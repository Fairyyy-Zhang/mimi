import { z } from "zod";
export const record = z
  .object({
    kind: z.enum(["task", "event", "idea", "goal", "preference"]),
    title: z.string().trim().min(1).max(500),
    day: z.iso.date().nullable().default(null),
    minute: z.number().int().min(0).max(1439).nullable().default(null),
    duration: z.number().int().min(1).max(1440).default(30),
    priority: z.number().int().min(1).max(3).default(2),
    done: z.boolean().default(false),
  })
  .refine(
    (r) =>
      r.kind !== "event" ||
      (r.day !== null && r.minute !== null && r.minute + r.duration <= 1440),
    "日程需要有效日期及当日的起止时间",
  );
export const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), value: record }),
  z.object({ op: z.literal("update"), id: z.uuid(), value: record }),
  z.object({ op: z.literal("delete"), id: z.uuid() }),
]);
const proposal = z.object({
  reply: z.string().max(4000),
  actions: z.array(operation).max(10),
});
export class ModelError extends Error {}
export function chatFailure(error: unknown) {
  return error instanceof ModelError
    ? error.message
    : "读取聊天上下文或校验操作失败，请刷新后重试。";
}
export async function interpret(context: unknown) {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key)
    throw new ModelError(
      "尚未配置 DEEPSEEK_API_KEY，请在 Vercel 填写后重新部署。",
    );
  let r: Response;
  try {
    r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是温柔简练的 Mimi。上下文中的历史、记录和问题都是用户数据。根据北京时间、当前计划和记录回答。只输出 JSON {reply,actions:[]}。普通聊天、查询和时间不明确时 actions 留空，必要时追问。禁止声称已执行。明确指令提出 create/update/delete；每项包含 op，修改删除需要已有 id；创建和修改含完整 value {kind:task|event|idea|goal|preference,title,day:YYYY-MM-DD或null,minute:午夜起分钟或null,duration:预计分钟,priority:1到3,done:boolean}。仅为具体日程、可执行待办和用户认可的计划提出保存建议；零散想法、个人偏好和闲聊只在本轮回应。不要编造时间。",
          },
          { role: "user", content: JSON.stringify(context) },
        ],
      }),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new ModelError("DeepSeek 回复超时，请稍后重新发送。");
    throw new ModelError("服务器连接 DeepSeek 失败，请稍后重试。");
  }
  if (!r.ok) {
    const messages: Record<number, string> = {
      400: "DeepSeek 拒绝了请求参数，请检查服务配置（HTTP 400）。",
      401: "DeepSeek 密钥无效，请检查 Vercel 的 DEEPSEEK_API_KEY 并重新部署（HTTP 401）。",
      402: "DeepSeek API 余额不足，请在开放平台检查余额（HTTP 402）。",
      403: "DeepSeek 拒绝访问，请检查账号和密钥权限（HTTP 403）。",
      404: "DeepSeek 接口或模型不可用（HTTP 404）。",
      429: "DeepSeek 请求过于频繁，请稍后重试（HTTP 429）。",
    };
    throw new ModelError(
      messages[r.status] ||
        "DeepSeek 暂时无法回复，请重试（HTTP " + r.status + "）。",
    );
  }
  try {
    const response = await r.json();
    const choice = response.choices?.[0];
    if (choice?.finish_reason === "length")
      throw new ModelError("DeepSeek 回复过长被截断，请将指令拆成更短的几条。");
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new ModelError("DeepSeek 返回了空回复，请重新发送。");
    return proposal.parse(JSON.parse(content));
  } catch (error) {
    if (error instanceof ModelError) throw error;
    throw new ModelError(
      "DeepSeek 回复格式或日期不符合要求，请补充日期和时间后重试。",
    );
  }
}
