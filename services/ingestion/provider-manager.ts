/**
 * Provider Manager
 * 
 * Manages multiple football data providers with automatic failover,
 * rate limiting, and health checks.
 * 
 * Features:
 * - Provider registration and lifecycle management
 * - Automatic failover between providers
 * - Rate limit handling with exponential backoff
 * - Provider health monitoring
 * - Circuit breaker pattern to prevent cascading failures
 */

import { EventEmitter } from 'events';
import type { ProviderMatch, ProviderEvent } from './types';

export interface FootballProvider {
  readonly name: string;
  getLiveMatches(): Promise<ProviderMatch[]>;
  getMatchEvents(matchId: string): Promise<ProviderEvent[]>;
  getMatchDetails(matchId: string): Promise<ProviderMatch | null>;
  healthCheck(): Promise<boolean>;
}

interface ProviderConfig {
  provider: FootballProvider;
  priority: number; // Lower = higher priority
  maxRetries: number;
  retryDelayMs: number;
  rateLimitPerMinute: number;
  circuitBreakerThreshold: number; // Failures before opening circuit
  circuitBreakerResetMs: number; // Time before attempting reset
}

interface ProviderState {
  config: ProviderConfig;
  isAvailable: boolean;
  lastHealthCheck: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  circuitOpenSince: number;
  rateLimitRemaining: number;
  rateLimitReset: number;
  totalRequests: number;
  totalFailures: number;
  averageResponseTime: number;
}

type ProviderStats = {
  isAvailable: boolean;
  circuitOpen: boolean;
  totalRequests: number;
  totalFailures: number;
  averageResponseTime: number;
  consecutiveFailures: number;
};

export class ProviderManager extends EventEmitter {
  private providers: Map<string, ProviderState> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly DEFAULT_HEALTH_CHECK_MS = 30_000;
  private readonly DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

  constructor() {
    super();
  }

  /**
   * Register a provider with its configuration
   */
  registerProvider(provider: FootballProvider, config: Partial<ProviderConfig> = {}): void {
    const defaultConfig: ProviderConfig = {
      provider,
      priority: 100,
      maxRetries: 3,
      retryDelayMs: 1000,
      rateLimitPerMinute: 30,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 60_000,
    };

    const mergedConfig: ProviderConfig = { ...defaultConfig, ...config };

    this.providers.set(provider.name, {
      config: mergedConfig,
      isAvailable: true,
      lastHealthCheck: Date.now(),
      consecutiveFailures: 0,
      circuitOpen: false,
      circuitOpenSince: 0,
      rateLimitRemaining: mergedConfig.rateLimitPerMinute,
      rateLimitReset: Date.now() + this.DEFAULT_RATE_LIMIT_WINDOW_MS,
      totalRequests: 0,
      totalFailures: 0,
      averageResponseTime: 0,
    });

    this.emit('provider:registered', { name: provider.name });
  }

  /**
   * Unregister a provider
   */
  unregisterProvider(providerName: string): void {
    this.providers.delete(providerName);
    this.emit('provider:unregistered', { name: providerName });
  }

