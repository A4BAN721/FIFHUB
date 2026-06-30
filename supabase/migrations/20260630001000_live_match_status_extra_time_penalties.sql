do $$
begin
  alter table public.live_match_state
    drop constraint if exists live_match_state_status_check;

  alter table public.live_match_state
    add constraint live_match_state_status_check
    check (
      status in (
        'scheduled',
        'live',
        'half_time',
        'finished',
        'extra_time',
        'penalties',
        'postponed',
        'cancelled',
        'suspended',
        'interrupted'
      )
    );
end;
$$;
