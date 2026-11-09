import { createClient } from "npm:@supabase/supabase-js@2";
import { dayOf, plan, time } from "../_shared/plan.mjs";
const env = (k: string) => Deno.env.get(k);
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function html(p: ReturnType<typeof plan>) {
  const list = (title: string, items: string[]) =>
    "<h2>" +
    title +
    "</h2><ul>" +
    (items.length ? items : ["暂无"])
      .map((s) => "<li>" + escape(s) + "</li>")
      .join("") +
    "</ul>";
  return (
    "<h1>" +
    p.day +
    " · Mimi 今日计划</h1>" +
    list("最重要的三件事", p.top) +
    list(
      "时间安排",
      p.items.map((i) => time(i.start) + " – " + time(i.end) + "　" + i.title),
    ) +
    list("今日截止", p.due) +
    list("此前未完成", p.overdue) +
    list("时间冲突", p.conflicts) +
    list("需要另行安排", p.pending) +
    "<p>给自己留一点休息的时间。—— Mimi</p>"
  );
}
Deno.serve(async (req) => {
  if (
    req.method !== "POST" ||
    !env("MIMI_CRON_SECRET") ||
    req.headers.get("authorization") !== "Bearer " + env("MIMI_CRON_SECRET")
  )
    return new Response("Forbidden", { status: 403 });
  const db = createClient(
    env("SUPABASE_URL")!,
    env("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const owner_id = env("MIMI_OWNER_ID"),
    day = dayOf();
  try {
    const records = [];
    for (let n = 0; ; n += 500) {
      const { data } = await db
        .from("records")
        .select("*")
        .eq("owner_id", owner_id)
        .order("id")
        .range(n, n + 499)
        .throwOnError();
      records.push(...data!);
      if (data!.length < 500) break;
    }
    const preview =
      new URL(req.url).searchParams.has("preview") ||
      !env("RESEND_API_KEY") ||
      !env("MAIL_FROM") ||
      !env("MAIL_TO");
    const current = plan(records, day);
    if (new URL(req.url).searchParams.has("preview"))
      return Response.json({ sent: false, preview: html(current) });
    await db
      .from("daily_plans")
      .upsert(
        { owner_id, day, plan: current },
        { onConflict: "owner_id,day", ignoreDuplicates: true },
      )
      .throwOnError();
    const { data: saved } = await db
      .from("daily_plans")
      .select("plan")
      .eq("owner_id", owner_id)
      .eq("day", day)
      .single()
      .throwOnError();
    if (preview)
      return Response.json({
        sent: false,
        reason: "缺少发信配置",
        preview: html(saved!.plan),
      });
    const { data: claimed } = await db
      .rpc("claim_mail", { person: owner_id, target: day })
      .throwOnError();
    if (!claimed)
      return Response.json({
        sent: false,
        reason: "已发送、发送中或重试次数已用尽",
      });
    let status = "sent",
      detail = "accepted";
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: "Bearer " + env("RESEND_API_KEY"),
          "Content-Type": "application/json",
          "Idempotency-Key": "mimi-" + owner_id + "-" + day,
        },
        body: JSON.stringify({
          from: env("MAIL_FROM"),
          to: [env("MAIL_TO")],
          subject: "Mimi · " + day + " 今日计划",
          html: html(saved!.plan),
        }),
      });
      if (!r.ok) throw Error("邮件服务 HTTP " + r.status);
    } catch (e) {
      status = "failed";
      detail = e instanceof Error ? e.message : "邮件服务连接失败";
    }
    await db
      .from("email_delivery_logs")
      .update({ status, detail, updated_at: new Date().toISOString() })
      .eq("owner_id", owner_id)
      .eq("day", day)
      .throwOnError();
    return Response.json(
      { status, detail },
      { status: status === "sent" ? 200 : 502 },
    );
  } catch {
    return Response.json(
      { error: "请检查数据库迁移和函数配置" },
      { status: 500 },
    );
  }
});
