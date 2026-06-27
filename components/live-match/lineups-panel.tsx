import type { MatchEvent, MatchLineupPlayer, MatchLineups, MatchTeamLineup, MatchUnavailablePlayer } from "@/lib/live-data/types";
import { normalizeCountryName } from "@/lib/country-utils";
import { getTeamDisplayName } from "@/lib/team-display";

type LineupsPanelProps = {
  lineups?: MatchLineups | null;
  events?: MatchEvent[];
  homeTeam: string;
  awayTeam: string;
};

type PlayerEventMarks = {
  goals: number;
  assists: number;
  injured: boolean;
  yellowCards: number;
  redCards: number;
};

export function LineupsPanel({ lineups, events = [], homeTeam, awayTeam }: LineupsPanelProps) {
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
        events={events}
      />
      <LineupSection
        title="Bench"
        home={lineups.home}
        away={lineups.away}
        homeFallback={homeTeam}
        awayFallback={awayTeam}
        type="substitutes"
        events={events}
      />
      <UnavailableSection home={lineups.home} away={lineups.away} homeFallback={homeTeam} awayFallback={awayTeam} />
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
  events,
}: {
  title: string;
  home: MatchTeamLineup;
  away: MatchTeamLineup;
  homeFallback: string;
  awayFallback: string;
  type: "starters" | "substitutes";
  events: MatchEvent[];
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
            <PlayerLine
              player={homePlayers[index]}
              side="home"
              teamName={home.teamName || homeFallback}
              marks={getPlayerEventMarks(homePlayers[index], home.teamName || homeFallback, events)}
            />
            <PlayerLine
              player={awayPlayers[index]}
              side="away"
              teamName={away.teamName || awayFallback}
              marks={getPlayerEventMarks(awayPlayers[index], away.teamName || awayFallback, events)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function PlayerLine({
  player,
  side,
  teamName,
  marks,
}: {
  player?: MatchLineupPlayer;
  side: "home" | "away";
  teamName: string;
  marks: PlayerEventMarks;
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
          {isAway && <PlayerEventMarkers marks={marks} />}
          {isAway && player.rating != null && <RatingBadge rating={player.rating} />}
          <button
            className="min-w-0 truncate text-sm font-black leading-tight text-white underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:text-base"
            onClick={() => openSquadPlayer(teamName, player.name)}
            type="button"
          >
            {player.name}
          </button>
          {!isAway && player.rating != null && <RatingBadge rating={player.rating} />}
          {player.captain && <CaptainBadge />}
          {!isAway && <PlayerEventMarkers marks={marks} />}
        </div>
        <p className="mt-0.5 truncate text-xs text-white/65">
          {positionLabel(player.position)} {player.shirtNumber ? `#${player.shirtNumber}` : ""}
        </p>
      </div>
      {isAway && <NumberCircle player={player} />}
    </div>
  );
}

function PlayerEventMarkers({ marks }: { marks: PlayerEventMarks }) {
  const markers = [
    ...Array.from({ length: marks.goals }, (_, index) => <BallMarker key={`goal-${index}`} />),
    ...Array.from({ length: marks.assists }, (_, index) => <ShoeMarker key={`assist-${index}`} />),
    marks.injured ? <MedicalMarker key="injury" /> : null,
    ...Array.from({ length: marks.yellowCards }, (_, index) => <CardMarker key={`yellow-${index}`} color="yellow" />),
    ...Array.from({ length: marks.redCards }, (_, index) => <CardMarker key={`red-${index}`} color="red" />),
  ].filter(Boolean);

  if (markers.length === 0) return null;

  return <span className="flex shrink-0 items-center gap-1">{markers}</span>;
}

function BallMarker() {
  return <span aria-label="Goal" className="text-[13px] leading-none">⚽</span>;
}

function ShoeMarker() {
  return <span aria-label="Assist" className="text-[13px] leading-none">👟</span>;
}

function MedicalMarker() {
  return (
    <span aria-label="Injured" className="grid h-4 w-4 place-items-center rounded-full bg-white text-[13px] font-black leading-none text-red-600">
      +
    </span>
  );
}

function CardMarker({ color }: { color: "yellow" | "red" }) {
  return (
    <span
      aria-label={color === "yellow" ? "Yellow card" : "Red card"}
      className={`h-4 w-2.5 rounded-[2px] border border-white/20 shadow-sm ${color === "yellow" ? "bg-yellow-400" : "bg-red-600"}`}
    />
  );
}

function UnavailableSection({
  home,
  away,
  homeFallback,
  awayFallback,
}: {
  home: MatchTeamLineup;
  away: MatchTeamLineup;
  homeFallback: string;
  awayFallback: string;
}) {
  const homePlayers = home.unavailable ?? [];
  const awayPlayers = away.unavailable ?? [];
  if (homePlayers.length === 0 && awayPlayers.length === 0) return null;

  const maxRows = Math.max(homePlayers.length, awayPlayers.length);

  return (
    <section className="border-t border-black/20">
      <div className="border-b border-black/20 bg-[#252627] px-3 py-2 text-center">
        <h4 className="text-lg font-semibold text-white">Injured / Suspended</h4>
        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs font-black text-white/80">
          <span className="truncate text-left">{getTeamDisplayName(home.teamName || homeFallback)}</span>
          <span className="text-white/40">vs</span>
          <span className="truncate text-right">{getTeamDisplayName(away.teamName || awayFallback)}</span>
        </div>
      </div>
      {Array.from({ length: maxRows }).map((_, index) => (
        <div key={`unavailable-${index}`} className="grid min-h-[54px] grid-cols-2 border-b border-black/20 last:border-b-0">
          <UnavailableLine player={homePlayers[index]} teamName={home.teamName || homeFallback} side="home" />
          <UnavailableLine player={awayPlayers[index]} teamName={away.teamName || awayFallback} side="away" />
        </div>
      ))}
    </section>
  );
}

function UnavailableLine({
  player,
  teamName,
  side,
}: {
  player?: MatchUnavailablePlayer;
  teamName: string;
  side: "home" | "away";
}) {
  if (!player) return <div className="bg-[#242526]" />;
  const isAway = side === "away";

  return (
    <div className={`flex items-center gap-2 bg-[#242526] px-2 py-2 sm:px-3 ${isAway ? "justify-end border-l border-black/20 text-right" : ""}`}>
      {!isAway && <UnavailableStatusMarker player={player} />}
      <div className="min-w-0">
        <button
          className="min-w-0 truncate text-sm font-black leading-tight text-white underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          onClick={() => openSquadPlayer(teamName, player.name)}
          type="button"
        >
          {player.name}
        </button>
        <p className="mt-0.5 truncate text-xs text-white/65">
          {positionLabel(player.position)}{player.reason ? ` - ${player.reason}` : ""}
        </p>
      </div>
      {isAway && <UnavailableStatusMarker player={player} />}
    </div>
  );
}

function UnavailableStatusMarker({ player }: { player: MatchUnavailablePlayer }) {
  if (player.status === "suspended") return <CardMarker color="red" />;
  if (player.status === "injured") return <MedicalMarker />;
  return <span className="h-2.5 w-2.5 rounded-full bg-white/55" aria-label="Unavailable" />;
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
  if (normalized === "f" || normalized.includes("for") || normalized.includes("str") || normalized.includes("att")) return "Forward";
  return position ?? "Player";
}

function getPlayerEventMarks(player: MatchLineupPlayer | undefined, teamName: string, events: MatchEvent[]): PlayerEventMarks {
  const marks: PlayerEventMarks = {
    goals: 0,
    assists: 0,
    injured: false,
    yellowCards: 0,
    redCards: 0,
  };
  if (!player) return marks;

  const playerKey = normalizePlayerName(player.name);
  const teamKey = normalizeCountryName(teamName);

  for (const event of events) {
    const eventTeamKey = event.teamName ? normalizeCountryName(event.teamName) : teamKey;
    if (eventTeamKey !== teamKey) continue;

    if (event.playerName && normalizePlayerName(event.playerName) === playerKey) {
      if (event.eventType === "goal" || event.eventType === "penalty_goal") marks.goals += 1;
      if (event.eventType === "injury") marks.injured = true;
      if (event.eventType === "yellow_card") marks.yellowCards += 1;
      if (event.eventType === "red_card" || event.eventType === "second_yellow") marks.redCards += 1;
    }

    if (event.assistPlayerName && normalizePlayerName(event.assistPlayerName) === playerKey) {
      marks.assists += 1;
    }
  }

  return marks;
}

function openSquadPlayer(teamName: string, playerName: string) {
  window.dispatchEvent(
    new CustomEvent("nationSelected", {
      detail: {
        nationId: normalizeCountryName(teamName),
        playerName,
        returnTab: "fixtures",
        returnScrollY: window.scrollY,
      },
    }),
  );
}

function normalizePlayerName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
