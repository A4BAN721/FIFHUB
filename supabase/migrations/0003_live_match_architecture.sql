/**
 * Live Match Data Architecture
 * 
 * Comprehensive database schema for live football match data.
 * Supports ESPN-scale live scores, events, and statistics.
 * 
 * Tables:
 * - matches: Core match data
 * - live_match_state: Real-time match state
 * - match_events: All match events (goals, cards, subs, etc.)
 * - teams: Team registry
 * - players: Player registry  
 * - venues: Stadium/venue data
 * - competitions: League/tournament data
 */

-- ==================== CORE TABLES ====================

/**
 * Teams registry
 */
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_team_id TEXT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  logo_url TEXT,
  country TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Ensure unique teams per provider
  UNIQUE(provider_team_id, provider)
);

-- Index for team lookups
CREATE INDEX IF NOT EXISTS idx_teams_provider ON teams(provider);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

/**
 * Players registry
 */
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_player_id TEXT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  position TEXT,
  jersey_number INTEGER,
  nationality TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(provider_player_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_provider ON players(provider);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);

/**
 * Venues/Stadiums
 */
CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_venue_id TEXT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  country TEXT,
  capacity INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(provider_venue_id, provider)
);

/**
 * Competitions/Leagues/Tournaments
 */
CREATE TABLE IF NOT EXISTS competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_competition_id TEXT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  logo_url TEXT,
  country TEXT,
  season TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(provider_competition_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_competitions_provider ON competitions(provider);
CREATE INDEX IF NOT EXISTS idx_competitions_name ON competitions(name);

/**
 * Core matches table
 * Stores all matches (past, present, future)
 */
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_match_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  
  -- Teams
  home_team_id UUID REFERENCES teams(id),
  away_team_id UUID REFERENCES teams(id),
  
  -- Competition context
  competition_id UUID REFERENCES competitions(id),
  
  -- Venue
  venue_id UUID REFERENCES venues(id),
  
  -- Match timing
  kickoff_time TIMESTAMPTZ NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  
  -- Current status
  status TEXT NOT NULL DEFAULT 'scheduled' 
    CHECK (status IN (
      'scheduled', 'live', 'half_time', 'finished',
      'extra_time', 'penalties', 'postponed', 'cancelled',
      'suspended', 'interrupted'
    )),
  
  -- Match metadata
  matchday INTEGER,
  round TEXT,
  referee TEXT,
  attendance INTEGER,
  
  -- Provider-specific data
  metadata JSONB DEFAULT '{}',
  
  -- Tracking
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(provider_match_id, provider)
);

-- Match indexes
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_kickoff ON matches(kickoff_time);
CREATE INDEX IF NOT EXISTS idx_matches_provider ON matches(provider);
CREATE INDEX IF NOT EXISTS idx_matches_home_team ON matches(home_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_team ON matches(away_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(competition_id);
CREATE INDEX IF NOT EXISTS idx_matches_updated ON matches(updated_at DESC);

-- Composite index for live match queries
CREATE INDEX IF NOT EXISTS idx_matches_live_status 
  ON matches(status, updated_at DESC) 
  WHERE status IN ('live', 'half_time', 'extra_time', 'penalties');

/**
 * Live match state
 * Stores rapidly changing match data separately for performance
 */
CREATE TABLE IF NOT EXISTS live_match_state (
  match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  minute INTEGER NOT NULL DEFAULT 0,
  stoppage_time INTEGER NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'pre_match'
    CHECK (period IN (
      'pre_match', 'first_half', 'half_time', 'second_half',
      'extra_time_first_half', 'extra_time_half_time',
      'extra_time_second_half', 'penalties', 'full_time'
    )),
  status TEXT NOT NULL DEFAULT 'scheduled',
  last_event_id TEXT,
  last_event_type TEXT,
  home_possession REAL DEFAULT 50,
  away_possession REAL DEFAULT 50,
  
  -- Shot statistics
  home_shots INTEGER DEFAULT 0,
  away_shots INTEGER DEFAULT 0,
  home_shots_on_target INTEGER DEFAULT 0,
  away_shots_on_target INTEGER DEFAULT 0,
  
  -- Discipline
  home_yellow_cards INTEGER DEFAULT 0,
  away_yellow_cards INTEGER DEFAULT 0,
  home_red_cards INTEGER DEFAULT 0,
  away_red_cards INTEGER DEFAULT 0,
  
  -- Set pieces
  home_corners INTEGER DEFAULT 0,
  away_corners INTEGER DEFAULT 0,
  home_fouls INTEGER DEFAULT 0,
  away_fouls INTEGER DEFAULT 0,
  home_offsides INTEGER DEFAULT 0,
  away_offsides INTEGER DEFAULT 0,
  
  -- Flexible metadata for future stats
  statistics JSONB DEFAULT '{}',
  
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Live match state index
CREATE INDEX IF NOT EXISTS idx_live_match_state_status 
  ON live_match_state(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_match_state_live 
  ON live_match_state(match_id) 
  WHERE status IN ('live', 'half_time', 'extra_time', 'penalties');

/**
 * Match events
 * All events from a match (goals, cards, substitutions, etc.)
 */
CREATE TABLE IF NOT EXISTS match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_event_id TEXT NOT NULL,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  
  -- Event details
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'GOAL', 'OWN_GOAL', 'PENALTY_GOAL', 'MISSED_PENALTY',
      'YELLOW_CARD', 'RED_CARD', 'SECOND_YELLOW',
      'SUBSTITUTION', 'VAR',
      'PENALTY_SHOOTOUT_GOAL', 'PENALTY_SHOOTOUT_MISS',
      'MATCH_STARTED', 'HALF_TIME', 'SECOND_HALF',
      'MATCH_ENDED', 'EXTRA_TIME_STARTED', 'EXTRA_TIME_ENDED',
      'PENALTY_SHOOTOUT_STARTED', 'PENALTY_SHOOTOUT_ENDED'
    )),
  minute INTEGER NOT NULL,
  stoppage_minute INTEGER,
  period TEXT,
  
  -- Team and players
  team_id UUID REFERENCES teams(id),
  team_name TEXT,
  player_id UUID REFERENCES players(id),
  player_name TEXT NOT NULL,
  assist_player_id UUID REFERENCES players(id),
  assist_player_name TEXT,
  substitute_player_id UUID REFERENCES players(id),
  substitute_player_name TEXT,
  
  -- Additional data
  description TEXT,
  
  -- Future: advanced statistics
  xg REAL, -- Expected Goals
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Prevent duplicates
  UNIQUE(external_event_id)
);

-- Event indexes
CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id, minute ASC);
CREATE INDEX IF NOT EXISTS idx_match_events_type ON match_events(event_type);
CREATE INDEX IF NOT EXISTS idx_match_events_external_id ON match_events(external_event_id);
CREATE INDEX IF NOT EXISTS idx_match_events_player ON match_events(player_id);
CREATE INDEX IF NOT EXISTS idx_match_events_timestamp ON match_events(event_timestamp DESC);

