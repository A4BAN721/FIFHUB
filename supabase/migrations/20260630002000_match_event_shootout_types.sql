do $$
begin
  alter table public.match_events
    drop constraint if exists match_events_event_type_check;

  alter table public.match_events
    add constraint match_events_event_type_check
    check (
      event_type in (
        'goal',
        'penalty_goal',
        'own_goal',
        'injury',
        'missed_penalty',
        'yellow_card',
        'red_card',
        'second_yellow',
        'substitution',
        'var',
        'penalty_shootout',
        'penalty_shootout_goal',
        'penalty_shootout_miss',
        'match_started',
        'half_time',
        'second_half',
        'match_ended'
      )
    );
end;
$$;
