import axios from 'axios';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate environment variables
const requiredEnvVars = ['MONGODB_URI', 'DB_NAME', 'COLLECTION_NAME'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  console.error('Please check your .env file is properly configured.');
  console.error('Current NODE_ENV:', process.env.NODE_ENV);
  console.error('Current working directory:', process.cwd());
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

console.log('✅ Environment variables loaded successfully');
console.log(`Database: ${DB_NAME}`);
console.log(`Collection: ${COLLECTION_NAME}`);
console.log(`MongoDB URI: ${MONGODB_URI.substring(0, 20)}...`); // Only show first 20 chars for security

// Request queue to handle rate limiting
class RequestQueue {
  constructor(requestsPerMinute = 30) {
    this.queue = [];
    this.processing = false;
    this.interval = 60000 / requestsPerMinute; // Convert to milliseconds
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
      
      // Ensure minimum time between requests
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

// Enhanced request function with retry logic
async function makeRequestWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url);
      return response;
    } catch (error) {
      if (error.response?.status === 429 || error.response?.status === 503) {
        const waitTime = Math.pow(2, i) * 2000; // Exponential backoff starting at 2 seconds
        console.log(`Rate limited on ${url}, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (error.response?.status >= 500) {
        const waitTime = 1000 * (i + 1); // Linear backoff for server errors
        console.log(`Server error on ${url}, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Max retries exceeded for ${url}`);
}

class NHLScraper {
  constructor() {
    this.client = new MongoClient(MONGODB_URI);
    this.db = null;
    this.collection = null;
    this.requestQueue = new RequestQueue(30); // 30 requests per minute
    this.processedPlayerIds = new Set();
    this.currentYear = new Date().getFullYear();
  }

  async connect() {
    try {
      await this.client.connect();
      this.db = this.client.db(DB_NAME);
      this.collection = this.db.collection(COLLECTION_NAME);
      console.log('✅ Connected to MongoDB');
      
      // Test the connection
      await this.db.admin().ping();
      console.log('✅ MongoDB connection verified');
      
      // Load existing player IDs to avoid duplicates
      const existingPlayers = await this.collection.find({}, { projection: { id: 1 } }).toArray();
      this.processedPlayerIds = new Set(existingPlayers.map(p => p.id));
      console.log(`✅ Loaded ${this.processedPlayerIds.size} existing player IDs`);
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      throw error;
    }
  }

  async disconnect() {
    await this.client.close();
    console.log('✅ Disconnected from MongoDB');
  }

  async bulkUpdatePlayers(playersArray) {
    if (playersArray.length === 0) return;
    
    try {
      const operations = playersArray.map(player => ({
        replaceOne: {
          filter: { id: player.id },
          replacement: {
            ...player,
            lastUpdated: new Date(),
            lastScraped: new Date()
          },
          upsert: true
        }
      }));
      
      const result = await this.collection.bulkWrite(operations);
      console.log(`Bulk update completed: ${result.upsertedCount} new, ${result.modifiedCount} updated`);
      return result;
    } catch (error) {
      console.error('Bulk update failed:', error);
      throw error;
    }
  }

  async saveProgress(teamIndex, processedTeams) {
    const progressData = {
      _id: 'scraper_progress',
      lastTeamIndex: teamIndex,
      processedTeams: processedTeams,
      timestamp: new Date()
    };
    
    await this.db.collection('scraper_progress').replaceOne(
      { _id: 'scraper_progress' },
      progressData,
      { upsert: true }
    );
  }

  async loadProgress() {
    const progress = await this.db.collection('scraper_progress').findOne({ _id: 'scraper_progress' });
    return progress || { lastTeamIndex: 0, processedTeams: [] };
  }

  // Function to fetch all players with pagination
  async fetchAllPlayersWithPagination(franchiseId, playerType) {
    const allPlayers = [];
    const limit = 100; // Maximum allowed by API
    let start = 0;
    let hasMore = true;

    console.log(`    Fetching all ${playerType}s...`);

    while (hasMore) {
      try {
        const url = `https://api.nhle.com/stats/rest/en/${playerType}/summary?cayenneExp=franchiseId=${franchiseId}&limit=${limit}&start=${start}`;
        
        const response = await this.requestQueue.add(() => makeRequestWithRetry(url));
        const data = response.data.data;
        
        if (data && data.length > 0) {
          allPlayers.push(...data);
          console.log(`      Fetched ${data.length} ${playerType}s (${start + 1}-${start + data.length})`);
          
          // Check if we got less than the limit, meaning we've reached the end
          if (data.length < limit) {
            hasMore = false;
          } else {
            start += limit;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error(`    Error fetching ${playerType}s at start=${start}:`, error.message);
        hasMore = false;
      }
    }

    console.log(`    Total ${playerType}s fetched: ${allPlayers.length}`);
    return allPlayers;
  }

  // Helper function to get correct draft team info
  getDraftTeamInfo(draftData) {
    const abbrevToFranchiseIdMap = {
      'MTL': 1, 'OTT': 3, 'TOR': 5, 'BOS': 6, 'NYR': 10, 'CHI': 11, 'DET': 12,
      'SJS': 29, 'LAK': 14, 'DAL': 15, 'PHI': 16, 'PIT': 17, 'STL': 18, 'BUF': 19,
      'VAN': 20, 'CGY': 21, 'NYI': 22, 'NJD': 23, 'WSH': 24, 'EDM': 25, 'CAR': 26,
      'COL': 27, 'ARI': 28, 'TBL': 31, 'ANA': 32, 'FLA': 33, 'NSH': 34, 'WPG': 35,
      'CBJ': 36, 'MIN': 37, 'VGK': 38, 'SEA': 39, 'UTA': 40
    };

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

    if (!draftData || !draftData.year) {
      return {
        year: null,
        round: null,
        pick: null,
        overall: null,
        team: null,
        teamAbbrev: null,
        teamLogo: null
      };
    }

    const originalAbbrev = draftData.teamAbbrev || '';
    let draftFranchiseId = null;
    
    if (originalAbbrev && abbrevToFranchiseIdMap[originalAbbrev]) {
      draftFranchiseId = abbrevToFranchiseIdMap[originalAbbrev];
    }
    
    let correctAbbrev = '';
    
    if (originalAbbrev && abbrevToTeamNameMap[originalAbbrev]) {
      correctAbbrev = originalAbbrev;
    } else if (draftFranchiseId && franchiseLogoMap[draftFranchiseId]) {
      correctAbbrev = franchiseLogoMap[draftFranchiseId];
    } else {
      correctAbbrev = originalAbbrev;
    }
    
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

  // FIXED: Extract NHL teams with metadata, properly handling multiple tenures
  extractTeams(seasons, teamMapById, teamMapByName, franchiseLogoMap, abbrevToTeamNameMap) {
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
            teamLogo: `https://assets.nhle.com/logos/nhl/svg/${currentTenure.teamAbbrev}_light.svg`,
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
        teamLogo: `https://assets.nhle.com/logos/nhl/svg/${currentTenure.teamAbbrev}_light.svg`,
        startYear: currentTenure.startYear,
        endYear: currentTenure.endYear,
        isActive
      });
    }
    
    return tenures;
  }

  async scrapePlayerData() {
    try {
      // Load progress from MongoDB
      const progress = await this.loadProgress();
      let startFromTeam = progress.lastTeamIndex;
      let processedTeams = progress.processedTeams;

      console.log(`Resuming from team index ${startFromTeam}`);
      console.log('Fetching all teams...');
      
      const { data } = await makeRequestWithRetry('https://api.nhle.com/stats/rest/en/team');
      const teams = data.data;
      console.log(`Found ${teams.length} teams.`);

      // Filter for active franchises only
      const activeTeams = teams.filter(team => team.franchiseId && team.active !== false);
      console.log(`Active teams: ${activeTeams.length}`);

      // Build team lookup maps
      const teamMapById = {};
      const teamMapByName = {};
      const abbrevToFranchiseIdMap = {};
      
      for (const team of teams) {
        if (team.franchiseId && team.triCode) {
          abbrevToFranchiseIdMap[team.triCode] = team.franchiseId;
        }
      }

      // Logo mapping by franchiseId
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
        'VGK': 'Vegas Golden Knights', 'SEA': 'Seattle Kraken', 'UTA': 'Utah Mammoth'
      };

      // Build team maps
      for (const t of activeTeams) {
        const franchiseId = t.franchiseId;
        const name = (t.fullName || '').toLowerCase().trim();
        const abbrev = franchiseLogoMap[franchiseId] || t.abbreviation || t.teamName?.abbreviation || '';
        const logo = `https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg`;

        const teamData = {
          teamId: franchiseId,
          teamAbbrev: abbrev,
          teamLogo: logo,
          teamName: t.fullName || ''
        };

        teamMapById[franchiseId] = teamData;
        if (name) teamMapByName[name] = teamData;
      }

      const BATCH_SIZE = 50;
      let batchPlayers = [];
      let totalProcessed = 0;

      // Process teams starting from where we left off
      for (let i = startFromTeam; i < activeTeams.length; i++) {
        const team = activeTeams[i];
        const franchiseId = team.franchiseId;
        
        console.log(`\nProcessing team ${i + 1}/${activeTeams.length}: ${team.fullName || 'Unknown'} (franchiseId: ${franchiseId})`);

        let allPlayers = [];
        
        try {
          // Get all skaters and goalies using pagination
          const skaters = await this.fetchAllPlayersWithPagination(franchiseId, 'skater');
          const goalies = await this.fetchAllPlayersWithPagination(franchiseId, 'goalie');
          
          allPlayers.push(...skaters, ...goalies);
          console.log(`  📊 Total players found: ${allPlayers.length}`);

        } catch (err) {
          console.error(`  Failed to fetch players for team ${team.fullName}:`, err.message);
          continue;
        }

        // Process players
        for (const player of allPlayers) {
          const playerId = player.playerId;
          
          // Skip if already processed
          if (this.processedPlayerIds.has(playerId)) {
            console.log(`    🔄 Skipping duplicate player ID: ${playerId}`);
            continue;
          }
          
          this.processedPlayerIds.add(playerId);

          try {
            const statsRes = await this.requestQueue.add(() => 
              makeRequestWithRetry(`https://api-web.nhle.com/v1/player/${playerId}/landing`)
            );
            const data = statsRes.data;

            const name = `${data.firstName?.default || 'Unknown'} ${data.lastName?.default || ''}`.trim();
            const sweaterNumber = data.sweaterNumber || 'N/A';
            const position = data.position || 'N/A';
            const career = data.careerTotals?.regularSeason || {};
            const seasons = data.seasonTotals || [];

            const silhouette = data.headshot || `https://assets.nhle.com/mugs/nhl/20232024/${playerId}.png`;
            const draftInfo = this.getDraftTeamInfo(data.draftDetails);
            
            // Use the improved extractTeams method to handle multiple tenures correctly
            const teamArray = this.extractTeams(seasons, teamMapById, teamMapByName, franchiseLogoMap, abbrevToTeamNameMap);

            // Only include players who have played for active franchises
            if (teamArray.length > 0) {
              // Determine if player is active based on their latest season
              let isActive = false;
              const latestTeam = teamArray[teamArray.length - 1];
              if (latestTeam) {
                isActive = latestTeam.isActive;
              }

              const playerData = {
                id: playerId,
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

              batchPlayers.push(playerData);
              totalProcessed++;
              
              console.log(`    ✅ Processed player: ${name} (${position}, Active: ${isActive})`);
            }
            
          } catch (err) {
            console.warn(`    ⚠️ Failed to get data for player ID: ${playerId}: ${err.message}`);
          }

          // Save batch when it reaches the batch size
          if (batchPlayers.length >= BATCH_SIZE) {
            await this.bulkUpdatePlayers(batchPlayers);
            batchPlayers = [];
          }
        }
        
        // Save any remaining players in the batch
        if (batchPlayers.length > 0) {
          await this.bulkUpdatePlayers(batchPlayers);
          batchPlayers = [];
        }
        
        // Mark team as processed and save progress
        processedTeams.push(franchiseId);
        await this.saveProgress(i + 1, processedTeams);
        
        console.log(`✅ Completed team ${team.fullName} (${totalProcessed} total players processed)`);
      }

      console.log('\n✅ NHL player data scraping completed!');
      console.log(`Total players processed: ${totalProcessed}`);
      console.log(`Total unique players in database: ${this.processedPlayerIds.size}`);
      
      // Clean up progress tracking
      await this.db.collection('scraper_progress').deleteOne({ _id: 'scraper_progress' });
      
    } catch (err) {
      console.error('❌ Fatal error fetching NHL player data:', err);
      console.log('💡 You can resume by running the script again - progress has been saved to MongoDB');
    }
  }
}

// Main execution function
async function runScraper() {
  const scraper = new NHLScraper();
  
  try {
    await scraper.connect();
    await scraper.scrapePlayerData();
  } catch (error) {
    console.error('Scraping failed:', error);
  } finally {
    await scraper.disconnect();
  }
}

// Run the scraper
runScraper();