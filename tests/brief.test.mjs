import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBrief,
  dayTimeline,
  renderBrief,
} from "../supabase/functions/_shared/brief.mjs";
import { plan } from "../supabase/functions/_shared/plan.mjs";
import { planningSkill } from "../supabase/functions/_shared/daily-planning/rules.mjs";

test("下午回看晨间建议并保留当天固定日程，缺少快照时标明未记录", () => {
  const morningTimeline = dayTimeline({items:[{start:600,end:645,title:"项目准备",fixed:false}]});
  const p = {items:[{start:840,end:900,title:"会议",fixed:true}], morningTimeline};
  const rows = dayTimeline(p, true);
  assert.ok(rows.some(i => i.title === "项目准备（晨间计划）"));
  assert.equal(rows[0].start,450);
  assert.equal(rows.at(-1).end,1320);
  assert.ok(rows.every((r,i) => !i || rows[i-1].end === r.start));
  assert.equal(dayTimeline({...p,morningTimeline:[]},true)[0].title,"未记录");
});

test("邮件只参考当天安排和长期目标，建议不能占用固定时间", async (t) => {
  const day = "2026-11-10";
  const records = [
    {
      kind: "event",
      day,
      title: "运动 <一小时>，测试场次待定。",
      minute: 1020,
      duration: 60,
    },
    {
      kind: "event",
      day: "2026-11-12",
      title: "面试",
      minute: 810,
      duration: 60,
    },
    { kind: "goal", title: "提升面试表达能力", done: false },
  ];
  const p = plan(records, day);
  t.mock.method(globalThis, "fetch", async (_, options) => {
    const messages = JSON.parse(options.body).messages;
    assert.ok(messages[0].content.includes(planningSkill));
    const input = JSON.parse(messages[1].content);
    assert.deepEqual(input.sources.map(r => r.title), [records[0].title, records[2].title]);
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              details: [{ item: 0, text: "更改日历" }],
              extra: [
                { source: 1, start: 1050, end: 1090, text: "冲突时段" },
                {
                  source: 1,
                  start: 1140,
                  end: 1180,
                  text: "挑一段经历，写下决定和结果。",
                },
                { source: 99, start: 1200, end: 1220, text: "无依据" },
              ],
            }),
          },
        },
      ],
    });
  });
  const brief = await buildBrief(p, records, "test");
  const html = renderBrief(brief);
  assert.match(
    html,
    /日历已安排.*17:00–18:00.*运动 &lt;一小时&gt;，测试场次待定。.*建议安排.*19:00–19:40.*挑一段经历/s,
  );
  assert.doesNotMatch(html, /更改日历|冲突时段|无依据/);
  assert.match(html, /建议安排（今日全天）.*07:30.*【已确定】运动.*自由活动.*22:00/s);
  assert.equal(brief.suggestions.length, 1);
  assert.deepEqual(brief.items, p.items);
});

test("旧快照和模型不可用时也按两段显示已有日程及待办", async (t) => {
  const p = {
    day: "2026-11-10",
    items: [{ start: 570, end: 600, title: "核对材料", fixed: false }],
  };
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 503 }),
  );
  const result = await buildBrief(
    p,
    [{ kind: "task", title: "核对材料" }],
    "test",
  );
  assert.equal(renderBrief(p), renderBrief(result));
  assert.match(
    renderBrief(p),
    /今天没有已确认的日历安排。.*建议安排.*09:30–10:00.*核对材料/s,
  );
});
