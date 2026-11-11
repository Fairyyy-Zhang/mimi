import { planningSkill } from "./daily-planning/rules.mjs";

export function requestDeepSeek(key, messages, timeout = 45000) {
  return fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: messages.map((message) =>
        message.role === "system"
          ? { ...message, content: message.content + "\n\n" + planningSkill }
          : message
      ),
    }),
  });
}
