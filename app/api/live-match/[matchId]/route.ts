import { NextResponse } from "next/server";
import { getFotmobLiveRefresh } from "@/lib/live-data/fotmob-live-refresh";
import { createServerFootballProvider } from "@/lib/live-data/server-provider";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ matchId: string }> | { matchId: string };
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { matchId } = await Promise.resolve(params);

  if (!matchId) {
    return NextResponse.json({ error: "Missing match id" }, { status: 400 });
  }

  try {
    const provider = await createServerFootballProvider();

    if (!provider) {
      return NextResponse.json({ error: "Live data provider is not configured" }, { status: 503 });
    }

    const match = await provider.getLiveMatch(matchId);

    if (!match) {
      return NextResponse.json({ match: null }, { status: 404 });
    }

    const refreshedMatch = await getFotmobLiveRefresh(match);

    return NextResponse.json(
      { match: refreshedMatch ?? match },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
          "Surrogate-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load live match:", error);
    return NextResponse.json({ error: "Failed to load live match" }, { status: 500 });
  }
}
