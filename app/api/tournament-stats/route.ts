import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 1000;

type EventRow = {
  match_id?: string | null;
  provider?: string | null;
  event_type: string;
  team_name: string | null;
  player_name: string | null;
  assist_player_name: string | null;
  minute?: number | null;
};

type LineupRow = {
  lineups: unknown;
};

export async function GET() {
  try {
    const supabase = createApiClient();
    const [events, lineupRows] = await Promise.all([
      fetchAllRows<EventRow>((from, to) =>
        supabase
          .from("match_events")
          .select("match_id,provider,event_type,team_name,player_name,assist_player_name,minute")
          .order("match_id", { ascending: true })
          .order("minute", { ascending: true, nullsFirst: false })
          .range(from, to),
      ),
      fetchAllRows<LineupRow>((from, to) =>
        supabase
          .from("live_match_state")
          .select("lineups")
          .not("lineups", "is", null)
          .range(from, to),
      ),
    ]);

    return NextResponse.json(
      {
        events,
        lineupRows,
        updatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load tournament stats.", error);
    return NextResponse.json(
      { error: "Failed to load tournament stats." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}
