import { createClient } from "npm:@supabase/supabase-js@2";
import { plan } from "../_shared/plan.mjs";
import { buildBrief, dayTimeline, renderBrief } from "../_shared/brief.mjs";
import { mailEdition, afternoonChanges } from "../_shared/editions.mjs";
const env = (k: string) => Deno.env.get(k);
async function callMailScript(data: Record<string, unknown>) {
  const url = new URL(env("GOOGLE_SCRIPT_URL")!);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec"))
    throw Error("Invalid Apps Script URL");
  const payload = JSON.stringify({ ...data, timestamp: Date.now() });
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(env("MIMI_MAIL_SIGNING_SECRET")!), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const signature = Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, "0")).join("");
  const response = await fetch(url, {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({payload, signature}),
    signal: AbortSignal.timeout(30000), redirect: "follow",
  });
  if (!response.ok) throw Error("Apps Script HTTP " + response.status);
  return await response.json();
}
function mailErrorCode(error: unknown) {
  const codes = ["missing_signing_secret", "signature_mismatch", "expired", "quota", "quota_check_failed", "busy"];
  return typeof error === "string" && codes.includes(error) ? error : "request_rejected";
}
Deno.serve(async (req) => {
  if (
    req.method !== "POST" ||
    !env("MIMI_CRON_SECRET") ||
    req.headers.get("authorization") !== "Bearer " + env("MIMI_CRON_SECRET")
  )
    return new Response("Forbidden", { status: 403 });
  if (new URL(req.url).searchParams.get("mailcheck") === "1") {
    const missing = ["GOOGLE_SCRIPT_URL", "MIMI_MAIL_SIGNING_SECRET"].filter(k => !env(k));
    if (missing.length) return Response.json({code:"MISSING_CONFIGURATION", missing}, {status:500});
    try {
      // No recipient, business ID or content: even the old script cannot send this probe.
      const result = await callMailScript({action:"check"});
      if (result?.status === "ready") return Response.json({status:"ready"});
      return Response.json({code:mailErrorCode(result?.error)}, {status:502});
    } catch {
      return Response.json({code:"mail_endpoint_unavailable"}, {status:502});
    }
  }
  const owner_id = env("MIMI_OWNER_ID")?.trim();
  const edition = new URL(req.url).searchParams.get("edition") ?? "morning";
  if (!["morning","afternoon","evening"].includes(edition))
    return Response.json({error:"未知邮件时段"}, {status:400});
  const morning = edition === "morning";
  const {sentDay, day, id, subject} = mailEdition(edition, Date.now(), owner_id);
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MIMI_OWNER_ID"]
    .filter((name) => !env(name)?.trim());
  if (missing.length)
    return Response.json(
      { error: "缺少服务端配置", code: "MISSING_CONFIGURATION", missing },
      { status: 500 },
    );
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner_id!))
    return Response.json(
      { error: "MIMI_OWNER_ID 必须填写 profiles.owner_id 对应的用户 UUID", code: "INVALID_OWNER_ID" },
      { status: 500 },
    );
  let stage = "connect_database";
  try {
    const db = createClient(
      env("SUPABASE_URL")!,
      env("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    stage = "read_records";
    const records = [];
    for (let n = 0; ; n += 500) {
      const { data, error, status: upstreamStatus } = await db
        .from("records")
        .select("*")
        .eq("owner_id", owner_id)
        .or(
          `and(kind.eq.event,day.eq.${day}),and(kind.eq.task,day.eq.${day},done.eq.false),and(kind.eq.goal,done.eq.false)`
        )
        .order("id")
        .range(n, n + 499);
      if (error) {
        // Forward only a database error code, never the raw message or query data.
        const dbCode = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code) ? error.code : null;
        const hints: Record<string, string> = {
          PGRST205: "请检查 Data API 是否能看到 public.records",
          "42P01": "请检查 Mimi 的 records 表是否已经创建",
          "42501": "请检查服务端数据库角色读取 records 的权限",
          "42703": "请检查 records 的字段是否与 Mimi 的建表脚本一致",
          "22P02": "数据库拒绝了查询参数，请检查 owner_id 的字段类型与配置",
          PGRST100: "数据库未能解析日程筛选条件",
        };
        return Response.json({
          code: "RECORDS_QUERY_FAILED", stage, dbCode, upstreamStatus,
          error: hints[dbCode ?? ""] ?? "读取 records 失败",
        }, { status: 500 });
      }
      records.push(...data!);
      if (data!.length < 500) break;
    }
    const preview =
      new URL(req.url).searchParams.has("preview") ||
      !env("GOOGLE_SCRIPT_URL") ||
      !env("MIMI_MAIL_SIGNING_SECRET") ||
      !env("MAIL_TO");
    const makePlan = async () => {
      const current = await buildBrief(plan(records, day, edition === "afternoon" ? 870 : 540, true), records, env("DEEPSEEK_API_KEY")?.trim(), edition);
      if (edition !== "afternoon") return current;
      const {data: baseline} = await db.from("daily_plans").select("plan")
        .eq("owner_id",owner_id).eq("day",sentDay).maybeSingle().throwOnError();
      const morningTimeline = baseline?.plan ? dayTimeline(baseline.plan).filter(i => i.start < 870) : [];
      return {...current, morningTimeline, changes:afternoonChanges(baseline?.plan, current)};
    };
    if (new URL(req.url).searchParams.has("preview")) {
      return Response.json({ sent: false, edition, subject, preview: renderBrief(await makePlan(), edition) });
    }
    stage = "save_plan";
    const table = morning ? "daily_plans" : "mail_briefings";
    const readSnapshot = () => {
      const query = db.from(table).select("plan").eq("owner_id", owner_id).eq("day", sentDay);
      return morning ? query : query.eq("edition",edition);
    };
    let {data: saved} = await readSnapshot().maybeSingle().throwOnError();
    if (!saved) {
      const current = await makePlan();
      await db.from(table).upsert(
        { owner_id, day:sentDay, plan: current, ...(morning ? {} : {edition}) },
        { onConflict: morning ? "owner_id,day" : "owner_id,day,edition", ignoreDuplicates: true },
      ).throwOnError();
      ({data: saved} = await readSnapshot().single().throwOnError());
    }
    if (preview)
      return Response.json({
        sent: false,
        reason: "缺少发信配置",
        preview: renderBrief(saved!.plan, edition),
      });
    stage = "claim_mail";
    const { data: claimed } = await db
      .rpc(morning ? "claim_mail" : "claim_briefing", { person: owner_id, target: sentDay, ...(morning ? {} : {slot:edition}) })
      .throwOnError();
    if (!claimed)
      return Response.json({
        sent: false,
        reason: "已发送、发送中或重试次数已用尽",
      });
    let status = "sent",
      detail = "accepted";
    try {
      status = "uncertain";
      const result = await callMailScript({
        id, to:"1436035656@qq.com",
        subject, html:renderBrief(saved!.plan, edition),
      });
      if (!["sent","failed","uncertain"].includes(result.status)) throw Error("Invalid response");
      status = result.status;
      detail = status === "sent" ? "accepted" : status === "failed" ? mailErrorCode(result.error) : "uncertain";
    } catch (e) {
      status = "uncertain";
      detail = e instanceof Error ? e.message : "邮件服务连接失败";
    }
    stage = "log_delivery";
    const deliveryLog = db
      .from(morning ? "email_delivery_logs" : table)
      .update({ status, detail, updated_at: new Date().toISOString() })
      .eq("owner_id", owner_id)
      .eq("day", sentDay);
    await (morning ? deliveryLog : deliveryLog.eq("edition",edition)).throwOnError();
    return Response.json(
      { status, detail, ...(status === "failed" ? {code:detail} : {}) },
      { status: status === "sent" ? 200 : 502 },
    );
  } catch {
    return Response.json(
      { error: "每日计划执行失败", code: "DAILY_FAILED", stage },
      { status: 500 },
    );
  }
});
