// Test file for NHL scraper with focus on multiple tenures
import axios from 'axios';

// Request queue to handle rate limiting (simplified for testing)
class RequestQueue {
  constructor() {
    this.interval = 2000; // 2 seconds between requests
    this.lastRequestTime = 0;
  }

  async add(requestFn) {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.interval) {
      await new Promise(r => setTimeout(r, this.interval - timeSinceLastRequest));
    }
    
    try {
      const result = await requestFn();
      this.lastRequestTime = Date.now();
      return result;
    } catch (error) {
      throw error;
    }
  }
}

// Enhanced request function with retry logic
async function makeRequestWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url);
      return response;
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

// The main test functions
const requestQueue = new RequestQueue();

// Maps for team lookups
const franchiseLogoMap = {
  1: 'MTL', 2: 'MTL', 3: 'OTT', 4: 'TOR', 5: 'TOR', 6: 'BOS', 7: 'MTL',
  8: 'NYR', 9: 'PIT', 10: 'NYR', 11: 'CHI', 12: 'DET', 13: 'SJS', 14: 'LAK',
  15: 'DAL', 16: 'PHI', 17: 'PIT', 18: 'STL', 19: 'BUF', 20: 'VAN', 21: 'CGY',
  22: 'NYI', 23: 'NJD', 24: 'WSH', 25: 'EDM', 26: 'CAR', 27: 'COL', 28: 'ARI',
  29: 'SJS', 30: 'OTT', 31: 'TBL', 32: 'ANA', 33: 'FLA', 34: 'NSH', 35: 'WPG',
  36: 'CBJ', 37: 'MIN', 38: 'VGK', 39: 'SEA', 40: 'UTA'
};

const abbrevToTeamNameMap = {
  'MTL': 'Montréal Canadiens', 'OTT': 'Ottawa Senators', 'TOR': 'Toronto Maple Leafs',
  'BOS': 'Boston Bruins', 'NYR': 'New York Rangers', 'CHI': 'Chicago Blackhawks',
  'DET': 'Detroit Red Wings', 'SJS': 'San Jose Sharks', 'LAK': 'Los Angeles Kings',
  'DAL': 'Dallas Stars', 'PHI': 'Philadelphia Flyers', 'PIT': 'Pittsburgh Penguins',
  'STL': 'St. Louis Blues', 'BUF': 'Buffalo Sabres', 'VAN': 'Vancouver Canucks',
  'CGY': 'Calgary Flames', 'NYI': 'New York Islanders', 'NJD': 'New Jersey Devils',
  'WSH': 'Washington Capitals', 'EDM': 'Edmonton Oilers', 'CAR': 'Carolina Hurricanes',
  'COL': 'Colorado Avalanche', 'ARI': 'Arizona Coyotes', 'TBL': 'Tampa Bay Lightning',
  'ANA': 'Anaheim Ducks', 'FLA': 'Florida Panthers', 'NSH': 'Nashville Predators',
  'WPG': 'Winnipeg Jets', 'CBJ': 'Columbus Blue Jackets', 'MIN': 'Minnesota Wild',
  'VGK': 'Vegas Golden Knights', 'SEA': 'Seattle Kraken', 'UTA': 'Utah Hockey Club'
};

// Current version - showing the issue with multiple tenures
function currentExtractTeams(seasons, teamMapById, teamMapByName) {
  const teamsPlayed = {};
  if (!Array.isArray(seasons)) return [];

  for (const season of seasons) {
    if (season.gameTypeId !== 2 && season.gameTypeId !== 3) continue;
    if (season.leagueAbbrev !== 'NHL') continue;

    const originalTeamName = season.teamFullName || 
      (season.teamName?.default || season.teamName) || 
      season.team || '';
    const teamId = season.franchiseId || season.teamId || '';
    const seasonStr = season.season?.toString() || '';
    
    if (!originalTeamName || seasonStr.length !== 8) continue;

    const startYear = parseInt(seasonStr.slice(0, 4));
    const endYear = parseInt(seasonStr.slice(4));
    const normalizedName = originalTeamName.toLowerCase().trim();

    const mapped = teamMapById[teamId] || teamMapByName[normalizedName] || {
      teamId: teamId || '',
      teamAbbrev: '',
      teamLogo: franchiseLogoMap[teamId] || ''
    };

    const modernTeamName = abbrevToTeamNameMap[mapped.teamAbbrev] || originalTeamName;
    const key = `${mapped.teamId}_${modernTeamName}`;
    
    if (!teamsPlayed[key]) {
      teamsPlayed[key] = {
        teamName: modernTeamName,
        teamId: mapped.teamId,
        teamAbbrev: mapped.teamAbbrev,
        teamLogo: mapped.teamLogo,
        startYear,
        endYear
      };
    } else {
      teamsPlayed[key].startYear = Math.min(teamsPlayed[key].startYear, startYear);
      teamsPlayed[key].endYear = Math.max(teamsPlayed[key].endYear, endYear);
    }
  }

  return Object.values(teamsPlayed);
}

