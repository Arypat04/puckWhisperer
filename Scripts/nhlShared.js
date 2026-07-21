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

export function buildTeamMaps(activeTeams) {
  const teamMapById = {};
  const teamMapByName = {};

  for (const t of activeTeams) {
    const franchiseId = t.franchiseId;
    const name = (t.fullName || '').toLowerCase().trim();
    const abbrev = FRANCHISE_LOGO_MAP[franchiseId] || t.abbreviation || t.teamName?.abbreviation || '';
    const teamData = {
      teamId: franchiseId,
      teamAbbrev: abbrev,
      teamLogo: `https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg`,
      teamName: t.fullName || ''
    };
    teamMapById[franchiseId] = teamData;
    if (name) teamMapByName[name] = teamData;
  }

  return { teamMapById, teamMapByName };
}

export function getDraftTeamInfo(draftData) {
  if (!draftData || !draftData.year) {
    return { year: null, round: null, pick: null, overall: null, team: null, teamAbbrev: null, teamLogo: null };
  }

  const originalAbbrev = draftData.teamAbbrev || '';
  const draftFranchiseId = ABBREV_TO_FRANCHISE_ID_MAP[originalAbbrev] || null;

  // Fall back to the franchise's current abbreviation when the draft-time
  // abbreviation is for a relocated/renamed team we don't have a name for.
  let correctAbbrev = originalAbbrev;
  if (!ABBREV_TO_TEAM_NAME_MAP[originalAbbrev] && draftFranchiseId && FRANCHISE_LOGO_MAP[draftFranchiseId]) {
    correctAbbrev = FRANCHISE_LOGO_MAP[draftFranchiseId];
  }

  const teamName = ABBREV_TO_TEAM_NAME_MAP[correctAbbrev] || draftData.teamName || '';
  const teamLogo = correctAbbrev ? `https://assets.nhle.com/logos/nhl/svg/${correctAbbrev}_light.svg` : null;

  return {
    year: draftData.year,
    round: draftData.round,
    pick: draftData.pickInRound,
    overall: draftData.overallPick,
    team: teamName,
    teamAbbrev: correctAbbrev,
    teamLogo
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
// merging consecutive seasons with the same team and flagging the latest
// tenure as active if it covers this season or last.
export function extractTeams(seasons, teamMapById, teamMapByName) {
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
    const normalizedName = originalTeamName.toLowerCase().trim();

    const fallbackAbbrev = FRANCHISE_LOGO_MAP[teamId] || '';
    const mapped = teamMapById[teamId] || teamMapByName[normalizedName] || {
      teamId: teamId || '',
      teamAbbrev: fallbackAbbrev,
      teamLogo: fallbackAbbrev ? `https://assets.nhle.com/logos/nhl/svg/${fallbackAbbrev}_light.svg` : ''
    };

    const modernTeamName = ABBREV_TO_TEAM_NAME_MAP[mapped.teamAbbrev] || originalTeamName;

    allSeasons.push({
      teamName: modernTeamName, teamId: mapped.teamId, teamAbbrev: mapped.teamAbbrev,
      teamLogo: mapped.teamLogo, startYear, endYear, seasonStr
    });
  }

  allSeasons.sort((a, b) => a.startYear - b.startYear);

  const tenures = [];
  let currentTenure = null;

  const finishTenure = (tenure) => {
    const isActive = tenure.endYear === currentSeason || tenure.endYear === currentSeason - 1;
    tenures.push({
      teamName: tenure.teamName, teamId: tenure.teamId, teamAbbrev: tenure.teamAbbrev,
      teamLogo: `https://assets.nhle.com/logos/nhl/svg/${tenure.teamAbbrev}_light.svg`,
      startYear: tenure.startYear, endYear: tenure.endYear, isActive
    });
  };

  for (const season of allSeasons) {
    const teamKey = `${season.teamId}_${season.teamName}`;

    if (!currentTenure || currentTenure.teamKey !== teamKey) {
      if (currentTenure) finishTenure(currentTenure);
      currentTenure = { teamKey, ...season };
    } else {
      currentTenure.endYear = Math.max(currentTenure.endYear, season.endYear);
    }
  }

  if (currentTenure) finishTenure(currentTenure);

  return tenures;
}
