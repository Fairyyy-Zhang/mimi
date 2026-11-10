import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mailEdition, afternoonChanges } from "../supabase/functions/_shared/editions.mjs";
import { plan } from "../supabase/functions/_shared/plan.mjs";
import { renderBrief } from "../supabase/functions/_shared/brief.mjs";

test("三个时段独立投递，晚间跨年核对明天", async () => {
  const now = Date.parse("2026-12-31T22:00:00+08:00");
  const owner = "abcdef01-0000-0000-0000-000000000001";
  const editions = ["morning","afternoon","evening"].map(slot=>mailEdition(slot,now,owner));
  assert.equal(editions[0].id, "mimi-"+owner+"-2026-12-31");
  assert.equal(new Set(editions.map(e=>e.id)).size,3);
  assert.equal(editions[2].day,"2027-01-01");
  assert.equal(editions[2].sentDay,"2026-12-31");
  const html = renderBrief(plan([],editions[2].day),"evening");
  assert.match(html,/2027-01-01/);
  assert.match(html,/请你确认/);
  const sql = await readFile(new URL("../supabase/cron.sql",import.meta.url),"utf8");
  assert.match(sql,/'mimi-afternoon','30,35,40 6 \* \* \*','afternoon'/);
  assert.match(sql,/'mimi-evening','0,5,10 14 \* \* \*','evening'/);
});
test("下午从 14:30 排未完成事项，保留进行中的日程并指出实际变化", () => {
  const day = "2026-11-10";
  const event = (title,minute) => ({kind:"event",day,title,minute,duration:60});
  const records = [event("上午课",540),event("讨论",840),event("约谈",960)];
  const morning = plan(records,day);
  const current = plan([records[0],records[1],event("新预约",1020),
    {kind:"task",title:"写提纲",duration:30,priority:2}],day,870);
  assert.deepEqual(current.items.map(i=>[i.title,i.start]),[["讨论",840],["写提纲",900],["新预约",1020]]);
  const changes = afternoonChanges(morning,current);
  assert.match(changes,/新预约/); assert.match(changes,/约谈/);
  assert.doesNotMatch(changes,/上午课/);
});
