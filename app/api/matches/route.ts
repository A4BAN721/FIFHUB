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
import { createClient } from '@supabase/supabase-js';
import { RedisCache, CACHE_KEYS, CACHE_TTL } from '../../../services/cache/redis-cache';

// Initialize cache (will use in-memory fallback if Redis unavailable)
const cache = RedisCache.getInstance({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  keyPrefix: 'fifhub:',
});

let supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    }
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const date = searchParams.get('date');
  const competition = searchParams.get('competition');
  const team = searchParams.get('team');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  // Build cache key from query params
  const cacheKey = `api:matches:${status || 'all'}:${date || ''}:${competition || ''}:${team || ''}:${limit}:${offset}`;

  try {
    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        },
      });
    }

    const db = getSupabase();

    // Build query
    let query = db
      .from('live_matches_view')
      .select('*')
      .order('kickoff_time', { ascending: true })
      .range(offset, offset + limit);

    if (status) {
      const statuses = status.split(',');
      query = query.in('status', statuses);
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      query = query
        .gte('kickoff_time', startDate.toISOString())
        .lt('kickoff_time', endDate.toISOString());
    }

    if (competition) {
      query = query.eq('competition_name', competition);
    }

    if (team) {
      query = query.or(`home_team_name.eq.${team},away_team_name.eq.${team}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Database query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch matches' },
        { status: 500 }
      );
    }

    const response = {
      matches: data || [],
      count: data?.length || 0,
      limit,
      offset,
    };

    // Cache the response
    await cache.set(cacheKey, response, CACHE_TTL.MATCH_LIST);

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