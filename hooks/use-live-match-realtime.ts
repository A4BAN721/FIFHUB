/**
 * useLiveMatchRealtime Hook
 * 
 * React hook for subscribing to realtime match updates.
 * 
 * Flow:
 * 1. Page loads -> Fetch initial match data via REST API
 * 2. Subscribe to Supabase Realtime channel
 * 3. Receive events as they happen
 * 4. Update React state instantly
 * 
 * No page refreshes required. Updates appear instantly.
 * Automatically handles reconnections and error states.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '../lib/supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/**
 * Live match state from realtime updates
 */
export interface LiveRealtimeState {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  period: string;
  status: string;
  lastEventType?: string;
  homePossession?: number;
  awayPossession?: number;
  homeShots?: number;
  awayShots?: number;
  homeShotsOnTarget?: number;
  awayShotsOnTarget?: number;
  homeYellowCards?: number;
  awayYellowCards?: number;
  homeRedCards?: number;
  awayRedCards?: number;
  homeCorners?: number;
  awayCorners?: number;
  homeFouls?: number;
  awayFouls?: number;
}

/**
 * Realtime event data
 */
export interface RealtimeEventData {
  type: string;
  matchId: string;
  minute: number;
  stoppageMinute?: number;
  playerName: string;
  teamName: string;
  assistPlayerName?: string;
  description?: string;
}

/**
 * Connection state
 */
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Hook options
 */
interface UseLiveMatchRealtimeOptions {
  matchId: string | null;
  enabled?: boolean;
  onEvent?: (event: RealtimeEventData) => void;
  onStateChange?: (state: LiveRealtimeState) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
}

/**
 * Hook return type
 */
interface UseLiveMatchRealtimeReturn {
  liveState: LiveRealtimeState | null;
  recentEvents: RealtimeEventData[];
  connectionStatus: ConnectionStatus;
  error: string | null;
  clearEvents: () => void;
}

