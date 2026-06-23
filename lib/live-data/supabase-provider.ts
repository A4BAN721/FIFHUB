import type { SupabaseClient } from "@supabase/supabase-js";
import type { FootballDataProvider } from "./football-provider";
import { normalizeMatchPhase, normalizeMatchStatus } from "./status";
import type { LiveMatch, MatchEvent, MatchEventType, MatchStatistics } from "./types";

type LiveMatchStateRow = {
  match_id: string;
  status: string;
  phase?: string | null;
  period?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score: number | null;
  away_score: number | null;
  minute: number | null;
  stoppage_minute: number | null;
  stoppage_time?: number | null;
  started_at: string | null;
  final_score_confirmed_at?: string | null;
  highlights_url?: string | null;
  highlights_title?: string | null;
  highlights_published_at?: string | null;
  home_possession?: number | null;
  away_possession?: number | null;
  home_shots?: number | null;
  away_shots?: number | null;
  home_shots_on_target?: number | null;
  away_shots_on_target?: number | null;
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
  updated_at: string;
  match?: {
    home_team?: { name?: string | null } | null;
    away_team?: { name?: string | null } | null;
  } | null;
};

type MatchEventRow = {
  id: string;
  external_event_id?: string | null;
  match_id: string;
  minute: number | null;
  stoppage_minute: number | null;
  sequence_number?: number | null;
  event_type: string;
  team_id: string | null;
  team_name: string | null;
  player_name: string | null;
  assist_player_name: string | null;
  substitute_player_name?: string | null;
  description: string | null;
  created_at: string;
};

export class SupabaseFootballProvider implements FootballDataProvider {
  constructor(private readonly supabase: SupabaseClient) {}

  async getLiveMatch(matchId: string): Promise<LiveMatch | null> {
    let { data: state, error: stateError } = await this.supabase
      .from("live_match_state")
      .select("*, match:matches(home_team:teams!home_team_id(name), away_team:teams!away_team_id(name))")
      .eq("match_id", matchId)
      .maybeSingle();

    if (stateError) {
      const fallback = await this.supabase
        .from("live_match_state")
        .select("*")
        .eq("match_id", matchId)
        .maybeSingle();

      state = fallback.data;
      stateError = fallback.error;
    }

    if (stateError) throw stateError;
    if (!state) return null;

    const { data: events, error: eventsError } = await this.supabase
      .from("match_events")
      .select("*")
      .eq("match_id", matchId)
      .order("sequence_number", { ascending: true, nullsFirst: false })
      .order("minute", { ascending: true })
      .order("stoppage_minute", { ascending: true })
      .order("created_at", { ascending: true });

    if (eventsError) throw eventsError;

    return mapLiveMatch(state as LiveMatchStateRow, (events ?? []) as MatchEventRow[]);
  }
}

function mapLiveMatch(state: LiveMatchStateRow, eventRows: MatchEventRow[]): LiveMatch {
  const seen = new Set<string>();
  const events: MatchEvent[] = [];

  for (const row of eventRows) {
    const key = `${row.event_type}:${row.minute}:${row.stoppage_minute ?? ""}:${row.team_id ?? ""}:${row.player_name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      id: row.id,
      externalEventId: row.external_event_id,
      matchId: row.match_id,
      minute: row.minute ?? 0,
      stoppageMinute: row.stoppage_minute,
      sequenceNumber: row.sequence_number,
      eventType: normalizeEventType(row.event_type),
      teamId: row.team_id,
      teamName: row.team_name,
      playerName: row.player_name,
      assistPlayerName: row.assist_player_name,
      substitutePlayerName: row.substitute_player_name,
      description: row.description,
      createdAt: row.created_at,
    });
  }

  const homeTeam = state.home_team ?? state.match?.home_team?.name ?? "Home";
  const awayTeam = state.away_team ?? state.match?.away_team?.name ?? "Away";

  return {
    matchId: state.match_id,
    status: normalizeMatchStatus(state.status),
    phase: normalizeMatchPhase(state.phase ?? state.period),
    homeTeam,
    awayTeam,
    homeScore: state.home_score ?? 0,
    awayScore: state.away_score ?? 0,
    minute: state.minute,
    stoppageMinute: state.stoppage_minute ?? state.stoppage_time,
    startedAt: state.started_at,
    finalScoreConfirmedAt: state.final_score_confirmed_at,
    highlightsUrl: state.highlights_url,
    highlightsTitle: state.highlights_title,
    highlightsPublishedAt: state.highlights_published_at,
    updatedAt: state.updated_at,
    statistics: mapStatistics(state),
    events,
  };
}

function mapStatistics(state: LiveMatchStateRow): MatchStatistics {
  return {
    homePossession: state.home_possession,
    awayPossession: state.away_possession,
    homeShots: state.home_shots,
    awayShots: state.away_shots,
    homeShotsOnTarget: state.home_shots_on_target,
    awayShotsOnTarget: state.away_shots_on_target,
    homeYellowCards: state.home_yellow_cards,
    awayYellowCards: state.away_yellow_cards,
    homeRedCards: state.home_red_cards,
    awayRedCards: state.away_red_cards,
    homeCorners: state.home_corners,
    awayCorners: state.away_corners,
    homeFouls: state.home_fouls,
    awayFouls: state.away_fouls,
    homeOffsides: state.home_offsides,
    awayOffsides: state.away_offsides,
  };
}

function normalizeEventType(eventType: string): MatchEventType {
  return eventType.toLowerCase() as MatchEventType;
}
