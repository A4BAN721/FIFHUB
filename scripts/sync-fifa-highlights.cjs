const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

loadEnvFile(process.env.ENV_FILE_PATH ?? path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isDryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const shouldRecheckExisting =
  process.argv.includes("--recheck-existing") || process.env.HIGHLIGHTS_RECHECK_EXISTING === "1";
const OFFICIAL_FIFA_CHANNEL_ID = process.env.FIFA_YOUTUBE_CHANNEL_ID || "UCpcTrCXblq78GZrTUTLWeBw";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const feedUrl = getFifaFeedUrl();
  const [videos, fixtures, states] = await Promise.all([
    loadFifaVideos(feedUrl),
    loadFixtures(),
    loadFinishedStatesMissingHighlights(),
  ]);

  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  let updated = 0;
  let unmatched = 0;
  let searchedCount = 0;

  for (const state of states) {
    const fixture = fixturesById.get(String(state.match_id));
    if (!fixture) {
      unmatched++;
      continue;
    }

    let video = findHighlightVideo(videos, fixture);
    if (!video) {
      const searchedVideos = await searchFifaHighlightVideos(fixture);
      searchedCount += searchedVideos.length;
      video = findHighlightVideo(searchedVideos, fixture);
      videos.push(...searchedVideos);
    }
    const checkedAt = new Date().toISOString();

    if (!video) {
      if (state.highlights_url && isAcceptedExistingHighlight(state)) {
        if (!isDryRun) {
          await updateHighlightCheck(state.match_id, { checkedAt, keepExisting: true });
        }
        continue;
      }

      unmatched++;
      if (!isDryRun) {
        await updateHighlightCheck(state.match_id, { checkedAt });
      }
      continue;
    }

    if (state.highlights_url && video.url === state.highlights_url && isAcceptedExistingHighlight(state)) {
      if (!isDryRun) {
        await updateHighlightCheck(state.match_id, { checkedAt, keepExisting: true });
      }
      continue;
    }

    updated++;
    console.log(`${isDryRun ? "Would update" : "Updating"} ${fixture.home_team} vs ${fixture.away_team}: ${video.url}`);

    if (!isDryRun) {
      await updateHighlightCheck(state.match_id, {
        url: video.url,
        title: video.title,
        publishedAt: video.publishedAt,
        checkedAt,
      });
    }
  }

  console.log(
    `FIFA highlights sync complete. ${isDryRun ? "Matched" : "Updated"} ${updated}; unmatched ${unmatched}; videos scanned ${videos.length}; searches returned ${searchedCount} results.`,
  );
}

function getFifaFeedUrl() {
  if (process.env.FIFA_YOUTUBE_FEED_URL) return process.env.FIFA_YOUTUBE_FEED_URL;

  const channelId = process.env.FIFA_YOUTUBE_CHANNEL_ID;
  if (!channelId) {
    return "https://www.youtube.com/feeds/videos.xml?user=FIFATV";
  }

  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

async function loadFifaVideos(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: { "user-agent": "fifhub-fifa-highlights-sync/1.0" },
  });

  if (!response.ok) {
    throw new Error(`FIFA YouTube feed returned ${response.status}`);
  }

  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const videoId = readXmlValue(entry, "yt:videoId");
    const title = decodeXml(readXmlValue(entry, "title"));
    return {
      videoId,
      title,
      normalizedTitle: normalizeText(title),
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : decodeXml(readXmlLink(entry)),
      publishedAt: readXmlValue(entry, "published") || null,
      channelId: readXmlValue(entry, "yt:channelId") || OFFICIAL_FIFA_CHANNEL_ID,
      channelTitle: "FIFA",
    };
  }).filter((video) => video.videoId && video.title);
}

async function searchFifaHighlightVideos(fixture) {
  if (process.env.YOUTUBE_API_KEY) {
    return searchFifaHighlightVideosWithApi(fixture);
  }

  return searchFifaHighlightVideosFromPage(fixture);
}

async function searchFifaHighlightVideosWithApi(fixture) {
  const query = buildHighlightSearchQueries(fixture)[0];
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Number(process.env.HIGHLIGHTS_SEARCH_RESULTS ?? 10)));
  url.searchParams.set("q", query);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY);

  url.searchParams.set("channelId", OFFICIAL_FIFA_CHANNEL_ID);

  const response = await fetch(url, {
    headers: { "user-agent": "fifhub-fifa-highlights-sync/1.0" },
  });

  if (!response.ok) {
    throw new Error(`YouTube Data API returned ${response.status}`);
  }

  const json = await response.json();
  return (json.items ?? []).map((item) => {
    const videoId = item.id?.videoId;
    const title = item.snippet?.title ?? "";
    return {
      videoId,
      title,
      normalizedTitle: normalizeText(title),
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
      publishedAt: item.snippet?.publishedAt ?? null,
      channelTitle: item.snippet?.channelTitle ?? "",
      channelId: item.snippet?.channelId ?? "",
    };
  }).filter(isOfficialFifaVideo);
}

