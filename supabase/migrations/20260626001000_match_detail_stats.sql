alter table if exists public.live_match_state
  add column if not exists home_expected_goals real,
  add column if not exists away_expected_goals real,
  add column if not exists home_passes integer,
  add column if not exists away_passes integer,
  add column if not exists home_passing_accuracy real,
  add column if not exists away_passing_accuracy real;
