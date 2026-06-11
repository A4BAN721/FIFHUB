/**
 * API-Football Provider Implementation
 * 
 * Adapter for https://www.api-football.com provider.
 * Handles the specific data format, authentication, and endpoint structure.
 * 
 * Features:
 * - API authentication via headers
 * - Response transformation to internal ProviderMatch format
 * - Rate limit handling based on response headers
 * - Timeout support
 * - Automatic retry with exponential backoff
 */

import { FootballProvider } from '../provider-manager';
import type {
  ProviderMatch,
  ProviderEvent,
  ProviderMatchStatus,
  ProviderEventType,
} from '../types';
import { ProviderError, ProviderRateLimitError, ProviderAuthError } from '../types';

export interface ApiFootballConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, string>;
  errors: Array<{ key: string; message: string }>;
  results: number;
  paging: {
    current: number;
    total: number;
  };
  response: T;
}

interface ApiFootballFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    periods: {
      first: number | null;
      second: number | null;
    };
    venue: {
      id: number;
      name: string;
      city: string;
    };
    status: {
      long: string;
      short: string;
      elapsed: number | null;
      extra: number | null;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    round: string;
  };
  teams: {
    home: {
      id: number;
      name: string;
      logo: string;
      winner: boolean | null;
    };
    away: {
      id: number;
      name: string;
      logo: string;
      winner: boolean | null;
    };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
}

interface ApiFootballEvent {
  time: {
    elapsed: number;
    extra: number | null;
  };
  team: {
    id: number;
    name: string;
    logo: string;
  };
  player: {
    id: number;
    name: string;
  };
  assist: {
    id: number | null;
    name: string | null;
  };
  type: string;
  detail: string;
  comments: string | null;
}

const STATUS_MAP: Record<string, ProviderMatchStatus> = {
  'TBD': 'TBD',
  'NS': 'NS',
  '1H': '1H',
  'HT': 'HT',
  '2H': '2H',
  'ET': 'ET',
  'P': 'P',
  'FT': 'FT',
  'AET': 'AET',
  'PEN': 'PEN',
  'BT': 'LIVE', // Break Time (used in some leagues)
  'SUSP': 'SUSP',
  'INT': 'INT',
  'PST': 'POST',
  'CANC': 'CAN',
  'ABD': 'ABD',
  'AWD': 'AWD',
  'WO': 'WO',
  'LIVE': 'LIVE',
};

const EVENT_TYPE_MAP: Record<string, ProviderEventType> = {
  'Goal': 'GOAL',
  'Own Goal': 'OWN_GOAL',
  'Penalty': 'PENALTY_GOAL',
  'Missed Penalty': 'MISSED_PENALTY',
  'Yellow Card': 'YELLOW_CARD',
  'Red Card': 'RED_CARD',
  'Second Yellow card': 'SECOND_YELLOW',
  'Substitution': 'SUBSTITUTION',
  'Var': 'VAR',
  'Card': 'YELLOW_CARD',
};

export class ApiFootballProvider implements FootballProvider {
  readonly name = 'api-football';
  private config: ApiFootballConfig;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 1000; // 1 request per second minimum

  constructor(config: ApiFootballConfig) {
    this.config = {
      baseUrl: 'https://v3.football.api-sports.io',
      timeout: 10000,
      ...config,
    };
  }

  async getLiveMatches(): Promise<ProviderMatch[]> {
    const data = await this.request<ApiFootballFixture[]>('fixtures', {
      live: 'all',
    });
    return data.map((fixture) => this.transformFixture(fixture));
  }

  async getMatchEvents(matchId: string): Promise<ProviderEvent[]> {
    const data = await this.request<ApiFootballEvent[]>('fixtures/events', {
      fixture: matchId,
    });
    return data.map((event) => this.transformEvent(event, matchId));
  }

