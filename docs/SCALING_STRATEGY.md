# Scaling Strategy: ESPN-Style Live Football Data Architecture

## Overview

This document outlines the scaling strategy for the live football data architecture, designed to grow from 1,000 to 1M+ concurrent users while maintaining real-time performance and reliability.

---

## Phase 1: 1,000 Concurrent Users (MVP/Local Development)

### Architecture
```
Next.js (App Router)
├── API Routes (Edge)
├── Supabase (Database + Realtime)
└── Redis (In-Memory Cache)

Clients: Single Next.js server
Database: Single Supabase instance
Cache: Local Redis instance
```

### Configuration
- **Next.js**: Single server, no edge functions
- **Supabase**: Free tier (2GB database, 5GB bandwidth)
- **Redis**: Local installation or Upstash free tier
- **CDN**: Vercel's built-in CDN

### Database
- Single PostgreSQL instance
- Connection pooling: 5-10 connections
- Query timeouts: 5 seconds
- Read replicas: None

### Cache Strategy
- In-memory fallback always enabled
- Redis TTL: 15-60 seconds
- Cache hit ratio target: 70%

### Cost Estimate
- Hosting: $20/month (Vercel Pro + Supabase Pro)
- Redis: Free (Upstash)
- CDN: Included with Vercel

---

## Phase 2: 100,000 Concurrent Users (Regional Scale)

### Architecture
```
┌─────────────────────────────────────────┐
│              Load Balancer              │
├──────────────────┬──────────────────────┤
│  Next.js Edge 1  │  Next.js Edge 2     │
├──────────────────┴──────────────────────┤
│            API Gateway                  │
├──────────────────┬──────────────────────┤
│  Supabase Primary│  Supabase Replica    │
├──────────────────┴──────────────────────┤
│            Redis Cluster                │
├──────────────────┬──────────────────────┤
│  Worker 1        │  Worker 2           │
└──────────────────┴──────────────────────┘
```

### Key Changes from Phase 1

#### Compute
- **Next.js**: Deploy to multiple regions (US, EU, Asia)
- **Edge Functions**: Move critical API routes to edge
- **Workers**: Dedicated ingestion workers (2-4 instances)

#### Database
- **Supabase**: Pro/Team tier with read replicas
- **Read Replicas**: 2-3 regional replicas
- **Connection Pooling**: PgBouncer with 50-100 connections
- **Query Optimization**: 
  - Materialized views for live scores
  - Partial indexes on match status
  - Query result caching

#### Cache
- **Redis Cluster**: 3-5 nodes
- **Cache Strategy**:
  ```
  Live scores: 15s TTL
  Match state: 30s TTL  
  Events: 60s TTL
  API responses: 15s TTL
  Team/Competition data: 5-10 min TTL
  ```
- **Cache Invalidation**: Event-driven invalidation

#### Realtime
- **Supabase Realtime**: Dedicated channels per match
- **Channel Distribution**: 
  - Match-specific channels: `match:{id}`
  - Competition channels: `competition:{id}`
  - Global live channel: `live-scores`
- **Connection Management**: Max 1000 connections per channel

#### CDN
- **Provider**: Vercel Edge Network or Cloudflare
- **Cache Rules**:
  ```nginx
  /api/live: 15s cache, 30s stale-while-revalidate
  /api/matches: 30s cache, 60s stale-while-revalidate
  /api/matches/{id}: 60s cache
  /api/matches/{id}/events: 60s cache
  ```

### Monitoring
- **Health Checks**: Every 15-30 seconds per component
- **Alerting**: PagerDuty/Discord webhooks for critical alerts
- **Metrics**: Response times, error rates, cache hit ratios
- **Logging**: Structured logging with correlation IDs

### Cost Estimate
- Hosting: $500-1000/month
- Database: $200-500/month (Supabase Pro)
- Redis: $100-300/month (Upstash)
- CDN: $100-200/month
- Workers: $100-200/month

---

## Phase 3: 1,000,000+ Concurrent Users (World Cup Scale)

### Architecture
```
┌─────────────────────────────────────────────────────┐
│                  Global Load Balancer               │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│  Region 1│  Region 2│  Region 3│  Region 4│  Region 5│
├──────────┴──────────┴──────────┴──────────┴─────────┤
│               Kafka Event Bus                       │
├─────────────────────────────────────────────────────┤
│  Event Consumers (Auto-scaling)                     │
├─────────────────────────────────────────────────────┤
│  WebSocket Gateway (Dedicated Servers)              │
├─────────────────────────────────────────────────────┤
│  Database Cluster                                   │
│  ├── Primary (Write)                                │
│  ├── Replica 1-5 (Read)                            │
│  └── Geo-distributed replicas                      │
├─────────────────────────────────────────────────────┤
│  Redis Cluster (Global)                             │
│  ├── Cache layer                                    │
│  ├── Rate limiter                                    │
│  └── Session store                                  │
├─────────────────────────────────────────────────────┤
│  CDN (Global, Multi-region)                         │
└─────────────────────────────────────────────────────┘
```

### Key Changes from Phase 2

#### Event Bus (Kafka)
Kafka replaces in-process event queuing for true event-driven architecture.

**Topics**:
```
raw-matches        → Partition by provider
normalized-events  → Partition by match_id  
match-events       → Partition by match_id
realtime-broadcast → Partition by region
dead-letter-queue  → Single partition
```

**Consumer Groups**:
```
ingestion-workers    → 10-20 consumers
event-processors     → 20-50 consumers  
realtime-publishers  → 10-30 consumers
analytics-processors → 5-10 consumers
```

**Kafka Configuration**:
- Cluster: 3-5 brokers per region
- Replication factor: 3
- Retention: 7 days
- Compression: Snappy

