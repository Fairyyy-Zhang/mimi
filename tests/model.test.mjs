import test from "node:test";
import assert from "node:assert/strict";
import { interpret, record } from "../lib/model.ts";
test("模型响应分流和 API 故障（模拟服务）", async () => {
  const original = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "fixture";
  try {
    for (const actions of [
      [],
      [{ op: "create", value: { kind: "idea", title: "欧洲旅居" } }],
      [{ op: "create", value: { kind: "task", title: "准备面试" } }],
    ]) {
      globalThis.fetch = async () =>
        Response.json({
          choices: [
            {
              message: { content: JSON.stringify({ reply: "好的", actions }) },
            },
          ],
        });
      const result = await interpret({});
      assert.equal(result.actions[0]?.value.kind, actions[0]?.value.kind);
    }
    globalThis.fetch = async () => new Response("", { status: 503 });
    await assert.rejects(interpret({}), /DeepSeek/);
    assert.equal(
      record.safeParse({
        title: "约会",
        kind: "event",
        day: "2026-02-30",
        minute: 10,
      }).success,
      false,
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.DEEPSEEK_API_KEY;
  }
});
test("定时配置按北京时间 09:00 首次触发", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../supabase/cron.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /0,5,10 1 \* \* \*/);
  assert.match(sql, /cron.timezone/);
});
