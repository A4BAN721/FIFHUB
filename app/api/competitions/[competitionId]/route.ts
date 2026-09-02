import { NextRequest, NextResponse } from "next/server";
import {
  getCompetitionOverview,
  getCompetitionStats,
  getTeamSquad,
  isClubCompetitionId,
} from "@/lib/fotmob-competition-data";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ competitionId: string }> },
) {
  const { competitionId } = await params;
  if (!isClubCompetitionId(competitionId)) {
    return NextResponse.json({ error: "Unsupported competition" }, { status: 404 });
  }

  const section = request.nextUrl.searchParams.get("section") ?? "overview";

  try {
    const data = section === "stats"
      ? await getCompetitionStats(competitionId)
      : section === "squad"
        ? await getTeamSquad(competitionId, request.nextUrl.searchParams.get("teamId") ?? "")
        : await getCompetitionOverview(competitionId);

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load competition data";
    const status = message.includes("does not belong") ? 400 : 502;
    console.error(`Failed to load ${competitionId} ${section}.`, error);
    return NextResponse.json({ error: message }, { status });
  }
}

