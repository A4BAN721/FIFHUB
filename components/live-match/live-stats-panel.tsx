import type { MatchEvent, MatchStatistics } from "@/lib/live-data/types";

type LiveStatsPanelProps = {
  statistics?: MatchStatistics | null;
  events?: MatchEvent[];
  homeTeam?: string;
  awayTeam?: string;
  language?: "en" | "bn";
  t?: (key: string) => string;
};

const stats = [
  ["possession", "Possession", "homePossession", "awayPossession", "%"],
  ["expectedGoals", "Expected Goals (xG)", "homeExpectedGoals", "awayExpectedGoals", ""],
  ["shots", "Shots", "homeShots", "awayShots", ""],
  ["shotsOnTarget", "Shots On Target", "homeShotsOnTarget", "awayShotsOnTarget", ""],
  ["passes", "Passes", "homePasses", "awayPasses", ""],
  ["passingAccuracy", "Passing Accuracy", "homePassingAccuracy", "awayPassingAccuracy", "%"],
  ["corners", "Corners", "homeCorners", "awayCorners", ""],
  ["offsides", "Offsides", "homeOffsides", "awayOffsides", ""],
  ["fouls", "Fouls", "homeFouls", "awayFouls", ""],
  ["yellowCards", "Yellow Cards", "homeYellowCards", "awayYellowCards", ""],
  ["redCards", "Red Cards", "homeRedCards", "awayRedCards", ""],
] as const;

export function LiveStatsPanel({ statistics, events = [], homeTeam = "Home", awayTeam = "Away", language = "en", t }: LiveStatsPanelProps) {
  const hasDetailedStats = stats.some(([, , homeKey, awayKey]) => {
    return statistics?.[homeKey] != null || statistics?.[awayKey] != null;
  });
  void events;
  void homeTeam;
  void awayTeam;

  return (
    <div className="space-y-2">
      <div className="space-y-1 rounded-lg border border-border/40 bg-background/45 p-2">
        {stats.map(([key, fallbackLabel, homeKey, awayKey, suffix]) => (
          <div key={key} className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 text-[11px]">
            <span className="text-left font-semibold tabular-nums text-foreground">
              {formatStat(statistics?.[homeKey], suffix, language)}
            </span>
            <span className="truncate text-center text-muted-foreground">{t ? t(key) : fallbackLabel}</span>
            <span className="text-right font-semibold tabular-nums text-foreground">
              {formatStat(statistics?.[awayKey], suffix, language)}
            </span>
          </div>
        ))}
      </div>
      {!hasDetailedStats && (
        <p className="text-[11px] font-medium leading-snug text-foreground/80">
          {t ? t("noDataAvailableYet") : "Detailed match stats are not available from the current live data provider."}
        </p>
      )}
    </div>
  );
}

function formatStat(value: number | null | undefined, suffix: string, language: "en" | "bn") {
  if (value == null) return "N/A";
  if (suffix === "%" && !Number.isInteger(value)) return formatLocalizedNumber(`${value.toFixed(1)}${suffix}`, language);
  if (suffix === "" && !Number.isInteger(value)) return formatLocalizedNumber(value.toFixed(2), language);
  return formatLocalizedNumber(`${value}${suffix}`, language);
}

function formatLocalizedNumber(value: string | number, language: "en" | "bn") {
  if (language !== "bn") return String(value);
  return String(value).replace(/\d/g, (digit) => banglaNumerals[digit] ?? digit);
}

const banglaNumerals: Record<string, string> = {
  "0": "০",
  "1": "১",
  "2": "২",
  "3": "৩",
  "4": "৪",
  "5": "৫",
  "6": "৬",
  "7": "৭",
  "8": "৮",
  "9": "৯",
};
