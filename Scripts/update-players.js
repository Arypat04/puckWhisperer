import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import {
  makeRequestWithRetry,
  runWithConcurrency,
  fetchActiveTeams,
  buildTeamMaps,
  getDraftTeamInfo,
  extractTeams
} from './nhlShared.js';

// How many player-landing requests to have in flight at once. Empirically
// tested clean against the live NHL API up to 30 concurrent with no
// 429/503s - staying well under that here for margin.
const CONCURRENCY = 15;

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

class NHLUpdater {
  constructor() {
    this.client = new MongoClient(MONGODB_URI);
    this.db = null;
    this.collection = null;
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

  // Detailed change detection with specific field changes
  getPlayerChanges(oldPlayer, newPlayer) {
    const changes = [];

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

    const oldTeams = oldPlayer.teams || [];
    const newTeams = newPlayer.teams || [];

    if (oldTeams.length !== newTeams.length) {
      changes.push(`Team count: ${oldTeams.length} → ${newTeams.length} teams`);
    }

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

  hasPlayerChanged(oldPlayer, newPlayer) {
    return this.getPlayerChanges(oldPlayer, newPlayer).length > 0;
  }

  // Update specific players by filter
  async updatePlayersByFilter(filter = {}, maxPlayers = null) {
    try {
      console.log('Setting up team mappings...');
      const activeTeams = await fetchActiveTeams();
      const { teamMapById, teamMapByName } = buildTeamMaps(activeTeams);

      const cursor = this.collection.find(filter);
      if (maxPlayers) cursor.limit(maxPlayers);

      const playersToUpdate = await cursor.toArray();
      console.log(`Found ${playersToUpdate.length} players to potentially update\n`);

      const batchUpdates = [];
      const BATCH_SIZE = 25;

      const fetchAndDiff = async (oldPlayer, index) => {
        console.log(`Checking ${index + 1}/${playersToUpdate.length}: ${oldPlayer.name}`);

        try {
          const statsRes = await makeRequestWithRetry(`https://api-web.nhle.com/v1/player/${oldPlayer.id}/landing`);
          const data = statsRes.data;

          const name = `${data.firstName?.default || 'Unknown'} ${data.lastName?.default || ''}`.trim();
          const sweaterNumber = data.sweaterNumber || 'N/A';
          const position = data.position || 'N/A';
          const career = data.careerTotals?.regularSeason || {};
          const seasons = data.seasonTotals || [];

          const silhouette = data.headshot || `https://assets.nhle.com/mugs/nhl/20232024/${oldPlayer.id}.png`;
          const draftInfo = getDraftTeamInfo(data.draftDetails);
          const teamArray = extractTeams(seasons, teamMapById, teamMapByName);

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

          return { oldPlayer, changes: this.getPlayerChanges(oldPlayer, newPlayerData), newPlayerData };
        } catch (err) {
          return { oldPlayer, error: err };
        }
      };

      await runWithConcurrency(playersToUpdate, CONCURRENCY, fetchAndDiff, async (results) => {
        for (const result of results) {
          this.updateStats.total++;

          if (result.error) {
            this.updateStats.errors++;
            console.log(`  Failed to update ${result.oldPlayer.name}: ${result.error.message}`);
            continue;
          }

          if (result.changes.length > 0) {
            batchUpdates.push({
              replaceOne: {
                filter: { id: result.oldPlayer.id },
                replacement: { ...result.newPlayerData, lastUpdated: new Date(), lastScraped: new Date() },
                upsert: false
              }
            });
            this.updateStats.updated++;
            console.log(`  UPDATING ${result.oldPlayer.name} - Changes detected:`);
            result.changes.forEach(change => console.log(`     • ${change}`));
          } else {
            this.updateStats.unchanged++;
            console.log(`  No changes detected: ${result.oldPlayer.name}`);
          }
        }

        if (batchUpdates.length >= BATCH_SIZE) {
          await this.collection.bulkWrite(batchUpdates);
          console.log(`\nProcessed batch of ${batchUpdates.length} updates\n`);
          batchUpdates.length = 0;
        }
      });

      if (batchUpdates.length > 0) {
        await this.collection.bulkWrite(batchUpdates);
        console.log(`\nProcessed final batch of ${batchUpdates.length} updates`);
      }

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

  async updateActivePlayers() {
    console.log('Updating active players only...\n');
    await this.updatePlayersByFilter({ isActive: true });
  }

  async updateAllPlayers() {
    console.log('Updating ALL players...\n');
    await this.updatePlayersByFilter({});
  }

  async updatePlayersByTeam(teamAbbrev) {
    console.log(`Updating players from ${teamAbbrev}...\n`);
    await this.updatePlayersByFilter({ 'teams.teamAbbrev': teamAbbrev });
  }

  async updateRecentPlayers(daysAgo = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

    console.log(`Updating players modified since ${cutoffDate.toISOString().split('T')[0]}...\n`);
    await this.updatePlayersByFilter({
      lastUpdated: { $gte: cutoffDate }
    });
  }

  async updatePlayersByName(searchName) {
    console.log(`Searching for players with name containing "${searchName}"...\n`);
    await this.updatePlayersByFilter({
      name: { $regex: searchName, $options: 'i' }
    });
  }

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

main().catch(console.error);
