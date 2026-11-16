-- Telegram sends each update to POST /telegram/webhook, and sends it again when the Worker does
-- not answer 2xx. One row per update the Worker took, so a repeated delivery is handled once.
-- A 'processing' row whose lease ended belongs to a request that died; the next delivery takes it.
-- `claim` names the request that holds the row, so only that request finishes or releases it.
create table alerts_telegram_updates (
  update_id integer primary key,
  state text not null check (state in ('processing', 'done')),
  claim text not null, lease_until text not null, received_at text not null
) strict;
create index alerts_telegram_updates_received on alerts_telegram_updates(received_at);

-- Guidance replies sent to one chat in the current window, so a repeated /start cannot make the
-- bot send without bound. `chat` is a keyed hash of the chat ID, never the ID itself.
create table alerts_telegram_replies (
  chat text primary key, window_start text not null, count integer not null
) strict;
