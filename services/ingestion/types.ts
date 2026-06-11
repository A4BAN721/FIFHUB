/**
 * Provider Types
 * 
 * These types represent raw data from external football data providers.
 * They are provider-specific and should be normalized before use.
 */

/**
 * Provider-specific match status values
 */
export type ProviderMatchStatus = 
  | 'TBD'           // To Be Determined
  | 'NS'            // Not Started
  | '1H'            // First Half
  | 'HT'            // Half Time
  | '2H'            // Second Half
  | 'ET'            // Extra Time
  | 'P'             // Penalties
  | 'FT'            // Match Finished
  | 'AET'           // After Extra Time
  | 'PEN'           // Finished After Penalties
  | 'POST'          // Postponed
  | 'CAN'           // Cancelled
  | 'ABD'           // Abandoned
  | 'AWD'           // Awarded
  | 'WO'            // WalkOver
  | 'SUSP'          // Suspended
  | 'INT'           // Interrupted
  | 'LIVE';         // Generic Live Status

/**
 * Provider match data (raw format from external API)
 */
export interface ProviderMatch {
  providerMatchId: string;
  provider: string;
  status: ProviderMatchStatus;
  homeTeam: ProviderTeam;
  awayTeam: ProviderTeam;
  homeScore: number;
  awayScore: number;
  minute?: number;
  stoppageTime?: number;
  kickoffTime: string;
  venue?: string;
  competition?: string;
  season?: string;
  round?: string;
  referee?: string;
  attendance?: number;
  events?: ProviderEvent[];
}

/**
 * Provider team data
 */
export interface ProviderTeam {
  id: string;
  name: string;
  shortName?: string;
  logo?: string;
  country?: string;
}

/**
 * Provider event type
 */
export type ProviderEventType =
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
  | 'GOAL_DISALLOWED'
  | 'ASSIST';

/**
 * Provider event data (raw format from external API)
 */
export interface ProviderEvent {
  externalEventId: string;
  provider: string;
  matchId: string;
  eventType: ProviderEventType;
  minute: number;
  stoppageMinute?: number;
  teamId: string;
  teamName: string;
  playerId?: string;
  playerName: string;
  assistPlayerId?: string;
  assistPlayerName?: string;
  substitutePlayerId?: string;
  substitutePlayerName?: string;
  description?: string;
  timestamp: string;
  period?: 'first_half' | 'second_half' | 'extra_time' | 'penalties';
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  pollIntervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  webhookSecret?: string;
}

/**
 * Webhook payload from provider
 */
export interface ProviderWebhookPayload {
  provider: string;
  event: 'match.created' | 'match.updated' | 'match.finished' | 'match.event' | 'match.status';
  matchId: string;
  timestamp: string;
  data: ProviderMatch | ProviderEvent;
  signature?: string;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  name: string;
  isHealthy: boolean;
  lastCheck: string;
  responseTime: number;
  error?: string;
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Provider error types
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(provider: string, retryAfter: number) {
    super(
      `Rate limited by provider ${provider}`,
      provider,
      429,
      retryAfter
    );
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderNotFoundError extends ProviderError {
  constructor(provider: string, resourceId: string) {
    super(
      `Resource ${resourceId} not found from provider ${provider}`,
      provider,
      404
    );
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(provider: string) {
    super(
      `Authentication failed for provider ${provider}`,
      provider,
      401
    );
    this.name = 'ProviderAuthError';
  }
}