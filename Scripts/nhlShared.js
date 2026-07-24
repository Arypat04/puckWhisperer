// Shared constants and helpers used by both the scraper (getNHLPlayers.js)
// and the weekly updater (update-players.js), so team data and rate-limiting
// logic only exist in one place.

import axios from 'axios';

export const FRANCHISE_LOGO_MAP = {
  1: 'MTL', 2: 'MTL', 3: 'OTT', 4: 'TOR', 5: 'TOR', 6: 'BOS', 7: 'MTL',
  8: 'NYR', 9: 'PIT', 10: 'NYR', 11: 'CHI', 12: 'DET', 13: 'SJS', 14: 'LAK',
  15: 'DAL', 16: 'PHI', 17: 'PIT', 18: 'STL', 19: 'BUF', 20: 'VAN', 21: 'CGY',
  22: 'NYI', 23: 'NJD', 24: 'WSH', 25: 'EDM', 26: 'CAR', 27: 'COL', 28: 'ARI',
  29: 'SJS', 30: 'OTT', 31: 'TBL', 32: 'ANA', 33: 'FLA', 34: 'NSH', 35: 'WPG',
  36: 'CBJ', 37: 'MIN', 38: 'VGK', 39: 'SEA', 40: 'UTA'
};

export const ABBREV_TO_FRANCHISE_ID_MAP = {
  MTL: 1, OTT: 3, TOR: 5, BOS: 6, NYR: 10, CHI: 11, DET: 12,
  SJS: 29, LAK: 14, DAL: 15, PHI: 16, PIT: 17, STL: 18, BUF: 19,
  VAN: 20, CGY: 21, NYI: 22, NJD: 23, WSH: 24, EDM: 25, CAR: 26,
  COL: 27, ARI: 28, TBL: 31, ANA: 32, FLA: 33, NSH: 34, WPG: 35,
  CBJ: 36, MIN: 37, VGK: 38, SEA: 39, UTA: 40
};

// Note: consolidated from three copies that had drifted (two said "Utah
// Hockey Club", one said "Utah Mammoth") - using the current team name.
export const ABBREV_TO_TEAM_NAME_MAP = {
  MTL: 'Montréal Canadiens', OTT: 'Ottawa Senators', TOR: 'Toronto Maple Leafs',
  BOS: 'Boston Bruins', NYR: 'New York Rangers', CHI: 'Chicago Blackhawks',
  DET: 'Detroit Red Wings', SJS: 'San Jose Sharks', LAK: 'Los Angeles Kings',
  DAL: 'Dallas Stars', PHI: 'Philadelphia Flyers', PIT: 'Pittsburgh Penguins',
  STL: 'St. Louis Blues', BUF: 'Buffalo Sabres', VAN: 'Vancouver Canucks',
  CGY: 'Calgary Flames', NYI: 'New York Islanders', NJD: 'New Jersey Devils',
  WSH: 'Washington Capitals', EDM: 'Edmonton Oilers', CAR: 'Carolina Hurricanes',
  COL: 'Colorado Avalanche', ARI: 'Arizona Coyotes', TBL: 'Tampa Bay Lightning',
  ANA: 'Anaheim Ducks', FLA: 'Florida Panthers', NSH: 'Nashville Predators',
  WPG: 'Winnipeg Jets', CBJ: 'Columbus Blue Jackets', MIN: 'Minnesota Wild',
  VGK: 'Vegas Golden Knights', SEA: 'Seattle Kraken', UTA: 'Utah Mammoth'
};

const TEAM_NAME_TO_ABBREV_MAP = Object.fromEntries(
  Object.entries(ABBREV_TO_TEAM_NAME_MAP).map(([abbrev, name]) => [name, abbrev])
);

