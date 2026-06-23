alter table if exists public.live_match_state
  add column if not exists highlights_url text,
  add column if not exists highlights_title text,
  add column if not exists highlights_published_at timestamptz,
  add column if not exists highlights_checked_at timestamptz;

create index if not exists live_match_state_highlights_missing_idx
  on public.live_match_state (final_score_confirmed_at desc)
  where final_score_confirmed_at is not null and highlights_url is null;
