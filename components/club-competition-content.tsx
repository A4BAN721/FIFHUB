"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Search, ShieldAlert, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ClubCompetitionId,
  CompetitionFixture,
  CompetitionOverview,
  CompetitionStats,
  CompetitionStatCategory,
  FotmobTeam,
  TeamSquad,
} from "@/lib/fotmob-competition-types";
import { useLanguage } from "@/components/language-provider";

type ClubCompetitionContentProps = {
  competitionId: ClubCompetitionId;
  activeTab: string;
};

export function ClubCompetitionContent({ competitionId, activeTab }: ClubCompetitionContentProps) {
  if (activeTab === "squads") return <ClubSquads competitionId={competitionId} />;
  if (activeTab === "fixtures") return <ClubFixtures competitionId={competitionId} />;
  if (activeTab === "table") return <ClubTable competitionId={competitionId} />;
  return <ClubStats competitionId={competitionId} />;
}

function ClubSquads({ competitionId }: { competitionId: ClubCompetitionId }) {
  const { data, isLoading, error } = useCompetitionResource<CompetitionOverview>(
    `/api/competitions/${competitionId}`,
  );
  const [search, setSearch] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<FotmobTeam | null>(null);
  const teams = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.teams ?? []).filter((team) => !query || team.name.toLowerCase().includes(query));
  }, [data, search]);

  if (selectedTeam) {
    return <ClubSquadDetail competitionId={competitionId} team={selectedTeam} onBack={() => setSelectedTeam(null)} />;
  }

  return (
    <SectionShell>
      <SectionHeading title="Squads" subtitle={data ? `${data.teams.length} teams · ${data.season}` : "Current season squads"} />
      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search teams" className="pl-9" />
      </div>
      <ResourceState isLoading={isLoading} error={error}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeam(team)}
              className="group flex min-h-40 flex-col items-center justify-center gap-4 rounded-2xl border border-border/60 bg-card/70 p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TeamLogo team={team} className="h-16 w-16 transition-transform group-hover:scale-105" />
              <span className="line-clamp-2 text-sm font-semibold text-foreground">{team.name}</span>
            </button>
          ))}
        </div>
      </ResourceState>
    </SectionShell>
  );
}

