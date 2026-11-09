"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  time,
  plan as buildPlan,
  dayOf,
} from "../supabase/functions/_shared/plan.mjs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = url && key ? createClient(url, key) : null;
const names: Record<string, string> = {
  task: "待办",
  event: "日程",
  idea: "灵感",
  goal: "长期目标",
  preference: "个人偏好",
};
const fresh = () => ({
  requestId: crypto.randomUUID(),
  kind: "task",
  title: "",
  day: "",
  minute: "",
  duration: 30,
  priority: 2,
  done: false,
});
export default function Home() {
  const [tab, T] = useState(0),
    [token, S] = useState(""),
    [records, R] = useState<any[]>([]),
    [messages, M] = useState<any[]>([]),
    [notice, N] = useState(""),
    [busy, B] = useState(false);
  const [draft, D] = useState<any>(null),
    [query, Q] = useState(""),
    [filter, F] = useState(""),
    [input, I] = useState(""),
    [email, E] = useState(""),
    [password, P] = useState("");
  const [today, Y] = useState(() => dayOf());
  const [chatIds, setChatIds] = useState<string[]>([]);
  const currentMessages = messages.filter((message) =>
    chatIds.includes(message.id),
  );
  function openTab(next: number) {
    if (next === 1 && tab !== 1) {
      setChatIds([]);
      I("");
    }
    T(next);
  }
  useEffect(() => {
    const reset = () => {
      if (document.visibilityState === "hidden") {
        setChatIds([]);
        I("");
      }
    };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => Y(dayOf()), 30000);
    return () => clearInterval(timer);
  }, []);
  const schedule = buildPlan(records, today);
  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    const subscription = db?.auth.onAuthStateChange((_, s) => {
      S(s?.access_token || "");
      if (!s) {
        R([]);
        M([]);
      }
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  async function api(body?: any) {
    const r = await fetch("/api/mimi", {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body && JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    return data;
  }
  async function refresh() {
    const data = await api();
    R(data.records);
    M(data.messages);
  }
  useEffect(() => {
    if (!token) return;
    let active = true;
    api()
      .then((d) => {
        if (active) {
          R(d.records);
          M(d.messages);
        }
      })
      .catch((e) => N(e.message));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    B(true);
    N("");
    try {
      await fn();
    } catch (e) {
      N(e instanceof Error ? e.message : "网络连接失败");
    } finally {
      B(false);
    }
  }
  async function write(
    action: any,
    id = crypto.randomUUID(),
    version?: string,
  ) {
    if (!token) throw Error("请先配置并登录个人账号");
    await api({ mode: "write", action, id, version });
    await refresh();
    N("已保存更改");
  }
  function update(r: any, value: any) {
    return run(() =>
      write(
        { op: "update", id: r.id, value: { ...r, ...value } },
        undefined,
        r.updated_at,
      ),
    );
  }
  function row(r: any) {
    return (
      <article key={r.id} className="record">
        {r.kind === "task" && (
          <button
            aria-label="切换完成状态"
            onClick={() => update(r, { done: !r.done })}
          >
            {r.done ? "☑" : "□"}
          </button>
        )}
        <div>
          <strong>{r.title}</strong>
          <small>
            {names[r.kind]}　{r.day} {r.minute != null && time(r.minute)}
          </small>
        </div>
        <button
          onClick={() =>
            D({
              ...r,
              day: r.day || "",
              minute: r.minute == null ? "" : time(r.minute),
            })
          }
        >
          编辑
        </button>
      </article>
    );
  }
  return (
    <main>
      <header>
        <b>
          <i>✦</i> Mimi
        </b>
        <span>私人特助</span>
      </header>
      {!token && (
        <details open={!!db}>
          <summary>{db ? "登录私人空间" : "配置个人空间"}</summary>
          {db ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const { error } = await db.auth.signInWithPassword({
                    email,
                    password,
                  });
                  if (error) throw Error("登录失败，请检查邮箱和密码");
                  P("");
                });
              }}
            >
              <input
                type="email"
                placeholder="邮箱"
                required
                value={email}
                onChange={(e) => E(e.target.value)}
              />
              <input
                type="password"
                placeholder="密码"
                required
                value={password}
                onChange={(e) => P(e.target.value)}
              />
              <button>登录</button>
            </form>
          ) : (
            <p>当前为界面预览。按 README 配置 Supabase 后即可登录并保存。</p>
          )}
        </details>
      )}
      <h1>{["今日计划", "与 Mimi 聊聊", "记忆与灵感箱"][tab]}</h1>
      {tab === 0 && (
        <>
          <section className="hero">
            <div className="familiar" aria-hidden="true" />
            <small>
              {new Date(today + "T12:00:00+08:00").toLocaleDateString("zh-CN", {
                timeZone: "Asia/Shanghai",
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </small>
            <h2>你好，今天想做些什么？</h2>
            <p>
              {schedule.top.join(" · ") || "把想做的事告诉我，我们一起安排。"}
            </p>
            <button onClick={() => openTab(1)}>✦　与 Mimi 聊聊　↗</button>
          </section>
          <section>
            <h2>今日时间轴</h2>
            {schedule.items.map((i: any, n: number) => (
              <p key={n}>
                <em>
                  {time(i.start)} – {time(i.end)}
                </em>
                　{i.title}
              </p>
            ))}
            {!schedule.items.length && <p>今天还没有安排。</p>}
            <small>
              空闲时段　
              {schedule.free
                .map(([a, b]: number[]) => time(a) + "–" + time(b))
                .join("、") || "已排满"}
            </small>
            {schedule.conflicts.length > 0 && (
              <p>日程重叠　{schedule.conflicts.join("、")}</p>
            )}
          </section>
          <section>
            <h2>
              我的待办 <button onClick={() => D(fresh())}>＋ 添加</button>
            </h2>
            {records
              .filter((r) => r.kind === "task" && (!r.day || r.day <= today))
              .map(row)}
            <small>{schedule.overdue.length} 项逾期未完成</small>
          </section>
        </>
      )}
      {tab === 1 && (
        <>
          <section>
            {currentMessages.length === 0 && (
              <p>想记下什么？也可以问我今天有哪些安排。</p>
            )}
            {currentMessages.map((m) => (
              <div key={m.id}>
                <p className="bubble">{m.question}</p>
                <p>{m.answer?.reply || "等待回复"}</p>
                {m.answer?.actions.map((p: any) => {
                  const saved =
                    p.action.op === "create" &&
                    records.find((r) => r.id === p.id);
                  if (saved)
                    return (
                      <button
                        key={p.id}
                        onClick={() =>
                          confirm("撤销保存并删除「" + saved.title + "」？") &&
                          run(() =>
                            write(
                              { op: "delete", id: p.id },
                              undefined,
                              saved.updated_at,
                            ),
                          )
                        }
                      >
                        已保存 · 撤销
                      </button>
                    );
                  return (
                    <button
                      disabled={busy}
                      key={p.id}
                      onClick={() => {
                        if (
                          confirm(
                            [
                              p.action.value?.title || p.title,
                              p.action.value?.day,
                              p.action.value?.minute != null
                                ? time(p.action.value.minute)
                                : "",
                              p.action.value?.duration
                                ? p.action.value.duration + " 分钟"
                                : "",
                              "确认执行？",
                            ]
                              .filter(Boolean)
                              .join("\n"),
                          )
                        )
                          run(() => write(p.action, p.id, p.version));
                      }}
                    >
                      {
                        (
                          {
                            create: "保存",
                            update: "修改",
                            delete: "删除",
                          } as Record<string, string>
                        )[p.action.op]
                      }{" "}
                      · {p.action.value?.title || p.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (!token) throw Error("请先登录");
                const id = crypto.randomUUID();
                setChatIds((previous) => [...previous, id]);
                await api({
                  mode: "chat",
                  id,
                  historyIds: chatIds.slice(-12),
                  question: input,
                });
                I("");
                await refresh();
              });
            }}
          >
            <textarea
              required
              maxLength={4000}
              placeholder="给 Mimi 留句话…"
              value={input}
              onChange={(e) => I(e.target.value)}
            />
            <small>可用 iPhone 键盘麦克风听写</small>
            <button disabled={busy}>发送 ↑</button>
          </form>
        </>
      )}
      {tab === 2 && (
        <>
          <input
            placeholder="搜索记录和聊天"
            value={query}
            onChange={(e) => Q(e.target.value)}
          />
          <section>
            <select value={filter} onChange={(e) => F(e.target.value)}>
              <option value="">所有记录</option>
              {Object.entries(names).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
              <option value="chat">聊天记录</option>
            </select>{" "}
            <button onClick={() => D(fresh())}>＋ 新记录</button>
            {records
              .filter(
                (r) =>
                  (!filter || filter === r.kind) && r.title.includes(query),
              )
              .map(row)}
            {(!filter || filter === "chat") &&
              messages
                .filter((m) =>
                  (m.question + (m.answer?.reply || "")).includes(query),
                )
                .map((m) => (
                  <article key={m.id}>
                    <p>{m.question}</p>
                    <p>{m.answer?.reply}</p>
                    <button
                      onClick={() => {
                        const question = prompt(
                          "修改自己的消息（保留原回复）",
                          m.question,
                        )?.trim();
                        if (question && question !== m.question)
                          run(async () => {
                            await api({
                              mode: "editChat",
                              id: m.id,
                              previous: m.question,
                              question,
                            });
                            await refresh();
                          });
                      }}
                    >
                      编辑消息
                    </button>
                    <button
                      onClick={() =>
                        confirm("删除这段聊天？") &&
                        run(async () => {
                          await api({ mode: "removeChat", id: m.id });
                          await refresh();
                        })
                      }
                    >
                      删除聊天
                    </button>
                  </article>
                ))}
          </section>
          {token && (
            <>
              <button
                onClick={() =>
                  run(async () => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(
                      new Blob([JSON.stringify(await api(), null, 2)], {
                        type: "application/json",
                      }),
                    );
                    a.download = "mimi-" + today + ".json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                  })
                }
              >
                导出个人记录
              </button>{" "}
              <button onClick={() => db?.auth.signOut()}>退出登录</button>
            </>
          )}
        </>
      )}
      {draft && (
        <dialog open>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const [h, m] = String(draft.minute).split(":").map(Number);
                const value = {
                  ...draft,
                  minute: draft.minute === "" ? null : h * 60 + m,
                  day: draft.day || null,
                };
                await write(
                  draft.id
                    ? { op: "update", id: draft.id, value }
                    : { op: "create", value },
                  draft.requestId,
                  draft.updated_at,
                );
                D(null);
              });
            }}
          >
            <h2>{draft.id ? "编辑记录" : "添加记录"}</h2>
            <select
              value={draft.kind}
              onChange={(e) => D({ ...draft, kind: e.target.value })}
            >
              {Object.entries(names).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <label>
              内容
              <input
                autoFocus
                required
                maxLength={500}
                value={draft.title}
                onChange={(e) => D({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              日期
              <input
                required={draft.kind === "event"}
                type="date"
                value={draft.day}
                onChange={(e) => D({ ...draft, day: e.target.value })}
              />
            </label>
            {draft.kind === "event" && (
              <label>
                开始时间
                <input
                  required
                  type="time"
                  value={draft.minute}
                  onChange={(e) => D({ ...draft, minute: e.target.value })}
                />
              </label>
            )}
            <label>
              预计分钟
              <input
                type="number"
                min="1"
                max="1440"
                required
                value={draft.duration}
                onChange={(e) =>
                  D({ ...draft, duration: Number(e.target.value) })
                }
              />
            </label>
            <label>
              优先级
              <select
                value={draft.priority}
                onChange={(e) =>
                  D({ ...draft, priority: Number(e.target.value) })
                }
              >
                <option value="1">低</option>
                <option value="2">普通</option>
                <option value="3">高</option>
              </select>
            </label>
            <div>
              <button disabled={busy}>确认保存</button>{" "}
              <button type="button" onClick={() => D(null)}>
                取消
              </button>{" "}
              {draft.id && (
                <button
                  type="button"
                  onClick={() =>
                    confirm("确定删除这条记录？") &&
                    run(async () => {
                      await write(
                        { op: "delete", id: draft.id },
                        undefined,
                        draft.updated_at,
                      );
                      D(null);
                    })
                  }
                >
                  删除
                </button>
              )}
            </div>
          </form>
        </dialog>
      )}
      {notice && (
        <aside role="status" onClick={() => N("")}>
          {notice}
        </aside>
      )}
      <nav>
        {["今日", "聊天", "灵感箱"].map((s, n) => (
          <button
            aria-current={tab === n ? "page" : undefined}
            key={s}
            onClick={() => openTab(n)}
          >
            {["◷", "✦", "▤"][n]}　{s}
          </button>
        ))}
      </nav>
    </main>
  );
}
