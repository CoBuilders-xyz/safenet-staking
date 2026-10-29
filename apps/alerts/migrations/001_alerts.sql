-- Apply once with a migration role. The browser never receives the service-role key.
create table public.alerts_challenges (
  id uuid primary key default gen_random_uuid(), wallet text not null,
  message text not null, expires_at timestamptz not null, used boolean not null default false
);
create table public.alerts_sessions (
  token_hash text primary key, wallet text not null, signature_hash text not null,
  expires_at timestamptz not null
);
create table public.alerts_subscriptions (
  id uuid primary key default gen_random_uuid(), wallet text not null, signature_hash text not null,
  triggers jsonb not null, participation numeric not null check (participation between 0 and 100),
  missed integer not null check (missed between 1 and 1000), channel jsonb not null,
  telegram_chat text, status text not null default 'unverified' check (status in ('unverified','verified','expired')),
  link_hash text unique, link_expires timestamptz,
  last_delivery timestamptz, created_at timestamptz not null default now()
);
create index on public.alerts_subscriptions(wallet);
create table public.alerts_deliveries (
  subscription uuid references public.alerts_subscriptions(id) on delete cascade,
  event_key text not null, ack_hash text unique, ack_expires timestamptz,
  state text not null check (state in ('sending','failed','accepted','received')),
  lease_until timestamptz not null, attempts integer not null default 1,
  updated_at timestamptz not null default now(), primary key(subscription, event_key)
);
create table public.alerts_state (key text primary key, value jsonb not null);
create table public.alerts_runs (
  started_at timestamptz primary key default now(), completed_at timestamptz, ok boolean not null default false,
  evaluated integer not null default 0, accepted integer not null default 0, failed integer not null default 0
);
create table public.alerts_lock (id boolean primary key default true check(id), owner uuid, until_at timestamptz);
insert into public.alerts_lock(id) values(true);

-- No anonymous or authenticated Supabase client has table access. Only the wallet-authenticated
-- Worker uses service_role. No accounts, Supabase Auth users or custody are created.
alter table public.alerts_challenges enable row level security;
alter table public.alerts_sessions enable row level security;
alter table public.alerts_subscriptions enable row level security;
alter table public.alerts_deliveries enable row level security;
alter table public.alerts_state enable row level security;
alter table public.alerts_runs enable row level security;
alter table public.alerts_lock enable row level security;
revoke all on public.alerts_challenges, public.alerts_sessions, public.alerts_subscriptions,
  public.alerts_deliveries, public.alerts_state, public.alerts_runs, public.alerts_lock from anon, authenticated;
grant all on public.alerts_challenges, public.alerts_sessions, public.alerts_subscriptions,
  public.alerts_deliveries, public.alerts_state, public.alerts_runs, public.alerts_lock to service_role;

create function public.alerts_issue_challenge(owner_wallet text, signed_message text, expiry timestamptz)
returns setof public.alerts_challenges language plpgsql set search_path = public as $$
begin
  -- Bounded challenge storage, including requests with forged Origin headers.
  perform pg_advisory_xact_lock(hashtextextended('alerts_challenges', 0));
  delete from alerts_challenges where expires_at<=now();
  if (select count(*) from alerts_challenges where expires_at>now() and wallet=owner_wallet) >= 10
    or (select count(*) from alerts_challenges where expires_at>now()) >= 1000 then return; end if;
  return query insert into alerts_challenges(wallet,message,expires_at)
    values(owner_wallet,signed_message,expiry) returning *;
end $$;

create function public.alerts_authenticate(challenge uuid, token text, signature text)
returns boolean language plpgsql set search_path = public as $$
declare w text;
begin
  update alerts_challenges set used = true where id = challenge and not used and expires_at > now() returning wallet into w;
  if w is null then return false; end if;
  delete from alerts_sessions where expires_at<=now();
  insert into alerts_sessions values(token, w, signature, now() + interval '30 minutes');
  return true;
end $$;

