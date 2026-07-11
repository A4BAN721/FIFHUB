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
        setLiveMatch((current) => chooseFreshestMatch(current, nextMatch));
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

      const status = normalizeMatchStatus(state.status);

      return chooseFreshestMatch(base, {
        ...base,
        status,
        phase: normalizeRealtimePhase(status, state.period),
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        homePenaltyScore: state.homePenaltyScore,
        awayPenaltyScore: state.awayPenaltyScore,
        minute: state.minute,
        stoppageMinute: state.stoppageMinute ?? base.stoppageMinute,
        statistics: mergeDefinedStatistics(base.statistics, state),
        lineups: base.lineups,
        events: base.events,
        updatedAt: state.updatedAt ?? base.updatedAt,
      });
    });
    setLastUpdated(new Date());
  }, [fallbackMatch, matchId]);

  const handleRealtimeStateChange = useCallback((state: LiveRealtimeState) => {
    applyRealtimeState(state);
    void refresh();
  }, [applyRealtimeState, refresh]);

  const handleRealtimeEvent = useCallback(() => {
    void refresh();
  }, [refresh]);

  useLiveMatchRealtime({
    matchId,
    enabled: enabled && Boolean(activeProvider),
    onStateChange: handleRealtimeStateChange,
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
    updatedAt: "",
    statistics: {},
    events: [],
  };
}

function normalizeRealtimePhase(status: LiveMatch["status"], period?: string | null): LiveMatch["phase"] {
  const normalizedPhase = normalizeMatchPhase(period);
  if (status === "half_time") return normalizedPhase === "extra_time" ? "extra_time" : "half_time";
  if (status === "finished") return "full_time";
  if (status === "extra_time") return "extra_time";
  if (status === "penalties") return "penalties";
  return normalizedPhase;
}

function chooseFreshestMatch(current: LiveMatch | null, incoming: LiveMatch): LiveMatch {
  if (!current) return incoming;

  const currentTime = getMatchUpdatedTime(current);
  const incomingTime = getMatchUpdatedTime(incoming);
  if (incomingTime > 0 && currentTime > 0 && incomingTime < currentTime) return current;

  return mergeLiveMatch(current, incoming);
}

function getMatchUpdatedTime(match: LiveMatch): number {
  const parsed = Date.parse(match.updatedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeLiveMatch(current: LiveMatch, incoming: LiveMatch): LiveMatch {
  return {
    ...current,
    ...incoming,
    homePenaltyScore: incoming.homePenaltyScore ?? current.homePenaltyScore,
    awayPenaltyScore: incoming.awayPenaltyScore ?? current.awayPenaltyScore,
    minute: incoming.minute ?? current.minute,
    stoppageMinute: incoming.stoppageMinute ?? current.stoppageMinute,
    startedAt: incoming.startedAt ?? current.startedAt,
    finalScoreConfirmedAt: incoming.finalScoreConfirmedAt ?? current.finalScoreConfirmedAt,
    highlightsUrl: incoming.highlightsUrl ?? current.highlightsUrl,
    highlightsTitle: incoming.highlightsTitle ?? current.highlightsTitle,
    highlightsPublishedAt: incoming.highlightsPublishedAt ?? current.highlightsPublishedAt,
    statistics: mergeDefinedMatchStatistics(current.statistics, incoming.statistics),
    lineups: incoming.lineups ?? current.lineups,
    events: incoming.events.length > 0 ? incoming.events : current.events,
  };
}

function mergeDefinedMatchStatistics(
  current: LiveMatch["statistics"],
  incoming: LiveMatch["statistics"]
): LiveMatch["statistics"] {
  return {
    ...current,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value != null)),
  } as LiveMatch["statistics"];
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
