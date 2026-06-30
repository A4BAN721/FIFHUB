update public.live_match_state
set
  home_penalty_score = null,
  away_penalty_score = null
where home_penalty_score = 0
  and away_penalty_score = 0
  and status <> 'penalties';
