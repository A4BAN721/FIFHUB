/**
 * Event Processing Pipeline
 * 
 * Every update is processed as an event through a pipeline:
 * 
 * Incoming Event -> Validation -> Deduplication -> Storage -> Realtime Broadcast
 * 
 * Features:
 * - Event IDs with ordering support
 * - Duplicate detection using event ID cache
 * - Retry queue with exponential backoff
 * - Event ordering and timestamp tracking
 * - Dead-letter queue for failed events
 * - Monitoring and logging
 */

import { EventEmitter } from 'events';
import type { NormalizedEvent, LiveMatchState } from '../normalization/types';

/**
 * Event types that flow through the pipeline
 */
export type PipelineEventType =
  | 'match.created'
  | 'match.updated'
  | 'match.finished'
  | 'match.event'
  | 'match.status_change'
  | 'pipeline.error'
  | 'pipeline.dead_letter'
  | 'pipeline.retry';

/**
 * A wrapper around a normalized event with pipeline metadata
 */
export interface PipelineEvent {
  id: string;
  type: PipelineEventType;
  matchId: string;
  data: NormalizedEvent | NormalizedEvent[];
  metadata: {
    receivedAt: string;
    processedAt?: string;
    source: string;
    retryCount: number;
    previousEventId?: string;
    sequenceNumber: number;
  };
  previousState?: LiveMatchState;
  newState?: LiveMatchState;
}

/**
 * Validation result
 */
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Retry queue item
 */
interface RetryQueueItem {
  event: PipelineEvent;
  nextRetryAt: number;
  retryCount: number;
  maxRetries: number;
  error: string;
}

/**
 * Dead letter queue item
 */
interface DeadLetterItem {
  event: PipelineEvent;
  reason: string;
  failedAt: string;
  retryCount: number;
}

/**
 * Storage interface - implemented by database layer
 */
export interface EventStorage {
  saveEvent(event: NormalizedEvent): Promise<void>;
  saveEvents(events: NormalizedEvent[]): Promise<void>;
  eventExists(externalEventId: string): Promise<boolean>;
  getEventsByMatchId(matchId: string): Promise<NormalizedEvent[]>;
  updateMatchState(matchId: string, state: LiveMatchState): Promise<void>;
  getMatchState(matchId: string): Promise<LiveMatchState | null>;
}

/**
 * Realtime publisher interface - implemented by Supabase/WebSocket layer
 */
export interface RealtimePublisher {
  publish(matchId: string, channel: string, event: PipelineEvent): Promise<void>;
  publishBatch(events: PipelineEvent[]): Promise<void>;
}

/**
 * Event Processor Pipeline
 */
export class EventPipeline extends EventEmitter {
  private storage: EventStorage;
  private publisher: RealtimePublisher;
  private retryQueue: RetryQueueItem[] = [];
  private deadLetterQueue: DeadLetterItem[] = [];
  private processedEventIds: Set<string> = new Set();
  private sequenceNumber: number = 0;
  private isProcessing: boolean = false;
  private retryInterval: NodeJS.Timeout | null = null;
  private readonly MAX_RETRY_QUEUE_SIZE = 1000;
  private readonly MAX_DEAD_LETTER_SIZE = 500;
  private readonly RETRY_INTERVAL_MS = 5_000;
  private readonly MAX_EVENT_ID_CACHE_SIZE = 10000;
  private readonly DUPLICATE_CACHE_TTL_MS = 300_000; // 5 minutes

  constructor(storage: EventStorage, publisher: RealtimePublisher) {
    super();
    this.storage = storage;
    this.publisher = publisher;
    this.startRetryProcessor();
  }