function ClubSquadDetail({ competitionId, team, onBack }: { competitionId: ClubCompetitionId; team: FotmobTeam; onBack: () => void }) {
  const { data, isLoading, error } = useCompetitionResource<TeamSquad>(
    `/api/competitions/${competitionId}?section=squad&teamId=${encodeURIComponent(team.id)}`,
  );

  return (
    <SectionShell>
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to squads
      </button>
      <div className="mb-7 flex items-center gap-4">
        <TeamLogo team={team} className="h-16 w-16" />
        <div>
          <h2 className="text-2xl font-bold text-foreground">{team.name}</h2>
          <p className="text-sm text-muted-foreground">Current squad</p>
        </div>
      </div>
      <ResourceState isLoading={isLoading} error={error}>
        {data?.pending ? (
          <PendingPanel title="Squad pending" description={`FotMob has not published a squad for ${team.name} yet. It will appear here automatically when available.`} />
        ) : (
          <div className="space-y-7">
            {data?.groups.map((group) => (
              <section key={group.title}>
                <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">{group.title}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.players.map((player) => (
                    <article key={player.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/65 p-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-black text-muted-foreground">
                        {player.shirtNumber ?? <UserRound className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate font-semibold text-foreground">{player.name}</h4>
                        <p className="truncate text-xs text-muted-foreground">
                          {[player.position, player.country, player.age != null ? `Age ${player.age}` : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </ResourceState>
    </SectionShell>
  );
}

function ClubFixtures({ competitionId }: { competitionId: ClubCompetitionId }) {
  const { language } = useLanguage();
  const { data, isLoading, error } = useCompetitionResource<CompetitionOverview>(`/api/competitions/${competitionId}`);
  const [search, setSearch] = useState("");
  const [round, setRound] = useState("ALL");
  const rounds = useMemo(() => [...new Set((data?.fixtures ?? []).map((fixture) => fixture.round).filter(Boolean))], [data]);
  const fixtures = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.fixtures ?? []).filter((fixture) => {
      const matchesSearch = !query || fixture.home.name.toLowerCase().includes(query) || fixture.away.name.toLowerCase().includes(query);
      return matchesSearch && (round === "ALL" || fixture.round === round);
    });
  }, [data, round, search]);
  const groups = useMemo(() => groupFixturesByDate(fixtures), [fixtures]);

  return (
    <SectionShell>
      <SectionHeading title="Fixtures" subtitle={data ? `${data.fixtures.length} matches · ${data.season}` : "Current season fixtures"} />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search teams" className="pl-9" />
        </div>
        <select value={round} onChange={(event) => setRound(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
          <option value="ALL">All rounds</option>
          {rounds.map((value) => <option key={value} value={value}>Round {value}</option>)}
        </select>
      </div>
      <ResourceState isLoading={isLoading} error={error}>
        <div className="space-y-6">
          {groups.map(([date, matches]) => (
            <section key={date}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                {formatFixtureDate(date, language)}
              </h3>
              <div className="overflow-hidden rounded-xl border border-border/60 bg-card/65">
                {matches.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} language={language} />)}
              </div>
            </section>
          ))}
          {!isLoading && groups.length === 0 ? <EmptyPanel text="No fixtures match your filters." /> : null}
        </div>
      </ResourceState>
    </SectionShell>
  );
}

function FixtureRow({ fixture, language }: { fixture: CompetitionFixture; language: string }) {
  const kickoff = fixture.utcTime ? new Date(fixture.utcTime) : null;
  return (
    <article className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border/50 px-3 py-4 last:border-b-0 sm:gap-5 sm:px-5">
      <div className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span className="truncate text-sm font-semibold">{fixture.home.name}</span>
        <TeamLogo team={fixture.home} className="h-8 w-8 shrink-0" />
      </div>
      <div className="min-w-20 text-center">
        {fixture.started ? (
          <div className="text-lg font-black tabular-nums">{fixture.score ?? "—"}</div>
        ) : (
          <div className="text-sm font-bold tabular-nums">{kickoff ? kickoff.toLocaleTimeString(language === "bn" ? "bn-BD" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "TBD"}</div>
        )}
        <div className={`mt-0.5 text-[10px] font-bold uppercase ${fixture.started && !fixture.finished ? "text-emerald-500" : "text-muted-foreground"}`}>{fixture.status}</div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <TeamLogo team={fixture.away} className="h-8 w-8 shrink-0" />
        <span className="truncate text-sm font-semibold">{fixture.away.name}</span>
      </div>
    </article>
  );
}

function ClubTable({ competitionId }: { competitionId: ClubCompetitionId }) {
  const { data, isLoading, error } = useCompetitionResource<CompetitionOverview>(`/api/competitions/${competitionId}`);
  return (
    <SectionShell>
      <SectionHeading title="Table" subtitle={data?.season ?? "Current season standings"} />
      <ResourceState isLoading={isLoading} error={error}>
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/65">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-border/60 bg-muted/45 text-xs uppercase text-muted-foreground">
              <tr><th className="w-12 px-3 py-3 text-center">#</th><th className="px-3 py-3 text-left">Team</th><th className="px-2 py-3 text-center">P</th><th className="px-2 py-3 text-center">W</th><th className="px-2 py-3 text-center">D</th><th className="px-2 py-3 text-center">L</th><th className="px-2 py-3 text-center">GF</th><th className="px-2 py-3 text-center">GA</th><th className="px-2 py-3 text-center">GD</th><th className="px-3 py-3 text-center">Pts</th></tr>
            </thead>
            <tbody>
              {data?.standings.map((row) => (
                <tr key={row.team.id} className="border-b border-border/45 last:border-b-0 hover:bg-muted/35">
                  <td className="relative px-3 py-3 text-center font-bold">{row.qualificationColor ? <span className="absolute inset-y-2 left-0 w-1 rounded-r" style={{ backgroundColor: row.qualificationColor }} /> : null}{row.position}</td>
                  <td className="px-3 py-3"><div className="flex items-center gap-3"><TeamLogo team={row.team} className="h-7 w-7" /><span className="font-semibold">{row.team.name}</span></div></td>
                  <td className="px-2 py-3 text-center">{row.played}</td><td className="px-2 py-3 text-center">{row.wins}</td><td className="px-2 py-3 text-center">{row.draws}</td><td className="px-2 py-3 text-center">{row.losses}</td><td className="px-2 py-3 text-center">{row.goalsFor}</td><td className="px-2 py-3 text-center">{row.goalsAgainst}</td><td className="px-2 py-3 text-center">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td><td className="px-3 py-3 text-center font-black">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ResourceState>
    </SectionShell>
  );
}

function ClubStats({ competitionId }: { competitionId: ClubCompetitionId }) {
  const { data, isLoading, error } = useCompetitionResource<CompetitionStats>(`/api/competitions/${competitionId}?section=stats`);
  const [activeCategory, setActiveCategory] = useState("");
  const category = data?.categories.find((entry) => entry.id === activeCategory) ?? data?.categories[0];

  return (
    <SectionShell>
      <SectionHeading title="Stats" subtitle={data?.season ?? "Current season player leaders"} />
      <ResourceState isLoading={isLoading} error={error}>
        {data?.pending ? <PendingPanel title="Stats pending" description="FotMob has not published player statistics for this competition stage yet. They will appear automatically when available." /> : null}
        {data && !data.pending ? (
          <>
            <Tabs value={category?.id ?? ""} onValueChange={setActiveCategory}>
              <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start rounded-none border-b border-border/50 bg-transparent p-0">
                {data.categories.map((entry) => <TabsTrigger key={entry.id} value={entry.id} className="min-h-11 flex-none rounded-none border-b-2 border-transparent bg-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">{entry.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            {category ? <StatsTable category={category} /> : null}
          </>
        ) : null}
      </ResourceState>
    </SectionShell>
  );
}

function StatsTable({ category }: { category: CompetitionStatCategory }) {
  if (category.rows.length === 0) {
    return <EmptyPanel text={`${category.label} data is not available from FotMob for this competition yet.`} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card/65">
      <div className="grid grid-cols-[48px_1fr_auto] gap-3 border-b border-border/60 bg-muted/45 px-4 py-3 text-xs font-bold uppercase text-muted-foreground"><span>Rank</span><span>Player</span><span>{category.label}</span></div>
      {category.rows.map((row) => (
        <div key={`${category.id}-${row.playerId}`} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-b border-border/45 px-4 py-3 last:border-b-0">
          <span className="text-center text-sm font-black">{row.rank}</span>
          <div className="flex min-w-0 items-center gap-3"><TeamLogo team={{ id: row.teamId, name: row.teamName, shortName: row.teamName }} className="h-8 w-8" /><div className="min-w-0"><div className="truncate font-semibold">{row.playerName}</div><div className="truncate text-xs text-muted-foreground">{row.teamName}</div></div></div>
          <span className="font-black tabular-nums">{formatStatValue(row.value, category.valueFormat)}</span>
        </div>
      ))}
    </div>
  );
}

function TeamLogo({ team, className }: { team: FotmobTeam; className: string }) {
  return <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${team.id}.png`} alt="" width={80} height={80} unoptimized className={`${className} object-contain`} />;
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl px-2 py-4 sm:px-4">{children}</div>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="mb-5"><h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p></div>;
}

function ResourceState({ isLoading, error, children }: { isLoading: boolean; error: string | null; children: React.ReactNode }) {
  if (isLoading) return <div className="grid min-h-56 place-items-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>;
  if (error) return <PendingPanel title="Unable to load data" description={error} />;
  return <>{children}</>;
}

function PendingPanel({ title, description }: { title: string; description: string }) {
  return <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border bg-card/45 p-8 text-center"><div><ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-bold text-foreground">{title}</h3><p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{description}</p></div></div>;
}

function EmptyPanel({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function useCompetitionResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `Request failed with ${response.status}`);
        return payload as T;
      })
      .then((payload) => setData(payload))
      .catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load data"); })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [url]);
  return { data, isLoading, error };
}

function groupFixturesByDate(fixtures: CompetitionFixture[]) {
  const groups = new Map<string, CompetitionFixture[]>();
  for (const fixture of fixtures) {
    const date = fixture.utcTime ? fixture.utcTime.slice(0, 10) : "TBD";
    groups.set(date, [...(groups.get(date) ?? []), fixture]);
  }
  return [...groups.entries()];
}

function formatFixtureDate(value: string, language: string) {
  if (value === "TBD") return value;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(language === "bn" ? "bn-BD" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function formatStatValue(value: number, format: CompetitionStatCategory["valueFormat"]) {
  if (format === "rating") return value.toFixed(2);
  if (format === "distance") return `${Math.round(value).toLocaleString()} m`;
  return Math.round(value).toLocaleString();
}
