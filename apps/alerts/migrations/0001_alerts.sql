-- D1 (SQLite). `cf d1 migrations apply` applies it once and records it in d1_migrations.
-- Only the safenet-alerts Worker binding and an operator's API token reach this database.
-- Timestamps are UTC ISO-8601 text with milliseconds and a Z suffix, as Date.toISOString writes
-- them, so text comparison orders them. The Worker supplies every timestamp.
create table alerts_challenges (
  id text primary key, wallet text not null, message text not null,
  expires_at text not null, used integer not null default 0 check (used in (0, 1))
) strict;
create index alerts_challenges_expiry on alerts_challenges(wallet, expires_at);

create table alerts_sessions (
  token_hash text primary key, wallet text not null, signature_hash text not null, expires_at text not null
) strict;

create table alerts_subscriptions (
  id text primary key, wallet text not null, signature_hash text not null,
  triggers text not null check (json_valid(triggers) and json_type(triggers) = 'array'),
  participation real not null check (participation between 0 and 100),
  missed integer not null check (missed between 1 and 1000),
  channel text not null check (json_valid(channel) and json_type(channel) = 'object'),
  telegram_chat text,
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'expired')),
  link_hash text unique, link_expires text, last_delivery text, created_at text not null
) strict;
create index alerts_subscriptions_wallet on alerts_subscriptions(wallet);

-- D1 enforces foreign keys, so deleting a subscription deletes its delivery history.
create table alerts_deliveries (
  subscription text not null references alerts_subscriptions(id) on delete cascade,
  event_key text not null, ack_hash text unique, ack_expires text,
  state text not null check (state in ('sending', 'failed', 'accepted', 'received')),
  lease_until text not null, attempts integer not null default 1, updated_at text not null,
  primary key (subscription, event_key)
) strict;

-- One JSON value per key, split into ordered parts: D1 limits a row to 2 MB, and the Aegis
-- checkpoint can reach 8 MiB.
create table alerts_state (
  key text not null, part integer not null check (part >= 0), value text not null,
  primary key (key, part)
) strict;

create table alerts_runs (
  started_at text primary key, completed_at text, ok integer not null default 0 check (ok in (0, 1)),
  evaluated integer not null default 0, accepted integer not null default 0, failed integer not null default 0
) strict;

create table alerts_lock (id integer primary key check (id = 1), owner text, until_at text) strict;
insert into alerts_lock(id) values (1);
