import axios from 'axios';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

// Request queue to handle rate limiting
class RequestQueue {
  constructor(requestsPerMinute = 30) {
    this.queue = [];
    this.processing = false;
    this.interval = 60000 / requestsPerMinute;
    this.lastRequestTime = 0;
  }

  async add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const { requestFn, resolve, reject } = this.queue.shift();
      
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.interval) {
        await new Promise(r => setTimeout(r, this.interval - timeSinceLastRequest));
      }
      
      try {
        const result = await requestFn();
        resolve(result);
        this.lastRequestTime = Date.now();
      } catch (error) {
        reject(error);
      }
    }
    
    this.processing = false;
  }
}

async function makeRequestWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url);
      return response;
    } catch (error) {
      if (error.response?.status === 429 || error.response?.status === 503) {
        const waitTime = Math.pow(2, i) * 2000;
        console.log(`Rate limited, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (error.response?.status >= 500) {
        const waitTime = 1000 * (i + 1);
        console.log(`Server error, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Max retries exceeded for ${url}`);
}

class NHLUpdater {
  constructor() {
    this.client = new MongoClient(MONGODB_URI);
    this.db = null;
    this.collection = null;
    this.requestQueue = new RequestQueue(30);
    this.updateStats = {
      total: 0,
      updated: 0,
      unchanged: 0,
      errors: 0
    };
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(DB_NAME);
    this.collection = this.db.collection(COLLECTION_NAME);
    console.log('Connected to MongoDB for updates');
  }

  async disconnect() {
    await this.client.close();
    console.log('Disconnected from MongoDB');
  }

  // Get draft team info (same as scraper)
  getDraftTeamInfo(draftData) {
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

    if (!draftData || !draftData.year) {
      return {
        year: null, round: null, pick: null, overall: null,
        team: null, teamAbbrev: null, teamLogo: null
      };
    }

    const correctAbbrev = draftData.teamAbbrev || '';
    const teamName = abbrevToTeamNameMap[correctAbbrev] || draftData.teamName || '';
    const teamLogo = correctAbbrev ? `https://assets.nhle.com/logos/nhl/svg/${correctAbbrev}_light.svg` : null;

    return {
      year: draftData.year,
      round: draftData.round,
      pick: draftData.pickInRound,
      overall: draftData.overallPick,
      team: teamName,
      teamAbbrev: correctAbbrev,
      teamLogo: teamLogo
    };
  }

  // Extract teams (same logic as scraper)
  extractTeams(seasons, teamMapById, teamMapByName, franchiseLogoMap, abbrevToTeamNameMap) {
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

      const mapped = teamMapById[teamId] || teamMapByName[normalizedName] || {
        teamId: teamId || '', teamAbbrev: '', teamLogo: franchiseLogoMap[teamId] || ''
      };

      const modernTeamName = abbrevToTeamNameMap[mapped.teamAbbrev] || originalTeamName;
      
      allSeasons.push({
        teamName: modernTeamName, teamId: mapped.teamId, teamAbbrev: mapped.teamAbbrev,
        teamLogo: mapped.teamLogo, startYear, endYear, seasonStr
      });
    }
    
    allSeasons.sort((a, b) => a.startYear - b.startYear);
    
    const tenures = [];
    let currentTenure = null;
    
    for (const season of allSeasons) {
      const teamKey = `${season.teamId}_${season.teamName}`;
      
      if (!currentTenure || currentTenure.teamKey !== teamKey) {
        if (currentTenure) {
          const isActive = currentTenure.endYear === currentSeason || 
                           currentTenure.endYear === currentSeason - 1;
          tenures.push({
            teamName: currentTenure.teamName, teamId: currentTenure.teamId,
            teamAbbrev: currentTenure.teamAbbrev,
            teamLogo: `https://assets.nhle.com/logos/nhl/svg/${currentTenure.teamAbbrev}_light.svg`,
            startYear: currentTenure.startYear, endYear: currentTenure.endYear, isActive
          });
        }
        
        currentTenure = {
          teamKey, teamName: season.teamName, teamId: season.teamId,
          teamAbbrev: season.teamAbbrev, teamLogo: season.teamLogo,
          startYear: season.startYear, endYear: season.endYear
        };
      } else {
        currentTenure.endYear = Math.max(currentTenure.endYear, season.endYear);
      }
    }
    
    if (currentTenure) {
      const isActive = currentTenure.endYear === currentSeason || 
                       currentTenure.endYear === currentSeason - 1;
      tenures.push({
        teamName: currentTenure.teamName, teamId: currentTenure.teamId,
        teamAbbrev: currentTenure.teamAbbrev,
        teamLogo: `https://assets.nhle.com/logos/nhl/svg/${currentTenure.teamAbbrev}_light.svg`,
        startYear: currentTenure.startYear, endYear: currentTenure.endYear, isActive
      });
    }
    
    return tenures;
  }

  // Detailed change detection with specific field changes
  getPlayerChanges(oldPlayer, newPlayer) {
    const changes = [];

    // Check basic info
    if (oldPlayer.name !== newPlayer.name) {
      changes.push(`Name: "${oldPlayer.name}" → "${newPlayer.name}"`);
    }
    if (oldPlayer.sweaterNumber !== newPlayer.sweaterNumber) {
      changes.push(`Number: "${oldPlayer.sweaterNumber}" → "${newPlayer.sweaterNumber}"`);
    }
    if (oldPlayer.position !== newPlayer.position) {
      changes.push(`Position: "${oldPlayer.position}" → "${newPlayer.position}"`);
    }
    if (oldPlayer.silhouette !== newPlayer.silhouette) {
      changes.push(`Headshot: Updated`);
    }
    if (oldPlayer.isActive !== newPlayer.isActive) {
      changes.push(`Status: ${oldPlayer.isActive ? 'Active' : 'Inactive'} → ${newPlayer.isActive ? 'Active' : 'Inactive'}`);
    }

    // Check stats changes
    const oldStats = oldPlayer.stats || {};
    const newStats = newPlayer.stats || {};
    
    for (const [key, newValue] of Object.entries(newStats)) {
      const oldValue = oldStats[key];
      if (oldValue !== newValue) {
        if (key === 'record') {
          changes.push(`Record: "${oldValue || 'N/A'}" → "${newValue}"`);
        } else {
          changes.push(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${oldValue || 0} → ${newValue}`);
        }
      }
    }

    // Check team changes (more complex)
    const oldTeams = oldPlayer.teams || [];
    const newTeams = newPlayer.teams || [];
    
    if (oldTeams.length !== newTeams.length) {
      changes.push(`Team count: ${oldTeams.length} → ${newTeams.length} teams`);
    }
    
    // Compare teams in detail
    const maxTeams = Math.max(oldTeams.length, newTeams.length);
    for (let i = 0; i < maxTeams; i++) {
      const oldTeam = oldTeams[i];
      const newTeam = newTeams[i];
      
      if (!oldTeam && newTeam) {
        changes.push(`Added team: ${newTeam.teamAbbrev} (${newTeam.startYear}-${newTeam.endYear})`);
      } else if (oldTeam && !newTeam) {
        changes.push(`Removed team: ${oldTeam.teamAbbrev} (${oldTeam.startYear}-${oldTeam.endYear})`);
      } else if (oldTeam && newTeam) {
        if (oldTeam.teamName !== newTeam.teamName) {
          changes.push(`Team ${i + 1} name: "${oldTeam.teamName}" → "${newTeam.teamName}"`);
        }
        if (oldTeam.startYear !== newTeam.startYear || oldTeam.endYear !== newTeam.endYear) {
          changes.push(`Team ${i + 1} years: ${oldTeam.startYear}-${oldTeam.endYear} → ${newTeam.startYear}-${newTeam.endYear}`);
        }
        if (oldTeam.isActive !== newTeam.isActive) {
          changes.push(`Team ${i + 1} status: ${oldTeam.isActive ? 'Active' : 'Inactive'} → ${newTeam.isActive ? 'Active' : 'Inactive'}`);
        }
      }
    }

    // Check draft info changes
    const oldDraft = oldPlayer.draft || {};
    const newDraft = newPlayer.draft || {};
    
    if (JSON.stringify(oldDraft) !== JSON.stringify(newDraft)) {
      if (oldDraft.year !== newDraft.year || oldDraft.overall !== newDraft.overall) {
        changes.push(`Draft: ${oldDraft.year || 'N/A'} (#${oldDraft.overall || 'N/A'}) → ${newDraft.year || 'N/A'} (#${newDraft.overall || 'N/A'})`);
      }
      if (oldDraft.team !== newDraft.team) {
        changes.push(`Draft team: "${oldDraft.team || 'N/A'}" → "${newDraft.team || 'N/A'}"`);
      }
    }

    return changes;
  }

  // Check if player data has changed (returns boolean)
  hasPlayerChanged(oldPlayer, newPlayer) {
    return this.getPlayerChanges(oldPlayer, newPlayer).length > 0;
  }

  // Update specific players by filter
  async updatePlayersByFilter(filter = {}, maxPlayers = null) {
    try {
      console.log('Setting up team mappings...');
      
      // Get team data for mapping (same as scraper)
      const { data } = await makeRequestWithRetry('https://api.nhle.com/stats/rest/en/team');
      const teams = data.data;
      const activeTeams = teams.filter(team => team.franchiseId && team.active !== false);

      const teamMapById = {};
      const teamMapByName = {};
      
      const franchiseLogoMap = {
        1: 'MTL', 3: 'OTT', 5: 'TOR', 6: 'BOS', 10: 'NYR', 11: 'CHI', 12: 'DET',
        29: 'SJS', 14: 'LAK', 15: 'DAL', 16: 'PHI', 17: 'PIT', 18: 'STL', 19: 'BUF',
        20: 'VAN', 21: 'CGY', 22: 'NYI', 23: 'NJD', 24: 'WSH', 25: 'EDM', 26: 'CAR',
        27: 'COL', 28: 'ARI', 31: 'TBL', 32: 'ANA', 33: 'FLA', 34: 'NSH', 35: 'WPG',
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

      for (const t of activeTeams) {
        const franchiseId = t.franchiseId;
        const name = (t.fullName || '').toLowerCase().trim();
        const abbrev = franchiseLogoMap[franchiseId] || t.abbreviation || '';
        const logo = `https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg`;

        const teamData = { teamId: franchiseId, teamAbbrev: abbrev, teamLogo: logo, teamName: t.fullName || '' };
        teamMapById[franchiseId] = teamData;
        if (name) teamMapByName[name] = teamData;
      }

      // Get players to update
      let query = filter;
      const cursor = this.collection.find(query);
      if (maxPlayers) cursor.limit(maxPlayers);
      
      const playersToUpdate = await cursor.toArray();
      console.log(`Found ${playersToUpdate.length} players to potentially update\n`);

      const batchUpdates = [];
      const BATCH_SIZE = 25;

      for (const [index, oldPlayer] of playersToUpdate.entries()) {
        this.updateStats.total++;
        
        console.log(`Checking ${index + 1}/${playersToUpdate.length}: ${oldPlayer.name}`);

        try {
          const statsRes = await this.requestQueue.add(() => 
            makeRequestWithRetry(`https://api-web.nhle.com/v1/player/${oldPlayer.id}/landing`)
          );
          const data = statsRes.data;

          const name = `${data.firstName?.default || 'Unknown'} ${data.lastName?.default || ''}`.trim();
          const sweaterNumber = data.sweaterNumber || 'N/A';
          const position = data.position || 'N/A';
          const career = data.careerTotals?.regularSeason || {};
          const seasons = data.seasonTotals || [];

          const silhouette = data.headshot || `https://assets.nhle.com/mugs/nhl/20232024/${oldPlayer.id}.png`;
          const draftInfo = this.getDraftTeamInfo(data.draftDetails);
          const teamArray = this.extractTeams(seasons, teamMapById, teamMapByName, franchiseLogoMap, abbrevToTeamNameMap);

          let isActive = false;
          const latestTeam = teamArray[teamArray.length - 1];
          if (latestTeam) isActive = latestTeam.isActive;

          const newPlayerData = {
            id: oldPlayer.id,
            name,
            sweaterNumber,
            position,
            silhouette,
            draft: draftInfo,
            teams: teamArray,
            isActive,
            stats: position === 'G' ? {
              games: career.gamesPlayed || 0,
              wins: career.wins || 0,
              losses: career.losses || 0,
              ot: career.otLosses || 0,
              record: `${career.wins || 0}-${career.losses || 0}-${career.otLosses || 0}`,
              savePercentage: career.savePctg || 0,
              goalsAgainstAverage: career.goalsAgainstAvg || 0
            } : {
              goals: career.goals || 0,
              assists: career.assists || 0,
              points: career.points || 0,
              games: career.gamesPlayed || 0
            }
          };

          const changes = this.getPlayerChanges(oldPlayer, newPlayerData);

          if (changes.length > 0) {
            batchUpdates.push({
              replaceOne: {
                filter: { id: oldPlayer.id },
                replacement: { ...newPlayerData, lastUpdated: new Date(), lastScraped: new Date() },
                upsert: false
              }
            });
            this.updateStats.updated++;
            console.log(`  UPDATING - Changes detected:`);
            changes.forEach(change => console.log(`     • ${change}`));
          } else {
            this.updateStats.unchanged++;
            console.log(`  No changes detected`);
          }

          // Process batch when full
          if (batchUpdates.length >= BATCH_SIZE) {
            await this.collection.bulkWrite(batchUpdates);
            console.log(`\nProcessed batch of ${batchUpdates.length} updates\n`);
            batchUpdates.length = 0;
          }

        } catch (err) {
          this.updateStats.errors++;
          console.log(`  Failed to update: ${err.message}`);
        }
      }

      // Process remaining updates
      if (batchUpdates.length > 0) {
        await this.collection.bulkWrite(batchUpdates);
        console.log(`\nProcessed final batch of ${batchUpdates.length} updates`);
      }

      // Print summary
      console.log('\n' + '='.repeat(50));
      console.log('UPDATE SUMMARY');
      console.log('='.repeat(50));
      console.log(`Total players checked: ${this.updateStats.total}`);
      console.log(`Players updated: ${this.updateStats.updated}`);
      console.log(`Players unchanged: ${this.updateStats.unchanged}`);
      console.log(`Errors: ${this.updateStats.errors}`);
      console.log('='.repeat(50));

    } catch (err) {
      console.error('Update process failed:', err);
      throw err;
    }
  }

  // Update only active players (most common use case)
  async updateActivePlayers() {
    console.log('Updating active players only...\n');
    await this.updatePlayersByFilter({ isActive: true });
  }

  // Update all players
  async updateAllPlayers() {
    console.log('Updating ALL players...\n');
    await this.updatePlayersByFilter({});
  }

  // Update players from specific team(s)
  async updatePlayersByTeam(teamAbbrev) {
    console.log(`Updating players from ${teamAbbrev}...\n`);
    await this.updatePlayersByFilter({ 'teams.teamAbbrev': teamAbbrev });
  }

  // Update recently modified players (within X days)
  async updateRecentPlayers(daysAgo = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
    
    console.log(`Updating players modified since ${cutoffDate.toISOString().split('T')[0]}...\n`);
    await this.updatePlayersByFilter({ 
      lastUpdated: { $gte: cutoffDate } 
    });
  }

  // Update players by name search (partial match)
  async updatePlayersByName(searchName) {
    console.log(`Searching for players with name containing "${searchName}"...\n`);
    await this.updatePlayersByFilter({ 
      name: { $regex: searchName, $options: 'i' }
    });
  }

  // Update specific player by exact name
  async updatePlayerByExactName(exactName) {
    console.log(`Updating player with exact name "${exactName}"...\n`);
    await this.updatePlayersByFilter({ name: exactName });
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'active';

  const updater = new NHLUpdater();
  
  try {
    await updater.connect();
    
    switch (command) {
      case 'active':
        await updater.updateActivePlayers();
        break;
      case 'all':
        await updater.updateAllPlayers();
        break;
      case 'team':
        const teamAbbrev = args[1];
        if (!teamAbbrev) {
          console.error('Please provide team abbreviation: node update-players.js team TOR');
          process.exit(1);
        }
        await updater.updatePlayersByTeam(teamAbbrev.toUpperCase());
        break;
      case 'recent':
        const days = parseInt(args[1]) || 30;
        await updater.updateRecentPlayers(days);
        break;
      case 'name':
        const searchName = args.slice(1).join(' ');
        if (!searchName) {
          console.error('Please provide a name to search: node update-players.js name "Connor McDavid"');
          console.error('Or partial name: node update-players.js name McDavid');
          process.exit(1);
        }
        await updater.updatePlayersByName(searchName);
        break;
      case 'exact':
        const exactName = args.slice(1).join(' ');
        if (!exactName) {
          console.error('Please provide exact full name: node update-players.js exact "Connor McDavid"');
          process.exit(1);
        }
        await updater.updatePlayerByExactName(exactName);
        break;
      default:
        console.log('Available commands:');
        console.log('  active           - Update only active players (default)');
        console.log('  all              - Update all players');
        console.log('  team TOR         - Update players from specific team');
        console.log('  recent 7         - Update players modified in last X days');
        console.log('  name McDavid     - Update players with name containing "McDavid"');
        console.log('  name "Connor M"  - Update players with name containing "Connor M"');
        console.log('  exact "Connor McDavid" - Update player with exact name match');
        break;
    }
    
  } catch (error) {
    console.error('Update failed:', error);
  } finally {
    await updater.disconnect();
  }
}

// Run the main function
main().catch(console.error);