create function public.alerts_subscribe(owner_wallet text, signature text, settings jsonb, link text)
returns setof public.alerts_subscriptions language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_wallet, 0));
  if (select count(*) from alerts_subscriptions where wallet = owner_wallet) >= 10 then
    raise exception 'subscription limit';
  end if;
  return query insert into alerts_subscriptions(wallet,signature_hash,triggers,participation,missed,channel,link_hash,link_expires)
    values(owner_wallet,signature,settings->'triggers',(settings->>'participation')::numeric,
      (settings->>'missed')::integer,settings->'channel',link,now()+interval '10 minutes') returning *;
end $$;

create function public.alerts_link_telegram(link text, chat text)
returns boolean language plpgsql set search_path = public as $$
begin
  update alerts_subscriptions set telegram_chat=chat,link_hash=null,link_expires=null
    where link_hash=link and link_expires>now() and channel->>'kind'='telegram';
  return found;
end $$;

create function public.alerts_reserve(subscription_id uuid, event text, acknowledgement text)
returns boolean language plpgsql set search_path = public as $$
begin
  insert into alerts_deliveries(subscription,event_key,ack_hash,ack_expires,state,lease_until)
    values(subscription_id,event,acknowledgement,now()+interval '24 hours','sending',now()+interval '2 minutes')
    on conflict(subscription,event_key) do update set state='sending',lease_until=now()+interval '2 minutes',
      ack_hash=acknowledgement,ack_expires=now()+interval '24 hours',attempts=alerts_deliveries.attempts+1,updated_at=now()
    where alerts_deliveries.state in ('failed','sending') and alerts_deliveries.lease_until < now();
  return found;
end $$;

create function public.alerts_acknowledge(acknowledgement text)
returns boolean language plpgsql set search_path = public as $$
declare sub uuid;
begin
  update alerts_deliveries set state='received',updated_at=now()
    where ack_hash=acknowledgement and ack_expires>now() and state in ('sending','accepted') returning subscription into sub;
  if sub is null then return false; end if;
  update alerts_subscriptions set status='verified',last_delivery=now() where id=sub;
  return true;
end $$;

create function public.alerts_lock_run(holder uuid, release boolean default false)
returns boolean language plpgsql set search_path = public as $$
begin
  if release then
    update alerts_lock set until_at=null,owner=null where owner=holder;
  else
    -- Outlive the scheduled Worker's 15-minute wall-clock limit. Slow upstream reads
    -- inside one subscription must not let a second poller overlap this invocation.
    update alerts_lock set owner=holder,until_at=now()+interval '16 minutes' where until_at is null or until_at<now();
  end if;
  return found;
end $$;

create function public.alerts_save_state(state_key text, state_value jsonb)
returns void language sql set search_path = public as $$
  insert into alerts_state values(state_key,state_value) on conflict(key) do update set value=excluded.value;
$$;

create function public.alerts_cleanup()
returns void language sql set search_path = public as $$
  delete from alerts_challenges where expires_at < now();
  delete from alerts_sessions where expires_at < now();
  update alerts_subscriptions set link_hash=null,link_expires=null where link_expires < now();
  -- Retain event keys while subscriptions exist, so an unclaimed condition does not resend.
  update alerts_deliveries set ack_hash=null,ack_expires=null where ack_expires < now();
  -- Thirteen months of aggregate availability evidence; no wallet or endpoint in this table.
  delete from alerts_runs where started_at < now()-interval '13 months';
$$;

-- Functions are invoker-rights and service-role only. PostgreSQL otherwise grants PUBLIC EXECUTE.
revoke execute on function public.alerts_authenticate(uuid,text,text), public.alerts_subscribe(text,text,jsonb,text),
  public.alerts_link_telegram(text,text), public.alerts_reserve(uuid,text,text), public.alerts_acknowledge(text),
  public.alerts_lock_run(uuid,boolean), public.alerts_save_state(text,jsonb), public.alerts_cleanup() from public,anon,authenticated;
grant execute on function public.alerts_authenticate(uuid,text,text), public.alerts_subscribe(text,text,jsonb,text),
  public.alerts_link_telegram(text,text), public.alerts_reserve(uuid,text,text), public.alerts_acknowledge(text),
  public.alerts_lock_run(uuid,boolean), public.alerts_save_state(text,jsonb), public.alerts_cleanup() to service_role;

revoke execute on function public.alerts_issue_challenge(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.alerts_issue_challenge(text,text,timestamptz) to service_role;
