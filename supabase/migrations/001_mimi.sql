create table public.profiles (
 owner_id uuid primary key references auth.users on delete cascade,
 singleton boolean unique default true check(singleton) not null,
 created_at timestamptz default now()
);
alter table profiles enable row level security;
revoke all on profiles from anon, authenticated;
grant select on profiles to authenticated;
create policy self on profiles for select to authenticated using(owner_id=auth.uid());
create table records (
 id uuid primary key, owner_id uuid not null default auth.uid() references profiles,
 kind text not null check(kind in ('task','event','idea','goal','preference')),
 title text not null check(length(trim(title)) between 1 and 500),
 day date, minute int check(minute between 0 and 1439),
 duration int not null default 30 check(duration between 1 and 1440),
 priority int not null default 2 check(priority between 1 and 3),
 done boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(kind <> 'event' or (day is not null and minute is not null and minute+duration<=1440))
);
create table messages (
 id uuid primary key, owner_id uuid not null default auth.uid() references profiles,
 question text not null check(length(question) between 1 and 4000), answer jsonb,
 created_at timestamptz not null default now()
);
create table daily_plans(owner_id uuid references profiles,day date,plan jsonb not null,updated_at timestamptz default now(),primary key(owner_id,day));
create table email_delivery_logs(owner_id uuid references profiles,day date,status text not null,attempts int not null default 1,detail text,updated_at timestamptz default now(),primary key(owner_id,day));
alter table records enable row level security;
alter table messages enable row level security;
create policy own on records to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid() and exists(select 1 from profiles where owner_id=auth.uid()));
create policy own on messages to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid() and exists(select 1 from profiles where owner_id=auth.uid()));
alter table daily_plans enable row level security;
alter table email_delivery_logs enable row level security;
create policy own on daily_plans for select to authenticated using(owner_id=auth.uid());
create policy own on email_delivery_logs for select to authenticated using(owner_id=auth.uid());
grant select,insert,update,delete on records,messages to authenticated;
grant select on daily_plans,email_delivery_logs to authenticated;
create function touch_record() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
create trigger touched before update on records for each row execute function touch_record();
create function claim_mail(person uuid, target date) returns boolean language plpgsql as $$
begin
 insert into email_delivery_logs(owner_id,day,status) values(person,target,'sending')
 on conflict(owner_id,day) do update set status='sending',attempts=email_delivery_logs.attempts+1,updated_at=now()
 where email_delivery_logs.attempts<3 and (email_delivery_logs.status='failed' or (email_delivery_logs.status='sending' and email_delivery_logs.updated_at<now()-interval '4 minutes'));
 return found;
end$$;
revoke all on function claim_mail(uuid,date) from public,anon,authenticated;
grant execute on function claim_mail(uuid,date) to service_role;