-- Composite index for match timeline
CREATE INDEX IF NOT EXISTS idx_match_events_timeline 
  ON match_events(match_id, event_type, minute);

-- ==================== FUNCTIONAL INDEXES ====================

/**
 * View: Live matches with state
 * Convenience view for querying live matches
 */
CREATE OR REPLACE VIEW live_matches_view AS
SELECT 
  m.id,
  m.provider_match_id,
  m.provider,
  m.kickoff_time,
  m.status,
  m.matchday,
  m.round,
  
  -- Home team
  ht.id as home_team_id,
  ht.name as home_team_name,
  ht.logo_url as home_team_logo,
  
  -- Away team
  at.id as away_team_id,
  at.name as away_team_name,
  at.logo_url as away_team_logo,
  
  -- Competition
  c.name as competition_name,
  c.logo_url as competition_logo,
  
  -- Live state
  lms.home_score,
  lms.away_score,
  lms.minute,
  lms.stoppage_time,
  lms.period,
  lms.last_event_type,
  lms.home_possession,
  lms.away_possession,
  lms.home_shots,
  lms.away_shots,
  lms.home_shots_on_target,
  lms.away_shots_on_target,
  lms.home_yellow_cards,
  lms.away_yellow_cards,
  lms.home_red_cards,
  lms.away_red_cards,
  lms.home_corners,
  lms.away_corners,
  lms.home_fouls,
  lms.away_fouls,
  lms.statistics,
  
  -- Timing
  m.created_at,
  m.updated_at,
  lms.updated_at as state_updated_at
  
FROM matches m
LEFT JOIN teams ht ON m.home_team_id = ht.id
LEFT JOIN teams at ON m.away_team_id = at.id
LEFT JOIN competitions c ON m.competition_id = c.id
LEFT JOIN live_match_state lms ON m.id = lms.match_id
WHERE m.status IN ('live', 'half_time', 'extra_time', 'penalties');

-- ==================== TRIGGERS ====================

/**
 * Auto-update updated_at timestamp
 */
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to relevant tables
CREATE TRIGGER update_matches_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_live_match_state_updated_at
  BEFORE UPDATE ON live_match_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

/**
 * Auto-create live_match_state when match is created
 */
CREATE OR REPLACE FUNCTION create_live_match_state()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO live_match_state (match_id, status)
  VALUES (NEW.id, NEW.status)
  ON CONFLICT (match_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_match_insert
  AFTER INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION create_live_match_state();

-- ==================== ROW LEVEL SECURITY ====================

-- Enable RLS on all tables
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_match_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;

-- Public read access for match data
CREATE POLICY "Public read matches"
  ON matches FOR SELECT
  USING (true);

CREATE POLICY "Public read live state"
  ON live_match_state FOR SELECT
  USING (true);

CREATE POLICY "Public read events"
  ON match_events FOR SELECT
  USING (true);

CREATE POLICY "Public read teams"
  ON teams FOR SELECT
  USING (true);

CREATE POLICY "Public read players"
  ON players FOR SELECT
  USING (true);

CREATE POLICY "Public read venues"
  ON venues FOR SELECT
  USING (true);

CREATE POLICY "Public read competitions"
  ON competitions FOR SELECT
  USING (true);

-- Service role write access (for backend services)
CREATE POLICY "Service write matches"
  ON matches FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service write live state"
  ON live_match_state FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service write events"
  ON match_events FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service write teams"
  ON teams FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service write players"
  ON players FOR ALL
  USING (auth.role() = 'service_role');

-- ==================== SUBSCRIPTIONS FOR REALTIME ====================

-- Enable realtime for live match data
ALTER PUBLICATION supabase_realtime ADD TABLE live_match_state;
ALTER PUBLICATION supabase_realtime ADD TABLE match_events;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;