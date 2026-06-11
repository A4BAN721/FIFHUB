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

function getSupabase() {
  if (!supabase) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
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

    // Query live matches from view
    let query = db
      .from('live_matches_view')
      .select('*')
      .order('kickoff_time', { ascending: true });

    if (competition) {
      query = query.eq('competition_name', competition);
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
    const liveMatches = (matches || []).map((match: any) => ({
      id: match.id,
      status: match.status,
      period: match.period,
      homeTeam: {
        name: match.home_team_name,
        logo: match.home_team_logo,
        score: match.home_score,
      },
      awayTeam: {
        name: match.away_team_name,
        logo: match.away_team_logo,
        score: match.away_score,
      },
      minute: match.minute,
      stoppageTime: match.stoppage_time,
      lastEvent: match.last_event_type,
      competition: match.competition_name,
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