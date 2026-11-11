import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { buildBrief, dayTimeline, renderBrief } from "../supabase/functions/_shared/brief.mjs";
import vm from "node:vm";
import { mailEdition, afternoonChanges } from "../supabase/functions/_shared/editions.mjs";
import { dayOf, plan, time } from "../supabase/functions/_shared/plan.mjs";

test("每日函数先鉴权，再检查配置；不泄漏密钥或访问数据库", async () => {
  const source = await readFile(new URL("../supabase/functions/daily/index.ts", import.meta.url), "utf8");
  const code = stripTypeScriptTypes(source.replace(/^import .*;\r?$/gm, ""));
  const settings = {
    MIMI_CRON_SECRET: "private-cron-fixture",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "private-service-fixture",
    MIMI_OWNER_ID: "00000000-0000-0000-0000-000000000001",
  };
  let handler;
  let databaseCalls = 0;
  vm.runInNewContext(code, {
    Deno: { env: { get: (key) => settings[key] }, serve: (fn) => { handler = fn; } },
    Response, URL, mailEdition, afternoonChanges,
    dayOf: () => "2026-11-09",
    createClient: () => { databaseCalls++; throw Error("Database must not be accessed"); },
  });
  const request = (authorized = true) => new Request("https://example.supabase.co/functions/v1/daily?preview=1", {
    method: "POST", headers: authorized ? { authorization: "Bearer " + settings.MIMI_CRON_SECRET } : {},
  });
  assert.equal((await handler(request(false))).status, 403);
  for (const key of ["MIMI_OWNER_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const original = settings[key];
    delete settings[key];
    const response = await handler(request());
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.code, "MISSING_CONFIGURATION");
    assert.deepEqual(body.missing, [key]);
    assert.ok(!JSON.stringify(body).includes("private-"));
    settings[key] = original;
  }
  settings.MIMI_OWNER_ID = "not-a-user-uuid";
  assert.equal((await (await handler(request())).json()).code, "INVALID_OWNER_ID");
  assert.equal(databaseCalls, 0);
});

test("预览保留查询错误码，隐藏原始数据，空日程也可以预览", async () => {
  const source = await readFile(new URL("../supabase/functions/daily/index.ts", import.meta.url), "utf8");
  const code = stripTypeScriptTypes(source.replace(/^import .*;\r?$/gm, ""));
  let handler;
  let result = { error: { code: "42501", message: "confidential fixture" }, status: 403 };
  const query = {
    select() { return this; }, eq() { return this; }, or() { return this; },
    order() { return this; }, range() { return Promise.resolve(result); },
  };
  const settings = { MIMI_OWNER_ID: "00000000-0000-0000-0000-000000000001", MIMI_CRON_SECRET: "fixture",
    SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" };
  vm.runInNewContext(code, {
    Deno: { env: { get: k => settings[k] }, serve: fn => { handler = fn; } },
    Response, URL, dayOf, plan, time, buildBrief, dayTimeline, renderBrief, mailEdition, afternoonChanges,
    createClient: () => ({ from(table) { assert.equal(table, "records"); return query; } }),
  });
  const req = new Request("https://example.supabase.co/functions/v1/daily?preview=1", {
    method: "POST", headers: { authorization: "Bearer fixture" },
  });
  const failed = await handler(req);
  assert.equal(failed.status, 500);
  const body = await failed.json();
  assert.equal(body.stage, "read_records");
  assert.equal(body.dbCode, "42501");
  assert.equal(body.upstreamStatus, 403);
  assert.ok(!JSON.stringify(body).includes("confidential"));
  result = { data: [], status: 200, error: null };
  const preview = await handler(req);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).sent, false);
});
