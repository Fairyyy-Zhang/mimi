-- 在 Vault 设置 mimi_daily_url 和 mimi_cron_secret 后手动执行。
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$begin
 if coalesce(current_setting('cron.timezone',true),'GMT') not in ('UTC','GMT','Etc/UTC') then raise exception 'Cron must use UTC';end if;
 if (select count(*) from vault.decrypted_secrets where name in ('mimi_daily_url','mimi_cron_secret'))<>2 then raise exception 'Configure Vault first';end if;
end$$;
select cron.schedule('mimi-morning','0,5,10 1 * * *',$job$
 select net.http_post(url:=(select decrypted_secret from vault.decrypted_secrets where name='mimi_daily_url'),
 headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='mimi_cron_secret'),'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000)
$job$);
