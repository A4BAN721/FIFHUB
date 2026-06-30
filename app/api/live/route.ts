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
import { normalizeMatchPhase, normalizeMatchStatus } from '@/lib/live-data/status';
import { createApiClient } from '@/lib/supabase/api';
import { RedisCache, CACHE_KEYS, CACHE_TTL } from '../../../services/cache/redis-cache';

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
  home_penalty_score: number | null;
  away_penalty_score: number | null;
  minute: number | null;
  stoppage_minute: number | null;
  stage: string;
  group_name: string | null;
  updated_at: string | null;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const competition = searchParams.get('competition');
  const fresh = searchParams.get('fresh') === '1' || searchParams.get('fresh') === 'true';

  try {
    const db = createApiClient();

    // Try cache first
    const cacheKey = `${CACHE_KEYS.liveMatches}:${competition || 'all'}`;
    const cached = fresh ? null : await cache.get(cacheKey);
    
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
    const liveMatches = ((matches || []) as FixtureScoreboardRow[])
      .filter(isActiveScoreboardMatch)
      .map((match) => ({
      id: match.fixture_id,
      matchId: match.fixture_id,
      status: normalizeMatchStatus(match.status),
      period: normalizeMatchPhase(match.phase || match.status),
      homeTeam: {
        name: match.home_team,
        logo: null,
        score: match.home_score,
        penaltyScore: match.home_penalty_score,
      },
      awayTeam: {
        name: match.away_team,
        logo: null,
        score: match.away_score,
        penaltyScore: match.away_penalty_score,
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
    if (!fresh) {
      await cache.set(cacheKey, response, CACHE_TTL.LIVE_SCORE);
    }

    return NextResponse.json(response, {
      headers: {
        'X-Cache': fresh ? 'BYPASS' : 'MISS',
        'Cache-Control': fresh ? 'no-store, no-cache, must-revalidate' : 'public, s-maxage=15, stale-while-revalidate=30',
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

function isActiveScoreboardMatch(match: FixtureScoreboardRow): boolean {
  const status = normalizeMatchStatus(match.status);
  const phase = normalizeMatchPhase(match.phase || match.status);

  return (
    status === 'live' ||
    status === 'half_time' ||
    status === 'extra_time' ||
    status === 'penalties' ||
    phase === 'first_half' ||
    phase === 'half_time' ||
    phase === 'second_half' ||
    phase === 'extra_time' ||
    phase === 'penalties'
  );
}