async function searchFifaHighlightVideosFromPage(fixture) {
  const videosById = new Map();
  const queries = buildHighlightSearchQueries(fixture)
    .slice(0, Number(process.env.HIGHLIGHTS_SEARCH_QUERY_LIMIT ?? 8));

  for (const query of queries) {
    const url = new URL("https://www.youtube.com/results");
    url.searchParams.set("search_query", query);
    url.searchParams.set("hl", "en");

    let response;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.HIGHLIGHTS_SEARCH_TIMEOUT_MS ?? 7000),
    );

    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "Mozilla/5.0 (compatible; fifhub-fifa-highlights-sync/1.0)",
        },
      });
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      continue;
    }

    const html = await response.text();

    // Try multiple parsing strategies for resilience
    const initialData = parseYtInitialData(html) || parseYtInitialDataAlt(html);
    if (!initialData) continue;

    for (const video of collectVideoRenderers(initialData).map(mapVideoRenderer).filter(isOfficialFifaVideo)) {
      videosById.set(video.videoId, video);
    }

    if (videosById.size >= Number(process.env.HIGHLIGHTS_SEARCH_RESULTS ?? 20)) break;
  }

  return [...videosById.values()];
}

function buildHighlightSearchQueries(fixture) {
  const home = normalizeTeamName(fixture.home_team);
  const away = normalizeTeamName(fixture.away_team);
  const queries = [];

  // Also include the raw team names (not just aliases) for direct matching
  const homeNames = [...new Set([...home.aliases, normalizeText(home.normalized).replace(/\s+/g, "")])].filter(Boolean);
  const awayNames = [...new Set([...away.aliases, normalizeText(away.normalized).replace(/\s+/g, "")])].filter(Boolean);

  for (const homeAlias of homeNames.slice(0, 4)) {
    for (const awayAlias of awayNames.slice(0, 4)) {
      queries.push(`${homeAlias} v ${awayAlias} FIFA World Cup 26 highlights`);
      queries.push(`FIFA ${homeAlias} vs ${awayAlias} highlights World Cup 2026`);
      queries.push(`FIFA ${homeAlias} ${awayAlias} highlights`);
    }
  }

  queries.push(`${fixture.home_team} v ${fixture.away_team} FIFA World Cup 26 highlights`);
  queries.push(`${fixture.home_team} vs ${fixture.away_team} FIFA World Cup 2026 highlights`);
  queries.push(`${fixture.home_team} ${fixture.away_team} FIFA highlights`);
  queries.push(`FIFA ${fixture.home_team} ${fixture.away_team} highlights`);
  queries.push(`FIFA ${fixture.away_team} ${fixture.home_team} highlights`);
  queries.push(`World Cup 2026 ${fixture.home_team} vs ${fixture.away_team} highlights`);
  queries.push(`World Cup 2026 ${fixture.away_team} vs ${fixture.home_team} highlights`);

  return [...new Set(queries)];
}

/**
 * Alternative ytInitialData parser that handles YouTube's ever-changing HTML structure.
 * Some YouTube page formats don't use a simple `ytInitialData` variable assignment
 * but instead embed it differently (e.g., in a `<script>` tag with different variable names,
 * or as JSON inside a specific `<script id="...">` tag).
 */