#### WebSocket Gateway
Dedicated WebSocket servers for real-time connections.

**Architecture**:
```
                ┌────────────────────────┐
                │   Load Balancer (TCP)  │
                └───────────┬────────────┘
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  WS Server 1 │   │  WS Server 2 │   │  WS Server N │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ▼
               ┌──────────────────┐
               │   Redis Pub/Sub  │
               │  (Cross-region)  │
               └──────────────────┘
```

**Scaling**:
- Each server: 10,000 concurrent connections
- Auto-scaling: 80% CPU threshold
- Sticky sessions via Redis
- Connection health checks every 30s

#### Database Cluster

**Sharding Strategy**:
```
Matches: Hash by match_id (64 shards)
Events: Hash by match_id (64 shards)
Teams/Players: Global (replicated)
```

**Read Replicas**:
- 5 regional replicas (US, EU, Asia, South America, Oceania)
- Automated failover
- 1 second replication lag max

**Connection Pooling**:
- PgBouncer: 200-500 connections per instance
- Application-side pool: 20-50 connections

#### Global CDN Strategy

**Cache Tiers**:
```
Tier 1 (Edge): Static assets, team logos
Tier 2 (Regional): API responses, match data
Tier 3 (Origin): WebSocket connections, dynamic data
```

**Cache Invalidation**:
- Real-time invalidation via Supabase Realtime
- Cache tags for batch invalidation
- Stale-while-revalidate for degraded mode

### Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| API Response Time | < 50ms p95 | From cache |
| Realtime Latency | < 500ms | Goal to client |
| Event Processing | < 100ms | Through pipeline |
| Database Queries | < 10ms p95 | Cached queries |
| Uptime | 99.99% | Production |
| Cache Hit Ratio | > 90% | Redis + CDN |

### World Cup Traffic Spikes

**Expected Load**:
- Concurrent users: 2-5 million during peak matches
- API requests: 50,000-100,000 req/s
- Realtime connections: 500,000-1,000,000
- Database writes: 10,000-20,000 writes/s (event updates)

**Mitigation Strategies**:

1. **Pre-warming**: Cache all match data 1 hour before kickoff
2. **Graceful Degradation**: 
   - Disable advanced stats during peak
   - Increase cache TTLs
   - Throttle non-critical updates
3. **Auto-scaling**:
   - Pre-define scaling policies for match times
   - 30-minute warm-up period
   - Regional isolation for match-specific traffic
4. **Rate Limiting**:
   - Per-client: 100 req/s
   - Per-IP: 500 req/s  
   - Global: 100,000 req/s
5. **Circuit Breakers**:
   - Database: Open at 100 concurrent queries
   - Cache: Open at 50ms response time
   - Provider: Open at 5 consecutive failures

### Cost Estimate
- Hosting: $20,000-50,000/month
- Database: $5,000-10,000/month
- Kafka: $3,000-5,000/month
- Redis: $2,000-4,000/month
- CDN: $5,000-10,000/month
- WebSocket Servers: $3,000-6,000/month
- Staff: 3-5 SREs during World Cup

---

## Failure Mode Analysis

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Provider API Down | No new match data | Fallback to secondary provider; serve cached data |
| Database Failure | Cannot save/query matches | Redis cache serves reads; Kafka queues writes |
| Redis Down | Cache misses | In-memory fallback; direct DB queries |
| Realtime Disconnect | Stale client data | Client auto-reconnect with backoff; REST API fallback |
| Network Partition | Event ordering issues | Kafka ensures ordered delivery; idempotent events |
| Traffic Spike | Increased latency | Auto-scaling; rate limiting; graceful degradation |

---

## Implementation Checklist by Phase

### Phase 1
- [x] Basic Next.js application
- [x] Supabase database schema
- [x] Redis cache layer (with in-memory fallback)
- [x] REST API routes
- [x] Basic realtime subscriptions

### Phase 2
- [ ] Deploy to multiple regions
- [ ] Set up read replicas
- [ ] Configure Redis cluster
- [ ] Implement CDN caching
- [ ] Add health monitoring
- [ ] Set up alerting

### Phase 3
- [ ] Deploy Kafka cluster
- [ ] Set up WebSocket gateway
- [ ] Implement database sharding
- [ ] Configure global CDN
- [ ] Auto-scaling policies
- [ ] Chaos engineering testing

---

## Monitoring & Observability

### Key Metrics to Track

**Application**:
```
- Request rate (req/s)
- Response time (p50, p95, p99)
- Error rate (%)
- Active connections
- Event processing latency
```

**Database**:
```
- Query performance (slow queries)
- Connection pool utilization
- Replication lag
- Cache hit ratio
```

**Infrastructure**:
```
- CPU/memory utilization
- Network bandwidth
- Disk I/O
- Auto-scaling events
```

### Dashboards
- Grafana dashboards for each component
- Real-time alerting via PagerDuty
- Weekly performance reports
- Capacity planning reviews

---

## Clean Architecture Principles

The system is built using Clean Architecture, ensuring every layer can be replaced independently:

```
Providers (API-Football, Football-Data, FIFA)
    │
    ▼
Ingestion Layer (ProviderManager)
    │
    ▼
Normalization Layer (Normalizer)
    │
    ▼
Event Processing Pipeline (EventPipeline)
    │
    ▼
Storage Layer (Supabase/PostgreSQL)
    │
    ▼
Cache Layer (Redis)
    │
    ▼
API Layer (Next.js Routes)
    │
    ▼
Presentation Layer (React Components)
```

Each layer:
- Has a clear interface/contract
- Can be replaced without affecting others
- Is independently testable
- Handles its own failure modes