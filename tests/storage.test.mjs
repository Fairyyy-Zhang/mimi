import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("迁移、个人权限、任务生命周期与发信重试", async () => {
  const db = new PGlite();
  try {
    const owner = crypto.randomUUID(),
      outsider = crypto.randomUUID(),
      id = crypto.randomUUID();
    await db.exec(
      "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;",
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/001_mimi.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query("insert into auth.users values ($1),($2)", [
      owner,
      outsider,
    ]);
    await db.query("insert into profiles(owner_id) values ($1)", [owner]);
    await db.exec("set role authenticated");
    const identify = (id) =>
      db.query("select set_config('test.uid',$1,false)", [id]);
    await identify(owner);
    const create = () =>
      db.query(
        "insert into records(id,kind,title) values($1,'task','学习') on conflict(id) do nothing",
        [id],
      );
    await create();
    await create();
    assert.equal((await db.query("select * from records")).rows.length, 1);
    await db.query("update records set title='看书',done=true where id=$1", [
      id,
    ]);
    assert.equal(
      (await db.query("select done from records")).rows[0].done,
      true,
    );
    await identify(outsider);
    assert.deepEqual((await db.query("select * from records")).rows, []);
    await assert.rejects(create);
    await assert.rejects(
      db.query("select claim_mail($1,current_date)", [owner]),
    );
    await identify(owner);
    await db.exec("delete from records");
    assert.deepEqual((await db.query("select * from records")).rows, []);
    await db.exec("reset role");
    const claim = async () =>
      (await db.query("select claim_mail($1,current_date) ok", [owner])).rows[0]
        .ok;
    assert.equal(await claim(), true);
    assert.equal(await claim(), false);
    await db.exec("update email_delivery_logs set status='failed'");
    assert.equal(await claim(), true);
    await db.exec("update email_delivery_logs set status='sent'");
    assert.equal(await claim(), false);
    await db.exec("update email_delivery_logs set status='failed'");
    assert.equal(await claim(), true);
    await db.exec("update email_delivery_logs set status='failed'");
    assert.equal(await claim(), false);
  } finally {
    await db.close();
  }
});