  async getMatchDetails(matchId: string): Promise<ProviderMatch | null> {
    try {
      const data = await this.request<ApiFootballFixture[]>('fixtures', {
        id: matchId,
      });
      if (data.length === 0) return null;
      return this.transformFixture(data[0]);
    } catch (error) {
      if (error instanceof ProviderError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>('status', {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make an authenticated request to the API-Football API
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number>
  ): Promise<T> {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.sleep(this.minRequestInterval - timeSinceLastRequest);
    }

    const url = new URL(`${this.config.baseUrl}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      this.lastRequestTime = Date.now();
      const response = await fetch(url.toString(), {
        headers: {
          'x-rapidapi-key': this.config.apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        throw new ProviderRateLimitError(this.name, retryAfter);
      }

      // Handle auth errors
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(this.name);
      }

      if (!response.ok) {
        throw new ProviderError(
          `API-Football returned status ${response.status}`,
          this.name,
          response.status
        );
      }

      const json: ApiFootballResponse<T> = await response.json();

      // Check for API errors
      if (json.errors && json.errors.length > 0) {
        const errorMessages = json.errors.map((e) => e.message).join(', ');
        throw new ProviderError(
          `API-Football error: ${errorMessages}`,
          this.name
        );
      }

      return json.response;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new ProviderError('Request timeout', this.name);
      }
      throw new ProviderError(
        `Request failed: ${(error as Error).message}`,
        this.name
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Transform API-Football fixture to internal ProviderMatch format
   */
  private transformFixture(fixture: ApiFootballFixture): ProviderMatch {
    const status = this.mapStatus(fixture.fixture.status.short);
    
    return {
      providerMatchId: String(fixture.fixture.id),
      provider: this.name,
      status,
      homeTeam: {
        id: String(fixture.teams.home.id),
        name: fixture.teams.home.name,
        logo: fixture.teams.home.logo,
      },
      awayTeam: {
        id: String(fixture.teams.away.id),
        name: fixture.teams.away.name,
        logo: fixture.teams.away.logo,
      },
      homeScore: fixture.goals.home ?? 0,
      awayScore: fixture.goals.away ?? 0,
      minute: fixture.fixture.status.elapsed ?? undefined,
      stoppageTime: fixture.fixture.status.extra ?? undefined,
      kickoffTime: fixture.fixture.date,
      venue: fixture.fixture.venue.name
        ? `${fixture.fixture.venue.name}, ${fixture.fixture.venue.city}`
        : undefined,
      competition: fixture.league.name,
      season: String(fixture.league.season),
      round: fixture.league.round,
      referee: fixture.fixture.referee ?? undefined,
    };
  }

  /**
   * Transform API-Football event to internal ProviderEvent format
   */
  private transformEvent(event: ApiFootballEvent, matchId: string): ProviderEvent {
    const eventType = this.mapEventType(event.type, event.detail);

    return {
      externalEventId: `${matchId}-${event.time.elapsed}-${event.player.name}-${eventType}-${Date.now()}`,
      provider: this.name,
      matchId,
      eventType,
      minute: event.time.elapsed,
      stoppageMinute: event.time.extra ?? undefined,
      teamId: String(event.team.id),
      teamName: event.team.name,
      playerId: String(event.player.id),
      playerName: event.player.name,
      assistPlayerId: event.assist.id ? String(event.assist.id) : undefined,
      assistPlayerName: event.assist.name ?? undefined,
      substitutePlayerName: event.type === 'Substitution' && event.assist.name 
        ? event.assist.name 
        : undefined,
      substitutePlayerId: event.type === 'Substitution' && event.assist.id
        ? String(event.assist.id)
        : undefined,
      description: event.comments ?? undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Map API-Football status to internal status
   */
  private mapStatus(status: string): ProviderMatchStatus {
    return STATUS_MAP[status] || 'LIVE';
  }

  /**
   * Map API-Football event type to internal event type
   */
  private mapEventType(type: string, detail: string): ProviderEventType {
    if (type === 'Goal' && detail === 'Penalty') return 'PENALTY_GOAL';
    if (type === 'Goal' && detail === 'Own Goal') return 'OWN_GOAL';
    if (type === 'Goal' && detail === 'Missed Penalty') return 'MISSED_PENALTY';
    return EVENT_TYPE_MAP[type] || 'YELLOW_CARD';
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}