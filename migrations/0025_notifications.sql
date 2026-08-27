-- ── In-App Notifications ─────────────────────────────────────────────────────
-- Stores all in-app notifications per user.
-- RLS: users see only their own rows.

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,           -- 'fd_alert' | 'insurance_reminder' | 'goal_milestone' | 'alert_triggered' | 'stale_holding' | 'system'
  title       text not null,
  body        text,
  url         text,                    -- deep-link inside the app e.g. '/goals'
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_unread on notifications(user_id, read, created_at desc);

-- Row-level security
alter table notifications enable row level security;

create policy "users_own_notifications" on notifications
  for all using (auth.uid() = user_id);
