"use client";

import { useCallback, useEffect, useState } from "react";
import type { Match } from "@/lib/match-fixtures";
import { createBrowserFootballProvider } from "@/lib/live-data/browser-provider";
import type { FootballDataProvider } from "@/lib/live-data/football-provider";
import { normalizeMatchPhase, normalizeMatchStatus } from "@/lib/live-data/status";
import type { LiveMatch } from "@/lib/live-data/types";
import { useLiveMatchRealtime, type LiveRealtimeState } from "./use-live-match-realtime";

type UseLiveMatchOptions = {
  enabled?: boolean;
  intervalMs?: number;
  provider?: FootballDataProvider | null;
  fallbackMatch?: Match;
};

type UseLiveMatchResult = {
  liveMatch: LiveMatch | null;
  error: string | null;
  isLoading: boolean;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
};

export function useLiveMatch(
  matchId: string,
  { enabled = true, intervalMs = 20000, provider, fallbackMatch }: UseLiveMatchOptions = {}
): UseLiveMatchResult {
  const [defaultProvider] = useState<FootballDataProvider | null>(() => createBrowserFootballProvider());
  const [liveMatch, setLiveMatch] = useState<LiveMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const activeProvider = provider === undefined ? defaultProvider : provider;

  const refresh = useCallback(async () => {
    if (!enabled || !activeProvider) {
      return;
    }

    setIsLoading(true);

    try {
      const nextMatch = await activeProvider.getLiveMatch(matchId);
      // Only update liveMatch from polling if we got actual data back.
      // Never overwrite with null — realtime might have already populated
      // the state with current scores, and nulling it would cause the
      // component to fall back to stale completedMatch data.
      if (nextMatch !== null) {
        setLiveMatch(nextMatch);
      }
      setError(null);
      setLastUpdated(new Date());
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unable to load live match data";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [activeProvider, enabled, matchId]);

  const applyRealtimeState = useCallback((state: LiveRealtimeState) => {
    setLiveMatch((current) => {
      const base =
        current ??
        (fallbackMatch
          ? createLiveMatchShell(matchId, fallbackMatch.homeTeam, fallbackMatch.awayTeam)
          : null);

      if (!base) return current;

      return {
        ...base,
        status: normalizeMatchStatus(state.status),
        phase: normalizeMatchPhase(state.period),
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        homePenaltyScore: state.homePenaltyScore,
        awayPenaltyScore: state.awayPenaltyScore,
        minute: state.minute,
        statistics: mergeDefinedStatistics(base.statistics, state),
        updatedAt: new Date().toISOString(),
      };
    });
    setLastUpdated(new Date());
  }, [fallbackMatch, matchId]);

  const handleRealtimeEvent = useCallback(() => {
    void refresh();
  }, [refresh]);

  useLiveMatchRealtime({
    matchId,
    enabled: enabled && Boolean(activeProvider),
    onStateChange: applyRealtimeState,
    onEvent: handleRealtimeEvent,
  });

  useEffect(() => {
    if (!enabled || !activeProvider) {
      return;
    }

    let isActive = true;
    const runRefresh = async () => {
      if (!isActive) return;
      await refresh();
    };

    void runRefresh();
    const timer = window.setInterval(runRefresh, intervalMs);

    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [activeProvider, enabled, intervalMs, refresh]);

  return { liveMatch, error, isLoading, lastUpdated, refresh };
}

function createLiveMatchShell(matchId: string, homeTeam: string, awayTeam: string): LiveMatch {
  return {
    matchId,
    status: "scheduled",
    phase: "pre_match",
    homeTeam,
    awayTeam,
    homeScore: 0,
    awayScore: 0,
    minute: null,
    updatedAt: new Date().toISOString(),
    statistics: {},
    events: [],
  };
}

function mergeDefinedStatistics(
  current: LiveMatch["statistics"],
  state: LiveRealtimeState
): LiveMatch["statistics"] {
  return {
    ...current,
    ...definedStats({
      homePossession: state.homePossession,
      awayPossession: state.awayPossession,
      homeShots: state.homeShots,
      awayShots: state.awayShots,
      homeShotsOnTarget: state.homeShotsOnTarget,
      awayShotsOnTarget: state.awayShotsOnTarget,
      homeExpectedGoals: state.homeExpectedGoals,
      awayExpectedGoals: state.awayExpectedGoals,
      homePasses: state.homePasses,
      awayPasses: state.awayPasses,
      homePassingAccuracy: state.homePassingAccuracy,
      awayPassingAccuracy: state.awayPassingAccuracy,
      homeYellowCards: state.homeYellowCards,
      awayYellowCards: state.awayYellowCards,
      homeRedCards: state.homeRedCards,
      awayRedCards: state.awayRedCards,
      homeCorners: state.homeCorners,
      awayCorners: state.awayCorners,
      homeFouls: state.homeFouls,
      awayFouls: state.awayFouls,
      homeOffsides: state.homeOffsides,
      awayOffsides: state.awayOffsides,
    }),
  };
}

function definedStats(statistics: LiveMatch["statistics"]): LiveMatch["statistics"] {
  return Object.fromEntries(
    Object.entries(statistics).filter(([, value]) => value != null)
  ) as LiveMatch["statistics"];
}
