/**
 * GET /api/matches/[id]/events
 * 
 * Get all events for a specific match.
 * Events are ordered by minute.
 * 
 * Response:
 * - Goal events with scorers and assists
 * - Card events (yellow/red)
 * - Substitution events
 * - VAR decisions
 * - Status change events (halftime, fulltime, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createApiClient } from '@/lib/supabase/api';
import { RedisCache, CACHE_KEYS, CACHE_TTL } from '../../../../../services/cache/redis-cache';

const cache = RedisCache.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const eventType = searchParams.get('type');
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    const db = createApiClient();

    // Build cache key
    const cacheKey = `${CACHE_KEYS.matchEventList(id)}:${eventType || 'all'}:${limit}:${offset}`;
    
    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      });
    }

    // Build query
    let query = db
      .from('match_events')
      .select('*')
      .eq('match_id', id)
      .order('minute', { ascending: true })
      .range(offset, offset + limit);

    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error('Error fetching events:', error);
      return NextResponse.json(
        { error: 'Failed to fetch match events' },
        { status: 500 }
      );
    }

    const response = {
      events: events || [],
      count: events?.length || 0,
      limit,
      offset,
    };

    // Cache the response
    await cache.set(cacheKey, response, CACHE_TTL.MATCH_EVENTS);

    return NextResponse.json(response, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
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
