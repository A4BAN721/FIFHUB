import { formatPhaseLabel } from "@/lib/live-data/status";
import type { LiveMatch } from "@/lib/live-data/types";
import { getFifaAbbreviation, getTeamDisplayName } from "@/lib/team-display";
import { MatchStatusBadge } from "./match-status-badge";

type LiveScoreboardProps = {
  liveMatch: LiveMatch;
};

export function LiveScoreboard({ liveMatch }: LiveScoreboardProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <MatchStatusBadge liveMatch={liveMatch} />
        <span className="truncate text-[10px] font-medium text-muted-foreground">
          {formatPhaseLabel(liveMatch.phase)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="min-w-0 truncate text-left text-xs font-semibold text-foreground">
          <span className="sm:hidden">{getFifaAbbreviation(liveMatch.homeTeam)}</span>
          <span className="hidden sm:inline">{getTeamDisplayName(liveMatch.homeTeam)}</span>
        </span>
        <span className="rounded-md bg-foreground px-3 py-1 text-base font-black tabular-nums text-background">
          {liveMatch.homeScore} - {liveMatch.awayScore}
        </span>
        <span className="min-w-0 truncate text-right text-xs font-semibold text-foreground">
          <span className="sm:hidden">{getFifaAbbreviation(liveMatch.awayTeam)}</span>
          <span className="hidden sm:inline">{getTeamDisplayName(liveMatch.awayTeam)}</span>
        </span>
      </div>
    </div>
  );
}
