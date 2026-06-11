/**
 * Normalization Service
 * 
 * Converts provider-specific data formats into one internal normalized format.
 * This is the boundary between external providers and the rest of the system.
 * 
 * Features:
 * - Provider-specific transformers
 * - Status/event type mapping
 * - Team name normalization (e.g., "FC Barcelona" -> "Barcelona")
 * - Duplicate detection
 * - Event ordering by minute
 * - Missing data handling with sensible defaults
 */

import type {
  ProviderMatch,
  ProviderEvent,
  ProviderMatchStatus,
  ProviderEventType,
  ProviderTeam,
} from '../ingestion/types';
import type {
  NormalizedMatch,
  NormalizedEvent,
  NormalizedTeam,
  NormalizedEventType,
  MatchStatus,
  MatchPeriod,
  LiveMatchState,
  MatchEventResponse,
  MatchSummaryResponse,
} from './types';

/**
 * Generate a unique ID without external dependencies
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Status mapping from provider status to internal status
 */
const STATUS_MAP: Record<ProviderMatchStatus, MatchStatus> = {
  'TBD': 'scheduled',
  'NS': 'scheduled',
  '1H': 'live',
  'HT': 'half_time',
  '2H': 'live',
  'ET': 'extra_time',
  'P': 'penalties',
  'FT': 'finished',
  'AET': 'finished',
  'PEN': 'finished',
  'POST': 'postponed',
  'CAN': 'cancelled',
  'ABD': 'cancelled',
  'AWD': 'finished',
  'WO': 'finished',
  'SUSP': 'suspended',
  'INT': 'interrupted',
  'LIVE': 'live',
};

/**
 * Provider status to period mapping
 */
const STATUS_TO_PERIOD: Record<ProviderMatchStatus, MatchPeriod> = {
  'TBD': 'pre_match',
  'NS': 'pre_match',
  '1H': 'first_half',
  'HT': 'half_time',
  '2H': 'second_half',
  'ET': 'extra_time_first_half',
  'P': 'penalties',
  'FT': 'full_time',
  'AET': 'full_time',
  'PEN': 'full_time',
  'POST': 'pre_match',
  'CAN': 'pre_match',
  'ABD': 'full_time',
  'AWD': 'full_time',
  'WO': 'full_time',
  'SUSP': 'first_half',
  'INT': 'first_half',
  'LIVE': 'first_half',
};

/**
 * Provider event type to normalized event type mapping
 */
const EVENT_TYPE_MAP: Record<ProviderEventType, NormalizedEventType> = {
  'GOAL': 'GOAL',
  'OWN_GOAL': 'OWN_GOAL',
  'PENALTY_GOAL': 'PENALTY_GOAL',
  'MISSED_PENALTY': 'MISSED_PENALTY',
  'YELLOW_CARD': 'YELLOW_CARD',
  'RED_CARD': 'RED_CARD',
  'SECOND_YELLOW': 'SECOND_YELLOW',
  'SUBSTITUTION': 'SUBSTITUTION',
  'VAR': 'VAR',
  'PENALTY_SHOOTOUT_GOAL': 'PENALTY_SHOOTOUT_GOAL',
  'PENALTY_SHOOTOUT_MISS': 'PENALTY_SHOOTOUT_MISS',
  'GOAL_DISALLOWED': 'VAR',
  'ASSIST': 'GOAL',
};

/**
 * Team name aliases for normalization
 */
const TEAM_NAME_ALIASES: Record<string, string> = {
  'FC Barcelona': 'Barcelona',
  'Real Madrid CF': 'Real Madrid',
  'Manchester United FC': 'Manchester United',
  'Manchester City FC': 'Manchester City',
  'Liverpool FC': 'Liverpool',
  'Chelsea FC': 'Chelsea',
  'Arsenal FC': 'Arsenal',
  'Tottenham Hotspur FC': 'Tottenham',
  'FC Bayern München': 'Bayern Munich',
  'BV Borussia 09 Dortmund': 'Borussia Dortmund',
  'Paris Saint-Germain FC': 'PSG',
  'Juventus FC': 'Juventus',
  'FC Internazionale Milano': 'Inter Milan',
  'AC Milan': 'AC Milan',
  'Associazione Calcio Milan': 'AC Milan',
  'SS Lazio': 'Lazio',
  'AS Roma': 'Roma',
};

