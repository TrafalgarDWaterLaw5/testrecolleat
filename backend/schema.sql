-- Run once in a NEW Supabase project as postgres. Do not expose service-role keys.
begin;
create schema if not exists reco_private;
revoke all on schema reco_private from public, anon, authenticated;
create table reco_private.profiles(id uuid primary key references auth.users(id) on delete cascade, nickname text not null check(char_length(nickname) between 1 and 30), invite uuid not null unique default gen_random_uuid(), suspended boolean not null default false);
create table reco_private.connections(sender uuid references reco_private.profiles(id) on delete cascade, recipient uuid references reco_private.profiles(id) on delete cascade, accepted boolean not null default false, created_at timestamptz default now(), primary key(sender,recipient), check(sender<>recipient));
create unique index reco_pair on reco_private.connections(least(sender,recipient),greatest(sender,recipient));
create table reco_private.blocks(owner uuid references reco_private.profiles(id) on delete cascade, target uuid references reco_private.profiles(id) on delete cascade, primary key(owner,target), check(owner<>target));
create table reco_private.admins(id uuid primary key references reco_private.profiles(id) on delete cascade);
create table reco_private.reports(id uuid primary key default gen_random_uuid(), reporter uuid references reco_private.profiles(id) on delete set null, target uuid references reco_private.profiles(id) on delete set null, reason text not null check(reason in ('impersonation','unwanted contact','suspected underage safety issue','other safety issue')), status text not null default 'open' check(status in ('open','resolved','dismissed')), created_at timestamptz not null default now(), resolved_at timestamptz);
create table reco_private.audit(id bigint generated always as identity primary key, actor uuid references reco_private.profiles(id) on delete set null, action text not null, object_id uuid, created_at timestamptz not null default now());
-- No client table access, even if the private schema is accidentally exposed.
do $$ declare t text; begin foreach t in array array['profiles','connections','blocks','admins','reports','audit'] loop execute format('alter table reco_private.%I enable row level security',t); end loop; end $$;
revoke all on all tables in schema reco_private from public, anon, authenticated;
create or replace function public.reco_account(action text, payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); other uuid; p reco_private.profiles%rowtype; is_admin boolean; reason text; rid uuid; result jsonb; n text;
begin
 if me is null or not exists(select 1 from auth.users where id=me and email_confirmed_at is not null) then raise exception 'Verified account required'; end if;
 -- Serialize low-volume social mutations to prevent block/request races.
 perform pg_catalog.pg_advisory_xact_lock(364182);
 if action='delete_account' then
  -- Reports may be retained for safety; foreign keys remove account identifiers.
  delete from auth.users where id=me;
  return jsonb_build_object('deleted',true);
 end if;
 if action='init' then
  n:=trim(coalesce(payload->>'nickname',''));
  if not exists(select 1 from reco_private.profiles where id=me) then
   if char_length(n) not between 1 and 30 then raise exception 'Enter a display name (1–30 characters)'; end if;
   insert into reco_private.profiles(id,nickname) values(me,n);
  end if;
 end if;
 select * into p from reco_private.profiles where id=me;
 if not found then raise exception 'Create your profile first'; end if;
 select exists(select 1 from reco_private.admins where id=me) into is_admin;
 if action='state' or action='init' then
  return jsonb_build_object('id',me,'nickname',p.nickname,'invite',case when not p.suspended then p.invite else null end,'suspended',p.suspended,'admin',is_admin and not p.suspended,
  'connections',case when p.suspended then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'name',q.nickname,'status',case when c.accepted then 'friend' when c.sender=me then 'sent' else 'received' end) order by q.nickname) from reco_private.connections c join reco_private.profiles q on q.id=case when c.sender=me then c.recipient else c.sender end where (c.sender=me or c.recipient=me) and not q.suspended and not exists(select 1 from reco_private.blocks b where (b.owner=me and b.target=q.id) or (b.owner=q.id and b.target=me))), '[]'::jsonb) end,
  'blocks',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'name',q.nickname)) from reco_private.blocks b join reco_private.profiles q on q.id=b.target where b.owner=me),'[]'::jsonb));
 end if;
 if p.suspended then raise exception 'Account suspended'; end if;
 if action='rename' then
  n:=trim(coalesce(payload->>'nickname','')); if char_length(n) not between 1 and 30 then raise exception 'Invalid name'; end if;
  update reco_private.profiles set nickname=n where id=me;
 elsif action='rotate_code' then update reco_private.profiles set invite=gen_random_uuid() where id=me;
 elsif action='request' then
  if (select count(*) from reco_private.connections where sender=me or recipient=me)>=250 then raise exception 'Connection limit reached'; end if;
  if (select count(*) from reco_private.connections where sender=me and not accepted)>=20 then raise exception 'Pending request limit reached'; end if;
  select id into other from reco_private.profiles where invite=(payload->>'code')::uuid and not suspended;
  if other is null or other=me or exists(select 1 from reco_private.blocks where (owner=me and target=other) or (owner=other and target=me)) then raise exception 'Connection unavailable'; end if;
  insert into reco_private.connections(sender,recipient) values(me,other) on conflict do nothing;
 elsif action in ('accept','remove','block','unblock','report') then
  other:=(payload->>'id')::uuid;
  if other is null or other=me then raise exception 'Invalid account'; end if;
  if action='accept' then
   if exists(select 1 from reco_private.blocks where (owner=me and target=other) or (owner=other and target=me)) or not exists(select 1 from reco_private.profiles where id=other and not suspended) then raise exception 'Connection unavailable'; end if;
   update reco_private.connections set accepted=true where sender=other and recipient=me and not accepted;
   if not found then raise exception 'Request unavailable'; end if;
  elsif action='unblock' then delete from reco_private.blocks where owner=me and target=other;
  else
   if not exists(select 1 from reco_private.connections where (sender=me and recipient=other) or (sender=other and recipient=me)) and not exists(select 1 from reco_private.blocks where owner=me and target=other) then raise exception 'Account unavailable'; end if;
   if action='report' then
    reason:=payload->>'reason';
    if (select count(*) from reco_private.reports where reporter=me and created_at>now()-interval '24 hours')>=10 then raise exception 'Report limit reached; contact support for urgent concerns'; end if;
    insert into reco_private.reports(reporter,target,reason) values(me,other,reason);
   else
    if action='block' then insert into reco_private.blocks values(me,other) on conflict do nothing; end if;
    delete from reco_private.connections where (sender=me and recipient=other) or (sender=other and recipient=me);
   end if;
  end if;
 elsif action in ('admin_list','admin_resolve','admin_suspend','admin_restore') then
  if not is_admin then raise exception 'Not authorized'; end if;
  if action='admin_list' then
   return jsonb_build_object('reports',coalesce((select jsonb_agg(to_jsonb(r)) from (select a.id,a.target,a.reason,a.status,a.created_at,a.resolved_at, q.nickname as target_name, q.suspended from reco_private.reports a left join reco_private.profiles q on q.id=a.target order by (a.status='open') desc,a.created_at desc limit 200) r),'[]'::jsonb), 'accounts',coalesce((select jsonb_agg(to_jsonb(u)) from (select id,nickname,suspended from reco_private.profiles order by nickname limit 200) u),'[]'::jsonb));
  elsif action='admin_resolve' then
   rid:=(payload->>'id')::uuid;
   if payload->>'status' not in ('resolved','dismissed') then raise exception 'Invalid status'; end if;
   update reco_private.reports set status=payload->>'status',resolved_at=now() where id=rid and status='open';
   if not found then raise exception 'Report unavailable'; end if;
   insert into reco_private.audit(actor,action,object_id) values(me,'report_'||(payload->>'status'),rid);
  else
   other:=(payload->>'id')::uuid;
   if other=me or exists(select 1 from reco_private.admins where id=other) then raise exception 'Cannot change administrator status'; end if;
   update reco_private.profiles set suspended=(action='admin_suspend') where id=other;
   if not found then raise exception 'Account unavailable'; end if;
   insert into reco_private.audit(actor,action,object_id) values(me,action,other);
  end if;
 else raise exception 'Unknown action'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.reco_account(text,jsonb) from public, anon, authenticated;
grant execute on function public.reco_account(text,jsonb) to authenticated;
commit;
-- Grant founder access manually after verified signup and profile creation:
-- insert into reco_private.admins(id) select id from auth.users where email='YOUR_VERIFIED_EMAIL';
