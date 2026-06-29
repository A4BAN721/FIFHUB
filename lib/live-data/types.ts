export type MatchStatus =
  | "scheduled"
  | "live"
  | "half_time"
  | "finished"
  | "extra_time"
  | "penalties"
  | "postponed"
  | "cancelled"
  | "suspended"
  | "interrupted";

export type MatchPhase =
  | "pre_match"
  | "first_half"
  | "half_time"
  | "second_half"
  | "extra_time"
  | "penalties"
  | "full_time";

export type MatchEventType =
  | "goal"
  | "penalty_goal"
  | "own_goal"
  | "injury"
  | "missed_penalty"
  | "yellow_card"
  | "red_card"
  | "second_yellow"
  | "substitution"
  | "var"
  | "penalty_shootout_goal"
  | "penalty_shootout_miss"
  | "match_started"
  | "half_time"
  | "second_half"
  | "match_ended";

export interface MatchEvent {
  id: string;
  externalEventId?: string | null;
  matchId: string;
  minute: number;
  stoppageMinute?: number | null;
  sequenceNumber?: number | null;
  eventType: MatchEventType;
  teamId?: string | null;
  teamName?: string | null;
  playerName?: string | null;
  assistPlayerName?: string | null;
  substitutePlayerName?: string | null;
  description?: string | null;
  createdAt: string;
}

export interface MatchStatistics {
  homePossession?: number | null;
  awayPossession?: number | null;
  homeShots?: number | null;
  awayShots?: number | null;
  homeShotsOnTarget?: number | null;
  awayShotsOnTarget?: number | null;
  homeExpectedGoals?: number | null;
  awayExpectedGoals?: number | null;
  homePasses?: number | null;
  awayPasses?: number | null;
  homePassingAccuracy?: number | null;
  awayPassingAccuracy?: number | null;
  homeYellowCards?: number | null;
  awayYellowCards?: number | null;
  homeRedCards?: number | null;
  awayRedCards?: number | null;
  homeCorners?: number | null;
  awayCorners?: number | null;
  homeFouls?: number | null;
  awayFouls?: number | null;
  homeOffsides?: number | null;
  awayOffsides?: number | null;
}

export type MatchLineupPlayerStatus = "starter" | "substitute";

export interface MatchLineupPlayer {
  id?: string | null;
  name: string;
  position?: string | null;
  shirtNumber?: number | null;
  status: MatchLineupPlayerStatus;
  rating?: number | null;
  grid?: string | null;
  captain?: boolean | null;
  playerOfTheMatch?: boolean | null;
}

export type MatchUnavailablePlayerStatus = "injured" | "suspended" | "unavailable";

export interface MatchUnavailablePlayer {
  id?: string | null;
  name: string;
  position?: string | null;
  shirtNumber?: number | null;
  reason?: string | null;
  status: MatchUnavailablePlayerStatus;
}

export interface MatchTeamLineup {
  teamName: string;
  formation?: string | null;
  coach?: string | null;
  starters: MatchLineupPlayer[];
  substitutes: MatchLineupPlayer[];
  unavailable?: MatchUnavailablePlayer[];
}

export interface MatchLineups {
  provider?: string | null;
  lastUpdated?: string | null;
  home: MatchTeamLineup;
  away: MatchTeamLineup;
}

export interface LiveMatch {
  matchId: string;
  status: MatchStatus;
  phase: MatchPhase;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute?: number | null;
  stoppageMinute?: number | null;
  startedAt?: string | null;
  finalScoreConfirmedAt?: string | null;
  highlightsUrl?: string | null;
  highlightsTitle?: string | null;
  highlightsPublishedAt?: string | null;
  updatedAt: string;
  statistics: MatchStatistics;
  lineups?: MatchLineups | null;
  events: MatchEvent[];
}

export interface LiveMatchError {
  message: string;
  retryAfterMs?: number;
}
