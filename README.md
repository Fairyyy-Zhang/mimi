# Mimi · AI 私人特助

Mimi 是个人使用的中文 iPhone PWA。今日页把固定日程、待办和空闲时段放在同一张计划里。聊天页通过 DeepSeek 理解指令，灵感箱保存任务、日程、想法、目标和偏好。使用 Next.js App Router、TypeScript、原生 CSS、Supabase Auth 和 PostgreSQL。服务器可运行在 Vercel 或普通 Node.js 主机。

## 在电脑上打开

使用 Node.js 24 和 npm，在本目录运行：

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

打开 http://localhost:3000。无配置时可预览三个页面，保存和聊天需要登录。已有 .env.local 时跳过复制步骤。生产运行用 `npm run build` 和 `npm start`。

## 建立私人空间

1. 创建 Supabase 项目。在 SQL Editor 执行 `supabase/migrations/001_mimi.sql` 一次。后续 Schema 变更应新增迁移。
2. 在 Authentication 的 Users 中创建自己的邮箱密码账号，确认邮箱状态，复制用户 UUID。在登录设置中关闭公开注册。
3. 在 SQL Editor 将下句的占位符换成该 UUID 并执行。唯一约束限制项目只能有一位主人。

   ```sql
   insert into public.profiles(owner_id) values ('你的用户UUID');
   ```

4. 在 .env.local 的 NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY 填项目地址和公开 anon 或 publishable key。在 MIMI_OWNER_ID 填同一 UUID。在 DEEPSEEK_API_KEY 填自己从 DeepSeek 开放平台创建的密钥。服务地址为 https://api.deepseek.com，模型为 deepseek-flash。浏览器仅接收 NEXT_PUBLIC_ 配置。
5. 重启开发服务器或重新构建生产版本。在 Mimi 中登录。聊天时问题、相关个人数据（当前版本读取全部记录）、今日计划及本次聊天中最近 12 轮对话会发送给 DeepSeek。可直接用表单管理不希望提交给模型的内容，但账号内记录仍可能进入后续聊天请求。

## 整理记录

在今日页添加任务。在灵感箱选择类型、日期、优先级和时长。编辑日期即可延期。勾选方框切换完成状态。聊天建议逐条确认后写入，修改和删除会检查原记录版本。持久化操作失败会显示提示。iOS 输入框可直接使用系统键盘听写。

计划采用北京时间，默认可安排时段为 09:00–18:00。先放固定日程，再按优先级、截止日安排到足够长的空档；超出容量的任务保留。跨午夜的固定日程请拆成两条。邮件保存当天首次生成的快照，今日页随当前记录更新。

## 开启每日邮件

1. 在 Resend 配置已验证的发信域名和发件地址，生成发信 API key。准备自己的收件邮箱。
2. 在 Supabase Edge Function Secrets 设置 MIMI_OWNER_ID、RESEND_API_KEY、MAIL_FROM、MAIL_TO 和随机生成的长密钥 MIMI_CRON_SECRET。Edge 运行环境提供 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。
3. 使用已登录的 Supabase CLI，从当前目录部署函数。将 PROJECT_REF 换成项目标识。函数使用独立 Bearer 密钥鉴权。

   ```sh
   supabase functions deploy daily --project-ref PROJECT_REF --no-verify-jwt
   ```

4. 手动预览。下面是 PowerShell 命令，先把本次会话环境变量 MIMI_CRON_SECRET 设为函数相同的值。预览不会占用当天发信名额。移除问号及其后内容，重新执行即测试真实发送，占用当天名额。缺少发信凭证会返回预览。

   ```powershell
   $dailyUrl = 'https://PROJECT_REF.supabase.co/functions/v1/daily'
   $headers = @{Authorization = 'Bearer ' + $env:MIMI_CRON_SECRET}
   Invoke-RestMethod -Method Post -Uri ($dailyUrl + '?preview=1') -Headers $headers
   ```

5. 在 Supabase Vault 创建 mimi_daily_url（上述完整函数地址）和 mimi_cron_secret（相同密钥）。在 SQL Editor 执行 `supabase/cron.sql`。脚本检查 cron.timezone，使用 UTC 01:00，对应北京时间 09:00。01:05 和 01:10 触发两次补偿检查。数据库按用户和日期原子领取发送资格，Resend 使用相同日期幂等键。当日成功后跳过重发。
6. 查看 daily_plans 的计划快照、email_delivery_logs 的状态与尝试次数，以及 cron.job_run_details 和函数日志。sent 表示邮件服务接受，收件和垃圾箱仍需检查。凭证缺失时返回 sent=false。恢复后可再次手动触发。

## 部署并安装到 iPhone

仅将 **mimi 目录**作为独立 Git 仓库。确认 git status 和 .gitignore 后提交代码，推送至自己的 GitHub 私有仓库。不要上传上级项目、个人导出和环境文件。Vercel 导入该仓库，选择 Next.js，在项目设置填写前四项应用环境变量，部署后通过 HTTPS 打开。邮件定时器位于 Supabase，网页服务器无需常驻定时进程。

也可在香港或大陆服务器使用 Node 24 运行 npm ci、npm run build、npm start，使用反向代理配置证书和 HTTPS。公开 Supabase 参数需要在构建时提供。上线前请在实际使用地用 Wi-Fi 和蜂窝网络分别验证登录、聊天、写入和重新打开。大陆可达性需要实测。

iPhone Safari 打开正式 HTTPS 地址，登录后通过分享菜单选择“添加到主屏幕”。离线打开会显示重连页面。Service Worker 只提供离线导航提示，不写缓存。键盘听写由系统负责。

## 数据和备份

records 按 kind 保存五类记录，messages 保存单一对话的每轮问答和建议，daily_plans 的 JSON 快照包含计划明细。profiles 用于唯一主人白名单。数据库对个人数据启用 RLS。灵感箱的导出按钮下载 JSON，含当前记录、聊天和即时计划。请把导出保存在自己的加密存储中。完整备份使用 Supabase 数据库备份，或用 pg_dump 的自定义格式导出并在独立测试库用 pg_restore 验证恢复；Auth 用户与 UUID 映射也应备份。

## 验证

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

测试在本地 PostgreSQL 兼容引擎 PGlite 执行迁移，检查所有者隔离、任务增改完成删除、重复创建、邮件领取与失败次数上限；另覆盖时区、冲突、延期积压、模型响应结构和失败、Cron 表达式。模型使用模拟响应。真实服务仍需用本人账号验收，尤其是自然语言分类质量、云端定时触发、真实收件和 iPhone 主屏幕体验。进入聊天页或从后台返回时会开始新对话。以往聊天可在灵感箱搜索、编辑自己的消息或整轮删除。已保存的偏好、目标、灵感和任务可在新对话中继续使用。


本次本机验收（2026-11-09）：7 项自动化测试通过，lint、TypeScript 与生产构建通过。启动生产服务器后验证首页、manifest、Apple 图标和 Service Worker 均返回 200，无令牌访问个人数据接口返回 401。
