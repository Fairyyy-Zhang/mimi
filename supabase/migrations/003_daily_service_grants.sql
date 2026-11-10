-- Privileges used by the daily Edge Function, including claim_mail (security invoker).
grant usage on schema public to service_role;
grant select on table public.records to service_role;
grant select, insert on table public.daily_plans to service_role;
grant select, insert, update on table public.email_delivery_logs to service_role;
