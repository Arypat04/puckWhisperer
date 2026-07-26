import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import {
  makeRequestWithRetry,
  createRateLimiter,
  runWithConcurrency,
  fetchActiveTeams,
  getDraftTeamInfo,
  extractTeams,
  extractTrophies,
  getBirthInfo,
  stripDiacritics
} from './nhlShared.js';

// How many player-landing requests to have in flight at once. Empirically
// tested clean against the live NHL API up to 30 concurrent with no
// 429/503s - staying well under that here for margin.
const CONCURRENCY = 15;

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

class NHLScraper {
  constructor() {
    this.client = new MongoClient(MONGODB_URI);
    this.db = null;
    this.collection = null;
    // Used only for the sequential team-roster pagination calls below;
    // per-player fetches use bounded concurrency (CONCURRENCY) instead.
    this.throttle = createRateLimiter(600);
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

        const response = await this.throttle(() => makeRequestWithRetry(url));
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

  async scrapePlayerData() {
    try {
      // Load progress from MongoDB
      const progress = await this.loadProgress();
      let startFromTeam = progress.lastTeamIndex;
      let processedTeams = progress.processedTeams;

      console.log(`Resuming from team index ${startFromTeam}`);
      console.log('Fetching all teams...');

      const activeTeams = await fetchActiveTeams();
      console.log(`Active teams: ${activeTeams.length}`);

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

        // Filter out already-processed IDs up front (must be synchronous so
        // concurrent workers below never race on this check).
        const newPlayerIds = [];
        for (const player of allPlayers) {
          const playerId = player.playerId;
          if (this.processedPlayerIds.has(playerId)) {
            console.log(`    🔄 Skipping duplicate player ID: ${playerId}`);
            continue;
          }
          this.processedPlayerIds.add(playerId);
          newPlayerIds.push(playerId);
        }

        const fetchPlayer = async (playerId) => {
          try {
            const statsRes = await makeRequestWithRetry(`https://api-web.nhle.com/v1/player/${playerId}/landing`);
            const data = statsRes.data;

            const name = stripDiacritics(`${data.firstName?.default || 'Unknown'} ${data.lastName?.default || ''}`.trim());
            const sweaterNumber = data.sweaterNumber || 'N/A';
            const position = data.position || 'N/A';
            const career = data.careerTotals?.regularSeason || {};
            const seasons = data.seasonTotals || [];

            const silhouette = data.headshot || `https://assets.nhle.com/mugs/nhl/20232024/${playerId}.png`;
            const draftInfo = await getDraftTeamInfo(data.draftDetails);
            const teamArray = await extractTeams(seasons);
            const trophies = extractTrophies(data.awards);
            const birth = getBirthInfo(data);

            // Only include players who have played for active franchises
            if (teamArray.length === 0) return { playerId, playerData: null };

            const isActive = !!data.isActive;

            const playerData = {
              id: playerId,
              name,
              sweaterNumber,
              position,
              silhouette,
              draft: draftInfo,
              teams: teamArray,
              isActive,
              trophies,
              birth,
              hallOfFame: !!data.inHHOF,
              topAllTime: !!data.inTop100AllTime,

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

            return { playerId, playerData };
          } catch (err) {
            return { playerId, error: err };
          }
        };

        await runWithConcurrency(newPlayerIds, CONCURRENCY, fetchPlayer, async (results) => {
          for (const result of results) {
            if (result.error) {
              console.warn(`    ⚠️ Failed to get data for player ID: ${result.playerId}: ${result.error.message}`);
              continue;
            }
            if (result.playerData) {
              batchPlayers.push(result.playerData);
              totalProcessed++;
              console.log(`    ✅ Processed player: ${result.playerData.name} (${result.playerData.position}, Active: ${result.playerData.isActive})`);
            }
          }

          if (batchPlayers.length >= BATCH_SIZE) {
            await this.bulkUpdatePlayers(batchPlayers);
            batchPlayers = [];
          }
        });

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
