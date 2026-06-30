alter table if exists public.live_match_state
  add column if not exists home_penalty_score integer check (home_penalty_score is null or home_penalty_score >= 0),
  add column if not exists away_penalty_score integer check (away_penalty_score is null or away_penalty_score >= 0);

create or replace view public.fixture_live_scoreboard_view
with (security_invoker = true)
as
select
  mf.id as fixture_id,
  mf.match_date,
  mf.match_time,
  mf.stage,
  mf.group_name,
  mf.home_team,
  mf.away_team,
  mf.stadium,
  coalesce(lms.status, 'scheduled') as status,
  coalesce(lms.phase, lms.period, 'pre_match') as phase,
  coalesce(lms.home_score, 0) as home_score,
  coalesce(lms.away_score, 0) as away_score,
  lms.minute,
  coalesce(lms.stoppage_minute, lms.stoppage_time) as stoppage_minute,
  lms.final_score_confirmed_at,
  lms.updated_at,
  lms.home_penalty_score,
  lms.away_penalty_score
from public.match_fixtures mf
left join public.live_match_state lms
  on lms.match_id::text = mf.id;

grant select on public.fixture_live_scoreboard_view to anon, authenticated;
