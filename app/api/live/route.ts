/**
 * GET /api/live
 * 
 * Get all currently live matches with current scores and state.
 * Fast endpoint optimized for the scoreboard component.
 * Always returns from cache if available.
 * 
 * Response:
 * - List of live matches with minimal data
 * - Current scores
 * - Current minute and period
 * - Last significant event
 * - Match status
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RedisCache, CACHE_KEYS, CACHE_TTL } from '../../../services/cache/redis-cache';

// Initialize Supabase client - these env vars MUST be set at runtime
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: ReturnType<typeof createClient> | null = null;

// Initialize cache (will use in-memory fallback if Redis unavailable)
const cache = RedisCache.getInstance();

type FixtureScoreboardRow = {
  fixture_id: string;
  status: string;
  phase: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  minute: number | null;
  stoppage_minute: number | null;
  stage: string;
  group_name: string | null;
  updated_at: string | null;
};

function getSupabase() {
  if (!supabase) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required Supabase configuration. Check your environment variables.');
    }
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const competition = searchParams.get('competition');

  try {
    const db = getSupabase();

    // Try cache first
    const cacheKey = `${CACHE_KEYS.liveMatches}:${competition || 'all'}`;
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        },
      });
    }

    // Query live/active matches from the fixture-backed scoreboard view.
    let query = db
      .from('fixture_live_scoreboard_view')
      .select('*')
      .in('status', ['live', 'half_time', 'extra_time', 'penalties'])
      .order('fixture_id', { ascending: true });

    if (competition) {
      query = query.eq('stage', competition);
    }

    const { data: matches, error } = await query;

    if (error) {
      console.error('Error fetching live matches:', error);
      return NextResponse.json(
        { error: 'Failed to fetch live matches' },
        { status: 500 }
      );
    }

    // Transform to minimal response format
    const liveMatches = ((matches || []) as FixtureScoreboardRow[]).map((match) => ({
      id: match.fixture_id,
      matchId: match.fixture_id,
      status: match.status,
      period: match.phase,
      homeTeam: {
        name: match.home_team,
        logo: null,
        score: match.home_score,
      },
      awayTeam: {
        name: match.away_team,
        logo: null,
        score: match.away_score,
      },
      minute: match.minute,
      stoppageTime: match.stoppage_minute,
      lastEvent: null,
      competition: match.stage,
      stage: match.stage,
      group: match.group_name,
      updatedAt: match.updated_at,
    }));

    const response = {
      matches: liveMatches,
      count: liveMatches.length,
      timestamp: new Date().toISOString(),
    };

    // Cache for 15 seconds
    await cache.set(cacheKey, response, CACHE_TTL.LIVE_SCORE);

    return NextResponse.json(response, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
