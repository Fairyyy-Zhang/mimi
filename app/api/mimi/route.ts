import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { interpret, operation, chatFailure } from "../../../lib/model";
import { dayOf, plan } from "../../../supabase/functions/_shared/plan.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const fail = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
const request = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("chat"),
    id: z.uuid(),
    question: z.string().trim().min(1).max(4000),
  }),
  z.object({
    mode: z.literal("write"),
    id: z.uuid(),
    action: operation,
    version: z.string().optional(),
  }),
  z.object({ mode: z.literal("removeChat"), id: z.uuid() }),
  z.object({
    mode: z.literal("editChat"),
    id: z.uuid(),
    previous: z.string(),
    question: z.string().trim().min(1).max(4000),
  }),
]);
async function handler(req: Request) {
  const token = req.headers.get("Authorization");
  if (!token?.startsWith("Bearer ")) return fail("请先登录", 401);
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: token } },
      auth: { persistSession: false },
    },
  );
  const {
    data: { user },
  } = await db.auth.getUser(token.slice(7));
  if (!user || user.id !== process.env.MIMI_OWNER_ID)
    return fail("此账号没有访问权限", 403);
  async function rows(table: string) {
    const result = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db
        .from(table)
        .select("*")
        .eq("owner_id", user!.id)
        .order("created_at")
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      result.push(...data);
      if (data.length < 500) return result;
    }
  }
  if (req.method === "GET") {
    const [records, messages] = await Promise.all([
      rows("records"),
      rows("messages"),
    ]);
    return Response.json(
      { records, messages, plan: plan(records, dayOf()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const parsed = request.safeParse(await req.json());
  if (!parsed.success) return fail("请检查日期、时长和输入内容", 400);
  const b = parsed.data;
  if (b.mode === "editChat") {
    const { data } = await db
      .from("messages")
      .update({ question: b.question })
      .eq("id", b.id)
      .eq("question", b.previous)
      .select("id")
      .throwOnError();
    return data?.length
      ? Response.json({ ok: true })
      : fail("聊天已变动，请刷新后核对", 409);
  }
  if (b.mode === "removeChat") {
    await db.from("messages").delete().eq("id", b.id).throwOnError();
    return Response.json({ ok: true });
  }
  if (b.mode === "write") {
    const a = b.action;
    if (a.op === "create") {
      await db
        .from("records")
        .upsert(
          { ...a.value, id: b.id },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .throwOnError();
    } else {
      if (!b.version) return fail("请刷新后重新确认", 409);
      const q =
        a.op === "delete"
          ? db.from("records").delete()
          : db.from("records").update(a.value);
      const { data, error } = await q
        .eq("id", a.id)
        .eq("updated_at", b.version)
        .select("id");
      if (error) throw error;
      if (!data.length) return fail("记录已变动，请刷新后核对", 409);
    }
    return Response.json({ ok: true });
  }
  const cached = await db
    .from("messages")
    .select("answer")
    .eq("id", b.id)
    .maybeSingle()
    .throwOnError();
  if (cached.data?.answer) return Response.json(cached.data.answer);
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 60000).toISOString())
    .throwOnError();
  if ((count ?? 0) >= 12) return fail("请稍后再聊，每分钟最多 12 条", 429);
  const claim = await db
    .from("messages")
    .insert({ id: b.id, question: b.question });
  if (claim.error) return fail("消息已提交，请刷新聊天记录", 409);
  let answer;
  try {
    const [records, messages] = await Promise.all([
      rows("records"),
      rows("messages"),
    ]);
    const result = await interpret({
      today: dayOf(),
      records,
      plan: plan(records, dayOf()),
      history: messages.slice(-12),
      question: b.question,
    });
    answer = {
      ...result,
      reply: result.actions.length
        ? "我整理好了下面的建议。请逐项核对，确认后保存。"
        : result.reply,
      actions: result.actions.map((a) => {
        const target =
          a.op === "create" ? null : records.find((r) => r.id === a.id);
        if (a.op !== "create" && !target) throw Error("找不到要修改的记录");
        return {
          action: a,
          id: crypto.randomUUID(),
          version: target?.updated_at,
          title: target?.title,
        };
      }),
    };
  } catch (error) {
    answer = {
      reply: chatFailure(error),
      actions: [],
    };
  }
  await db.from("messages").update({ answer }).eq("id", b.id).throwOnError();
  return Response.json(answer);
}
async function serve(req: Request) {
  try {
    return await handler(req);
  } catch {
    return fail("操作未能确认，请刷新并检查连接或数据库配置", 503);
  }
}
export { serve as GET, serve as POST };
