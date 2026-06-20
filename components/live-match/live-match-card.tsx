"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Match } from "@/lib/match-fixtures";
import { normalizeCountryName } from "@/lib/country-utils";
import { getCompletedMatch } from "@/lib/live-data/completed-matches";
import { formatMatchMinute, formatPhaseLabel, isVisibleLiveState } from "@/lib/live-data/status";
import type { LiveMatch, MatchEvent } from "@/lib/live-data/types";
import { getFifaAbbreviation, getTeamDisplayName } from "@/lib/team-display";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NationFlag } from "@/components/nation-flag";
import { useLiveMatch } from "@/hooks/use-live-match";
import { LiveStatsPanel } from "./live-stats-panel";

type LiveMatchCardProps = {
  match: Match;
  children: ReactNode;
};

export function LiveMatchCard({ match, children }: LiveMatchCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { liveMatch } = useLiveMatch(match.id, { fallbackMatch: match });
  const completedMatch = getCompletedMatch(match.id);
  const scheduledLiveMatch = !liveMatch && !completedMatch ? createScheduledLiveMatch(match, now) : null;
  const sourcedMatch = getBestMatchState({ completedMatch, liveMatch, scheduledLiveMatch });
  const displayMatch = sourcedMatch ? withDisplayClock(sourcedMatch, now, match) : null;
  const shouldRunTimer = Boolean(sourcedMatch && (isMatchInProgress(sourcedMatch) || scheduledLiveMatch));

  useEffect(() => {
    if (!shouldRunTimer) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [shouldRunTimer, sourcedMatch?.matchId]);

  if (!isVisibleLiveState(displayMatch)) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className="relative cursor-pointer"
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("button,a,input,select,textarea")) return;
          setIsExpanded(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsExpanded(true);
          }
        }}
        aria-label={`Open ${displayMatch.homeTeam} versus ${displayMatch.awayTeam} match details`}
      >
        {children}
        <CompactScoreOverlay liveMatch={displayMatch} />
      </div>

      {isExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setIsExpanded(false)}
            aria-label="Close match details"
          />
          <Card className="relative max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border-white/15 bg-card/95 p-4 shadow-2xl shadow-black/50 sm:p-6">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-10"
              onClick={() => setIsExpanded(false)}
              aria-label="Close match details"
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="space-y-5">
              <ExpandedMatchHeader liveMatch={displayMatch} stadium={match.stadium} />
              <ExpandedScoreboard liveMatch={displayMatch} />
              <TeamEventSummary liveMatch={displayMatch} />
              <LiveStatsPanel statistics={displayMatch.statistics} />

              <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                <span className="truncate">
                  {match.date} - {match.time}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function CompactScoreOverlay({ liveMatch }: { liveMatch: LiveMatch }) {
  const timerLabel = getTimerLabel(liveMatch);
  const showLiveIndicator = shouldShowLiveIndicator(liveMatch);
  const scoreboardPosition = isMatchInProgress(liveMatch) ? "top-[58%]" : "top-1/2";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {showLiveIndicator && (
        <span
          className="absolute right-2 top-2 h-3 w-3 rounded-full border border-white/80 bg-red-600 shadow-lg shadow-red-600/60 live-dot-pulse"
          aria-hidden="true"
        />
      )}
      <span className="absolute left-2 top-2 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[9px] font-black text-zinc-950 shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:text-white sm:text-[10px]">
        {getPlayPeriodLabel(liveMatch)}
      </span>
      <div className={`absolute left-1/2 ${scoreboardPosition} flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1`}>
        <span className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-sm font-black tabular-nums text-zinc-950 shadow-lg dark:border-zinc-700 dark:bg-zinc-950 dark:text-white">
          {liveMatch.homeScore} - {liveMatch.awayScore}
        </span>
        {timerLabel && (
          <span className="rounded-full border border-zinc-200 bg-white/95 px-2 py-0.5 text-[10px] font-black uppercase tabular-nums text-red-600 shadow-md dark:border-zinc-700 dark:bg-zinc-950/95">
            {timerLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function getBestMatchState({
  completedMatch,
  liveMatch,
  scheduledLiveMatch,
}: {
  completedMatch: LiveMatch | null;
  liveMatch: LiveMatch | null;
  scheduledLiveMatch: LiveMatch | null;
}) {
  if (completedMatch && liveMatch) {
    return mergeCompletedAndLiveMatch(completedMatch, liveMatch);
  }

  if (completedMatch) return completedMatch;
  return liveMatch ?? scheduledLiveMatch;
}

function mergeCompletedAndLiveMatch(completedMatch: LiveMatch, liveMatch: LiveMatch): LiveMatch {
  const liveIsConfirmedFinal = Boolean(
    liveMatch.finalScoreConfirmedAt ||
      liveMatch.status === "finished" ||
      liveMatch.phase === "full_time"
  );

  const scoreSource = liveIsConfirmedFinal ? liveMatch : completedMatch;

  return {
    ...completedMatch,
    homeScore: scoreSource.homeScore,
    awayScore: scoreSource.awayScore,
    startedAt: liveMatch.startedAt ?? completedMatch.startedAt,
    finalScoreConfirmedAt: liveMatch.finalScoreConfirmedAt ?? completedMatch.finalScoreConfirmedAt,
    updatedAt: liveMatch.updatedAt ?? completedMatch.updatedAt,
    statistics: hasMatchStatistics(liveMatch.statistics)
      ? { ...completedMatch.statistics, ...liveMatch.statistics }
      : completedMatch.statistics,
    events: liveMatch.events.length > 0 ? liveMatch.events : completedMatch.events,
  };
}

function hasMatchStatistics(statistics: LiveMatch["statistics"]) {
  return Object.values(statistics).some((value) => value != null);
}

function ExpandedMatchHeader({ liveMatch, stadium }: { liveMatch: LiveMatch; stadium: string }) {
  return (
    <div className="px-10 text-center">
      <p className="text-xs font-bold uppercase text-muted-foreground">{getStatusLabel(liveMatch)}</p>
      <h3 className="mt-1 text-xl font-black tracking-normal text-foreground sm:text-2xl">
        <span className="sm:hidden">
          {getFifaAbbreviation(liveMatch.homeTeam)} vs {getFifaAbbreviation(liveMatch.awayTeam)}
        </span>
        <span className="hidden sm:inline">
          {getTeamDisplayName(liveMatch.homeTeam)} vs {getTeamDisplayName(liveMatch.awayTeam)}
        </span>
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{stadium}</p>
    </div>
  );
}

function getStatusLabel(liveMatch: LiveMatch) {
  if (liveMatch.status === "finished") return "FT";
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") return "HT";

  const minute = formatMatchMinute(liveMatch.minute, liveMatch.stoppageMinute);
  if (minute && liveMatch.status !== "scheduled") return minute;

  if (isMatchInProgress(liveMatch)) return "LIVE";

  return formatPhaseLabel(liveMatch.phase);
}

function getPlayPeriodLabel(liveMatch: LiveMatch) {
  if (liveMatch.status === "finished" || liveMatch.phase === "full_time") return "Full Time";
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") return "Half Time";
  if (liveMatch.status === "penalties" || liveMatch.phase === "penalties") return "Penalties";

  if (liveMatch.status === "extra_time" || liveMatch.phase === "extra_time") {
    return getExtraTimeHalfLabel(liveMatch.minute);
  }

  if (liveMatch.status === "live") {
    return liveMatch.phase === "first_half" ? "First Half" : "Second Half";
  }

  return formatPhaseLabel(liveMatch.phase);
}

function getExtraTimeHalfLabel(minute?: number | null) {
  if (typeof minute === "number" && minute > 105) return "Extra Time Second Half";
  return "Extra Time First Half";
}

function getTimerLabel(liveMatch: LiveMatch) {
  if (!isMatchInProgress(liveMatch)) return "";
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") return "Half Time";

  return formatMatchMinute(liveMatch.minute, liveMatch.stoppageMinute);
}

function withDisplayClock(liveMatch: LiveMatch, now: number, fixture: Match): LiveMatch {
  const timer = estimateDisplayClock(liveMatch, now, fixture);
  if (!timer) return sanitizeMatchClock(liveMatch);

  return {
    ...liveMatch,
    status: timer.status,
    phase: timer.phase,
    minute: timer.minute,
    stoppageMinute: timer.stoppageMinute,
  };
}

function sanitizeMatchClock(liveMatch: LiveMatch): LiveMatch {
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") {
    return {
      ...liveMatch,
      status: "half_time",
      phase: "half_time",
      minute: 45,
      stoppageMinute: null,
    };
  }

  if (liveMatch.status === "finished" || liveMatch.phase === "full_time") {
    return {
      ...liveMatch,
      status: "finished",
      phase: "full_time",
      minute: 90,
      stoppageMinute: null,
    };
  }

  return {
    ...liveMatch,
    stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
  };
}

function estimateDisplayClock(liveMatch: LiveMatch, now: number, fixture: Match) {
  if (!isMatchInProgress(liveMatch)) return null;

  const kickoffTime = getKickoffTime(liveMatch, fixture);
  if (!Number.isFinite(kickoffTime)) return phaseFallbackClock(liveMatch);

  const elapsed = Math.floor((now - kickoffTime) / 60_000);
  if (elapsed < 0) return null;

  if (elapsed < 45) {
    return {
      status: "live" as const,
      phase: "first_half" as const,
      minute: Math.max(1, elapsed + 1),
      stoppageMinute: null,
    };
  }

  if (elapsed < 60) {
    return {
      status: "half_time" as const,
      phase: "half_time" as const,
      minute: 45,
      stoppageMinute: null,
    };
  }

  if (elapsed < 105) {
    return {
      status: "live" as const,
      phase: "second_half" as const,
      minute: Math.min(90, Math.max(46, elapsed - 14)),
      stoppageMinute: null,
    };
  }

  if (liveMatch.status === "extra_time" || liveMatch.phase === "extra_time") {
    return extraTimeClock(elapsed);
  }

  return {
    status: "finished" as const,
    phase: "full_time" as const,
    minute: 90,
    stoppageMinute: null,
  };
}

function phaseFallbackClock(liveMatch: LiveMatch) {
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") {
    return {
      status: "half_time" as const,
      phase: "half_time" as const,
      minute: 45,
      stoppageMinute: null,
    };
  }

  if (liveMatch.phase === "first_half") {
    return {
      status: "live" as const,
      phase: "first_half" as const,
      minute: Math.min(45, Math.max(1, liveMatch.minute ?? 1)),
      stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
    };
  }

  if (liveMatch.phase === "second_half" || liveMatch.status === "live") {
    return {
      status: "live" as const,
      phase: "second_half" as const,
      minute: Math.min(90, Math.max(46, liveMatch.minute ?? 46)),
      stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
    };
  }

  if (liveMatch.phase === "extra_time" || liveMatch.status === "extra_time") {
    return {
      status: "extra_time" as const,
      phase: "extra_time" as const,
      minute: Math.min(120, Math.max(91, liveMatch.minute ?? 91)),
      stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
    };
  }

  return null;
}

function extraTimeClock(elapsed: number) {
  if (elapsed < 120) {
    return {
      status: "extra_time" as const,
      phase: "extra_time" as const,
      minute: Math.min(105, Math.max(91, elapsed - 14)),
      stoppageMinute: null,
    };
  }

  if (elapsed < 135) {
    return {
      status: "extra_time" as const,
      phase: "extra_time" as const,
      minute: Math.min(120, Math.max(106, elapsed - 14)),
      stoppageMinute: null,
    };
  }

  return {
    status: "finished" as const,
    phase: "full_time" as const,
    minute: 120,
    stoppageMinute: null,
  };
}

function getKickoffTime(liveMatch: LiveMatch, fixture: Match) {
  const startedAt = liveMatch.startedAt ? Date.parse(liveMatch.startedAt) : NaN;
  if (Number.isFinite(startedAt)) return startedAt;

  return parseFixtureDateTime(fixture.date, fixture.time);
}

function parseFixtureDateTime(date: string, time: string) {
  const withoutWeekday = date.includes(",") ? date.split(",").slice(1).join(",").trim() : date;
  const parsed = Date.parse(`${withoutWeekday} ${time}`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function createScheduledLiveMatch(match: Match, now: number): LiveMatch | null {
  const kickoffTime = parseFixtureDateTime(match.date, match.time);
  if (!Number.isFinite(kickoffTime)) return null;

  const elapsed = Math.floor((now - kickoffTime) / 60_000);
  if (elapsed < 0 || elapsed >= 105) return null;

  return {
    matchId: match.id,
    status: "live",
    phase: elapsed < 45 ? "first_half" : elapsed < 60 ? "half_time" : "second_half",
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: 0,
    awayScore: 0,
    minute: null,
    startedAt: new Date(kickoffTime).toISOString(),
    updatedAt: new Date(now).toISOString(),
    statistics: {},
    events: [],
  };
}

function capStoppageMinute(stoppageMinute?: number | null) {
  if (typeof stoppageMinute !== "number" || stoppageMinute <= 0) return null;
  return Math.min(stoppageMinute, 15);
}

function isMatchInProgress(liveMatch: LiveMatch) {
  return (
    liveMatch.status === "live" ||
    liveMatch.status === "half_time" ||
    liveMatch.status === "extra_time" ||
    liveMatch.status === "penalties"
  );
}

function shouldShowLiveIndicator(liveMatch: LiveMatch) {
  return isMatchInProgress(liveMatch);
}

function isSameTeam(eventTeamName: string | null | undefined, teamName: string) {
  if (!eventTeamName) return false;
  return normalizeCountryName(eventTeamName) === normalizeCountryName(teamName);
}

function ExpandedScoreboard({ liveMatch }: { liveMatch: LiveMatch }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border/50 bg-background/45 p-3 sm:gap-5 sm:p-5">
      <ExpandedTeamName teamName={liveMatch.homeTeam} align="left" />
      <span className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-2xl font-black tabular-nums text-zinc-950 shadow-lg dark:border-zinc-700 dark:bg-zinc-950 dark:text-white sm:text-3xl">
        {liveMatch.homeScore} - {liveMatch.awayScore}
      </span>
      <ExpandedTeamName teamName={liveMatch.awayTeam} align="right" />
    </div>
  );
}

function ExpandedTeamName({ teamName, align }: { teamName: string; align: "left" | "right" }) {
  const nationId = teamName === "TBD" ? null : normalizeCountryName(teamName);

  return (
    <div
      className={`flex min-w-0 items-center gap-3 ${
        align === "right" ? "justify-end text-right" : "justify-start text-left"
      }`}
    >
      {align === "left" && (
        <NationFlag
          className="h-8 w-11 sm:h-10 sm:w-14"
          fallbackClassName="text-3xl sm:text-4xl"
          label={teamName}
          nationId={nationId}
        />
      )}
      <span className="min-w-0 truncate text-lg font-black text-foreground sm:text-2xl">
        <span className="sm:hidden">{getFifaAbbreviation(teamName)}</span>
        <span className="hidden sm:inline">{getTeamDisplayName(teamName)}</span>
      </span>
      {align === "right" && (
        <NationFlag
          className="h-8 w-11 sm:h-10 sm:w-14"
          fallbackClassName="text-3xl sm:text-4xl"
          label={teamName}
          nationId={nationId}
        />
      )}
    </div>
  );
}

function TeamEventSummary({ liveMatch }: { liveMatch: LiveMatch }) {
  const goals = liveMatch.events.filter((event) =>
    ["goal", "penalty_goal", "own_goal"].includes(event.eventType),
  );
  const redCards = liveMatch.events.filter((event) =>
    ["red_card", "second_yellow"].includes(event.eventType),
  );

  return (
    <div className="grid gap-4 border-t border-border/40 pt-4 sm:grid-cols-2">
      <TeamEventColumn
        teamName={liveMatch.homeTeam}
        goals={goals.filter((event) => isSameTeam(event.teamName, liveMatch.homeTeam))}
        redCards={redCards.filter((event) => isSameTeam(event.teamName, liveMatch.homeTeam))}
        align="left"
      />
      <TeamEventColumn
        teamName={liveMatch.awayTeam}
        goals={goals.filter((event) => isSameTeam(event.teamName, liveMatch.awayTeam))}
        redCards={redCards.filter((event) => isSameTeam(event.teamName, liveMatch.awayTeam))}
        align="right"
      />
    </div>
  );
}

function TeamEventColumn({
  teamName,
  goals,
  redCards,
  align,
}: {
  teamName: string;
  goals: MatchEvent[];
  redCards: MatchEvent[];
  align: "left" | "right";
}) {
  const alignClass = align === "right" ? "text-right sm:items-end" : "text-left sm:items-start";

  return (
    <div className={`flex flex-col gap-3 ${alignClass}`}>
      <h4 className="text-xs font-black uppercase text-muted-foreground">
        <span className="sm:hidden">{getFifaAbbreviation(teamName)}</span>
        <span className="hidden sm:inline">{getTeamDisplayName(teamName)}</span>
      </h4>
      <div className="space-y-1.5">
        {goals.length > 0 ? (
          goals.map((goal) => (
            <p key={goal.id} className="text-sm font-semibold text-foreground">
              {formatGoalLine(goal)}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No goals</p>
        )}
      </div>
      {redCards.length > 0 && (
        <div className="space-y-1">
          {redCards.map((card) => (
            <RedCardRow key={card.id} card={card} align={align} />
          ))}
        </div>
      )}
    </div>
  );
}

function RedCardRow({ card, align }: { card: MatchEvent; align: "left" | "right" }) {
  return (
    <p
      className={`flex items-center gap-2 text-sm font-bold text-red-500 ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      {align === "left" && <span className="h-4 w-2 rounded-[2px] bg-red-600" aria-label="Red card" />}
      <span>
        {card.playerName ?? "Unknown player"} {formatMinute(card)}
      </span>
      {align === "right" && <span className="h-4 w-2 rounded-[2px] bg-red-600" aria-label="Red card" />}
    </p>
  );
}

function formatGoalLine(goal: MatchEvent) {
  const suffix = goal.eventType === "penalty_goal" ? " pen." : goal.eventType === "own_goal" ? " OG" : "";
  const assist = goal.assistPlayerName ? `, assist: ${goal.assistPlayerName}` : "";
  return `${goal.playerName ?? "Unknown scorer"} ${formatMinute(goal)}${suffix}${assist}`;
}

function formatMinute(event: MatchEvent) {
  return `${event.minute}${event.stoppageMinute ? `+${event.stoppageMinute}` : ""}'`;
}
