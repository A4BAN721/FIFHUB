import type { LiveMatch, MatchPhase, MatchStatus } from "./types";

export function normalizeMatchStatus(status?: string | null): MatchStatus {
  const value = normalizeStatusValue(status);

  if (
    value === "live" ||
    value === "in_progress" ||
    value === "first_half" ||
    value === "second_half" ||
    value === "1h" ||
    value === "2h"
  ) {
    return "live";
  }

  if (value === "half_time" || value === "halftime" || value === "ht") {
    return "half_time";
  }

  if (value === "finished" || value === "full_time" || value === "fulltime" || value === "final" || value === "ft") {
    return "finished";
  }

  if (value === "extra_time" || value === "et") {
    return "extra_time";
  }

  if (value === "penalties" || value === "penalty_shootout" || value === "pen") {
    return "penalties";
  }

  if (value === "postponed" || value === "cancelled" || value === "suspended" || value === "interrupted") {
    return value;
  }

  return "scheduled";
}

export function normalizeMatchPhase(phase?: string | null): MatchPhase {
  const value = normalizeStatusValue(phase);

  if (value === "in_progress") return "second_half";
  if (value === "1h" || value === "first_half") return "first_half";
  if (value === "half_time" || value === "halftime" || value === "ht") return "half_time";
  if (value === "2h" || value === "second_half") return "second_half";
  if (value === "extra_time" || value === "et") return "extra_time";
  if (value === "penalties" || value === "penalty_shootout" || value === "pen") return "penalties";
  if (value === "finished" || value === "full_time" || value === "fulltime" || value === "final" || value === "ft") {
    return "full_time";
  }

  if (
    value === "pre_match" ||
    value === "scheduled"
  ) {
    return "pre_match";
  }

  return "pre_match";
}

export function isVisibleLiveState(match: LiveMatch | null): match is LiveMatch {
  return Boolean(
    match &&
      (match.status !== "scheduled" ||
        match.finalScoreConfirmedAt ||
        typeof match.minute === "number" ||
        match.homeScore > 0 ||
        match.awayScore > 0)
  );
}

export function formatMatchMinute(minute?: number | null, stoppageMinute?: number | null): string {
  if (typeof minute !== "number") return "";
  return stoppageMinute ? `${minute}+${stoppageMinute}'` : `${minute}'`;
}

export function formatPhaseLabel(phase: MatchPhase): string {
  const labels: Record<MatchPhase, string> = {
    pre_match: "Scheduled",
    first_half: "First Half",
    half_time: "Half Time",
    second_half: "Second Half",
    extra_time: "Extra Time",
    penalties: "Penalties",
    full_time: "Full Time",
  };

  return labels[phase];
}

function normalizeStatusValue(value?: string | null): string {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}
