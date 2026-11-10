// PowerShell: $mimiHeaders.Authorization | node .\scripts\check-preview.mjs
const endpoint = "https://jzadkfjpuzozkodbijgh.supabase.co/functions/v1/daily?preview=1";
process.stdin.setEncoding("utf8");
let input = "";
for await (const part of process.stdin) input += part;
const authorization = input.trim();
if (!/^Bearer [^\s]+$/.test(authorization)) {
  console.error("当前 PowerShell 窗口缺少预览请求头，请在原窗口运行。");
  process.exitCode = 1;
} else {
  try {
    const res = await fetch(endpoint, {
      method: "POST", headers: { Authorization: authorization },
      redirect: "error", signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.sent === false && typeof body.preview === "string") {
      console.log("HTTP " + res.status + "：邮件预览成功。");
    } else {
      console.log("HTTP " + res.status);
      for (const key of ["stage", "code", "dbCode", "upstreamStatus", "missing"]) {
        if (body?.[key] != null) console.log(key, body[key]);
      }
      if (!body?.code) console.log("未收到新版诊断码。请查看 daily 函数此次调用的日志。");
      process.exitCode = 1;
    }
  } catch {
    console.error("预览请求未取得 HTTP 响应，请检查网络连接。");
    process.exitCode = 1;
  }
}
