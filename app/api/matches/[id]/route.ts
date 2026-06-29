/**
 * GET /api/matches/[id]
 * 
 * Get detailed match information including live state and events.
 * 
 * Response:
 * - Match metadata
 * - Current live state (score, minute, period)
 * - All events (goals, cards, subs)
 * - Team information
 * - Competition information
 */

import { NextRequest, NextResponse } from 'next/server';
import { createApiClient } from '@/lib/supabase/api';
import { RedisCache, CACHE_KEYS, CACHE_TTL } from '../../../../services/cache/redis-cache';

const cache = RedisCache.getInstance();

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = createApiClient();

    // Try cache first
    const cacheKey = CACHE_KEYS.matchDetail(id);
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      });
    }

    const { data: match, error: matchError } = await db
      .from('fixture_live_scoreboard_view')
      .select('*')
      .eq('fixture_id', id)
      .single();

    if (matchError) {
      if (matchError.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Match not found' },
          { status: 404 }
        );
      }
      throw matchError;
    }

    const { data: liveState, error: liveStateError } = await db
      .from('live_match_state')
      .select('*')
      .eq('match_id', id)
      .maybeSingle();

    if (liveStateError) {
      throw liveStateError;
    }

    // Fetch recent events
    const { data: events } = await db
      .from('match_events')
      .select('*')
      .eq('match_id', id)
      .order('minute', { ascending: true })
      .limit(100);

    const matchRecord = match as FixtureScoreboardRow;
    const response = {
      id: matchRecord.fixture_id,
      matchId: matchRecord.fixture_id,
      matchDate: matchRecord.match_date,
      matchTime: matchRecord.match_time,
      stage: matchRecord.stage,
      group: matchRecord.group_name,
      homeTeam: matchRecord.home_team,
      awayTeam: matchRecord.away_team,
      stadium: matchRecord.stadium,
      status: matchRecord.status,
      period: matchRecord.phase,
      homeScore: matchRecord.home_score,
      awayScore: matchRecord.away_score,
      minute: matchRecord.minute,
      stoppageTime: matchRecord.stoppage_minute,
      finalScoreConfirmedAt: matchRecord.final_score_confirmed_at,
      updatedAt: matchRecord.updated_at,
      events: events || [],
      live_state: liveState || null,
    };

    // Cache the response
    await cache.set(cacheKey, response, CACHE_TTL.MATCH_STATE);

    return NextResponse.json(response, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Error fetching match:', error);
    return NextResponse.json(
      { error: 'Failed to fetch match details' },
      { status: 500 }
    );
  }
}
