import type { CSSProperties } from "react";
import Image from "next/image";
import type { MatchEvent, MatchLineupPlayer, MatchLineups, MatchTeamLineup, MatchUnavailablePlayer } from "@/lib/live-data/types";
import { normalizeCountryName } from "@/lib/country-utils";
import { getTeamDisplayName } from "@/lib/team-display";
import { nations as fallbackNations } from "@/lib/world-cup-data";
import { ArrowDown, ArrowUp, Ban, Plus, Star } from "lucide-react";

type LineupsPanelProps = {
  lineups?: MatchLineups | null;
  events?: MatchEvent[];
  matchId?: string;
  homeTeam: string;
  awayTeam: string;
};

type PlayerEventMarks = {
  goals: number;
  ownGoals: number;
  assists: number;
  injured: boolean;
  suspended: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  yellowCards: number;
  secondYellowCards: number;
  redCards: number;
};

type PlayerNameStyle = CSSProperties & {
  "--player-team-primary": string;
};

const nationPrimaryColorById = new Map(
  fallbackNations.map((nation) => [nation.id, nation.jerseyColors.primary]),
);

export function LineupsPanel({ lineups, events = [], matchId, homeTeam, awayTeam }: LineupsPanelProps) {
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

  const displayLineups = getDisplayLineups(lineups, matchId, homeTeam, awayTeam);

  return (
    <div className="overflow-hidden rounded-lg border border-border/40 bg-[#242526] text-white">
      <LineupSection
        title="Starters"
        home={displayLineups.home}
        away={displayLineups.away}
        homeFallback={homeTeam}
        awayFallback={awayTeam}
        type="starters"
        events={events}
      />
      <LineupSection
        title="Bench"
        home={displayLineups.home}
        away={displayLineups.away}
        homeFallback={homeTeam}
        awayFallback={awayTeam}
        type="substitutes"
        events={events}
      />
      <UnavailableSection home={displayLineups.home} away={displayLineups.away} homeFallback={homeTeam} awayFallback={awayTeam} />
    </div>
  );
}

function getDisplayLineups(lineups: MatchLineups, matchId: string | undefined, homeTeam: string, awayTeam: string): MatchLineups {
  const isIvoryCoastNorway =
    matchId === "77" ||
    (normalizeCountryName(homeTeam) === "ivory-coast" && normalizeCountryName(awayTeam) === "norway");

  if (!isIvoryCoastNorway) return lineups;

  return {
    ...lineups,
    away: {
      ...lineups.away,
      formation: "4-3-3",
    },
  };
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
      {!isAway && <NumberCircle player={player} marks={marks} />}
      <div className="min-w-0">
        <div className={`flex items-center gap-1.5 ${isAway ? "flex-row-reverse" : ""}`}>
          <button
            className="min-w-0 cursor-pointer whitespace-normal break-words text-[11px] font-black leading-[1.05] text-white transition hover:text-[var(--player-team-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:truncate sm:text-base sm:leading-tight"
            style={{ "--player-team-primary": getNationPrimaryColor(teamName) } as PlayerNameStyle}
            onClick={() => openSquadPlayer(teamName, player.name)}
            type="button"
          >
            <span className="sm:hidden">{formatMobilePlayerName(player.name)}</span>
            <span className="hidden sm:inline">{player.name}</span>
          </button>
          <RatingCluster player={player} marks={marks} side={side} />
        </div>
        <p className="mt-0.5 truncate text-xs text-white/65">
          {playerPositionLabel(player, teamName)}
        </p>
      </div>
      {isAway && <NumberCircle player={player} marks={marks} />}
    </div>
  );
}

function RatingCluster({ player, marks, side }: { player: MatchLineupPlayer; marks: PlayerEventMarks; side: "home" | "away" }) {
  const rating = player.rating;
  const hasMarkers = hasRatingSideMarkers(marks);
  if (rating == null && !hasMarkers) return null;

  return (
    <span className={`flex shrink-0 items-center gap-1 ${side === "away" ? "flex-row-reverse" : ""}`}>
      {rating != null && <RatingBadge rating={rating} playerOfTheMatch={Boolean(player.playerOfTheMatch)} />}
      <PlayerEventMarkers marks={marks} />
    </span>
  );
}

function hasRatingSideMarkers(marks: PlayerEventMarks) {
  return (
    marks.goals > 0 ||
    marks.ownGoals > 0 ||
    marks.assists > 0 ||
    marks.suspended
  );
}

function PlayerEventMarkers({ marks }: { marks: PlayerEventMarks }) {
  const markers = [
    ...Array.from({ length: marks.goals }, (_, index) => <GoalMarker key={`goal-${index}`} />),
    ...Array.from({ length: marks.ownGoals }, (_, index) => <OwnGoalMarker key={`own-goal-${index}`} />),
    ...Array.from({ length: marks.assists }, (_, index) => <AssistMarker key={`assist-${index}`} />),
    marks.suspended ? <SuspendedMarker key="suspended" /> : null,
  ].filter(Boolean);

  if (markers.length === 0) return null;

  return <span className="flex shrink-0 items-center gap-1">{markers}</span>;
}