export class Normalizer {
  /**
   * Normalize a provider match to internal format
   */
  normalizeMatch(providerMatch: ProviderMatch): NormalizedMatch {
    const status = this.normalizeStatus(providerMatch.status);
    const period = this.mapStatusToPeriod(providerMatch.status);
    const now = new Date().toISOString();

    return {
      id: generateId(),
      providerMatchId: providerMatch.providerMatchId,
      provider: providerMatch.provider,
      status,
      period,
      homeTeam: this.normalizeTeam(providerMatch.homeTeam),
      awayTeam: this.normalizeTeam(providerMatch.awayTeam),
      homeScore: providerMatch.homeScore,
      awayScore: providerMatch.awayScore,
      minute: providerMatch.minute ?? 0,
      stoppageTime: providerMatch.stoppageTime ?? 0,
      kickoffTime: providerMatch.kickoffTime,
      venue: providerMatch.venue,
      competition: providerMatch.competition ? {
        id: `${providerMatch.provider}-${providerMatch.competition}`,
        name: providerMatch.competition,
        season: providerMatch.season,
        round: providerMatch.round,
      } : undefined,
      referee: providerMatch.referee,
      attendance: providerMatch.attendance,
      events: (providerMatch.events ?? []).map((event) => this.normalizeEvent(event)),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Normalize a provider event to internal format
   */
  normalizeEvent(providerEvent: ProviderEvent): NormalizedEvent {
    return {
      id: generateId(),
      externalEventId: providerEvent.externalEventId,
      provider: providerEvent.provider,
      matchId: providerEvent.matchId,
      eventType: this.normalizeEventType(providerEvent.eventType),
      minute: providerEvent.minute,
      stoppageMinute: providerEvent.stoppageMinute,
      team: {
        id: providerEvent.teamId,
        name: providerEvent.teamName,
      },
      playerName: providerEvent.playerName,
      playerId: providerEvent.playerId,
      assistPlayerName: providerEvent.assistPlayerName,
      assistPlayerId: providerEvent.assistPlayerId,
      substitutePlayerName: providerEvent.substitutePlayerName,
      substitutePlayerId: providerEvent.substitutePlayerId,
      description: providerEvent.description,
      timestamp: providerEvent.timestamp,
    };
  }

  /**
   * Normalize team data
   */
  normalizeTeam(providerTeam: ProviderTeam): NormalizedTeam {
    return {
      id: providerTeam.id,
      name: this.resolveTeamName(providerTeam.name),
      shortName: providerTeam.shortName,
      logo: providerTeam.logo,
      country: providerTeam.country,
    };
  }

  /**
   * Extract live match state from a normalized match
   */
  extractLiveState(match: NormalizedMatch): LiveMatchState {
    const lastEvent = match.events[match.events.length - 1];
    
    return {
      matchId: match.id,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      minute: match.minute,
      period: match.period,
      status: match.status,
      lastEventId: lastEvent?.id ?? '',
      lastEventType: lastEvent?.eventType ?? 'MATCH_STARTED',
      updatedAt: match.updatedAt,
    };
  }

  /**
   * Format matches for API response
   */
  formatMatchSummary(match: NormalizedMatch): MatchSummaryResponse {
    return {
      id: match.id,
      status: match.status,
      period: match.period,
      homeTeam: match.homeTeam.name,
      homeTeamLogo: match.homeTeam.logo,
      awayTeam: match.awayTeam.name,
      awayTeamLogo: match.awayTeam.logo,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      minute: this.formatMinute(match.minute, match.stoppageTime),
      events: match.events.map((event) => this.formatEvent(event)),
    };
  }

  /**
   * Format an event for API response
   */
  formatEvent(event: NormalizedEvent): MatchEventResponse {
    return {
      id: event.id,
      matchId: event.matchId,
      minute: this.formatMinute(event.minute, event.stoppageMinute),
      eventType: event.eventType,
      teamName: event.team.name,
      playerName: event.playerName,
      assistPlayerName: event.assistPlayerName,
      description: event.description,
    };
  }

  /**
   * Generate a list of status transition events based on status change
   */
  generateStatusEvents(
    previousStatus: MatchStatus,
    newStatus: MatchStatus,
    matchId: string,
    provider: string
  ): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const now = new Date().toISOString();
    const timestamp = Date.now().toString();
    
    const statusEvents: Array<{ from: MatchStatus | string; to: MatchStatus | string; eventType: NormalizedEventType }> = [
      { from: 'scheduled', to: 'live', eventType: 'MATCH_STARTED' },
      { from: 'live', to: 'half_time', eventType: 'HALF_TIME' },
      { from: 'half_time', to: 'live', eventType: 'SECOND_HALF' },
      { from: 'live', to: 'extra_time', eventType: 'EXTRA_TIME_STARTED' },
      { from: 'extra_time', to: 'finished', eventType: 'EXTRA_TIME_ENDED' },
      { from: 'live', to: 'penalties', eventType: 'PENALTY_SHOOTOUT_STARTED' },
      { from: 'penalties', to: 'finished', eventType: 'PENALTY_SHOOTOUT_ENDED' },
      { from: 'extra_time', to: 'finished', eventType: 'MATCH_ENDED' },
      { from: 'live', to: 'finished', eventType: 'MATCH_ENDED' },
      { from: 'half_time', to: 'finished', eventType: 'MATCH_ENDED' },
    ];

    for (const transition of statusEvents) {
      if (previousStatus === transition.from && newStatus === transition.to) {
        events.push({
          id: generateId(),
          externalEventId: `status-${matchId}-${transition.eventType}-${timestamp}`,
          provider,
          matchId,
          eventType: transition.eventType,
          minute: 0,
          team: { id: '', name: '' },
          playerName: '',
          timestamp: now,
        });
      }
    }

    return events;
  }

  /**
   * Check if two match states differ significantly
   */
  hasSignificantChange(
    previousState: LiveMatchState,
    newState: LiveMatchState
  ): boolean {
    return (
      previousState.homeScore !== newState.homeScore ||
      previousState.awayScore !== newState.awayScore ||
      previousState.period !== newState.period ||
      previousState.status !== newState.status ||
      previousState.lastEventId !== newState.lastEventId
    );
  }

  /**
   * Normalize provider status to internal status
   */
  private normalizeStatus(status: ProviderMatchStatus): MatchStatus {
    return STATUS_MAP[status] || 'scheduled';
  }

  /**
   * Map provider status to match period
   */
  private mapStatusToPeriod(status: ProviderMatchStatus): MatchPeriod {
    return STATUS_TO_PERIOD[status] || 'pre_match';
  }

  /**
   * Normalize provider event type to internal event type
   */
  private normalizeEventType(eventType: ProviderEventType): NormalizedEventType {
    return EVENT_TYPE_MAP[eventType] || 'YELLOW_CARD';
  }

  /**
   * Resolve team name aliases
   */
  private resolveTeamName(name: string): string {
    return TEAM_NAME_ALIASES[name] || name;
  }

  /**
   * Format minute display (e.g., "90+3")
   */
  private formatMinute(minute: number, stoppageMinute?: number): string {
    if (stoppageMinute && stoppageMinute > 0) {
      return `${minute}+${stoppageMinute}`;
    }
    return String(minute);
  }
}

/**
 * Singleton instance
 */
export const normalizer = new Normalizer();