create table if not exists public.nations (
  id text primary key,
  name text not null,
  code text not null,
  flag text not null,
  confederation text not null,
  total_squad_value text not null,
  jersey_colors jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.squad_players (
  id text primary key,
  nation_id text not null references public.nations(id) on delete cascade,
  full_name text not null,
  position text not null,
  club text not null,
  height text not null,
  weight text not null,
  strong_foot text not null,
  market_value text not null,
  jersey_number integer not null,
  age integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists squad_players_nation_id_idx
  on public.squad_players(nation_id);

create table if not exists public.match_fixtures (
  id text primary key,
  match_date text not null,
  match_time text not null,
  stage text not null,
  group_name text,
  home_team text not null,
  away_team text not null,
  stadium text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.translations (
  locale text not null,
  translation_key text not null,
  translation_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (locale, translation_key)
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'players'
      and column_name = 'nation_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'players'
      and column_name = 'full_name'
  ) then
    insert into public.squad_players (
      id,
      nation_id,
      full_name,
      position,
      club,
      height,
      weight,
      strong_foot,
      market_value,
      jersey_number,
      created_at,
      updated_at
    )
    select
      id,
      nation_id,
      full_name,
      position,
      club,
      height,
      weight,
      strong_foot,
      market_value,
      jersey_number,
      created_at,
      updated_at
    from public.players
    on conflict (id) do nothing;
  end if;
end;
$$;

alter table public.nations enable row level security;
alter table public.squad_players enable row level security;
alter table public.match_fixtures enable row level security;
alter table public.translations enable row level security;

drop policy if exists nations_select_public on public.nations;
create policy nations_select_public
on public.nations
for select
to anon, authenticated
using (true);

drop policy if exists squad_players_select_public on public.squad_players;
create policy squad_players_select_public
on public.squad_players
for select
to anon, authenticated
using (true);

drop policy if exists match_fixtures_select_public on public.match_fixtures;
create policy match_fixtures_select_public
on public.match_fixtures
for select
to anon, authenticated
using (true);

drop policy if exists translations_select_public on public.translations;
create policy translations_select_public
on public.translations
for select
to anon, authenticated
using (true);

grant select on public.nations to anon, authenticated;
grant select on public.squad_players to anon, authenticated;
grant select on public.match_fixtures to anon, authenticated;
grant select on public.translations to anon, authenticated;
