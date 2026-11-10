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
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;",
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/001_mimi.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/002_google_mail.sql", import.meta.url),
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
    await db.exec("reset role; set role service_role");
    await assert.rejects(db.query("select * from public.records"), { code: "42501" });
    await db.exec("reset role");
    await db.exec(await readFile(new URL("../supabase/migrations/003_daily_service_grants.sql", import.meta.url), "utf8"));
    await db.exec("set role service_role");
    assert.equal((await db.query("select * from public.records where owner_id=$1", [owner])).rows.length, 1);
    await db.query("insert into public.daily_plans(owner_id,day,plan) values($1,current_date,'{}') on conflict(owner_id,day) do nothing", [owner]);
    assert.equal((await db.query("select plan from public.daily_plans where owner_id=$1", [owner])).rows.length, 1);
    await db.exec("reset role; set role authenticated");
    await db.exec("delete from records");
    assert.deepEqual((await db.query("select * from records")).rows, []);
    await db.exec("reset role; set role service_role");
    const claim = async () =>
      (await db.query("select claim_mail($1,current_date) ok", [owner])).rows[0]
        .ok;
    assert.equal(await claim(), true);
    assert.equal(await claim(), false);
    await db.exec("update email_delivery_logs set updated_at=now()-interval '10 minutes'");
    assert.equal(await claim(), false);
    await db.exec("update email_delivery_logs set status='uncertain'");
    assert.equal(await claim(), false);
    await db.exec("update email_delivery_logs set status='failed'");
    assert.equal(await claim(), true);
    await db.exec("update email_delivery_logs set status='sent'");
    assert.equal(await claim(), false);
    await db.exec("update email_delivery_logs set status='failed'");
    assert.equal(await claim(), true);
    await db.exec("update email_delivery_logs set status='failed'");
    assert.equal(await claim(), false);
    await db.exec("reset role");
    await db.exec(await readFile(new URL("../supabase/migrations/004_mail_briefings.sql", import.meta.url), "utf8"));
    await db.exec("set role service_role");
    const claimSlot = async slot => (await db.query(
      "select public.claim_briefing($1,current_date,$2) as ok", [owner,slot])).rows[0].ok;
    for (const edition of ["afternoon","evening"]) {
      await db.query("insert into public.mail_briefings(owner_id,day,edition,plan) values($1,current_date,$2,'{}')",[owner,edition]);
      assert.equal(await claimSlot(edition),true);
      assert.equal(await claimSlot(edition),false);
    }
    await db.exec("update public.mail_briefings set status='uncertain' where edition='afternoon'");
    assert.equal(await claimSlot("afternoon"),false);
    for (const expected of [true,true,false]) {
      await db.exec("update public.mail_briefings set status='failed' where edition='evening'");
      assert.equal(await claimSlot("evening"),expected);
    }
  } finally {
    await db.close();
  }
});