function parseYtInitialDataAlt(html) {
  // Strategy 1: Look for ytInitialData in a <script> tag with id "initial-data"
  // (YouTube sometimes uses this format)
  const scriptMatch = html.match(/<script[^>]*id="(?:initial-data|initialData)"[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    try {
      return JSON.parse(scriptMatch[1]);
    } catch { /* fall through */ }
  }

  // Strategy 2: Look for any <script> containing "window.ytInitialData" instead of just "ytInitialData"
  const windowMarkerIndex = html.indexOf("window.ytInitialData");
  if (windowMarkerIndex !== -1) {
    const openBrace = html.indexOf("{", windowMarkerIndex);
    if (openBrace !== -1) {
      try {
        return parseBalancedJson(html, openBrace);
      } catch { /* fall through */ }
    }
  }

  // Strategy 3: Search for "var ytInitialData" or "let ytInitialData"
  const varPatterns = ["var ytInitialData", "let ytInitialData", "const ytInitialData"];
  for (const pattern of varPatterns) {
    const idx = html.indexOf(pattern);
    if (idx !== -1) {
      // Look for = after the pattern
      const equalsIdx = html.indexOf("=", idx);
      if (equalsIdx !== -1) {
        const openBrace = html.indexOf("{", equalsIdx);
        if (openBrace !== -1) {
          try {
            return parseBalancedJson(html, openBrace);
          } catch { /* fall through */ }
        }
      }
    }
  }

  // Strategy 4: Look for ytInitialData in a script tag with various formats
  const scriptTagMatch = html.match(/<script[^>]*>([\s\S]*?ytInitialData[\s\S]*?)<\/script>/i);
  if (scriptTagMatch) {
    const scriptContent = scriptTagMatch[1];
    const dataMatch = scriptContent.match(/ytInitialData\s*=\s*({[\s\S]*?});/);
    if (dataMatch) {
      try {
        return JSON.parse(dataMatch[1]);
      } catch { /* fall through */ }
    }
  }

  return null;
}

function parseYtInitialData(html) {
  const marker = "ytInitialData";
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  const openIndex = html.indexOf("{", markerIndex);
  if (openIndex === -1) return null;

  try {
    return parseBalancedJson(html, openIndex);
  } catch {
    return null;
  }
}

/**
 * Parse a balanced JSON object starting at `openIndex` in `html`.
 * This is more robust than the original approach as it handles edge cases
 * like deeply nested strings and escaped characters properly.
 */
function parseBalancedJson(html, openIndex) {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = openIndex; index < html.length; index++) {
    const char = html[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") depth--;

    if (depth === 0) {
      return JSON.parse(html.slice(openIndex, index + 1));
    }
  }

  return null;
}

function collectVideoRenderers(value, videos = []) {
  if (!value || typeof value !== "object") return videos;

  if (value.videoRenderer) {
    videos.push(value.videoRenderer);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) collectVideoRenderers(item, videos);
    } else if (child && typeof child === "object") {
      collectVideoRenderers(child, videos);
    }
  }

  return videos;
}

function mapVideoRenderer(video) {
  const videoId = video.videoId;
  const title = readRunsText(video.title) || video.title?.simpleText || "";
  const channelTitle = readRunsText(video.ownerText) || readRunsText(video.shortBylineText);
  const channelId = video.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    ?? video.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    ?? "";

  return {
    videoId,
    title,
    normalizedTitle: normalizeText(title),
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    publishedAt: null,
    channelTitle,
    channelId,
  };
}

function readRunsText(value) {
  if (!value) return "";
  if (value.simpleText) return value.simpleText;
  return (value.runs ?? []).map((run) => run.text ?? "").join("");
}

function isOfficialFifaVideo(video) {
  if (!video.videoId || !video.title) return false;
  if (video.channelId && video.channelId === OFFICIAL_FIFA_CHANNEL_ID) return true;
  return normalizeText(video.channelTitle) === "fifa";
}

async function loadFixtures() {
  const { data, error } = await supabase
    .from("match_fixtures")
    .select("id, home_team, away_team");

  if (error) throw new Error(`Failed to load fixtures: ${error.message}`);
  return data ?? [];
}

