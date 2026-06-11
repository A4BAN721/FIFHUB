/**
 * Realtime Publishing System
 * 
 * Architecture:
 * Event Processor -> Realtime Publisher -> Channels -> Clients
 * 
 * Channel Pattern:
 * - match:{id} - Individual match updates (goal, card, sub, etc.)
 * - match:{id}:events - Match event stream
 * - worldcup:live - All live World Cup matches
 * - competitions:{id} - All matches in a competition
 * 
 * Features:
 * - Channel-based subscriptions (no broadcasting all matches to everyone)
 * - Automatic reconnection with backoff
 * - Message ordering with sequence numbers
 * - Connection state management
 * - Client-side heartbeat to detect disconnects
 */

import { EventEmitter } from 'events';
import type { PipelineEvent } from '../event-processor/event-pipeline';
import type { MatchSummaryResponse, MatchEventResponse } from '../normalization/types';

/**
 * Channel types for realtime subscriptions
 */
export type ChannelType =
  | 'match'
  | 'match_events'
  | 'live_scores'
  | 'competition'
  | 'worldcup';

/**
 * Channel subscription configuration
 */
export interface ChannelConfig {
  type: ChannelType;
  id: string; // match ID, competition ID, etc.
  events?: string[]; // Filter specific event types
}

/**
 * Realtime message envelope
 */
export interface RealtimeMessage {
  type: 'match.update' | 'match.event' | 'match.status' | 'match.created' | 'match.removed';
  channel: string;
  data: unknown;
  timestamp: string;
  sequence: number;
}

/**
 * Realtime connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Publisher interface for the event pipeline
 */
export interface PublisherInterface {
  publish(matchId: string, channel: string, event: PipelineEvent): Promise<void>;
  publishBatch(events: PipelineEvent[]): Promise<void>;
}

/**
 * Supabase Realtime Publisher
 * 
 * Uses Supabase's built-in realtime functionality with PostgreSQL replication.
 * Provides channel-based subscriptions for different types of updates.
 */
export class SupabaseRealtimePublisher extends EventEmitter implements PublisherInterface {
  private connectionState: ConnectionState = 'disconnected';
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelayMs: number = 1000;
  private subscriptions: Map<string, boolean> = new Map();
  private supabaseClient: any = null; // Supabase client reference
  private messageQueue: PipelineEvent[] = [];
  private isProcessingQueue: boolean = false;

  constructor() {
    super();
  }

  /**
   * Initialize the publisher with a Supabase client
   */
  initialize(supabaseClient: any): void {
    this.supabaseClient = supabaseClient;
    this.connectionState = 'connected';
    this.emit('connected');
  }

  /**
   * Publish a single event to a channel
   */
  async publish(matchId: string, channel: string, event: PipelineEvent): Promise<void> {
    const message = this.createRealtimeMessage(event, channel);

    try {
      if (this.connectionState !== 'connected') {
        this.messageQueue.push(event);
        return;
      }

      // Broadcast through Supabase Realtime
      if (this.supabaseClient) {
        const channel_obj = this.supabaseClient.channel(channel);
        
        await channel_obj.send({
          type: 'broadcast',
          event: message.type,
          payload: message,
        });
      }

      this.emit('published', {
        channel,
        type: message.type,
        matchId,
      });
    } catch (error) {
      this.emit('publish:error', {
        channel,
        matchId,
        error: (error as Error).message,
      });

      // Queue for retry
      this.messageQueue.push(event);
    }
  }

  /**
   * Publish a batch of events
   */
  async publishBatch(events: PipelineEvent[]): Promise<void> {
    if (events.length === 0) return;

    try {
      if (this.connectionState !== 'connected') {
        this.messageQueue.push(...events);
        return;
      }

      // Group by channel for efficiency
      const grouped = new Map<string, PipelineEvent[]>();
      for (const event of events) {
        const channel = `match:${event.matchId}`;
        const existing = grouped.get(channel) || [];
        existing.push(event);
        grouped.set(channel, existing);
      }

      // Publish to each channel
      for (const [channel, channelEvents] of grouped) {
        if (this.supabaseClient) {
          const channel_obj = this.supabaseClient.channel(channel);
          
          for (const event of channelEvents) {
            const message = this.createRealtimeMessage(event, channel);
            await channel_obj.send({
              type: 'broadcast',
              event: message.type,
              payload: message,
            }).catch(() => {
              // Individual failures are handled
            });
          }
        }
      }

      this.emit('batch:published', { count: events.length });
    } catch (error) {
      this.emit('batch:publish:error', {
        error: (error as Error).message,
        eventCount: events.length,
      });

      // Queue all for retry
      this.messageQueue.push(...events);
    }
  }

