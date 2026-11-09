import test from "node:test";
import assert from "node:assert/strict";
import { interpret, record, chatFailure } from "../lib/model.ts";
test("模型故障分类、超时和隐私保护", async () => {
  const original = globalThis.fetch;
  const previous = process.env.DEEPSEEK_API_KEY;
  try {
    delete process.env.DEEPSEEK_API_KEY;
    await assert.rejects(interpret({}), /尚未配置/);
    process.env.DEEPSEEK_API_KEY = " fixture ";
    for (const [status, message] of [
      [401, /密钥无效/],
      [402, /余额不足/],
      [429, /过于频繁/],
      [500, /HTTP 500/],
    ]) {
      globalThis.fetch = async () =>
        new Response("sensitive provider details", { status });
      await assert.rejects(interpret({}), message);
    }
    globalThis.fetch = async () => {
      throw new DOMException("secret detail", "TimeoutError");
    };
    await assert.rejects(interpret({}), /超时/);
    globalThis.fetch = async () => {
      throw Error("secret detail");
    };
    await assert.rejects(interpret({}), /连接 DeepSeek 失败/);
    for (const content of [
      "   ",
      "broken json",
      '{"reply":"hi","actions":[{"op":"delete","id":"bad"}]}',
    ]) {
      globalThis.fetch = async () =>
        Response.json({ choices: [{ message: { content } }] });
      await assert.rejects(interpret({}), /空回复|格式或日期/);
    }
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(options.headers.Authorization, "Bearer fixture");
      return Response.json({
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      });
    };
    await assert.rejects(interpret({}), /截断/);
    assert.doesNotMatch(chatFailure(Error("secret detail")), /secret/);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
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