export async function makeRequestWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await axios.get(url);
    } catch (error) {
      if (error.response?.status === 429 || error.response?.status === 503) {
        const waitTime = Math.pow(2, i) * 2000;
        console.log(`Rate limited on ${url}, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (error.response?.status >= 500) {
        const waitTime = 1000 * (i + 1);
        console.log(`Server error on ${url}, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Max retries exceeded for ${url}`);
}

// Every caller awaits each request before making the next one, so there's
// never more than one in flight - this just enforces a minimum gap between
// calls instead of the queue class that used to wrap this.
export function createRateLimiter(requestsPerMinute = 30) {
  const interval = 60000 / requestsPerMinute;
  let lastRequestTime = 0;

  return async function throttle(requestFn) {
    const wait = interval - (Date.now() - lastRequestTime);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestTime = Date.now();
    return requestFn();
  };
}

// Runs `worker(item, index)` over `items` with at most `concurrency` in
// flight at once. After each concurrent chunk resolves, `onChunkDone` (if
// given) is called with that chunk's results - lets callers flush partial
// work (e.g. a batched DB write) without waiting for the whole list.
export async function runWithConcurrency(items, concurrency, worker, onChunkDone) {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((item, j) => worker(item, i + j)));
    if (onChunkDone) await onChunkDone(results);
  }
}

export async function fetchActiveTeams() {
  const { data } = await makeRequestWithRetry('https://api.nhle.com/stats/rest/en/team');
  return data.data.filter(team => team.franchiseId && team.active !== false);
}

// The NHL's current-team logo CDN (assets.nhle.com/logos/nhl/svg/{ABBREV}_*.svg)
// only ever serves whatever a franchise looks like today - a player's history
// with a relocated, renamed, or redesigned team always showed the modern
// branding. The date-scoped standings API (api-web.nhle.com/v1/standings/{date})
// is the only NHL endpoint that returns logos matching what a team actually
// looked like at a given point in time. Cached per date since a single scrape
// run has heavy overlap in the seasons/dates different players reference.
const standingsCache = new Map();

async function fetchStandingsForDate(date) {
  if (standingsCache.has(date)) return standingsCache.get(date);
  let standings = [];
  try {
    const { data } = await makeRequestWithRetry(`https://api-web.nhle.com/v1/standings/${date}`);
    standings = data.standings || [];
  } catch {
    // Cache the miss too, so an uncovered/bad date isn't retried for every
    // subsequent player whose tenure references it.
  }
  standingsCache.set(date, standings);
  return standings;
}

export async function resolveEraTeamIdentityByName(representativeDate, exactTeamName) {
  const standings = await fetchStandingsForDate(representativeDate);
  const entry = standings.find(t => t.teamName?.default === exactTeamName);
  if (!entry) return null;
  return {
    teamAbbrev: entry.teamAbbrev?.default || '',
    teamLogo: entry.teamLogo || '',
    teamLogoDark: entry.teamLogoDark || ''
  };
}

// Same idea, matched by abbreviation instead of name - draft data only gives
// us the historical abbreviation, not a full team name.
export async function resolveEraTeamIdentityByAbbrev(representativeDate, abbrev) {
  const standings = await fetchStandingsForDate(representativeDate);
  const entry = standings.find(t => t.teamAbbrev?.default === abbrev);
  if (!entry) return null;
  return {
    teamName: entry.teamName?.default || '',
    teamLogo: entry.teamLogo || '',
    teamLogoDark: entry.teamLogoDark || ''
  };
}

export async function getDraftTeamInfo(draftData) {
  if (!draftData || !draftData.year) {
    return { year: null, round: null, pick: null, overall: null, team: null, teamAbbrev: null, teamLogo: null, teamLogoDark: null };
  }

  // December, not draft day itself (June) - the standings API has no data
  // for summer dates outside the season, but a team's identity can't have
  // changed between the draft and the start of that same season anyway.
  // Falls back to February of the following year for lockout-delayed
  // seasons (e.g. 1994-95) where December also has no data yet.
  const originalAbbrev = draftData.teamAbbrev || '';
  let resolved = originalAbbrev
    ? await resolveEraTeamIdentityByAbbrev(`${draftData.year}-12-01`, originalAbbrev)
    : null;
  if (!resolved && originalAbbrev) {
    resolved = await resolveEraTeamIdentityByAbbrev(`${draftData.year + 1}-02-01`, originalAbbrev);
  }

  if (resolved) {
    return {
      year: draftData.year,
      round: draftData.round,
      pick: draftData.pickInRound,
      overall: draftData.overallPick,
      team: resolved.teamName,
      teamAbbrev: originalAbbrev,
      teamLogo: resolved.teamLogo,
      teamLogoDark: resolved.teamLogoDark
    };
  }

  // Fall back to the franchise's current identity if the era-accurate lookup
  // came up empty (e.g. a date outside the standings API's coverage). Only
  // ever use an abbreviation we can confirm is a real current team - never
  // the raw original abbrev unverified, since an unrecognized/defunct code
  // would produce a logo URL that 404s.
  const draftFranchiseId = ABBREV_TO_FRANCHISE_ID_MAP[originalAbbrev] || null;
  const fallbackAbbrev = ABBREV_TO_TEAM_NAME_MAP[originalAbbrev]
    ? originalAbbrev
    : (draftFranchiseId && FRANCHISE_LOGO_MAP[draftFranchiseId]) || '';

  return {
    year: draftData.year,
    round: draftData.round,
    pick: draftData.pickInRound,
    overall: draftData.overallPick,
    team: ABBREV_TO_TEAM_NAME_MAP[fallbackAbbrev] || draftData.teamName || '',
    teamAbbrev: fallbackAbbrev,
    teamLogo: fallbackAbbrev ? `https://assets.nhle.com/logos/nhl/svg/${fallbackAbbrev}_light.svg` : null,
    teamLogoDark: fallbackAbbrev ? `https://assets.nhle.com/logos/nhl/svg/${fallbackAbbrev}_dark.svg` : null
  };
}

// Pulls major end-of-season trophies (Hart, Norris, Vezina, Calder, Art
// Ross, Conn Smythe, Rocket Richard, Ted Lindsay, Stanley Cup, etc.) from
// the NHL API's `awards` field. Note: this does NOT include All-Star Game
// selections - the NHL API doesn't expose that data anywhere we can reach.
export function extractTrophies(awardsData) {
  if (!Array.isArray(awardsData)) return [];

  return awardsData.map(award => ({
    name: award.trophy?.default || 'Unknown Trophy',
    seasons: (award.seasons || []).map(s => s.seasonId).filter(Boolean)
  }));
}

// Collapses a player's season-by-season history into per-team tenures,
// merging consecutive seasons under the same *historical* team identity and
// flagging the latest tenure as active if it covers this season or last.
// A franchise rename (e.g. Hartford Whalers -> Carolina Hurricanes)
// intentionally starts a new tenure rather than merging through it, since
// showing "years played on each team" should reflect the team as it was
// actually named at the time, not its modern identity.
export async function extractTeams(seasons) {
  if (!Array.isArray(seasons)) return [];

  const currentSeason = new Date().getFullYear();
  const allSeasons = [];

  for (const season of seasons) {
    if (season.gameTypeId !== 2 && season.gameTypeId !== 3) continue;
    if (season.leagueAbbrev !== 'NHL') continue;

    const originalTeamName = season.teamFullName ||
      (season.teamName?.default || season.teamName) || season.team || '';
    const teamId = season.franchiseId || season.teamId || '';
    const seasonStr = season.season?.toString() || '';

    if (!originalTeamName || seasonStr.length !== 8) continue;

    const startYear = parseInt(seasonStr.slice(0, 4));
    const endYear = parseInt(seasonStr.slice(4));

    allSeasons.push({ teamName: originalTeamName, teamId, startYear, endYear });
  }

  allSeasons.sort((a, b) => a.startYear - b.startYear);

  const rawTenures = [];
  let current = null;
  for (const season of allSeasons) {
    if (current && current.teamName === season.teamName) {
      current.endYear = Math.max(current.endYear, season.endYear);
    } else {
      if (current) rawTenures.push(current);
      current = { ...season };
    }
  }
  if (current) rawTenures.push(current);

  const tenures = [];
  for (const tenure of rawTenures) {
    const isActive = tenure.endYear === currentSeason || tenure.endYear === currentSeason - 1;

    // An ongoing tenure should show the team's *current* branding (the
    // relationship is still active today), not whatever it looked like when
    // the tenure started - a player who's been on the same team since 2015
    // shouldn't show a logo the team retired years ago. "now" redirects to
    // the most recent date with real standings data, since a raw date
    // during the offseason returns nothing. Finished tenures try December
    // of the start year first (safely inside the season before any
    // offseason rename could have happened), falling back to February of
    // the end year for the rare lockout-delayed season (e.g. 1994-95,
    // which didn't start until mid-January) where December has no data.
    let resolved = null;
    if (isActive) {
      resolved = await resolveEraTeamIdentityByName('now', tenure.teamName);
    } else {
      resolved = await resolveEraTeamIdentityByName(`${tenure.startYear}-12-01`, tenure.teamName);
      if (!resolved) {
        resolved = await resolveEraTeamIdentityByName(`${tenure.endYear}-02-01`, tenure.teamName);
      }
    }

    let teamAbbrev, teamLogo, teamLogoDark;
    if (resolved) {
      ({ teamAbbrev, teamLogo, teamLogoDark } = resolved);
    } else {
      // Fall back to the franchise's current branding if the era-accurate
      // lookup came up empty - never leave a tenure with no logo at all.
      // Raw season data doesn't reliably carry a franchiseId, so this
      // matches by the team's current name rather than tenure.teamId.
      const fallbackAbbrev = TEAM_NAME_TO_ABBREV_MAP[tenure.teamName] || '';
      teamAbbrev = fallbackAbbrev;
      teamLogo = fallbackAbbrev ? `https://assets.nhle.com/logos/nhl/svg/${fallbackAbbrev}_light.svg` : '';
      teamLogoDark = fallbackAbbrev ? `https://assets.nhle.com/logos/nhl/svg/${fallbackAbbrev}_dark.svg` : '';
    }

    tenures.push({
      teamName: tenure.teamName, teamId: tenure.teamId, teamAbbrev,
      teamLogo, teamLogoDark,
      startYear: tenure.startYear, endYear: tenure.endYear, isActive
    });
  }

  return tenures;
}
