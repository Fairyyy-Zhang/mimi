import test from "node:test";
import assert from "node:assert/strict";
import { dayOf, plan } from "../supabase/functions/_shared/plan.mjs";
test("北京时间跨天", () =>
  assert.equal(dayOf("2026-11-08T16:00:00Z"), "2026-11-09"));
const d = "2026-11-09",
  event = (minute, duration) => ({
    kind: "event",
    title: "会",
    day: d,
    minute,
    duration,
  }),
  task = (title, priority, extra = {}) => ({
    kind: "task",
    title,
    priority,
    duration: 40,
    ...extra,
  });
test("重叠日程，优先级及空闲时间", () => {
  const p = plan(
    [event(560, 30), event(570, 30), task("学习", 2), task("面试", 3)],
    d,
  );
  assert.deepEqual(p.top, ["面试", "学习"]);
  assert.deepEqual(p.conflicts, ["会"]);
  assert.equal(p.items[2].start, 600);
  assert.deepEqual(p.free, [
    [540, 560],
    [680, 1080],
  ]);
});
test("过期、已完成和未来任务", () => {
  const p = plan(
    [
      task("昨天", 1, { day: "2026-11-08" }),
      task("完成", 3, { done: true }),
      task("明天", 2, { day: "2026-11-10" }),
    ],
    d,
  );
  assert.deepEqual(p.overdue, ["昨天"]);
  assert.deepEqual(p.top, ["昨天"]);
});
test("无法安排的任务保留下来", () =>
  assert.deepEqual(plan([event(540, 540), task("读书", 1)], d).pending, [
    "读书",
  ]));
