-- What the alerts page shows and controls for one subscription: when its Telegram chat was linked,
-- whether the owner paused it, and when the last test message was sent (one per minute).
alter table alerts_subscriptions add column linked_at text;
alter table alerts_subscriptions add column paused integer not null default 0 check (paused in (0, 1));
alter table alerts_subscriptions add column tested_at text;
