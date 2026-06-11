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
import { createClient } from '@supabase/supabase-js';
import { RedisCache, CACHE_KEYS, CACHE_TTL } from '../../../../services/cache/redis-cache';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: ReturnType<typeof createClient> | null = null;

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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    const db = getSupabase();

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

    // Fetch match with all related data
    const { data: match, error: matchError } = await db
      .from('matches')
      .select(`
        *,
        home_team:teams!home_team_id(*),
        away_team:teams!away_team_id(*),
        competition:competitions(*),
        venue:venues(*),
        live_state:live_match_state(*)
      `)
      .eq('id', id)
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

    // Fetch recent events
    const { data: events } = await db
      .from('match_events')
      .select('*')
      .eq('match_id', id)
      .order('minute', { ascending: true })
      .limit(100);

    const response = {
      ...match,
      events: events || [],
      live_state: match.live_state || null,
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