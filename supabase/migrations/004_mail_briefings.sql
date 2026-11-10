-- Afternoon updates and evening check-ins keep independent snapshots and attempts.
create table if not exists public.mail_briefings (
  owner_id uuid not null references public.profiles,
  day date not null,
  edition text not null check (edition in ('afternoon', 'evening')),
  plan jsonb not null,
  status text not null default 'ready',
  attempts integer not null default 0,
  detail text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, day, edition)
);
alter table public.mail_briefings enable row level security;
revoke all on public.mail_briefings from public, anon, authenticated;
grant select, insert, update on public.mail_briefings to service_role;

create or replace function public.claim_briefing(person uuid, target date, slot text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.mail_briefings
     set status = 'sending', attempts = attempts + 1, updated_at = now()
   where owner_id = person and day = target and edition = slot
     and status in ('ready','failed') and attempts < 3;
  return found;
end$$;
revoke all on function public.claim_briefing(uuid,date,text) from public, anon, authenticated;
grant execute on function public.claim_briefing(uuid,date,text) to service_role;