  /**
   * Process an incoming event through the pipeline
   */
  async processEvent(
    event: NormalizedEvent,
    source: string,
    previousState?: LiveMatchState,
    newState?: LiveMatchState
  ): Promise<void> {
    const pipelineEvent: PipelineEvent = {
      id: `${event.eventType}-${event.matchId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: this.determineEventType(event),
      matchId: event.matchId,
      data: event,
      metadata: {
        receivedAt: new Date().toISOString(),
        source,
        retryCount: 0,
        sequenceNumber: this.sequenceNumber++,
      },
      previousState,
      newState,
    };

    try {
      // Step 1: Validation
      const validation = this.validateEvent(event);
      if (!validation.isValid) {
        this.moveToDeadLetter(pipelineEvent, `Validation failed: ${validation.errors.join(', ')}`);
        return;
      }

      // Step 2: Deduplication
      if (await this.isDuplicate(event)) {
        this.emit('event:duplicate', { eventId: event.externalEventId, matchId: event.matchId });
        return;
      }

      // Step 3: Mark as processing
      this.markAsProcessed(event);

      // Step 4: Storage
      await this.storage.saveEvent(event);
      
      // Update pipeline metadata
      pipelineEvent.metadata.processedAt = new Date().toISOString();

      // Step 5: Realtime broadcast
      await this.publisher.publish(event.matchId, `match:${event.matchId}`, pipelineEvent);

      this.emit('event:processed', {
        eventId: event.id,
        type: event.eventType,
        matchId: event.matchId,
      });

      // Update match state if provided
      if (newState) {
        await this.storage.updateMatchState(event.matchId, newState);
      }

      // Re-process retry queue
      await this.processRetryQueue();
    } catch (error) {
      this.handleProcessingError(pipelineEvent, error as Error);
    }
  }

  /**
   * Process a batch of events
   */
  async processBatch(
    events: NormalizedEvent[],
    source: string,
    matchState?: LiveMatchState
  ): Promise<void> {
    const pipelineEvents: PipelineEvent[] = [];
    const validEvents: NormalizedEvent[] = [];

    for (const event of events) {
      const validation = this.validateEvent(event);
      if (!validation.isValid) {
        this.emit('event:validation:failed', { event, errors: validation.errors });
        continue;
      }

      if (await this.isDuplicate(event)) {
        continue;
      }

      this.markAsProcessed(event);
      validEvents.push(event);

      pipelineEvents.push({
        id: `${event.eventType}-${event.matchId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: this.determineEventType(event),
        matchId: event.matchId,
        data: event,
        metadata: {
          receivedAt: new Date().toISOString(),
          source,
          retryCount: 0,
          sequenceNumber: this.sequenceNumber++,
        },
        previousState: matchState,
      });
    }

    if (validEvents.length === 0) return;

