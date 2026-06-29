/**
 * GET /api/matches
 * 
 * Get all matches (live, scheduled, finished)
 * Supports query parameters for filtering
 * 
 * Query Parameters:
 * - status: Filter by status (live, scheduled, finished)
 * - date: Filter by date (YYYY-MM-DD)
 * - competition: Filter by competition ID
 * - team: Filter by team ID
 * 
 * Response comes from cache when possible.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createApiClient } from '@/lib/supabase/api';
import { RedisCache, CACHE_TTL } from '../../../services/cache/redis-cache';

// Initialize cache (will use in-memory fallback if Redis unavailable)
const cache = RedisCache.getInstance({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  keyPrefix: 'fifhub:',
});

type FixtureScoreboardRow = {
  fixture_id: string;
  match_date: string;
  match_time: string;
  stage: string;
  group_name: string | null;
  home_team: string;
  away_team: string;
  stadium: string;
  status: string;
  phase: string;
  home_score: number;
  away_score: number;
  minute: number | null;
  stoppage_minute: number | null;
  final_score_confirmed_at: string | null;
  updated_at: string | null;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const date = searchParams.get('date');
  const competition = searchParams.get('competition');
  const team = searchParams.get('team');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const fresh = searchParams.get('fresh') === '1' || searchParams.get('fresh') === 'true';

  // Build cache key from query params
  const cacheKey = `api:matches:${status || 'all'}:${date || ''}:${competition || ''}:${team || ''}:${limit}:${offset}`;

  try {
    // Try cache first
    const cached = fresh ? null : await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        },
      });
    }

    const db = createApiClient();

    // Build query from the fixture-backed live scoreboard contract.
    let query = db
      .from('fixture_live_scoreboard_view')
      .select('*')
      .order('fixture_id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (status) {
      const statuses = status.split(',');
      query = query.in('status', statuses);
    }

    if (date) {
      query = query.ilike('match_date', `%${date}%`);
    }

    if (competition) {
      query = query.eq('stage', competition);
    }

    if (team) {
      query = query.or(`home_team.eq.${team},away_team.eq.${team}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Database query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch matches' },
        { status: 500 }
      );
    }

    const matches = ((data || []) as FixtureScoreboardRow[]).map((match) => ({
      id: match.fixture_id,
      matchId: match.fixture_id,
      matchDate: match.match_date,
      matchTime: match.match_time,
      stage: match.stage,
      group: match.group_name,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      stadium: match.stadium,
      status: match.status,
      period: match.phase,
      homeScore: match.home_score,
      awayScore: match.away_score,
      minute: match.minute,
      stoppageTime: match.stoppage_minute,
      finalScoreConfirmedAt: match.final_score_confirmed_at,
      updatedAt: match.updated_at,
    }));

    const response = {
      matches,
      count: matches.length,
      limit,
      offset,
    };

    // Cache the response
    if (!fresh) {
      await cache.set(cacheKey, response, CACHE_TTL.MATCH_LIST);
    }

    return NextResponse.json(response, {
      headers: {
        'X-Cache': fresh ? 'BYPASS' : 'MISS',
        'Cache-Control': fresh ? 'no-store' : 'public, s-maxage=15, stale-while-revalidate=30',
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
