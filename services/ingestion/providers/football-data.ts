/**
 * Football-Data.org Provider Implementation
 * 
 * Adapter for https://www.football-data.org provider.
 * Uses the free tier API format.
 */

import { FootballProvider } from '../provider-manager';
import type {
  ProviderMatch,
  ProviderEvent,
  ProviderMatchStatus,
  ProviderEventType,
} from '../types';
import { ProviderError, ProviderRateLimitError, ProviderAuthError } from '../types';

export interface FootballDataConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

interface FootballDataResponse<T> {
  count: number;
  filters: Record<string, string>;
  competition?: {
    id: number;
    name: string;
    code: string;
    type: string;
    emblem: string;
  };
  matches: T;
}

interface FootballDataMatch {
  id: number;
  competition: {
    id: number;
    name: string;
    code: string;
    type: string;
    emblem: string;
  };
  season: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number;
    winner: string | null;
  };
  utcDate: string;
  status: string;
  matchday: number;
  stage: string;
  group: string | null;
  lastUpdated: string;
  homeTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  awayTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  score: {
    winner: string | null;
    duration: string;
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    extraTime: { home: number | null; away: number | null };
    penalties: { home: number | null; away: number | null };
  };
  referees: Array<{
    id: number;
    name: string;
    type: string;
    nationality: string | null;
  }>;
}

interface FootballDataEvent {
  id: number;
  matchId: number;
  type: string;
  detail: string;
  minute: number;
  extraMinute?: number;
  team?: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  player?: {
    id: number;
    name: string;
  };
  assistPlayer?: {
    id: number;
    name: string;
  };
  substitute?: {
    id: number;
    name: string;
  };
}

const STATUS_MAP: Record<string, ProviderMatchStatus> = {
  'SCHEDULED': 'NS',
  'TIMED': 'NS',
  'IN_PLAY': '1H',
  'PAUSED': 'HT',
  'EXTRA_TIME': 'ET',
  'PENALTY_SHOOTOUT': 'P',
  'FINISHED': 'FT',
  'AWARDED': 'AWD',
  'POSTPONED': 'POST',
  'CANCELLED': 'CAN',
  'SUSPENDED': 'SUSP',
};

const EVENT_TYPE_MAP: Record<string, ProviderEventType> = {
  'GOAL': 'GOAL',
  'OWN_GOAL': 'OWN_GOAL',
  'PENALTY': 'PENALTY_GOAL',
  'MISSED_PENALTY': 'MISSED_PENALTY',
  'YELLOW_CARD': 'YELLOW_CARD',
  'RED_CARD': 'RED_CARD',
  'SECOND_YELLOW': 'SECOND_YELLOW',
  'SUBSTITUTION': 'SUBSTITUTION',
  'VAR': 'VAR',
};

export class FootballDataProvider implements FootballProvider {
  readonly name = 'football-data';
  private config: FootballDataConfig;

  constructor(config: FootballDataConfig) {
    this.config = {
      baseUrl: 'https://api.football-data.org/v4',
      timeout: 10000,
      ...config,
    };
  }

  async getLiveMatches(): Promise<ProviderMatch[]> {
    const data = await this.request<FootballDataMatch[]>('matches', {
      status: 'LIVE,IN_PLAY,PAUSED',
    });
    return data.matches.map((match) => this.transformMatch(match));
  }

  async getMatchEvents(matchId: string): Promise<ProviderEvent[]> {
    const match = await this.getMatchDetails(matchId);
    return match?.events ?? [];
  }

  async getMatchDetails(matchId: string): Promise<ProviderMatch | null> {
    try {
      const match = await this.request<FootballDataMatch>(`matches/${matchId}`, {});
      return this.transformMatch(match as unknown as FootballDataMatch);
    } catch (error) {
      if (error instanceof ProviderError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('competitions/2021', {}); // Premier League competition
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make an authenticated request to the football-data.org API
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number>
  ): Promise<FootballDataResponse<T>> {
    const url = new URL(`${this.config.baseUrl}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'X-Auth-Token': this.config.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        throw new ProviderRateLimitError(this.name, 60);
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(this.name);
      }

      if (!response.ok) {
        throw new ProviderError(
          `football-data.org returned status ${response.status}`,
          this.name,
          response.status
        );
      }

      return await response.json();
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
   * Transform football-data.org match to internal ProviderMatch format
   */
  private transformMatch(match: FootballDataMatch): ProviderMatch {
    return {
      providerMatchId: String(match.id),
      provider: this.name,
      status: this.mapStatus(match.status),
      homeTeam: {
        id: String(match.homeTeam.id),
        name: match.homeTeam.name,
        shortName: match.homeTeam.shortName,
        logo: match.homeTeam.crest,
      },
      awayTeam: {
        id: String(match.awayTeam.id),
        name: match.awayTeam.name,
        shortName: match.awayTeam.shortName,
        logo: match.awayTeam.crest,
      },
      homeScore: match.score.fullTime.home ?? match.score.fullTime.home ?? 0,
      awayScore: match.score.fullTime.away ?? match.score.fullTime.away ?? 0,
      kickoffTime: match.utcDate,
      competition: match.competition.name,
      season: String(match.season.startDate?.substring(0, 4)),
      round: match.stage || undefined,
    };
  }

  /**
   * Map football-data.org status to internal status
   */
  private mapStatus(status: string): ProviderMatchStatus {
    return STATUS_MAP[status] || 'LIVE';
  }
}