    try {
      // Batch save to storage
      await this.storage.saveEvents(validEvents);

      // Batch publish to realtime
      const now = new Date().toISOString();
      const processedEvents = pipelineEvents.map(e => ({
        ...e,
        metadata: { ...e.metadata, processedAt: now },
      }));
      
      await this.publisher.publishBatch(processedEvents);

      this.emit('batch:processed', {
        count: validEvents.length,
        matchId: events[0].matchId,
      });
    } catch (error) {
      // If batch fails, process individually with retry
      for (const event of validEvents) {
        const pipelineEvent = pipelineEvents.find(e => 
          e.data === event
        );
        if (pipelineEvent) {
          await this.queueForRetry(pipelineEvent, (error as Error).message);
        }
      }
    }
  }

  /**
   * Get dead letter queue contents
   */
  getDeadLetterQueue(): DeadLetterItem[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Get retry queue statistics
   */
  getRetryQueueStats(): { size: number; oldestItem?: RetryQueueItem } {
    return {
      size: this.retryQueue.length,
      oldestItem: this.retryQueue[0],
    };
  }

  /**
   * Replay a dead letter event
   */
  async replayDeadLetter(eventId: string): Promise<void> {
    const index = this.deadLetterQueue.findIndex(item => item.event.id === eventId);
    if (index === -1) {
      throw new Error(`Event ${eventId} not found in dead letter queue`);
    }

    const [item] = this.deadLetterQueue.splice(index, 1);
    await this.processEvent(
      item.event.data as NormalizedEvent,
      'replay',
      item.event.previousState,
      item.event.newState
    );
  }

  /**
   * Validate an event
   */
  private validateEvent(event: NormalizedEvent): ValidationResult {
    const errors: string[] = [];

    if (!event.matchId) errors.push('Missing matchId');
    if (!event.eventType) errors.push('Missing eventType');
    if (!event.externalEventId) errors.push('Missing externalEventId');
    if (event.minute < 0) errors.push('Invalid minute value');
    if (!event.playerName && event.eventType !== 'VAR') {
      errors.push(`Missing playerName for event type ${event.eventType}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if event is a duplicate
   */
  private async isDuplicate(event: NormalizedEvent): Promise<boolean> {
    // Check in-memory cache first
    if (this.processedEventIds.has(event.externalEventId)) {
      return true;
    }

    // Check storage for persistence
    return await this.storage.eventExists(event.externalEventId);
  }

  /**
   * Mark event as processed in cache
   */
  private markAsProcessed(event: NormalizedEvent): void {
    this.processedEventIds.add(event.externalEventId);

    // Evict old entries if cache is too large
    if (this.processedEventIds.size > this.MAX_EVENT_ID_CACHE_SIZE) {
      const iterator = this.processedEventIds.values();
      const toDelete = this.MAX_EVENT_ID_CACHE_SIZE / 2;
      for (let i = 0; i < toDelete; i++) {
        const value = iterator.next();
        if (value.done) break;
        this.processedEventIds.delete(value.value);
      }
    }
  }

  /**
   * Determine the pipeline event type from a normalized event
   */
  private determineEventType(event: NormalizedEvent): PipelineEventType {
    switch (event.eventType) {
      case 'MATCH_STARTED':
      case 'HALF_TIME':
      case 'SECOND_HALF':
      case 'MATCH_ENDED':
      case 'EXTRA_TIME_STARTED':
      case 'EXTRA_TIME_ENDED':
      case 'PENALTY_SHOOTOUT_STARTED':
      case 'PENALTY_SHOOTOUT_ENDED':
        return 'match.status_change';
      case 'GOAL':
      case 'OWN_GOAL':
      case 'PENALTY_GOAL':
        return 'match.event';
      default:
        return 'match.event';
    }
  }

  /**
   * Queue an event for retry
   */
  private async queueForRetry(event: PipelineEvent, error: string): Promise<void> {
    if (this.retryQueue.length >= this.MAX_RETRY_QUEUE_SIZE) {
      this.moveToDeadLetter(event, `Retry queue full: ${error}`);
      return;
    }

    const retryItem: RetryQueueItem = {
      event,
      nextRetryAt: Date.now() + this.calculateBackoff(event.metadata.retryCount),
      retryCount: event.metadata.retryCount + 1,
      maxRetries: 5,
      error,
    };

    this.retryQueue.push(retryItem);
    this.retryQueue.sort((a, b) => a.nextRetryAt - b.nextRetryAt);

    this.emit('event:queued_for_retry', {
      eventId: event.id,
      retryCount: retryItem.retryCount,
      error,
    });
  }

  /**
   * Process the retry queue
   */
  private async processRetryQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    const now = Date.now();

    try {
      while (this.retryQueue.length > 0 && this.retryQueue[0].nextRetryAt <= now) {
        const item = this.retryQueue.shift()!;

        if (item.retryCount > item.maxRetries) {
          this.moveToDeadLetter(item.event, `Max retries exceeded: ${item.error}`);
          continue;
        }

        try {
          const event = item.event.data as NormalizedEvent;
          
          // Re-validate
          const validation = this.validateEvent(event);
          if (!validation.isValid) {
            this.moveToDeadLetter(item.event, `Validation failed on retry: ${validation.errors.join(', ')}`);
            continue;
          }

          // Re-check duplicates
          if (await this.isDuplicate(event)) {
            continue;
          }

          this.markAsProcessed(event);
          await this.storage.saveEvent(event);
          await this.publisher.publish(event.matchId, `match:${event.matchId}`, item.event);

          this.emit('event:retry:success', {
            eventId: event.id,
            retryCount: item.retryCount,
          });
        } catch (error) {
          // Re-queue with backoff
          item.nextRetryAt = Date.now() + this.calculateBackoff(item.retryCount);
          item.retryCount++;
          item.error = (error as Error).message;
          this.retryQueue.push(item);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Start the retry processor interval
   */
  private startRetryProcessor(): void {
    this.retryInterval = setInterval(() => {
      this.processRetryQueue().catch((error) => {
        this.emit('retry:processor:error', { error: (error as Error).message });
      });
    }, this.RETRY_INTERVAL_MS);
  }

  /**
   * Stop the retry processor
   */
  stopRetryProcessor(): void {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
  }

  /**
   * Handle processing error
   */
  private handleProcessingError(event: PipelineEvent, error: Error): void {
    this.emit('pipeline:error', {
      eventId: event.id,
      error: error.message,
    });

    // Queue for retry
    this.queueForRetry(event, error.message).catch((err) => {
      this.moveToDeadLetter(event, `Failed to queue for retry: ${err.message}`);
    });
  }

  /**
   * Move event to dead letter queue
   */
  private moveToDeadLetter(event: PipelineEvent, reason: string): void {
    if (this.deadLetterQueue.length >= this.MAX_DEAD_LETTER_SIZE) {
      this.deadLetterQueue.shift(); // Remove oldest
    }

    const item: DeadLetterItem = {
      event,
      reason,
      failedAt: new Date().toISOString(),
      retryCount: event.metadata.retryCount,
    };

    this.deadLetterQueue.push(item);

    this.emit('event:dead_letter', {
      eventId: event.id,
      reason,
      retryCount: item.retryCount,
    });
  }

  /**
   * Calculate exponential backoff
   */
  private calculateBackoff(retryCount: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 60_000; // 1 minute
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    // Add jitter
    return delay + Math.random() * 1000;
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    this.stopRetryProcessor();
    this.removeAllListeners();
    this.retryQueue = [];
    this.deadLetterQueue = [];
    this.processedEventIds.clear();
  }
}