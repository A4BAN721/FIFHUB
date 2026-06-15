import type { MatchStatistics } from "@/lib/live-data/types";

type LiveStatsPanelProps = {
  statistics?: MatchStatistics | null;
};

const stats = [
  ["Possession", "homePossession", "awayPossession", "%"],
  ["Shots", "homeShots", "awayShots", ""],
  ["On Target", "homeShotsOnTarget", "awayShotsOnTarget", ""],
  ["Corners", "homeCorners", "awayCorners", ""],
  ["Fouls", "homeFouls", "awayFouls", ""],
] as const;

export function LiveStatsPanel({ statistics }: LiveStatsPanelProps) {
  const hasDetailedStats = stats.some(([, homeKey, awayKey]) => {
    return statistics?.[homeKey] != null || statistics?.[awayKey] != null;
  });

  return (
    <div className="space-y-2 border-t border-border/40 pt-3">
      <h4 className="text-[11px] font-bold uppercase tracking-normal text-muted-foreground">
        Match Stats
      </h4>
      <div className="space-y-1 rounded-lg border border-border/40 bg-background/45 p-2">
        {stats.map(([label, homeKey, awayKey, suffix]) => (
          <div key={label} className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 text-[11px]">
            <span className="text-left font-semibold tabular-nums text-foreground">
              {formatStat(statistics?.[homeKey], suffix)}
            </span>
            <span className="truncate text-center text-muted-foreground">{label}</span>
            <span className="text-right font-semibold tabular-nums text-foreground">
              {formatStat(statistics?.[awayKey], suffix)}
            </span>
          </div>
        ))}
      </div>
      {!hasDetailedStats && (
        <p className="text-[11px] font-medium leading-snug text-foreground/80">
          Detailed match stats are not available from the current live data provider.
        </p>
      )}
    </div>
  );
}

function formatStat(value: number | null | undefined, suffix: string) {
  if (value == null) return "N/A";
  return `${value}${suffix}`;
}
