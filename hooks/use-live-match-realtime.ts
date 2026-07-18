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
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  minute: number;
  stoppageMinute?: number | null;
  period: string;
  status: string;
  updatedAt?: string | null;
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
  home_penalty_score?: number | null;
  away_penalty_score?: number | null;
  minute?: number | null;
  stoppage_minute?: number | null;
  stoppage_time?: number | null;
  phase?: string | null;
  period?: string | null;
  status?: string | null;
  updated_at?: string | null;
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

type LiveMatchBroadcastData = {
  matchId?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  minute?: number | null;
  stoppageMinute?: number | null;
  stoppageTime?: number | null;
  period?: string | null;
  phase?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  lastEventType?: string | null;
  homePossession?: number | null;
  awayPossession?: number | null;
  homeShots?: number | null;
  awayShots?: number | null;
  homeShotsOnTarget?: number | null;
  awayShotsOnTarget?: number | null;
  homeExpectedGoals?: number | null;
  awayExpectedGoals?: number | null;
  homePasses?: number | null;
  awayPasses?: number | null;
  homePassingAccuracy?: number | null;
  awayPassingAccuracy?: number | null;
  homeYellowCards?: number | null;
  awayYellowCards?: number | null;
  homeRedCards?: number | null;
  awayRedCards?: number | null;
  homeCorners?: number | null;
  awayCorners?: number | null;
  homeFouls?: number | null;
  awayFouls?: number | null;
  homeOffsides?: number | null;
  awayOffsides?: number | null;
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
            const newState = stateFromLiveMatchRow(data, matchId);

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
            const newState = stateFromBroadcastData(data, matchId);

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
            setLiveState(prev => {
              const nextState = mergeLiveState(
                prev,
                stateFromBroadcastData(data, matchId, prev),
              );
              onStateChange?.(nextState);
              return nextState;
            });
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

    const fetchLatest = async () => {
      try {
        const response = await fetch('/api/live?fresh=1', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
          },
        });
        if (!response.ok) {
          throw new Error(`Live scoreboard request failed with ${response.status}`);
        }

        const data = await response.json();
        if (Array.isArray(data.matches)) {
          const matches = data.matches.filter(isLiveScoreboardMatch);
          setLiveMatches(matches);
          onUpdate?.(matches);
          setError(null);
        }
      } catch {
        setError('Failed to fetch live matches');
      }
    };

    channel
      .on('broadcast', { event: 'match.update' }, (payload) => {
        const data = payload.payload?.data;
        if (isLiveScoreboardMatch(data)) {
          setLiveMatches(prev => {
            const index = prev.findIndex(m => m.matchId === data.matchId);
            let updated: LiveScoreboardMatch[];
            if (index >= 0) {
              updated = [...prev];
              updated[index] = { ...updated[index], ...data };
            } else {
              updated = [...prev, data];
            }
            onUpdate?.(updated);
            return updated;
          });
        }
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_match_state' },
        () => void fetchLatest(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          setError(null);
        } else if (status === 'CHANNEL_ERROR') {
          setConnectionStatus('error');
        }
      });

    void fetchLatest();
    const interval = window.setInterval(fetchLatest, 15_000);

    return () => {
      window.clearInterval(interval);
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

function stateFromLiveMatchRow(row: LiveMatchStateRow, fallbackMatchId: string): LiveRealtimeState {
  return {
    matchId: row.match_id ?? fallbackMatchId,
    homeScore: row.home_score ?? 0,
    awayScore: row.away_score ?? 0,
    homePenaltyScore: row.home_penalty_score,
    awayPenaltyScore: row.away_penalty_score,
    minute: row.minute ?? 0,
    stoppageMinute: row.stoppage_minute ?? row.stoppage_time ?? null,
    period: row.phase ?? row.period ?? '',
    status: row.status ?? '',
    updatedAt: row.updated_at ?? null,
    lastEventType: row.last_event_type ?? undefined,
    homePossession: row.home_possession ?? undefined,
    awayPossession: row.away_possession ?? undefined,
    homeShots: row.home_shots ?? undefined,
    awayShots: row.away_shots ?? undefined,
    homeShotsOnTarget: row.home_shots_on_target ?? undefined,
    awayShotsOnTarget: row.away_shots_on_target ?? undefined,
    homeExpectedGoals: row.home_expected_goals ?? undefined,
    awayExpectedGoals: row.away_expected_goals ?? undefined,
    homePasses: row.home_passes ?? undefined,
    awayPasses: row.away_passes ?? undefined,
    homePassingAccuracy: row.home_passing_accuracy ?? undefined,
    awayPassingAccuracy: row.away_passing_accuracy ?? undefined,
    homeYellowCards: row.home_yellow_cards ?? undefined,
    awayYellowCards: row.away_yellow_cards ?? undefined,
    homeRedCards: row.home_red_cards ?? undefined,
    awayRedCards: row.away_red_cards ?? undefined,
    homeCorners: row.home_corners ?? undefined,
    awayCorners: row.away_corners ?? undefined,
    homeFouls: row.home_fouls ?? undefined,
    awayFouls: row.away_fouls ?? undefined,
    homeOffsides: row.home_offsides ?? undefined,
    awayOffsides: row.away_offsides ?? undefined,
  };
}

function stateFromBroadcastData(
  data: LiveMatchBroadcastData,
  fallbackMatchId: string,
  previous?: LiveRealtimeState | null,
): LiveRealtimeState {
  return {
    matchId: data.matchId ?? previous?.matchId ?? fallbackMatchId,
    homeScore: data.homeScore ?? previous?.homeScore ?? 0,
    awayScore: data.awayScore ?? previous?.awayScore ?? 0,
    homePenaltyScore: data.homePenaltyScore ?? previous?.homePenaltyScore,
    awayPenaltyScore: data.awayPenaltyScore ?? previous?.awayPenaltyScore,
    minute: data.minute ?? previous?.minute ?? 0,
    stoppageMinute: data.stoppageMinute ?? data.stoppageTime ?? previous?.stoppageMinute ?? null,
    period: data.phase ?? data.period ?? previous?.period ?? '',
    status: data.status ?? previous?.status ?? '',
    updatedAt: data.updatedAt ?? previous?.updatedAt ?? null,
    lastEventType: data.lastEventType ?? previous?.lastEventType,
    homePossession: data.homePossession ?? previous?.homePossession,
    awayPossession: data.awayPossession ?? previous?.awayPossession,
    homeShots: data.homeShots ?? previous?.homeShots,
    awayShots: data.awayShots ?? previous?.awayShots,
    homeShotsOnTarget: data.homeShotsOnTarget ?? previous?.homeShotsOnTarget,
    awayShotsOnTarget: data.awayShotsOnTarget ?? previous?.awayShotsOnTarget,
    homeExpectedGoals: data.homeExpectedGoals ?? previous?.homeExpectedGoals,
    awayExpectedGoals: data.awayExpectedGoals ?? previous?.awayExpectedGoals,
    homePasses: data.homePasses ?? previous?.homePasses,
    awayPasses: data.awayPasses ?? previous?.awayPasses,
    homePassingAccuracy: data.homePassingAccuracy ?? previous?.homePassingAccuracy,
    awayPassingAccuracy: data.awayPassingAccuracy ?? previous?.awayPassingAccuracy,
    homeYellowCards: data.homeYellowCards ?? previous?.homeYellowCards,
    awayYellowCards: data.awayYellowCards ?? previous?.awayYellowCards,
    homeRedCards: data.homeRedCards ?? previous?.homeRedCards,
    awayRedCards: data.awayRedCards ?? previous?.awayRedCards,
    homeCorners: data.homeCorners ?? previous?.homeCorners,
    awayCorners: data.awayCorners ?? previous?.awayCorners,
    homeFouls: data.homeFouls ?? previous?.homeFouls,
    awayFouls: data.awayFouls ?? previous?.awayFouls,
    homeOffsides: data.homeOffsides ?? previous?.homeOffsides,
    awayOffsides: data.awayOffsides ?? previous?.awayOffsides,
  };
}

function mergeLiveState(
  previous: LiveRealtimeState | null,
  incoming: LiveRealtimeState,
): LiveRealtimeState {
  if (!previous) return incoming;

  return {
    ...previous,
    ...incoming,
    homePenaltyScore: incoming.homePenaltyScore ?? previous.homePenaltyScore,
    awayPenaltyScore: incoming.awayPenaltyScore ?? previous.awayPenaltyScore,
    stoppageMinute: incoming.stoppageMinute ?? previous.stoppageMinute,
    updatedAt: incoming.updatedAt ?? previous.updatedAt,
    lastEventType: incoming.lastEventType ?? previous.lastEventType,
    homePossession: incoming.homePossession ?? previous.homePossession,
    awayPossession: incoming.awayPossession ?? previous.awayPossession,
    homeShots: incoming.homeShots ?? previous.homeShots,
    awayShots: incoming.awayShots ?? previous.awayShots,
    homeShotsOnTarget: incoming.homeShotsOnTarget ?? previous.homeShotsOnTarget,
    awayShotsOnTarget: incoming.awayShotsOnTarget ?? previous.awayShotsOnTarget,
    homeExpectedGoals: incoming.homeExpectedGoals ?? previous.homeExpectedGoals,
    awayExpectedGoals: incoming.awayExpectedGoals ?? previous.awayExpectedGoals,
    homePasses: incoming.homePasses ?? previous.homePasses,
    awayPasses: incoming.awayPasses ?? previous.awayPasses,
    homePassingAccuracy: incoming.homePassingAccuracy ?? previous.homePassingAccuracy,
    awayPassingAccuracy: incoming.awayPassingAccuracy ?? previous.awayPassingAccuracy,
    homeYellowCards: incoming.homeYellowCards ?? previous.homeYellowCards,
    awayYellowCards: incoming.awayYellowCards ?? previous.awayYellowCards,
    homeRedCards: incoming.homeRedCards ?? previous.homeRedCards,
    awayRedCards: incoming.awayRedCards ?? previous.awayRedCards,
    homeCorners: incoming.homeCorners ?? previous.homeCorners,
    awayCorners: incoming.awayCorners ?? previous.awayCorners,
    homeFouls: incoming.homeFouls ?? previous.homeFouls,
    awayFouls: incoming.awayFouls ?? previous.awayFouls,
    homeOffsides: incoming.homeOffsides ?? previous.homeOffsides,
    awayOffsides: incoming.awayOffsides ?? previous.awayOffsides,
  };
}
