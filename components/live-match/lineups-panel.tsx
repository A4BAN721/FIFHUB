import type { MatchLineupPlayer, MatchLineups, MatchTeamLineup } from "@/lib/live-data/types";
import { getTeamDisplayName } from "@/lib/team-display";

type LineupsPanelProps = {
  lineups?: MatchLineups | null;
  homeTeam: string;
  awayTeam: string;
};

export function LineupsPanel({ lineups, homeTeam, awayTeam }: LineupsPanelProps) {
  if (!lineups) {
    return (
      <div className="rounded-lg border border-border/40 bg-background/45 p-3">
        <p className="text-sm font-semibold text-foreground">Line-ups are not available yet.</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          They will appear automatically when the lineup provider publishes them.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/40 bg-[#242526] text-white">
      <LineupSection
        title="Starters"
        home={lineups.home}
        away={lineups.away}
        homeFallback={homeTeam}
        awayFallback={awayTeam}
        type="starters"
      />
      <LineupSection
        title="Bench"
        home={lineups.home}
        away={lineups.away}
        homeFallback={homeTeam}
        awayFallback={awayTeam}
        type="substitutes"
      />
    </div>
  );
}

function LineupSection({
  title,
  home,
  away,
  homeFallback,
  awayFallback,
  type,
}: {
  title: string;
  home: MatchTeamLineup;
  away: MatchTeamLineup;
  homeFallback: string;
  awayFallback: string;
  type: "starters" | "substitutes";
}) {
  const homePlayers = home[type];
  const awayPlayers = away[type];
  const maxRows = Math.max(homePlayers.length, awayPlayers.length);

  return (
    <section className="border-b border-black/20 last:border-b-0">
      <div className="border-b border-black/20 bg-[#252627] px-3 py-2 text-center">
        <h4 className="text-lg font-semibold text-white">{title}</h4>
        {type === "starters" && (
          <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs font-black text-white/80">
            <span className="truncate text-left">
              {getTeamDisplayName(home.teamName || homeFallback)}
              <span className="ml-2 tabular-nums text-white">{home.formation ?? "TBA"}</span>
            </span>
            <span className="text-white/40">vs</span>
            <span className="truncate text-right">
              <span className="mr-2 tabular-nums text-white">{away.formation ?? "TBA"}</span>
              {getTeamDisplayName(away.teamName || awayFallback)}
            </span>
          </div>
        )}
      </div>

      <div>
        {Array.from({ length: maxRows }).map((_, index) => (
          <div key={`${title}-${index}`} className="grid min-h-[70px] grid-cols-2 border-b border-black/20 last:border-b-0">
            <PlayerLine player={homePlayers[index]} side="home" />
            <PlayerLine player={awayPlayers[index]} side="away" />
          </div>
        ))}
      </div>
    </section>
  );
}

function PlayerLine({
  player,
  side,
}: {
  player?: MatchLineupPlayer;
  side: "home" | "away";
}) {
  if (!player) return <div className="bg-[#242526]" />;

  const isAway = side === "away";

  return (
    <div
      className={`flex items-center gap-3 bg-[#242526] px-2 py-2 sm:px-3 ${
        isAway ? "justify-end border-l border-black/20 text-right" : ""
      }`}
    >
      {!isAway && <NumberCircle player={player} />}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {isAway && player.rating != null && <RatingBadge rating={player.rating} />}
          <p className="truncate text-sm font-black leading-tight text-white sm:text-base">{player.name}</p>
          {!isAway && player.rating != null && <RatingBadge rating={player.rating} />}
          {player.captain && <CaptainBadge />}
        </div>
        <p className="mt-0.5 truncate text-xs text-white/65">
          {positionLabel(player.position)} {player.shirtNumber ? `#${player.shirtNumber}` : ""}
        </p>
      </div>
      {isAway && <NumberCircle player={player} />}
    </div>
  );
}

function NumberCircle({ player }: { player: MatchLineupPlayer }) {
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-400/80 text-lg font-black tabular-nums text-white shadow-inner">
      {player.shirtNumber ?? "-"}
    </div>
  );
}

function RatingBadge({ rating }: { rating: number }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums text-zinc-950 ${rating >= 7 ? "bg-emerald-400" : "bg-orange-400"}`}>
      {rating.toFixed(1)}
    </span>
  );
}

function CaptainBadge() {
  return (
    <span className="grid h-4 w-4 place-items-center rounded-full bg-white text-[9px] font-black text-zinc-950">
      C
    </span>
  );
}

function positionLabel(position?: string | null) {
  const normalized = String(position ?? "").toLowerCase();
  if (normalized === "g" || normalized.includes("goal")) return "Goalkeeper";
  if (normalized === "d" || normalized.includes("def")) return "Defender";
  if (normalized === "m" || normalized.includes("mid")) return "Midfielder";
  if (normalized === "f" || normalized.includes("for") || normalized.includes("str")) return "Striker";
  return position ?? "Player";
}
