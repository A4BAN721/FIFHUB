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
import { createClient, getSupabaseConfig } from '../lib/supabase/client';
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
  homeExpectedGoals?: number;
  awayExpectedGoals?: number;
  homePasses?: number;
  awayPasses?: number;
  homePassingAccuracy?: number;
  awayPassingAccuracy?: number;
  homeYellowCards?: number;
  awayYellowCards?: number;
  homeRedCards?: number;
  awayRedCards?: number;
  homeCorners?: number;
  awayCorners?: number;
  homeFouls?: number;
  awayFouls?: number;
  homeOffsides?: number;
  awayOffsides?: number;
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

type LiveMatchStateRow = {
  match_id?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  minute?: number | null;
  phase?: string | null;
  period?: string | null;
  status?: string | null;
  last_event_type?: string | null;
  home_possession?: number | null;
  away_possession?: number | null;
  home_shots?: number | null;
  away_shots?: number | null;
  home_shots_on_target?: number | null;
  away_shots_on_target?: number | null;
  home_expected_goals?: number | null;
  away_expected_goals?: number | null;
  home_passes?: number | null;
  away_passes?: number | null;
  home_passing_accuracy?: number | null;
  away_passing_accuracy?: number | null;
  home_yellow_cards?: number | null;
  away_yellow_cards?: number | null;
  home_red_cards?: number | null;
  away_red_cards?: number | null;
  home_corners?: number | null;
  away_corners?: number | null;
  home_fouls?: number | null;
  away_fouls?: number | null;
  home_offsides?: number | null;
  away_offsides?: number | null;
};

type MatchEventRow = {
  match_id?: string | null;
  event_type?: string | null;
  minute?: number | null;
  stoppage_minute?: number | null;
  player_name?: string | null;
  team_name?: string | null;
  assist_player_name?: string | null;
  description?: string | null;
};

type LiveScoreboardMatch = {
  matchId: string;
  [key: string]: unknown;
};

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
  const [supabase] = useState(() => (getSupabaseConfig() ? createClient() : null));
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
    if (!matchId || !enabled || !supabase) return;

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
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'live_match_state', filter: `match_id=eq.${matchId}` },
          (payload: RealtimePostgresChangesPayload<LiveMatchStateRow>) => {
            if (!mounted || !payload.new) return;
            const data = payload.new as LiveMatchStateRow;
            const newState: LiveRealtimeState = {
              matchId: data.match_id ?? matchId,
              homeScore: data.home_score ?? 0,
              awayScore: data.away_score ?? 0,
              minute: data.minute ?? 0,
              period: data.phase ?? data.period ?? '',
              status: data.status ?? '',
              lastEventType: data.last_event_type ?? undefined,
              homePossession: data.home_possession ?? undefined,
              awayPossession: data.away_possession ?? undefined,
              homeShots: data.home_shots ?? undefined,
              awayShots: data.away_shots ?? undefined,
              homeShotsOnTarget: data.home_shots_on_target ?? undefined,
              awayShotsOnTarget: data.away_shots_on_target ?? undefined,
              homeExpectedGoals: data.home_expected_goals ?? undefined,
              awayExpectedGoals: data.away_expected_goals ?? undefined,
              homePasses: data.home_passes ?? undefined,
              awayPasses: data.away_passes ?? undefined,
              homePassingAccuracy: data.home_passing_accuracy ?? undefined,
              awayPassingAccuracy: data.away_passing_accuracy ?? undefined,
              homeYellowCards: data.home_yellow_cards ?? undefined,
              awayYellowCards: data.away_yellow_cards ?? undefined,
              homeRedCards: data.home_red_cards ?? undefined,
              awayRedCards: data.away_red_cards ?? undefined,
              homeCorners: data.home_corners ?? undefined,
              awayCorners: data.away_corners ?? undefined,
              homeFouls: data.home_fouls ?? undefined,
              awayFouls: data.away_fouls ?? undefined,
              homeOffsides: data.home_offsides ?? undefined,
              awayOffsides: data.away_offsides ?? undefined,
            };

            setLiveState(newState);
            onStateChange?.(newState);
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` },
          (payload: RealtimePostgresChangesPayload<MatchEventRow>) => {
            if (!mounted || !payload.new) return;
            const data = payload.new as MatchEventRow;
            const eventData: RealtimeEventData = {
              type: data.event_type ?? '',
              matchId: data.match_id ?? matchId,
              minute: data.minute ?? 0,
              stoppageMinute: data.stoppage_minute ?? undefined,
              playerName: data.player_name ?? '',
              teamName: data.team_name ?? '',
              assistPlayerName: data.assist_player_name ?? undefined,
              description: data.description ?? undefined,
            };

            setRecentEvents(prev => [eventData, ...prev].slice(0, MAX_EVENTS));
            onEvent?.(eventData);
          },
        )
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
              homeExpectedGoals: data.homeExpectedGoals,
              awayExpectedGoals: data.awayExpectedGoals,
              homePasses: data.homePasses,
              awayPasses: data.awayPasses,
              homePassingAccuracy: data.homePassingAccuracy,
              awayPassingAccuracy: data.awayPassingAccuracy,
              homeYellowCards: data.homeYellowCards,
              awayYellowCards: data.awayYellowCards,
              homeRedCards: data.homeRedCards,
              awayRedCards: data.awayRedCards,
              homeCorners: data.homeCorners,
              awayCorners: data.awayCorners,
              homeFouls: data.homeFouls,
              awayFouls: data.awayFouls,
              homeOffsides: data.homeOffsides,
              awayOffsides: data.awayOffsides,
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
  onUpdate?: (matches: LiveScoreboardMatch[]) => void;
}): {
  liveMatches: LiveScoreboardMatch[];
  connectionStatus: ConnectionStatus;
  error: string | null;
} {
  const enabled = options?.enabled ?? true;
  const onUpdate = options?.onUpdate;
  const [supabase] = useState(() => (getSupabaseConfig() ? createClient() : null));
  const [liveMatches, setLiveMatches] = useState<LiveScoreboardMatch[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !supabase) return;

    const channel = supabase.channel('live-scores');

    channel
      .on('broadcast', { event: 'match.update' }, (payload) => {
        const data = payload.payload?.data;
        if (isLiveScoreboardMatch(data)) {
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
        if (Array.isArray(data.matches)) {
          setLiveMatches(data.matches);
          const matches = data.matches.filter(isLiveScoreboardMatch);
          setLiveMatches(matches);
          onUpdate?.(matches);
        }
      } catch {
        setError('Failed to fetch initial live matches');
      }
    };

    fetchInitial();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, onUpdate, supabase]);

  return { liveMatches, connectionStatus, error };
}

function isLiveScoreboardMatch(value: unknown): value is LiveScoreboardMatch {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'matchId' in value &&
      typeof (value as { matchId?: unknown }).matchId === 'string'
  );
}