// Fixed version - handling multiple tenures correctly
// Fixed version - handling multiple tenures correctly
function fixedExtractTeams(seasons, teamMapById, teamMapByName) {
  if (!Array.isArray(seasons)) return [];

  const currentSeason = new Date().getFullYear();
  
  // First, process all seasons and create a chronological list
  const allSeasons = [];
  
  for (const season of seasons) {
    if (season.gameTypeId !== 2 && season.gameTypeId !== 3) continue;
    if (season.leagueAbbrev !== 'NHL') continue;

    const originalTeamName = season.teamFullName || 
      (season.teamName?.default || season.teamName) || 
      season.team || '';
    const teamId = season.franchiseId || season.teamId || '';
    const seasonStr = season.season?.toString() || '';
    
    if (!originalTeamName || seasonStr.length !== 8) continue;

    const startYear = parseInt(seasonStr.slice(0, 4));
    const endYear = parseInt(seasonStr.slice(4));
    const normalizedName = originalTeamName.toLowerCase().trim();

    const mapped = teamMapById[teamId] || teamMapByName[normalizedName] || {
      teamId: teamId || '',
      teamAbbrev: '',
      teamLogo: franchiseLogoMap[teamId] || ''
    };

    const modernTeamName = abbrevToTeamNameMap[mapped.teamAbbrev] || originalTeamName;
    
    allSeasons.push({
      teamName: modernTeamName,
      teamId: mapped.teamId,
      teamAbbrev: mapped.teamAbbrev,
      teamLogo: mapped.teamLogo,
      startYear,
      endYear,
      seasonStr
    });
  }
  
  // Sort all seasons chronologically
  allSeasons.sort((a, b) => a.startYear - b.startYear);
  
  // Build tenures by walking through chronologically and detecting when teams change
  const tenures = [];
  let currentTenure = null;
  
  for (const season of allSeasons) {
    const teamKey = `${season.teamId}_${season.teamName}`;
    
    if (!currentTenure || currentTenure.teamKey !== teamKey) {
      // Starting a new tenure
      if (currentTenure) {
        // Finish the previous tenure
        const isActive = currentTenure.endYear === currentSeason || 
                         currentTenure.endYear === currentSeason - 1;
        tenures.push({
          teamName: currentTenure.teamName,
          teamId: currentTenure.teamId,
          teamAbbrev: currentTenure.teamAbbrev,
          teamLogo: currentTenure.teamLogo,
          startYear: currentTenure.startYear,
          endYear: currentTenure.endYear,
          isActive
        });
      }
      
      // Start new tenure
      currentTenure = {
        teamKey,
        teamName: season.teamName,
        teamId: season.teamId,
        teamAbbrev: season.teamAbbrev,
        teamLogo: season.teamLogo,
        startYear: season.startYear,
        endYear: season.endYear
      };
    } else {
      // Same team, extend the current tenure
      currentTenure.endYear = Math.max(currentTenure.endYear, season.endYear);
    }
  }
  
  // Don't forget the last tenure
  if (currentTenure) {
    const isActive = currentTenure.endYear === currentSeason || 
                     currentTenure.endYear === currentSeason - 1;
    tenures.push({
      teamName: currentTenure.teamName,
      teamId: currentTenure.teamId,
      teamAbbrev: currentTenure.teamAbbrev,
      teamLogo: currentTenure.teamLogo,
      startYear: currentTenure.startYear,
      endYear: currentTenure.endYear,
      isActive
    });
  }
  
  return tenures;
}

// Function to test with Luke Schenn
async function testPlayerData(playerId) {
  try {
    console.log(`Testing player ID: ${playerId}`);
    
    const statsRes = await requestQueue.add(() => 
      makeRequestWithRetry(`https://api-web.nhle.com/v1/player/${playerId}/landing`)
    );
    const data = statsRes.data;
    
    const name = `${data.firstName?.default || 'Unknown'} ${data.lastName?.default || ''}`.trim();
    console.log(`Player: ${name}`);
    
    const seasons = data.seasonTotals || [];
    
    // Create empty team maps for testing
    const teamMapById = {};
    const teamMapByName = {};
    
    // Test current version
    console.log("\nCURRENT VERSION OUTPUT:");
    const currentTeams = currentExtractTeams(seasons, teamMapById, teamMapByName);
    console.log(JSON.stringify(currentTeams, null, 2));
    
    // Test fixed version
    console.log("\nFIXED VERSION OUTPUT:");
    const fixedTeams = fixedExtractTeams(seasons, teamMapById, teamMapByName);
    console.log(JSON.stringify(fixedTeams, null, 2));
    
    // Show active status
    console.log("\nActive Status in Fixed Version:");
    fixedTeams.forEach(team => {
      console.log(`${team.teamName}: ${team.startYear}-${team.endYear} (Active: ${team.isActive})`);
    });
    
    return {
      name,
      currentTeams,
      fixedTeams
    };
  } catch (error) {
    console.error("Error fetching player data:", error.message);
    return null;
  }
}

// Luke Schenn player ID
const LUKE_SCHENN_ID = 8471677;

// Run the test
(async () => {
  const result = await testPlayerData(LUKE_SCHENN_ID);
  console.log("\nTEST COMPLETE");
})();