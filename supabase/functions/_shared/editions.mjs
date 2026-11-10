import { dayOf, time } from "./plan.mjs";

export function mailEdition(slot, instant, owner) {
  const sentDay = dayOf(instant);
  const day = slot === "evening" ? dayOf(instant + 86400000) : sentDay;
  const label = {morning:"今日行程安排", afternoon:"下午日程更新", evening:"明日安排确认"}[slot];
  if (!label || !["morning","afternoon","evening"].includes(slot)) throw Error("Invalid edition");
  // The deployed Google script accepts hex and dashes before the date.
  // Preserve its existing morning key, and namespace each later delivery.
  const tag = {morning:"", afternoon:"-a", evening:"-e"}[slot];
  return {sentDay, day, subject:"Mimi | " + day + " " + label,
    id:"mimi-" + owner + tag + "-" + sentDay};
}

export function afternoonChanges(morning, current) {
  if (!Array.isArray(morning?.items)) return "";
  const lines = p => new Set(p.items.filter(i => i.fixed && i.end > 870)
    .map(i => time(i.start) + "–" + time(i.end) + " " + i.title));
  const before = lines(morning), after = lines(current);
  const added = [...after].filter(i => !before.has(i));
  const removed = [...before].filter(i => !after.has(i));
  return [
    added.length ? "比晨间计划新增或改到此时段：" + added.join("、") + "。" : "",
    removed.length ? "晨间列出的以下时段已调整或移出：" + removed.join("、") + "。" : "",
  ].filter(Boolean).join(" ") || "余下的固定日程与晨间计划一致。";
}
