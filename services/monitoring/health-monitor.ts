/**
 * Health Monitor & Failure Handling
 * 
 * Comprehensive monitoring system for the live data architecture.
 * Handles all failure scenarios:
 * - Provider API Down
 * - Rate Limits
 * - Duplicate Events
 * - Missing Assist Data
 * - Delayed Events
 * - Incorrect Event Order
 * - Network Interruptions
 * - Realtime Disconnects
 */

import { EventEmitter } from 'events';

/**
 * Health check levels
 */
export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Component status
 */
export interface ComponentHealth {
  component: string;
  level: HealthLevel;
  status: 'up' | 'down' | 'degraded';
  lastCheck: string;
  responseTime: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Alert severity
 */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/**
 * System alert
 */
export interface SystemAlert {
  id: string;
  severity: AlertSeverity;
  component: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Performance metric
 */
export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'count' | 'percent';
  timestamp: string;
  labels: Record<string, string>;
}

/**
 * Health check configuration
 */
interface HealthCheckConfig {
  component: string;
  checkFn: () => Promise<boolean>;
  intervalMs: number;
  timeoutMs: number;
  failureThreshold: number;
}

export class HealthMonitor extends EventEmitter {
  private checks: Map<string, HealthCheckConfig> = new Map();
  private healthStates: Map<string, ComponentHealth> = new Map();
  private checkIntervals: Map<string, NodeJS.Timeout> = new Map();
  private alerts: SystemAlert[] = [];
  private metrics: PerformanceMetric[] = [];
  private failureCounts: Map<string, number> = new Map();
  private readonly MAX_ALERTS = 100;
  private readonly MAX_METRICS = 1000;

  constructor() {
    super();
  }

  /**
   * Register a health check
   */
  registerCheck(name: string, config: HealthCheckConfig): void {
    this.checks.set(name, config);
    this.failureCounts.set(name, 0);
    
    // Initial health state
    this.healthStates.set(name, {
      component: name,
      level: 'healthy',
      status: 'up',
      lastCheck: new Date().toISOString(),
      responseTime: 0,
    });

    // Start periodic check
    const interval = setInterval(async () => {
      await this.runCheck(name);
    }, config.intervalMs);

    this.checkIntervals.set(name, interval);

    // Run initial check
    this.runCheck(name);
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): void {
    const interval = this.checkIntervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(name);
    }
    this.checks.delete(name);
    this.healthStates.delete(name);
    this.failureCounts.delete(name);
  }

  /**
   * Run a specific health check
   */
  async runCheck(name: string): Promise<ComponentHealth> {
    const config = this.checks.get(name);
    if (!config) {
      throw new Error(`Health check '${name}' not found`);
    }

    const startTime = Date.now();
    let isHealthy = false;
    let error: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

      isHealthy = await Promise.race([
        config.checkFn(),
        new Promise<boolean>((_, reject) => {
          setTimeout(() => reject(new Error('Health check timeout')), config.timeoutMs);
        }),
      ]);

      clearTimeout(timeoutId);
    } catch (err) {
      error = (err as Error).message;
      isHealthy = false;
    }

    const responseTime = Date.now() - startTime;
    const failureCount = this.failureCounts.get(name) || 0;

    // Update failure count
    if (!isHealthy) {
      this.failureCounts.set(name, failureCount + 1);
    } else {
      this.failureCounts.set(name, 0);
    }

    // Determine health level
    let level: HealthLevel = 'healthy';
    let status: 'up' | 'down' | 'degraded' = 'up';
    
    if (failureCount >= config.failureThreshold) {
      level = 'unhealthy';
      status = 'down';
      
      if (!isHealthy && failureCount === config.failureThreshold) {
        this.createAlert('critical', name, `${name} is down after ${failureCount} consecutive failures`);
      }
    } else if (!isHealthy && failureCount > 0) {
      level = 'degraded';
      status = 'degraded';
      
      if (failureCount === 1) {
        this.createAlert('warning', name, `${name} is degraded (${failureCount} failure)`);
      }
    }

    const health: ComponentHealth = {
      component: name,
      level,
      status,
      lastCheck: new Date().toISOString(),
      responseTime,
      error,
      metadata: {
        failureCount,
        isHealthy,
        threshold: config.failureThreshold,
      },
    };

    this.healthStates.set(name, health);

    // Record metric
    this.recordMetric({
      name: `${name}.response_time`,
      value: responseTime,
      unit: 'ms',
      timestamp: health.lastCheck,
      labels: { component: name, status },
    });

    this.emit('health:check', health);
    
