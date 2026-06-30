import { normalizeCountryName } from "@/lib/country-utils";
import { formatPhaseLabel } from "@/lib/live-data/status";
import type { LiveMatch } from "@/lib/live-data/types";
import { getFifaAbbreviation, getTeamDisplayName } from "@/lib/team-display";
import { MatchStatusBadge } from "./match-status-badge";

type LiveScoreboardProps = {
  liveMatch: LiveMatch;
};

export function LiveScoreboard({ liveMatch }: LiveScoreboardProps) {
  const penaltyScore = getPenaltyShootoutScore(liveMatch);
  const showShootoutBoard = isPenaltyShootoutInProgress(liveMatch);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <MatchStatusBadge liveMatch={liveMatch} />
        <span className="truncate text-[10px] font-medium text-muted-foreground">
          {formatPhaseLabel(liveMatch.phase)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="min-w-0 space-y-1">
          <span className="block truncate text-left text-xs font-semibold text-foreground">
            <span className="sm:hidden">{getFifaAbbreviation(liveMatch.homeTeam)}</span>
            <span className="hidden sm:inline">{getTeamDisplayName(liveMatch.homeTeam)}</span>
          </span>
          {showShootoutBoard && (
            <PenaltyAttemptDots attempts={getPenaltyShootoutAttempts(liveMatch, liveMatch.homeTeam)} align="left" />
          )}
        </div>
        <span className="rounded-md bg-foreground px-3 py-1 text-center text-base font-black tabular-nums text-background">
          <span className="block">{liveMatch.homeScore} - {liveMatch.awayScore}</span>
          {penaltyScore && !showShootoutBoard && (
            <span className="block text-[9px] uppercase leading-tight opacity-75">
              Pens {penaltyScore.home} - {penaltyScore.away}
            </span>
          )}
        </span>
        <div className="min-w-0 space-y-1">
          <span className="block truncate text-right text-xs font-semibold text-foreground">
            <span className="sm:hidden">{getFifaAbbreviation(liveMatch.awayTeam)}</span>
            <span className="hidden sm:inline">{getTeamDisplayName(liveMatch.awayTeam)}</span>
          </span>
          {showShootoutBoard && (
            <PenaltyAttemptDots attempts={getPenaltyShootoutAttempts(liveMatch, liveMatch.awayTeam)} align="right" />
          )}
        </div>
      </div>
    </div>
  );
}

function isPenaltyShootoutInProgress(liveMatch: LiveMatch) {
  return (
    !isFinalMatchState(liveMatch) &&
    (liveMatch.status === "penalties" ||
      liveMatch.phase === "penalties" ||
      isLikelyAwaitingPenaltyShootout(liveMatch) ||
      hasPenaltyShootoutEvents(liveMatch) ||
      Boolean(getPenaltyShootoutScore(liveMatch)))
  );
}

function isFinalMatchState(liveMatch: LiveMatch) {
  return liveMatch.status === "finished" || liveMatch.phase === "full_time" || Boolean(liveMatch.finalScoreConfirmedAt);
}

function isLikelyAwaitingPenaltyShootout(liveMatch: LiveMatch) {
  return (
    liveMatch.homeScore === liveMatch.awayScore &&
    (liveMatch.status === "extra_time" || liveMatch.phase === "extra_time") &&
    typeof liveMatch.minute === "number" &&
    liveMatch.minute >= 120
  );
}

function getPenaltyShootoutScore(liveMatch: LiveMatch) {
  if (
    typeof liveMatch.homePenaltyScore === "number" &&
    typeof liveMatch.awayPenaltyScore === "number" &&
    (liveMatch.homePenaltyScore > 0 ||
      liveMatch.awayPenaltyScore > 0 ||
      liveMatch.status === "penalties" ||
      liveMatch.phase === "penalties")
  ) {
    return { home: liveMatch.homePenaltyScore, away: liveMatch.awayPenaltyScore };
  }

  const shootoutGoals = liveMatch.events.filter((event) => event.eventType === "penalty_shootout_goal");
  if (shootoutGoals.length === 0) return null;

  return {
    home: shootoutGoals.filter((event) => isSameTeam(event.teamName, liveMatch.homeTeam)).length,
    away: shootoutGoals.filter((event) => isSameTeam(event.teamName, liveMatch.awayTeam)).length,
  };
}

type PenaltyAttemptState = "scored" | "missed" | null;

function getPenaltyShootoutAttempts(liveMatch: LiveMatch, teamName: string): PenaltyAttemptState[] {
  const attempts = [...liveMatch.events]
    .filter((event) =>
      (event.eventType === "penalty_shootout_goal" || event.eventType === "penalty_shootout_miss") &&
      isSameTeam(event.teamName, teamName),
    )
    .sort((a, b) => {
      const sequenceDiff = (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
      if (sequenceDiff !== 0) return sequenceDiff;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .map((event) => event.eventType === "penalty_shootout_goal" ? "scored" as const : "missed" as const);

  if (attempts.length === 0) {
    const penaltyScore = getPenaltyShootoutScore(liveMatch);
    if (penaltyScore) {
      const scoredCount = teamName === liveMatch.homeTeam ? penaltyScore.home : penaltyScore.away;
      return Array.from({ length: 5 }, (_, index) => index < scoredCount ? "scored" : null);
    }
  }

  return Array.from({ length: 5 }, (_, index) => attempts[index] ?? null);
}

function hasPenaltyShootoutEvents(liveMatch: LiveMatch) {
  return liveMatch.events.some((event) =>
    event.eventType === "penalty_shootout_goal" || event.eventType === "penalty_shootout_miss",
  );
}

function PenaltyAttemptDots({ attempts, align }: { attempts: PenaltyAttemptState[]; align: "left" | "right" }) {
  return (
    <div
      className={`flex items-center gap-1 ${align === "right" ? "justify-end" : "justify-start"}`}
      aria-label="Penalty shoot-out attempts"
    >
      {attempts.map((attempt, index) => (
        <span
          key={index}
          className={`h-2 w-2 rounded-full border ${
            attempt === "scored"
              ? "border-emerald-500 bg-emerald-500"
              : attempt === "missed"
                ? "border-red-500 bg-red-500"
                : "border-zinc-400 bg-transparent dark:border-zinc-500"
          }`}
        />
      ))}
    </div>
  );
}

function isSameTeam(eventTeamName: string | null | undefined, teamName: string) {
  if (!eventTeamName) return false;
  return normalizeCountryName(eventTeamName) === normalizeCountryName(teamName);
}
