/**
 * Normalization Types
 * 
 * These are the internal normalized types that the entire system uses.
 * All provider-specific data MUST be converted to these types.
 * The frontend MUST only use these normalized types.
 */

/**
 * Match status displayed to users
 */
export type MatchStatus = 
  | 'scheduled'
  | 'live'
  | 'half_time'
  | 'finished'
  | 'extra_time'
  | 'penalties'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'interrupted';

/**
 * Match period
 */
export type MatchPeriod =
  | 'pre_match'
  | 'first_half'
  | 'half_time'
  | 'second_half'
  | 'extra_time_first_half'
  | 'extra_time_half_time'
  | 'extra_time_second_half'
  | 'penalties'
  | 'full_time';

/**
 * Normalized event types
 */
export type NormalizedEventType =
  | 'GOAL'
  | 'OWN_GOAL'
  | 'PENALTY_GOAL'
  | 'MISSED_PENALTY'
  | 'YELLOW_CARD'
  | 'RED_CARD'
  | 'SECOND_YELLOW'
  | 'SUBSTITUTION'
  | 'VAR'
  | 'PENALTY_SHOOTOUT_GOAL'
  | 'PENALTY_SHOOTOUT_MISS'
  | 'MATCH_STARTED'
  | 'HALF_TIME'
  | 'SECOND_HALF'
  | 'MATCH_ENDED'
  | 'EXTRA_TIME_STARTED'
  | 'EXTRA_TIME_ENDED'
  | 'PENALTY_SHOOTOUT_STARTED'
  | 'PENALTY_SHOOTOUT_ENDED';

/**
 * Normalized match data
 */
export interface NormalizedMatch {
  id: string;
  providerMatchId: string;
  provider: string;
  status: MatchStatus;
  period: MatchPeriod;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  homeScore: number;
  awayScore: number;
  minute: number;
  stoppageTime: number;
  kickoffTime: string;
  venue?: string;
  competition?: NormalizedCompetition;
  referee?: string;
  attendance?: number;
  events: NormalizedEvent[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Normalized team data
 */
export interface NormalizedTeam {
  id: string;
  name: string;
  shortName?: string;
  logo?: string;
  country?: string;
}

/**
 * Normalized competition data
 */
export interface NormalizedCompetition {
  id: string;
  name: string;
  season?: string;
  round?: string;
}

/**
 * Normalized event data
 */
export interface NormalizedEvent {
  id: string;
  externalEventId: string;
  provider: string;
  matchId: string;
  eventType: NormalizedEventType;
  minute: number;
  stoppageMinute?: number;
  team: NormalizedTeam;
  playerName: string;
  playerId?: string;
  assistPlayerName?: string;
  assistPlayerId?: string;
  substitutePlayerName?: string;
  substitutePlayerId?: string;
  description?: string;
  timestamp: string;
  xg?: number; // Expected Goals - for future use
}

/**
 * Live match state for realtime updates
 */
export interface LiveMatchState {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  period: MatchPeriod;
  status: MatchStatus;
  lastEventId: string;
  lastEventType: NormalizedEventType;
  updatedAt: string;
}

/**
 * Normalized match event for API responses
 */
export interface MatchEventResponse {
  id: string;
  matchId: string;
  minute: string; // Formatted as "90+3"
  eventType: NormalizedEventType;
  teamName: string;
  playerName: string;
  assistPlayerName?: string;
  description?: string;
}

/**
 * Normalized match summary for API responses
 */
export interface MatchSummaryResponse {
  id: string;
  status: MatchStatus;
  period: MatchPeriod;
  homeTeam: string;
  homeTeamLogo?: string;
  awayTeam: string;
  awayTeamLogo?: string;
  homeScore: number;
  awayScore: number;
  minute: string;
  events: MatchEventResponse[];
}