async function loadFinishedStatesMissingHighlights() {
  let query = supabase
    .from("live_match_state")
    .select("match_id, status, final_score_confirmed_at, highlights_url, highlights_title")
    .not("final_score_confirmed_at", "is", null)
    .order("final_score_confirmed_at", { ascending: false })
    .limit(Number(process.env.HIGHLIGHTS_MATCH_LIMIT ?? 120));

  if (!shouldRecheckExisting) {
    query = query.is("highlights_url", null);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to load completed matches missing highlights: ${error.message}`);
  return data ?? [];
}

async function updateHighlightCheck(matchId, { url, title, publishedAt, checkedAt, keepExisting = false }) {
  const update = keepExisting
    ? { highlights_checked_at: checkedAt }
    : {
        highlights_url: url ?? null,
        highlights_title: title ?? null,
        highlights_published_at: publishedAt ?? null,
        highlights_checked_at: checkedAt,
      };

  const { error } = await supabase.from("live_match_state").update(update).eq("match_id", matchId);

  if (error) throw new Error(`Failed to update highlights for match ${matchId}: ${error.message}`);
}

function findHighlightVideo(videos, fixture) {
  const home = normalizeTeamName(fixture.home_team);
  const away = normalizeTeamName(fixture.away_team);
  const minimumScore = Number(process.env.HIGHLIGHTS_MIN_SCORE ?? 5);

  return videos
    .map((video) => ({ video, score: scoreHighlightVideo(video, home, away) }))
    .filter((candidate) => candidate.score >= minimumScore)
    .sort((a, b) => b.score - a.score)[0]?.video ?? null;
}

function isHighlightTitle(title) {
  if (!title) return false;
  if (isRejectedHighlightTitle(title)) return false;
  return title.includes("highlight") && title.includes("fifa world cup 2026");
}

function isRejectedHighlightTitle(title) {
  if (/\bgoals?\b/.test(title)) return true;

  return [
    "alt cast",
    "watchalong",
    "watch along",
    "preview",
    "prediction",
    "simulated",
    "simulation",
    "lineups",
    "press conference",
    "full match",
    "live",
  ].some((phrase) => title.includes(phrase));
}

function scoreHighlightVideo(video, home, away) {
  const title = video.normalizedTitle;
  if (!isOfficialFifaVideo(video)) return 0;
  if (!isHighlightTitle(title)) return 0;
  if (!title || isRejectedHighlightTitle(title)) return 0;
  if (!titleHasTeam(title, home) || !titleHasTeam(title, away)) return 0;

  let score = 0;
  score += 6;
  if (title.includes("fifa world cup 2026")) score += 3;
  if (title.includes("fifa")) score += 1;
  if (/\b(v|vs)\b/.test(title)) score += 1;
  if (isOfficialFifaVideo(video)) score += 2;

  return score;
}

function isAcceptedExistingHighlight(state) {
  if (!state.highlights_url || !state.highlights_title) return false;
  const title = normalizeText(state.highlights_title);
  return isHighlightTitle(title);
}

function titleHasTeam(title, team) {
  return team.aliases.some((alias) => title.includes(alias));
}

/**
 * Clean mojibake / encoding-corrupted team names.
 * This handles common cases where UTF-8 text was double-encoded or incorrectly stored,
 * e.g. "CuraÃ§ao" → "Curaçao", "TÃ¼rkiye" → "Türkiye".
 * 
 * IMPORTANT: This must work on the RAW text BEFORE normalizeText() is called,
 * because normalizeText() would decompose the mojibake characters via NFKD
 * into unrecognizable fragments (e.g., "Ã¼" → "a 1 4").
 */
function fixMojibake(text) {
  // Common FIFA World Cup 2026 team name encoding corruptions
  // These match the raw text as it appears in the database (before normalization)
  const mojibakeMap = {
    "tã¼rkiye": "turkiye",
    "türkiye": "turkiye",
    "curaã§ao": "curacao",
    "curaçao": "curacao",
    "bosnia & herzegovina": "bosnia and herzegovina",
    "lukembourg": "luxembourg",
    // Add more as discovered
  };
  
  // Normalize the raw text to a key for lookup
  // We use a simpler normalization here that doesn't NFKD-decompose the text
  const key = String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9à-ÿ]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  
  return mojibakeMap[key] || key;
}

function normalizeTeamName(teamName) {
  // First, fix any mojibake/encoding issues
  const cleanedName = fixMojibake(teamName);
  const normalized = normalizeText(cleanedName);

  const aliasesByName = {
    // Bosnia & Herzegovina - handle the & being converted to "and" and matches with "bosnia"
    "bosnia and herzegovina": ["bosnia and herzegovina", "bosnia", "bosnia herzegovina"],
    // Cabo Verde / Cape Verde
    "cabo verde": ["cape verde", "cabo verde"],
    // Curaçao
    "curacao": ["curacao", "curaçao"],
    // Czechia / Czech Republic
    "czechia": ["czechia", "czech republic"],
    // DR Congo
    "dr congo": ["dr congo", "congo dr", "democratic republic of congo"],
    // Ivory Coast / Côte d'Ivoire
    "ivory coast": ["ivory coast", "cote d ivoire"],
    // Qatar
    "qatar": ["qatar", "qat"],
    // Saudi Arabia
    "saudi arabia": ["saudi arabia", "ksa", "saudi"],
    // South Africa
    "south africa": ["south africa", "rsa"],
    // South Korea / Korea Republic
    "south korea": ["korea republic", "south korea", "kor"],
    // Türkiye / Turkey
    "turkiye": ["turkiye", "turkey", "türkiye"],
    // Uruguay
    "uruguay": ["uruguay", "uru"],
    // USA / United States
    "usa": ["united states", "usa", "usmnt"],
  };

  return {
    normalized,
    aliases: aliasesByName[normalized] ?? [normalized],
  };
}

function normalizeText(value) {
  return decodeXml(String(value ?? ""))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function readXmlValue(xml, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`));
  return match?.[1]?.trim() ?? "";
}

function readXmlLink(xml) {
  return xml.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
}

function decodeXml(value) {
  // Decode XML/HTML entities back to their literal characters
  return String(value ?? "")
    .replace(/\x26amp;/g, "\x26")
    .replace(/\x26lt;/g, "\x3c")
    .replace(/\x26gt;/g, "\x3e")
    .replace(/\x26quot;/g, '\x22')
    .replace(/\x26#39;/g, "\x27");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    if (process.env[key]) continue;
    process.env[key] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}
