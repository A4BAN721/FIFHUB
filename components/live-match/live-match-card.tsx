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
  const sourcedMatch = liveMatch ?? getCompletedMatch(match.id);
  const displayMatch = sourcedMatch ? withRunningMinute(sourcedMatch, now) : null;
  const shouldRunTimer = Boolean(sourcedMatch && isMatchInProgress(sourcedMatch));

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
  const showLiveIndicator = isMatchInProgress(liveMatch);

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
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
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
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") return "HT";

  return formatMatchMinute(liveMatch.minute, liveMatch.stoppageMinute);
}

function withRunningMinute(liveMatch: LiveMatch, now: number): LiveMatch {
  const timer = estimateRunningMinute(liveMatch, now);
  if (!timer) return liveMatch;

  return {
    ...liveMatch,
    minute: timer.minute,
    stoppageMinute: timer.stoppageMinute,
  };
}

function estimateRunningMinute(liveMatch: LiveMatch, now: number) {
  if (!isMatchInProgress(liveMatch) || liveMatch.status === "half_time" || liveMatch.phase === "half_time") {
    return null;
  }

  const startedAt = liveMatch.startedAt ? Date.parse(liveMatch.startedAt) : NaN;
  if (!Number.isFinite(startedAt)) return null;

  const elapsed = Math.floor((now - startedAt) / 60_000);
  if (elapsed < 0) return null;

  if (liveMatch.phase === "first_half") {
    return minuteWithStoppage(Math.max(liveMatch.minute ?? 1, elapsed), 45);
  }

  if (liveMatch.phase === "second_half" || liveMatch.status === "live") {
    return minuteWithStoppage(Math.max(liveMatch.minute ?? 46, elapsed - 15), 90);
  }

  if (liveMatch.phase === "extra_time" || liveMatch.status === "extra_time") {
    return minuteWithStoppage(Math.max(liveMatch.minute ?? 91, elapsed - 20), 120);
  }

  return null;
}

function minuteWithStoppage(value: number, regulationMinute: number) {
  if (value > regulationMinute) {
    return {
      minute: regulationMinute,
      stoppageMinute: value - regulationMinute,
    };
  }

  return {
    minute: Math.max(1, value),
    stoppageMinute: null,
  };
}

function isMatchInProgress(liveMatch: LiveMatch) {
  return (
    liveMatch.status === "live" ||
    liveMatch.status === "half_time" ||
    liveMatch.status === "extra_time" ||
    liveMatch.status === "penalties"
  );
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
        goals={goals.filter((event) => event.teamName === liveMatch.homeTeam)}
        redCards={redCards.filter((event) => event.teamName === liveMatch.homeTeam)}
        align="left"
      />
      <TeamEventColumn
        teamName={liveMatch.awayTeam}
        goals={goals.filter((event) => event.teamName === liveMatch.awayTeam)}
        redCards={redCards.filter((event) => event.teamName === liveMatch.awayTeam)}
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