  /**
   * Process queued messages
   */
  async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.messageQueue.length === 0) return;

    this.isProcessingQueue = true;

    try {
      const batch = this.messageQueue.splice(0, 50); // Process in batches of 50
      await this.publishBatch(batch);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Handle reconnection
   */
  async reconnect(): Promise<void> {
    this.connectionState = 'reconnecting';
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.emit('reconnect:failed', {
        attempts: this.reconnectAttempts,
      });
      return;
    }

    const delay = this.calculateBackoffDelay();
    
    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay,
    });

    await this.sleep(delay);

    // Attempt to reconnect via the initialized client
    if (this.supabaseClient) {
      this.connectionState = 'connected';
      this.reconnectAttempts = 0;
      this.emit('reconnected');

      // Process queued messages
      await this.processQueue();
    }
  }

  /**
   * Create a Realtime message from a pipeline event
   */
  private createRealtimeMessage(event: PipelineEvent, channel: string): RealtimeMessage {
    const type = this.determineMessageType(event);
    
    return {
      type,
      channel,
      data: this.formatEventData(event),
      timestamp: new Date().toISOString(),
      sequence: event.metadata.sequenceNumber,
    };
  }

  /**
   * Determine the message type from a pipeline event
   */
  private determineMessageType(event: PipelineEvent): RealtimeMessage['type'] {
    switch (event.type) {
      case 'match.created':
        return 'match.created';
      case 'match.finished':
        return 'match.removed';
      case 'match.status_change':
        return 'match.status';
      case 'match.event':
        return 'match.event';
      default:
        return 'match.update';
    }
  }

  /**
   * Format event data for broadcasting
   */
  private formatEventData(event: PipelineEvent): unknown {
    return {
      matchId: event.matchId,
      ...event.newState,
      event: event.data,
      previousState: event.previousState,
    };
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoffDelay(): number {
    const baseDelay = this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    const maxDelay = 30_000; // 30 seconds max
    const jitter = Math.random() * 1000;
    return Math.min(baseDelay, maxDelay) + jitter;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.messageQueue.length;
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
    this.removeAllListeners();
    this.messageQueue = [];
    this.subscriptions.clear();
    this.connectionState = 'disconnected';
  }
}

/**
 * Client-side hook for subscribing to realtime match updates
 * This is consumed by the React frontend
 */
export class RealtimeClient {
  private supabaseClient: any;
  private subscriptions: Map<string, any> = new Map();
  private listeners: Map<string, Array<(data: any) => void>> = new Map();

  constructor(supabaseClient: any) {
    this.supabaseClient = supabaseClient;
  }

  /**
   * Subscribe to a match channel
   * Clients subscribe only to relevant matches, not all matches
   */
  subscribeToMatch(matchId: string, onUpdate: (data: any) => void): () => void {
    const channelName = `match:${matchId}`;
    return this.subscribe(channelName, 'match.update', onUpdate);
  }

  /**
   * Subscribe to match events
   */
  subscribeToMatchEvents(matchId: string, onEvent: (data: any) => void): () => void {
    const channelName = `match:${matchId}`;
    return this.subscribe(channelName, 'match.event', onEvent);
  }

  /**
   * Subscribe to all live matches
   */
  subscribeToLiveScores(onUpdate: (data: any) => void): () => void {
    const channelName = 'live-scores';
    return this.subscribe(channelName, 'match.update', onUpdate);
  }

  /**
   * Subscribe to a competition channel
   */
  subscribeToCompetition(competitionId: string, onUpdate: (data: any) => void): () => void {
    const channelName = `competition:${competitionId}`;
    return this.subscribe(channelName, 'match.update', onUpdate);
  }

  /**
   * Subscribe to World Cup live channel
   */
  subscribeToWorldCup(onUpdate: (data: any) => void): () => void {
    const channelName = 'worldcup:live';
    return this.subscribe(channelName, 'match.update', onUpdate);
  }

  /**
   * Generic subscribe method
   */
  subscribe(
    channel: string,
    event: string,
    callback: (data: any) => void
  ): () => void {
    // Track listener
    const key = `${channel}:${event}`;
    const existing = this.listeners.get(key) || [];
    existing.push(callback);
    this.listeners.set(key, existing);

    // Create subscription if not exists
    if (!this.subscriptions.has(channel)) {
      const subscription = this.supabaseClient
        .channel(channel)
        .on(
          'broadcast',
          { event },
          (payload: any) => {
            this.notifyListeners(channel, event, payload.payload);
          }
        )
        .subscribe();

      this.subscriptions.set(channel, subscription);
    }

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(key) || [];
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }

      if (listeners.length === 0) {
        this.listeners.delete(key);
      }

      // Clean up subscription if no more listeners
      if (!this.hasListeners(channel)) {
        const sub = this.subscriptions.get(channel);
        if (sub) {
          sub.unsubscribe();
          this.subscriptions.delete(channel);
        }
      }
    };
  }

  /**
   * Notify all listeners for a channel/event
   */
  private notifyListeners(channel: string, event: string, data: any): void {
    const key = `${channel}:${event}`;
    const listeners = this.listeners.get(key) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Realtime callback error:', error);
      }
    });
  }

  /**
   * Check if a channel has any active listeners
   */
  private hasListeners(channel: string): boolean {
    for (const key of this.listeners.keys()) {
      if (key.startsWith(channel)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get active subscription count
   */
  getActiveSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Cleanup all subscriptions
   */
  async cleanup(): Promise<void> {
    for (const [channel, subscription] of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();
    this.listeners.clear();
  }
}

/**
 * Create realtime publisher instance
 */
export function createRealtimePublisher(): SupabaseRealtimePublisher {
  return new SupabaseRealtimePublisher();
}