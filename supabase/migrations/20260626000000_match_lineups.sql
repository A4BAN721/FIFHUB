alter table if exists public.live_match_state
  add column if not exists lineups jsonb,
  add column if not exists lineups_provider text,
  add column if not exists lineups_updated_at timestamptz;

create index if not exists live_match_state_lineups_available_idx
  on public.live_match_state (lineups_updated_at desc)
  where lineups is not null;
