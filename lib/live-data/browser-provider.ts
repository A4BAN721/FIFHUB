"use client";

import type { FootballDataProvider } from "./football-provider";
import { normalizeMatchPhase, normalizeMatchStatus } from "./status";
import type { LiveMatch } from "./types";

export function createBrowserFootballProvider(): FootballDataProvider | null {
  return new BrowserApiFootballProvider();
}

class BrowserApiFootballProvider implements FootballDataProvider {
  async getLiveMatch(matchId: string): Promise<LiveMatch | null> {
    const detailMatch = await fetchLiveMatchDetail(matchId);
    if (detailMatch) return detailMatch;

    return fetchScoreboardMatch(matchId);
  }
}

async function fetchLiveMatchDetail(matchId: string): Promise<LiveMatch | null> {
  try {
    const response = await fetchNoStore(`/api/live-match/${encodeURIComponent(matchId)}?fresh=1`);
    if (response.status === 404 || response.status === 503) return null;
    if (!response.ok) throw new Error(`Live match request failed with ${response.status}`);

    const payload = (await response.json()) as { match?: LiveMatch | null };
    return payload.match ?? null;
  } catch (error) {
    if (isLiveDataDebugEnabled()) {
      console.debug("Falling back to scoreboard match data.", error);
    }
    return null;
  }
}

async function fetchScoreboardMatch(matchId: string): Promise<LiveMatch | null> {
  const response = await fetchNoStore(`/api/matches/${encodeURIComponent(matchId)}?fresh=1`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Scoreboard match request failed with ${response.status}`);

  const payload = (await response.json()) as ScoreboardMatchPayload;
  return mapScoreboardPayload(payload);
}

function fetchNoStore(url: string) {
  return fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });
}

function isLiveDataDebugEnabled() {
  return typeof window !== "undefined" && window.localStorage.getItem("fifhub:live-debug") === "1";
}

type ScoreboardMatchPayload = {
  matchId?: string;
  id?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  status?: string | null;
  period?: string | null;
  minute?: number | null;
  stoppageTime?: number | null;
  finalScoreConfirmedAt?: string | null;
  updatedAt?: string | null;
  events?: unknown[];
  live_state?: {
    status?: string | null;
    phase?: string | null;
    period?: string | null;
    home_score?: number | null;
    away_score?: number | null;
    home_penalty_score?: number | null;
    away_penalty_score?: number | null;
    minute?: number | null;
    stoppage_minute?: number | null;
    stoppage_time?: number | null;
    final_score_confirmed_at?: string | null;
    updated_at?: string | null;
    lineups?: LiveMatch["lineups"];
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
  } | null;
};

function mapScoreboardPayload(payload: ScoreboardMatchPayload): LiveMatch | null {
  const matchId = payload.matchId ?? payload.id;
  if (!matchId || !payload.homeTeam || !payload.awayTeam) return null;

  const state = payload.live_state;
  return {
    matchId,
    status: normalizeMatchStatus(state?.status ?? payload.status),
    phase: normalizeMatchPhase(state?.phase ?? state?.period ?? payload.period),
    homeTeam: payload.homeTeam,
    awayTeam: payload.awayTeam,
    homeScore: state?.home_score ?? payload.homeScore ?? 0,
    awayScore: state?.away_score ?? payload.awayScore ?? 0,
    homePenaltyScore: state?.home_penalty_score ?? payload.homePenaltyScore ?? null,
    awayPenaltyScore: state?.away_penalty_score ?? payload.awayPenaltyScore ?? null,
    minute: state?.minute ?? payload.minute ?? null,
    stoppageMinute: state?.stoppage_minute ?? state?.stoppage_time ?? payload.stoppageTime ?? null,
    finalScoreConfirmedAt: state?.final_score_confirmed_at ?? payload.finalScoreConfirmedAt ?? null,
    updatedAt: state?.updated_at ?? payload.updatedAt ?? new Date().toISOString(),
    statistics: {
      homePossession: state?.home_possession,
      awayPossession: state?.away_possession,
      homeShots: state?.home_shots,
      awayShots: state?.away_shots,
      homeShotsOnTarget: state?.home_shots_on_target,
      awayShotsOnTarget: state?.away_shots_on_target,
      homeExpectedGoals: state?.home_expected_goals,
      awayExpectedGoals: state?.away_expected_goals,
      homePasses: state?.home_passes,
      awayPasses: state?.away_passes,
      homePassingAccuracy: state?.home_passing_accuracy,
      awayPassingAccuracy: state?.away_passing_accuracy,
      homeYellowCards: state?.home_yellow_cards,
      awayYellowCards: state?.away_yellow_cards,
      homeRedCards: state?.home_red_cards,
      awayRedCards: state?.away_red_cards,
      homeCorners: state?.home_corners,
      awayCorners: state?.away_corners,
      homeFouls: state?.home_fouls,
      awayFouls: state?.away_fouls,
      homeOffsides: state?.home_offsides,
      awayOffsides: state?.away_offsides,
    },
    lineups: state?.lineups ?? null,
    events: [],
  };
}
