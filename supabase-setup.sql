-- ============================================================
-- Mouse Mayhem — Supabase setup
-- Run this whole file once in the Supabase SQL Editor
-- (Project → SQL Editor → New query → paste → Run)
-- ============================================================

-- 1. Table that tracks room creation / joining / duplicate-slot
--    prevention. This is the one piece of "server-side truth":
--    whichever client's UPDATE actually lands first wins player 2.
create table if not exists public.rooms (
  id text primary key,                 -- the 6-character room code
  player1_name text not null,
  player2_name text,
  status text not null default 'waiting',  -- waiting | full | closed
  created_at timestamptz not null default now()
);

-- Auto-cleanup helper (optional): delete rooms older than 6 hours.
-- You can run this manually, or set it up as a Supabase scheduled
-- function later. Not required for the game to work.
-- delete from public.rooms where created_at < now() - interval '6 hours';

-- 2. Row Level Security
alter table public.rooms enable row level security;

-- Anyone with the anon key can create a room (insert a row).
create policy "anyone can create a room"
  on public.rooms for insert
  with check (true);

-- Anyone can read room rows (needed to validate a code / check status).
create policy "anyone can read rooms"
  on public.rooms for select
  using (true);

-- Anyone can update a room ONLY while it's still "waiting" — this is
-- what the game relies on to atomically claim the player-2 slot
-- (the client does: update ... where id = code and status = 'waiting').
create policy "anyone can claim a waiting room"
  on public.rooms for update
  using (status = 'waiting')
  with check (true);

-- Allow the room creator's own cleanup (cancel before anyone joins).
create policy "anyone can delete a room"
  on public.rooms for delete
  using (true);

-- 3. Realtime
-- Cursor movement, attacks, health and defeat events all travel over
-- Supabase Realtime "Broadcast" and "Presence" on a per-room channel
-- (room:<CODE>). Broadcast/Presence do NOT require you to add the
-- table to a publication — only Postgres Changes would need that.
-- So no extra Realtime config is required beyond enabling Realtime
-- for your project, which is on by default.
