/**
 * Redis Cache Layer
 * 
 * High-performance caching for live match data.
 * The frontend always hits cache first for optimal performance.
 * 
 * Cache Strategies:
 * - Live scores: 15 second TTL
 * - Match state: 30 second TTL
 * - Events: 60 second TTL  
 * - API responses: 15 second TTL
 * 
 * Keys Pattern:
 * - live:match:{id} - Live match state
 * - events:match:{id} - Match events
 * - score:{id} - Quick score lookup
 * - api:matches:live - Live matches list
 * - api:match:{id} - Match details
 * - api:match:{id}:events - Match events
 */

/**
 * Redis cache configuration.
 * 
 * SECURITY: `password` is stored internally and MUST NOT be logged,
 * displayed in error messages, or serialized in any output.
 */
export interface CacheConfig {
  host: string;
  port: number;
  /** @internal - Do NOT log or expose this value */
  password?: string;
  keyPrefix?: string;
  defaultTTL?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  memoryUsage?: string;
}

/**
 * Cache TTL constants (in seconds)
 */
export const CACHE_TTL = {
  LIVE_SCORE: 15,         // Live score updates every 15s
  MATCH_STATE: 30,        // Match state every 30s
  MATCH_EVENTS: 60,       // Events cache for 60s
  API_RESPONSE: 15,       // API response cache
  MATCH_LIST: 15,         // Match list cache
  TEAM_DATA: 300,         // Team data for 5 min
  COMPETITION_DATA: 600,  // Competition data for 10 min
} as const;

/**
 * Cache key patterns
 */
export const CACHE_KEYS = {
  liveMatch: (id: string) => `live:match:${id}`,
  matchState: (id: string) => `state:match:${id}`,
  matchEvents: (id: string) => `events:match:${id}`,
  score: (id: string) => `score:${id}`,
  liveMatches: 'api:matches:live',
  matchDetail: (id: string) => `api:match:${id}`,
  matchEventList: (id: string) => `api:match:${id}:events`,
  teamById: (id: string) => `team:${id}`,
  competitionById: (id: string) => `competition:${id}`,
} as const;

/**
 * Redis Cache Manager
 * 
 * Note: Uses native fetch/Response for Redis HTTP API compatibility.
 * For production, replace with ioredis client.
 */
export class RedisCache {
  private static instance: RedisCache;
  private config: CacheConfig;
  private stats: CacheStats = { hits: 0, misses: 0, keys: 0 };
  private client: Map<string, { value: string; expiry: number }> = new Map();
  private useInMemoryFallback: boolean = false;

  private constructor(config: CacheConfig) {
    this.config = {
      keyPrefix: 'fifhub:',
      defaultTTL: CACHE_TTL.API_RESPONSE,
      ...config,
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: CacheConfig): RedisCache {
    if (!RedisCache.instance) {
      if (config) {
        RedisCache.instance = new RedisCache(config);
      } else {
        // Create default instance from environment variables
        RedisCache.instance = new RedisCache({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD,
          keyPrefix: 'fifhub:',
          defaultTTL: CACHE_TTL.API_RESPONSE,
        });
      }
    }
    return RedisCache.instance;
  }

  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.buildKey(key);

    try {
      if (this.useInMemoryFallback) {
        return this.getFromMemory<T>(fullKey);
      }

      const value = await this.redisGet(fullKey);
      if (value) {
        this.stats.hits++;
        return JSON.parse(value) as T;
      }

      this.stats.misses++;
      return null;
    } catch {
      // Fall back to in-memory cache on Redis failure
      this.useInMemoryFallback = true;
      return this.getFromMemory<T>(fullKey);
    }
  }

  /**
   * Set a cached value
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const fullKey = this.buildKey(key);
    const ttlSeconds = ttl ?? this.config.defaultTTL ?? CACHE_TTL.API_RESPONSE;
    const serialized = JSON.stringify(value);

    try {
      if (this.useInMemoryFallback) {
        this.setInMemory(fullKey, serialized, ttlSeconds);
        return;
      }

      await this.redisSet(fullKey, serialized, ttlSeconds);
    } catch {
      this.setInMemory(fullKey, serialized, ttlSeconds);
    }
  }

  /**
   * Delete a cached value
   */
  async del(key: string): Promise<void> {
    const fullKey = this.buildKey(key);
    
    this.client.delete(fullKey);

    try {
      await this.redisDel(fullKey);
    } catch {
      // Silently fail
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.buildKey(key);
    
    // Check memory first
    if (this.client.has(fullKey)) {
      const entry = this.client.get(fullKey)!;
      if (entry.expiry > Date.now()) {
        return true;
      }
      this.client.delete(fullKey);
    }

    return false;
  }

  /**
   * Get multiple cached values
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map(key => this.get<T>(key)));
  }

  /**
   * Set multiple cache values
   */
  async mset(entries: Array<{ key: string; value: unknown; ttl?: number }>): Promise<void> {
    await Promise.all(
      entries.map(({ key, value, ttl }) => this.set(key, value, ttl))
    );
  }

  /**
   * Increment a counter
   */
  async increment(key: string, by: number = 1): Promise<number> {
    const fullKey = this.buildKey(key);
    
    const existing = await this.get<number>(fullKey) ?? 0;
    const newValue = existing + by;
    await this.set(fullKey, newValue);
    
    return newValue;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      keys: this.client.size,
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, keys: 0 };
  }

