create or replace function public.claim_mail(person uuid, target date) returns boolean language plpgsql as $$
begin
 insert into public.email_delivery_logs(owner_id,day,status) values(person,target,'sending')
 on conflict(owner_id,day) do update set status='sending',attempts=email_delivery_logs.attempts+1,updated_at=now()
 where email_delivery_logs.attempts<3 and email_delivery_logs.status='failed';
 return found;
end$$;
revoke all on function public.claim_mail(uuid,date) from public,anon,authenticated;
grant execute on function public.claim_mail(uuid,date) to service_role;
-- Stale sending means delivery is unknown; manual investigation is required.
