import fs from 'fs';
import process from 'process';

const filePath = './nhl_players.json';

if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

const rawData = fs.readFileSync(filePath, 'utf8');
const players = JSON.parse(rawData);

const seen = new Set();
const duplicates = [];

for (const player of players) {
  if (seen.has(player.id)) {
    duplicates.push(player);
  } else {
    seen.add(player.id);
  }
}

if (duplicates.length > 0) {
  console.log(`⚠️ Found ${duplicates.length} duplicate player(s):`);
  duplicates.forEach(p => console.log(`- ID: ${p.id}, Name: ${p.name}`));
} else {
  console.log('✅ No duplicate player IDs found!');
}