export function useLiveMatchRealtime({
  matchId,
  enabled = true,
  onEvent,
  onStateChange,
  onConnectionChange,
}: UseLiveMatchRealtimeOptions): UseLiveMatchRealtimeReturn {
  const supabase = createClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAY_MS = 2000;

  const [liveState, setLiveState] = useState<LiveRealtimeState | null>(null);
  const [recentEvents, setRecentEvents] = useState<RealtimeEventData[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  /**
   * Clear all recent events
   */
  const clearEvents = useCallback(() => {
    setRecentEvents([]);
  }, []);

  useEffect(() => {
    if (!matchId || !enabled) return;

    let mounted = true;
    const MAX_EVENTS = 50;

    /**
     * Connect to realtime channel
     */
    const connect = () => {
      if (!mounted) return;

      setConnectionStatus('connecting');
      onConnectionChange?.('connecting');

      // Clean up previous subscription
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      // Subscribe to match-specific channel
      const channel = supabase.channel(`match:${matchId}`, {
        config: {
          broadcast: { 
            self: true,
            ack: true,
          },
        },
      });

      channel
        .on('broadcast', { event: 'match.update' }, (payload) => {
          if (!mounted) return;
          const data = payload.payload?.data;
          if (data) {
            const newState: LiveRealtimeState = {
              matchId: data.matchId,
              homeScore: data.homeScore ?? 0,
              awayScore: data.awayScore ?? 0,
              minute: data.minute ?? 0,
              period: data.period ?? '',
              status: data.status ?? '',
              lastEventType: data.lastEventType,
              homePossession: data.homePossession,
              awayPossession: data.awayPossession,
              homeShots: data.homeShots,
              awayShots: data.awayShots,
              homeShotsOnTarget: data.homeShotsOnTarget,
              awayShotsOnTarget: data.awayShotsOnTarget,
              homeYellowCards: data.homeYellowCards,
              awayYellowCards: data.awayYellowCards,
              homeRedCards: data.homeRedCards,
              awayRedCards: data.awayRedCards,
              homeCorners: data.homeCorners,
              awayCorners: data.awayCorners,
              homeFouls: data.homeFouls,
              awayFouls: data.awayFouls,
            };

            setLiveState(newState);
            onStateChange?.(newState);
          }
        })
        .on('broadcast', { event: 'match.event' }, (payload) => {
          if (!mounted) return;
          const data = payload.payload?.data;
          if (data?.event) {
            const eventData: RealtimeEventData = {
              type: data.event.eventType || data.event.type,
              matchId: data.matchId,
              minute: data.event.minute ?? 0,
              stoppageMinute: data.event.stoppageMinute,
              playerName: data.event.playerName || '',
              teamName: data.event.teamName || '',
              assistPlayerName: data.event.assistPlayerName,
              description: data.event.description,
            };

            setRecentEvents(prev => {
              const updated = [eventData, ...prev].slice(0, MAX_EVENTS);
              return updated;
            });

            onEvent?.(eventData);
          }
        })
        .on('broadcast', { event: 'match.status' }, (payload) => {
          if (!mounted) return;
          const data = payload.payload?.data;
          if (data) {
            setLiveState(prev => prev ? {
              ...prev,
              status: data.status ?? prev.status,
              period: data.period ?? prev.period,
            } : null);
          }
        })
        .subscribe((status) => {
          if (!mounted) return;

          if (status === 'SUBSCRIBED') {
            setConnectionStatus('connected');
            onConnectionChange?.('connected');
            reconnectAttemptsRef.current = 0;
            setError(null);
          } else if (status === 'CHANNEL_ERROR') {
            setConnectionStatus('error');
            onConnectionChange?.('error');
            handleReconnect();
          } else if (status === 'TIMED_OUT') {
            setConnectionStatus('disconnected');
            onConnectionChange?.('disconnected');
            handleReconnect();
          }
        });

      channelRef.current = channel;
    };

    /**
     * Handle reconnection with exponential backoff
     */
    const handleReconnect = () => {
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError('Max reconnection attempts reached');
        return;
      }

      const delay = Math.min(
        RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
        30_000
      ) + Math.random() * 1000;

      reconnectAttemptsRef.current++;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (mounted) {
          connect();
        }
      }, delay);
    };

    // Initial connection
    connect();

    // Cleanup
    return () => {
      mounted = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [matchId, enabled, supabase, onEvent, onStateChange, onConnectionChange]);

  return {
    liveState,
    recentEvents,
    connectionStatus,
    error,
    clearEvents,
  };
}

/**
 * Hook for subscribing to all live matches (scoreboard)
 */
export function useLiveScoreboard(options?: {
  enabled?: boolean;
  onUpdate?: (matches: any[]) => void;
}): {
  liveMatches: any[];
  connectionStatus: ConnectionStatus;
  error: string | null;
} {
  const supabase = createClient();
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (options?.enabled === false) return;

    const channel = supabase.channel('live-scores');

    channel
      .on('broadcast', { event: 'match.update' }, (payload) => {
        const data = payload.payload?.data;
        if (data) {
          setLiveMatches(prev => {
            const index = prev.findIndex(m => m.matchId === data.matchId);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = { ...updated[index], ...data };
              return updated;
            }
            return [...prev, data];
          });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          setError(null);
        } else if (status === 'CHANNEL_ERROR') {
          setConnectionStatus('error');
        }
      });

    // Fetch initial live matches
    const fetchInitial = async () => {
      try {
        const response = await fetch('/api/live');
        const data = await response.json();
        if (data.matches) {
          setLiveMatches(data.matches);
          options?.onUpdate?.(data.matches);
        }
      } catch {
        setError('Failed to fetch initial live matches');
      }
    };

    fetchInitial();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [options?.enabled, options?.onUpdate, supabase]);

  return { liveMatches, connectionStatus, error };
}