  /**
   * Start health checks for all registered providers
   */
  startHealthChecks(intervalMs: number = this.DEFAULT_HEALTH_CHECK_MS): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, intervalMs);

    // Perform initial health check
    this.performHealthChecks();
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get live matches with automatic provider failover
   */
  async getLiveMatches(): Promise<ProviderMatch[]> {
    return this.executeWithFailover(
      (provider) => provider.getLiveMatches(),
      'getLiveMatches'
    );
  }

  /**
   * Get match events with automatic provider failover
   */
  async getMatchEvents(matchId: string): Promise<ProviderEvent[]> {
    return this.executeWithFailover(
      (provider) => provider.getMatchEvents(matchId),
      `getMatchEvents:${matchId}`
    );
  }

  /**
   * Get match details with automatic provider failover
   */
  async getMatchDetails(matchId: string): Promise<ProviderMatch | null> {
    return this.executeWithFailover(
      (provider) => provider.getMatchDetails(matchId),
      `getMatchDetails:${matchId}`
    );
  }

  /**
   * Get provider statistics
   */
  getProviderStats(): Record<string, ProviderStats> {
    const stats: Record<string, ProviderStats> = {};
    
    this.providers.forEach((state, name) => {
      stats[name] = {
        isAvailable: state.isAvailable,
        circuitOpen: state.circuitOpen,
        totalRequests: state.totalRequests,
        totalFailures: state.totalFailures,
        averageResponseTime: state.averageResponseTime,
        consecutiveFailures: state.consecutiveFailures,
      };
    });

    return stats;
  }

  /**
   * Execute a provider method with failover support
   */
  private async executeWithFailover<T>(
    fn: (provider: FootballProvider) => Promise<T>,
    operationName: string
  ): Promise<T> {
    const sortedProviders = this.getSortedAvailableProviders();
    
    if (sortedProviders.length === 0) {
      throw new Error('No available providers');
    }

    const lastError: Error[] = [];

    for (const { state, provider } of sortedProviders) {
      try {
        // Check circuit breaker
        if (state.circuitOpen) {
          if (Date.now() - state.circuitOpenSince >= state.config.circuitBreakerResetMs) {
            state.circuitOpen = false;
            state.consecutiveFailures = 0;
          } else {
            continue; // Skip this provider
          }
        }

        // Check rate limit
        if (state.rateLimitRemaining <= 0) {
          if (Date.now() < state.rateLimitReset) {
            continue; // Skip this provider if rate limited
          }
          // Reset rate limit window
          state.rateLimitRemaining = state.config.rateLimitPerMinute;
          state.rateLimitReset = Date.now() + this.DEFAULT_RATE_LIMIT_WINDOW_MS;
        }

        const startTime = Date.now();
        const result = await this.executeWithRetry(
          () => fn(provider),
          state.config.maxRetries,
          state.config.retryDelayMs
        );
        const responseTime = Date.now() - startTime;

        // Update provider state
        state.totalRequests++;
        state.consecutiveFailures = 0;
        state.rateLimitRemaining--;
        state.averageResponseTime = this.calculateMovingAverage(
          state.averageResponseTime,
          responseTime,
          state.totalRequests
        );

        this.emit('provider:success', {
          provider: provider.name,
          operation: operationName,
          responseTime,
        });

        return result;
      } catch (error) {
        lastError.push(error as Error);
        this.handleProviderFailure(state, error as Error, operationName);
      }
    }

    // All providers failed
    this.emit('all:providers:failed', {
      operation: operationName,
      errors: lastError,
    });

    throw new AggregateError(lastError, `All providers failed for operation: ${operationName}`);
  }

  /**
   * Execute a function with retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delayMs: number
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          const backoffDelay = delayMs * Math.pow(2, attempt);
          await this.sleep(backoffDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Handle provider failure
   */
  private handleProviderFailure(
    state: ProviderState,
    error: Error,
    operationName: string
  ): void {
    state.totalRequests++;
    state.totalFailures++;
    state.consecutiveFailures++;

    this.emit('provider:failure', {
      provider: state.config.provider.name,
      operation: operationName,
      error: error.message,
      consecutiveFailures: state.consecutiveFailures,
    });

    // Check if circuit should open
    if (state.consecutiveFailures >= state.config.circuitBreakerThreshold) {
      state.circuitOpen = true;
      state.circuitOpenSince = Date.now();

      this.emit('circuit:opened', {
        provider: state.config.provider.name,
        failures: state.consecutiveFailures,
      });
    }
  }

  /**
   * Perform health checks on all providers
   */
  private async performHealthChecks(): Promise<void> {
    const healthPromises: Promise<void>[] = [];

    this.providers.forEach((state) => {
      const promise = this.checkProviderHealth(state);
      healthPromises.push(promise);
    });

    await Promise.allSettled(healthPromises);
  }

  /**
   * Check a single provider's health
   */
  private async checkProviderHealth(state: ProviderState): Promise<void> {
    try {
      const isHealthy = await state.config.provider.healthCheck();
      state.isAvailable = isHealthy;
      state.lastHealthCheck = Date.now();

      this.emit('health:check', {
        provider: state.config.provider.name,
        isHealthy,
      });
    } catch (error) {
      state.isAvailable = false;
      
      this.emit('health:check:failed', {
        provider: state.config.provider.name,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get sorted list of available providers by priority
   */
  private getSortedAvailableProviders(): Array<{
    state: ProviderState;
    provider: FootballProvider;
  }> {
    const available: Array<{ state: ProviderState; provider: FootballProvider }> = [];

    this.providers.forEach((state) => {
      if (state.isAvailable) {
        available.push({ state, provider: state.config.provider });
      }
    });

    // Sort by priority (lower = higher priority)
    available.sort((a, b) => a.state.config.priority - b.state.config.priority);

    return available;
  }

  /**
   * Calculate moving average for response times
   */
  private calculateMovingAverage(
    currentAverage: number,
    newValue: number,
    totalSamples: number
  ): number {
    if (totalSamples === 1) return newValue;
    return currentAverage + (newValue - currentAverage) / totalSamples;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    this.stopHealthChecks();
    this.providers.clear();
    this.removeAllListeners();
  }
}