function GoalMarker() {
  return (
    <span aria-label="Goal" className="grid h-4 w-4 place-items-center">
      <EventIcon src="/icons/goal-symbol.png" alt="Goal" />
    </span>
  );
}

function OwnGoalMarker() {
  return (
    <span aria-label="Own goal" className="grid h-4 w-4 place-items-center">
      <EventIcon src="/icons/own-goal-symbol.png" alt="Own goal" />
    </span>
  );
}

function AssistMarker() {
  return (
    <span aria-label="Assist" className="grid h-4 w-4 place-items-center">
      <EventIcon src="/icons/assist-symbol.png" alt="Assist" />
    </span>
  );
}

function EventIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <Image src={src} alt={alt} width={16} height={16} className="h-4 w-4 object-contain" draggable={false} />
  );
}

function MedicalMarker() {
  return (
    <span aria-label="Injured" className="grid h-4 w-4 place-items-center rounded-sm bg-rose-100 text-rose-700 ring-1 ring-rose-300">
      <Plus className="h-3 w-3" />
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

function SecondYellowMarker() {
  return (
    <span className="relative h-4 w-4" aria-label="Second yellow card">
      <span className="absolute left-0.5 top-1 h-3 w-2 rounded-[2px] bg-yellow-400 shadow-sm" />
      <span className="absolute right-0.5 top-0 h-3 w-2 rounded-[2px] bg-red-600 shadow-sm" />
    </span>
  );
}

function SuspendedMarker() {
  return (
    <span aria-label="Suspended" className="grid h-4 w-4 place-items-center rounded-full bg-rose-100 text-rose-700 ring-1 ring-rose-300">
      <Ban className="h-3 w-3" />
    </span>
  );
}

function SubstitutionCornerMarker({ type }: { type: "in" | "out" }) {
  const isIn = type === "in";

  return (
    <span
      aria-label={isIn ? "Subbed in" : "Subbed out"}
      className={`absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-white shadow-sm ring-1 ring-white/50 ${
        isIn ? "bg-emerald-600" : "bg-red-700"
      }`}
    >
      {isIn ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
    </span>
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
      {!isAway && <UnavailableNumberCircle player={player} />}
      <div className="min-w-0">
        <button
          className="min-w-0 cursor-pointer whitespace-normal break-words text-[11px] font-black leading-[1.05] text-white transition hover:text-[var(--player-team-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:truncate sm:text-sm sm:leading-tight"
          style={{ "--player-team-primary": getNationPrimaryColor(teamName) } as PlayerNameStyle}
          onClick={() => openSquadPlayer(teamName, player.name)}
          type="button"
        >
          <span className="sm:hidden">{formatMobilePlayerName(player.name)}</span>
          <span className="hidden sm:inline">{player.name}</span>
        </button>
        <p className="mt-0.5 truncate text-xs text-white/65">
          {unavailablePlayerPositionLabel(player, teamName)}{player.reason ? ` - ${player.reason}` : ""}
        </p>
      </div>
      {isAway && <UnavailableNumberCircle player={player} />}
    </div>
  );
}

function UnavailableStatusMarker({ player }: { player: MatchUnavailablePlayer }) {
  if (player.status === "suspended") return <SuspendedMarker />;
  if (player.status === "injured") return <MedicalMarker />;
  return <span className="h-2.5 w-2.5 rounded-full bg-white/55" aria-label="Unavailable" />;
}

function UnavailableNumberCircle({ player }: { player: MatchUnavailablePlayer }) {
  return (
    <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-400/80 text-lg font-black tabular-nums text-white shadow-inner sm:h-12 sm:w-12 sm:rounded-xl">
      <span className="absolute -left-1 -top-1">
        <UnavailableStatusMarker player={player} />
      </span>
      {player.shirtNumber ?? "-"}
    </div>
  );
}

function NumberCircle({ player, marks }: { player: MatchLineupPlayer; marks: PlayerEventMarks }) {
  return (
    <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-400/80 text-lg font-black tabular-nums text-white shadow-inner sm:h-12 sm:w-12 sm:rounded-xl">
      <CardEdgeMarkers marks={marks} />
      {marks.injured && (
        <span className="absolute -left-1 -top-1">
          <MedicalMarker />
        </span>
      )}
      {marks.subbedIn && <SubstitutionCornerMarker type="in" />}
      {marks.subbedOut && <SubstitutionCornerMarker type="out" />}
      {player.captain && <CaptainBadge />}
      {player.shirtNumber ?? "-"}
    </div>
  );
}

function CardEdgeMarkers({ marks }: { marks: PlayerEventMarks }) {
  const cards = [
    ...Array.from({ length: marks.yellowCards }, (_, index) => <CardMarker key={`yellow-${index}`} color="yellow" />),
    ...Array.from({ length: marks.secondYellowCards }, (_, index) => <SecondYellowMarker key={`second-yellow-${index}`} />),
    ...Array.from({ length: marks.redCards }, (_, index) => <CardMarker key={`red-${index}`} color="red" />),
  ];

  if (cards.length === 0) return null;

  return (
    <span className="absolute -left-1 top-1/2 z-10 flex -translate-y-1/2 -translate-x-1/2 flex-col items-center gap-0.5">
      {cards}
    </span>
  );
}

function RatingBadge({ rating, playerOfTheMatch }: { rating: number; playerOfTheMatch: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums text-zinc-950 ${
        playerOfTheMatch ? "bg-sky-500" : rating >= 7 ? "bg-emerald-400" : "bg-orange-400"
      }`}
    >
      {rating.toFixed(1)}
      {playerOfTheMatch && <Star className="h-2.5 w-2.5 fill-current" />}
    </span>
  );
}

function CaptainBadge() {
  return (
    <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[9px] font-black text-zinc-950 ring-1 ring-black/20">
      C
    </span>
  );
}

function positionLabel(position?: string | null) {
  const normalized = String(position ?? "").toLowerCase();
  if (normalized === "g" || normalized === "gk" || normalized.includes("goal")) return "Goalkeeper";
  if (normalized === "d" || normalized === "df" || normalized.includes("def") || normalized.includes("back")) return "Defender";
  if (normalized === "m" || normalized === "mf" || normalized.includes("mid")) return "Midfielder";
  if (normalized === "f" || normalized === "fw" || normalized.includes("for") || normalized.includes("str") || normalized.includes("att") || normalized.includes("wing")) return "Forward";
  return position ?? "Player";
}

function playerPositionLabel(player: MatchLineupPlayer, teamName: string) {
  return positionLabel(player.position ?? getRosterPosition(teamName, player.name) ?? positionFromGrid(player.grid));
}

function unavailablePlayerPositionLabel(player: MatchUnavailablePlayer, teamName: string) {
  return positionLabel(player.position ?? getRosterPosition(teamName, player.name));
}

function positionFromGrid(grid?: string | null) {
  const line = Number(String(grid ?? "").split(":")[0]);
  if (!Number.isFinite(line)) return null;
  if (line <= 1) return "G";
  if (line <= 2) return "D";
  if (line <= 3) return "M";
  return "F";
}

function getRosterPosition(teamName: string, playerName: string) {
  const nation = fallbackNations.find((entry) => entry.id === normalizeCountryName(teamName));
  const playerKey = normalizePlayerName(playerName);
  const player = nation?.players.find((entry) => normalizePlayerName(entry.fullName) === playerKey);
  return player?.position ?? null;
}

function getPlayerEventMarks(player: MatchLineupPlayer | undefined, teamName: string, events: MatchEvent[]): PlayerEventMarks {
  const marks: PlayerEventMarks = {
    goals: 0,
    ownGoals: 0,
    assists: 0,
    injured: false,
    suspended: false,
    subbedIn: false,
    subbedOut: false,
    yellowCards: 0,
    secondYellowCards: 0,
    redCards: 0,
  };
  if (!player) return marks;

  const playerKey = normalizePlayerName(player.name);
  const teamKey = normalizeCountryName(teamName);

  for (const event of events) {
    const eventPlayerMatches = Boolean(event.playerName && normalizePlayerName(event.playerName) === playerKey);

    if (eventPlayerMatches && event.eventType === "own_goal") {
      marks.ownGoals += 1;
    }

    const eventTeamKey = event.teamName ? normalizeCountryName(event.teamName) : teamKey;
    if (eventTeamKey !== teamKey) continue;

    if (eventPlayerMatches) {
      if (event.eventType === "goal" || event.eventType === "penalty_goal") marks.goals += 1;
      if (event.eventType === "injury") marks.injured = true;
      if (event.eventType === "yellow_card") marks.yellowCards += 1;
      if (event.eventType === "second_yellow") marks.secondYellowCards += 1;
      if (event.eventType === "red_card") marks.redCards += 1;
      if (event.eventType === "substitution") marks.subbedOut = true;
    }

    if (
      event.eventType === "substitution" &&
      ((event.substitutePlayerName && normalizePlayerName(event.substitutePlayerName) === playerKey) ||
        (event.assistPlayerName && normalizePlayerName(event.assistPlayerName) === playerKey))
    ) {
      marks.subbedIn = true;
    }

    if (
      event.assistPlayerName &&
      (event.eventType === "goal" || event.eventType === "penalty_goal") &&
      normalizePlayerName(event.assistPlayerName) === playerKey
    ) {
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

function getNationPrimaryColor(teamName: string) {
  return nationPrimaryColorById.get(normalizeCountryName(teamName)) ?? "#60a5fa";
}

function formatMobilePlayerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name;

  const surname = parts[parts.length - 1];
  const firstInitial = parts[0]?.[0];
  return firstInitial ? `${firstInitial}. ${surname}` : surname;
}

function normalizePlayerName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
