export const dayOf = (instant = Date.now()) =>
  new Date(Number(new Date(instant)) + 8 * 3600000).toISOString().slice(0, 10);
export function plan(records, day) {
  const tasks = records
    .filter((r) => r.kind === "task" && !r.done && (!r.day || r.day <= day))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.day || "9999").localeCompare(b.day || "9999"),
    );
  const events = records
    .filter((r) => r.kind === "event" && r.day === day)
    .sort((a, b) => a.minute - b.minute);
  const items = events.map((e) => ({
    title: e.title,
    start: e.minute,
    end: e.minute + e.duration,
    fixed: true,
  }));
  const conflicts = items
    .filter((e, i) => items.slice(0, i).some((p) => p.end > e.start))
    .map((e) => e.title);
  function gaps() {
    const free = [];
    let cursor = 540;
    for (const i of [...items].sort((a, b) => a.start - b.start)) {
      if (i.start > cursor && cursor < 1080)
        free.push([cursor, Math.min(1080, i.start)]);
      cursor = Math.max(cursor, i.end);
    }
    if (cursor < 1080) free.push([cursor, 1080]);
    return free;
  }
  const pending = [];
  for (const t of tasks) {
    const gap = gaps().find(([a, b]) => b - a >= t.duration);
    if (gap)
      items.push({
        title: t.title,
        start: gap[0],
        end: gap[0] + t.duration,
        fixed: false,
      });
    else pending.push(t.title);
  }
  return {
    day,
    top: tasks.slice(0, 3).map((t) => t.title),
    items: items.sort((a, b) => a.start - b.start),
    free: gaps(),
    conflicts,
    pending,
    overdue: tasks.filter((t) => t.day && t.day < day).map((t) => t.title),
    due: tasks.filter((t) => t.day === day).map((t) => t.title),
  };
}
export const time = (m) =>
  String(Math.floor(m / 60)).padStart(2, "0") +
  ":" +
  String(m % 60).padStart(2, "0");