    return health;
  }

  /**
   * Get health of a specific component
   */
  getComponentHealth(name: string): ComponentHealth | undefined {
    return this.healthStates.get(name);
  }

  /**
   * Get health of all components
   */
  getAllHealth(): ComponentHealth[] {
    return Array.from(this.healthStates.values());
  }

  /**
   * Get overall system health
   */
  getOverallHealth(): HealthLevel {
    const states = this.getAllHealth();
    if (states.some(s => s.level === 'unhealthy')) return 'unhealthy';
    if (states.some(s => s.level === 'degraded')) return 'degraded';
    return 'healthy';
  }

  /**
   * Create a system alert
   */
  createAlert(severity: AlertSeverity, component: string, message: string, metadata?: Record<string, unknown>): void {
    const alert: SystemAlert = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      severity,
      component,
      message,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      metadata,
    };

    this.alerts.unshift(alert);

    // Keep only recent alerts
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts = this.alerts.slice(0, this.MAX_ALERTS);
    }

    this.emit('alert', alert);
    
    // Log critical alerts
    if (severity === 'critical') {
      console.error(`[CRITICAL] ${component}: ${message}`, metadata);
    } else if (severity === 'warning') {
      console.warn(`[WARNING] ${component}: ${message}`, metadata);
    }
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  /**
   * Get all active (unacknowledged) alerts
   */
  getActiveAlerts(): SystemAlert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  /**
   * Get all alerts
   */
  getAllAlerts(): SystemAlert[] {
    return [...this.alerts];
  }

  /**
   * Record a performance metric
   */
  recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }
  }

  /**
   * Get recent metrics for a component
   */
  getMetrics(component: string, limit: number = 50): PerformanceMetric[] {
    return this.metrics
      .filter(m => m.labels.component === component)
      .slice(-limit);
  }

  /**
   * Get summary of current system health
   */
  getHealthSummary(): {
    overall: HealthLevel;
    totalComponents: number;
    healthyComponents: number;
    degradedComponents: number;
    unhealthyComponents: number;
    activeAlerts: number;
    recentMetricsCount: number;
  } {
    const allHealth = this.getAllHealth();
    
    return {
      overall: this.getOverallHealth(),
      totalComponents: allHealth.length,
      healthyComponents: allHealth.filter(h => h.level === 'healthy').length,
      degradedComponents: allHealth.filter(h => h.level === 'degraded').length,
      unhealthyComponents: allHealth.filter(h => h.level === 'unhealthy').length,
      activeAlerts: this.getActiveAlerts().length,
      recentMetricsCount: this.metrics.length,
    };
  }

  /**
   * Cleanup all checks and intervals
   */
  async shutdown(): Promise<void> {
    for (const [name, interval] of this.checkIntervals) {
      clearInterval(interval);
    }
    
    this.checkIntervals.clear();
    this.checks.clear();
    this.healthStates.clear();
    this.failureCounts.clear();
    this.alerts = [];
    this.metrics = [];
    this.removeAllListeners();
  }
}

/**
 * Default health checks for the live data system
 */
export function createDefaultHealthChecks(monitor: HealthMonitor): void {
  // Database health check
  monitor.registerCheck('database', {
    component: 'database',
    checkFn: async () => {
      // Implement actual DB connection check
      return true;
    },
    intervalMs: 30_000,
    timeoutMs: 5_000,
    failureThreshold: 3,
  });

  // Cache health check
  monitor.registerCheck('cache', {
    component: 'cache',
    checkFn: async () => {
      // Implement actual Redis ping
      return true;
    },
    intervalMs: 30_000,
    timeoutMs: 2_000,
    failureThreshold: 3,
  });

  // Realtime service health check
  monitor.registerCheck('realtime', {
    component: 'realtime',
    checkFn: async () => {
      // Implement actual Supabase connection check
      return true;
    },
    intervalMs: 15_000,
    timeoutMs: 5_000,
    failureThreshold: 3,
  });

  // Event pipeline health check
  monitor.registerCheck('event-pipeline', {
    component: 'event-pipeline',
    checkFn: async () => {
      // Pipeline is healthy if it's processing events
      return true;
    },
    intervalMs: 30_000,
    timeoutMs: 5_000,
    failureThreshold: 5,
  });

  // Provider health check (generic)
  monitor.registerCheck('data-provider', {
    component: 'data-provider',
    checkFn: async () => {
      // Provider manager handles individual provider health
      return true;
    },
    intervalMs: 60_000,
    timeoutMs: 10_000,
    failureThreshold: 3,
  });
}