  /**
   * Clear all cached data
   */
  async flushAll(): Promise<void> {
    this.client.clear();
    this.stats = { hits: 0, misses: 0, keys: 0 };
  }

  /**
   * Build full cache key with prefix
   */
  private buildKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  /**
   * In-memory cache get
   */
  private getFromMemory<T>(key: string): T | null {
    const entry = this.client.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (entry.expiry < Date.now()) {
      this.client.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return JSON.parse(entry.value) as T;
  }

  /**
   * In-memory cache set
   */
  private setInMemory(key: string, value: string, ttlSeconds: number): void {
    this.client.set(key, {
      value,
      expiry: Date.now() + (ttlSeconds * 1000),
    });
  }

  /**
   * Redis GET operation
   * Uses HTTP interface to Redis - replace with ioredis in production
   */
  private async redisGet(key: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      const response = await fetch(
        `http://${this.config.host}:${this.config.port}/get/${key}`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (!response.ok) return null;
      const data = await response.text();
      return data || null;
    } catch {
      return null;
    }
  }

  /**
   * Redis SET operation
   */
  private async redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      await fetch(
        `http://${this.config.host}:${this.config.port}/set/${key}/${value}/ex/${ttlSeconds}`,
        { method: 'POST', signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
    } catch {
      // Silently fail
    }
  }

  /**
   * Redis DEL operation
   */
  private async redisDel(key: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      await fetch(
        `http://${this.config.host}:${this.config.port}/del/${key}`,
        { method: 'POST', signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
    } catch {
      // Silently fail
    }
  }
}

/**
 * Cache helper for match operations
 */
export class MatchCache {
  private cache: RedisCache;

  constructor(cache: RedisCache) {
    this.cache = cache;
  }

  /**
   * Cache live match state
   */
  async setLiveMatch(matchId: string, data: { homeScore?: number; awayScore?: number }): Promise<void> {
    await Promise.all([
      this.cache.set(CACHE_KEYS.liveMatch(matchId), data, CACHE_TTL.LIVE_SCORE),
      this.cache.set(CACHE_KEYS.score(matchId), {
        homeScore: data.homeScore,
        awayScore: data.awayScore,
      }, CACHE_TTL.LIVE_SCORE),
    ]);
  }

  /**
   * Get live match state
   */
  async getLiveMatch(matchId: string): Promise<unknown | null> {
    return this.cache.get(CACHE_KEYS.liveMatch(matchId));
  }

  /**
   * Cache match events
   */
  async setMatchEvents(matchId: string, events: unknown[]): Promise<void> {
    await this.cache.set(CACHE_KEYS.matchEvents(matchId), events, CACHE_TTL.MATCH_EVENTS);
  }

  /**
   * Get match events
   */
  async getMatchEvents(matchId: string): Promise<unknown[] | null> {
    return this.cache.get(CACHE_KEYS.matchEvents(matchId));
  }

  /**
   * Cache API response
   */
  async setApiResponse(key: string, data: unknown): Promise<void> {
    await this.cache.set(key, data, CACHE_TTL.API_RESPONSE);
  }

  /**
   * Get cached API response
   */
  async getApiResponse<T>(key: string): Promise<T | null> {
    return this.cache.get<T>(key);
  }

  /**
   * Invalidate match cache
   */
  async invalidateMatch(matchId: string): Promise<void> {
    await Promise.all([
      this.cache.del(CACHE_KEYS.liveMatch(matchId)),
      this.cache.del(CACHE_KEYS.matchState(matchId)),
      this.cache.del(CACHE_KEYS.matchEvents(matchId)),
      this.cache.del(CACHE_KEYS.score(matchId)),
      this.cache.del(CACHE_KEYS.matchDetail(matchId)),
      this.cache.del(CACHE_KEYS.matchEventList(matchId)),
      this.cache.del(CACHE_KEYS.liveMatches),
    ]);
  }
}

/**
 * Create cache instance
 */
export function createCache(config?: Partial<CacheConfig>): { 
  cache: RedisCache; 
  matchCache: MatchCache;
} {
  const defaultConfig: CacheConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    keyPrefix: 'fifhub:',
    defaultTTL: CACHE_TTL.API_RESPONSE,
  };

  const cache = RedisCache.getInstance({ ...defaultConfig, ...config });
  const matchCache = new MatchCache(cache);

  return { cache, matchCache };
}
