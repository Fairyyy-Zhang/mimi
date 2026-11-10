# Google 邮件配置（2026-11-09）

晨间邮件按「日历已安排」「建议安排」两段展示，每行列出起止时间和行动。前者使用当天的固定日程原文。若 Edge Functions 的 Secrets 已保存聊天所用的 DEEPSEEK_API_KEY，后者会结合待办、未来七天的事项和偏好细化建议。模型暂时不可用时沿用已有任务时段。重新部署 daily 后，在原 PowerShell 窗口运行 `.\scripts\check-preview.ps1 -Headers $mimiHeaders -ShowPlan` 即可预览当天正文。

1. 打开 https://script.google.com 创建独立项目，将 google-apps-script/Code.gs 全文粘贴进去。
2. 在项目设置 → 脚本属性新增 MIMI_MAIL_SIGNING_SECRET，使用随机长密钥。请勿使用 DeepSeek 密钥代替。
3. 部署 → 新建部署 → Web 应用，执行身份选自己、访问权限允许任何人。完成 Google 发信授权，复制以 /exec 结尾的地址。接口本身通过请求体 HMAC、五分钟有效期、固定收件人、持久化投递记录保护。
4. 打开 https://supabase.com/dashboard/project/jzadkfjpuzozkodbijgh 进入 Mimi 项目。在 SQL Editor 依次执行 supabase/migrations/002_google_mail.sql、supabase/migrations/003_daily_service_grants.sql。首次建库还需先执行 001。若预览显示 read_records 和 42501，003 会为服务端角色补上所需权限。
5. Edge Functions → Secrets 保留 MIMI_OWNER_ID、MIMI_CRON_SECRET。新增 GOOGLE_SCRIPT_URL、MIMI_MAIL_SIGNING_SECRET（同脚本属性）、MAIL_TO=1436035656@qq.com。无需 Resend、MAIL_FROM 或新的 DeepSeek key。
6. PowerShell 中进入 mimi 目录，用已登录 CLI 部署：

```powershell
npx --yes supabase@3.0.0 login
npx --yes supabase@3.0.0 functions deploy daily --remote=jzadkfjpuzozkodbijgh --no-verify-jwt --use-api
```

`--use-api` 让 Supabase 在云端打包，无需本机安装 Docker。登录授权在自己的浏览器或终端中完成，不要把访问令牌发送到聊天中。部署只更新 daily 函数，不会执行数据库迁移，也不会自动创建定时任务。

已核实 CLI 3.0.0 的部署参数为 `--remote=项目标识`；旧版的 `--project-ref` 不适用于这里固定的版本。

如果浏览器登录显示“无法创建 CLI 登录会话”，可在 https://supabase.com/dashboard/account/tokens 创建或使用已有的个人访问令牌，范围限定 Mimi 项目，至少授予 Edge Functions 读写权限。然后取消旧登录流程，在同一个 PowerShell 窗口运行以下命令，直接通过环境变量认证（无需再次运行 login）：

```powershell
$mimiPat = Read-Host '粘贴 Supabase 个人访问令牌（输入隐藏）' -AsSecureString
$env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $mimiPat).Password
npx --yes supabase@3.0.0 functions deploy daily --remote=jzadkfjpuzozkodbijgh --no-verify-jwt --use-api
```

这个令牌用于 Supabase 部署，不是 DeepSeek 密钥、项目 anon/service_role key 或邮件签名密钥。不要发到聊天中。完成本次部署操作后关闭该 PowerShell 窗口即可结束本次会话的环境变量使用。

7. 在 Vault 设置 mimi_daily_url 为 https://jzadkfjpuzozkodbijgh.supabase.co/functions/v1/daily；mimi_cron_secret 必须与原 Secret 一致。SQL Editor 执行 supabase/cron.sql，UTC 01:00、01:05、01:10 即北京时间 09:00、09:05、09:10。
8. 本机环境变量 MIMI_CRON_SECRET 安全设置为同一值后先预览，再手动真实发送：

```powershell
$dailyUrl = 'https://jzadkfjpuzozkodbijgh.supabase.co/functions/v1/daily'
$headers = @{Authorization = 'Bearer ' + $env:MIMI_CRON_SECRET}
Invoke-RestMethod -Method Post -Uri ($dailyUrl + '?preview=1') -Headers $headers
# 下一条会真实发送当日计划，重复调用应跳过
Invoke-RestMethod -Method Post -Uri $dailyUrl -Headers $headers
```

预览不发送、不领取发信名额。检查 QQ 收件箱与垃圾箱；email_delivery_logs 中 sent 仅表示 Google 接受发送。failed 可由后续 Cron 重试，uncertain 和滞留 sending 必须核查 Google 发件箱及脚本执行记录，不能直接改为 failed 重发。Apps Script delivery: 开头属性用于防重复，切勿在未核实投递时删除。长期使用需留意脚本属性存储配额，归档前只清理超过业务重试窗口的历史记录。

已有 README 中 Resend 步骤已过时，请以本文为准。尚未在云端确认 Secrets、Vault、数据库迁移或定时任务状态。

Google 官方部署说明：https://developers.google.com/apps-script/guides/web

## 午后更新和晚间确认

在同一 Supabase 项目的 SQL Editor 执行 `supabase/migrations/004_mail_briefings.sql`，部署新版 daily，然后执行 `supabase/cron.sql`。三个同名任务可重复安装。Jobs 中应显示 mimi-morning、mimi-afternoon、mimi-evening。沿用现有 Vault 地址（以 /daily 结尾）和密钥。

北京时间 14:30 发送当天余下日程，与晨间快照比对固定安排的变化。22:00 发送明天的安排和核对问题，用户在 Mimi 修改后，次日晨间重新规划。两次分别在首次触发后 5、10 分钟进行补偿检查。新增时段的首份快照和投递状态保存在 mail_briefings，day 为北京时间发送日，plan.day 为计划日期。Google 脚本沿用同一部署。

PowerShell 在 mimi 目录预览两个时段：

```powershell
.\scripts\check-preview.ps1 -Headers $mimiHeaders -Edition afternoon -ShowPlan
.\scripts\check-preview.ps1 -Headers $mimiHeaders -Edition evening -ShowPlan
```
