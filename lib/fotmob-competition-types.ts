import type { CompetitionId } from "@/components/competition-sidebar";

export type ClubCompetitionId = Exclude<CompetitionId, "fifa-world-cup">;

export type FotmobTeam = {
  id: string;
  name: string;
  shortName: string;
};

export type CompetitionFixture = {
  id: string;
  round: string;
  home: FotmobTeam;
  away: FotmobTeam;
  utcTime: string;
  started: boolean;
  finished: boolean;
  cancelled: boolean;
  score: string | null;
  status: string;
};

export type CompetitionStanding = {
  position: number;
  team: FotmobTeam;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  qualificationColor: string | null;
};

export type CompetitionOverview = {
  competitionId: ClubCompetitionId;
  name: string;
  season: string;
  teams: FotmobTeam[];
  fixtures: CompetitionFixture[];
  standings: CompetitionStanding[];
  updatedAt: string;
};

export type SquadPlayer = {
  id: string;
  name: string;
  role: string;
  position: string;
  shirtNumber: number | null;
  age: number | null;
  height: number | null;
  country: string | null;
  countryCode: string | null;
};

export type TeamSquad = {
  team: FotmobTeam;
  pending: boolean;
  groups: Array<{ title: string; players: SquadPlayer[] }>;
  updatedAt: string;
};

export type CompetitionStatRow = {
  rank: number;
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  value: number;
  subValue: number | null;
  countryCode: string | null;
};

export type CompetitionStatCategory = {
  id: string;
  label: string;
  valueFormat: "number" | "rating" | "distance";
  rows: CompetitionStatRow[];
};

export type CompetitionStats = {
  competitionId: ClubCompetitionId;
  season: string;
  pending: boolean;
  categories: CompetitionStatCategory[];
  updatedAt: string;
};

