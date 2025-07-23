import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB connection string - replace with your actual connection string
const MONGODB_URI = '###' // or your MongoDB Atlas URI
const DB_NAME = '###'; // replace with your database name
const COLLECTION_NAME = '###'; // replace with your collection name

// Path to your existing JSON file
const JSON_FILE_PATH = '###'; // adjust path as needed

async function migrateData() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    // Connect to MongoDB
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    // Read your existing JSON file
    const jsonData = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf8'));
    
    // Check if data is an array or object
    let playersArray;
    if (Array.isArray(jsonData)) {
      playersArray = jsonData;
    } else {
      // If it's an object, convert to array
      playersArray = Object.values(jsonData);
    }
    
    console.log(`Found ${playersArray.length} players to migrate`);
    
    // Clear existing data (optional - remove this if you want to keep existing data)
    await collection.deleteMany({});
    console.log('Cleared existing data');
    
    // Insert all players
    // Using insertMany for bulk insert (faster than individual inserts)
    const result = await collection.insertMany(playersArray);
    console.log(`Successfully inserted ${result.insertedCount} players`);
    
    // Create indexes for better performance (optional but recommended)
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ team: 1 });
    await collection.createIndex({ name: 1 });
    console.log('Created indexes');
    
    // Verify the data
    const count = await collection.countDocuments();
    console.log(`Total players in database: ${count}`);
    
    // Show a sample player
    const samplePlayer = await collection.findOne();
    console.log('Sample player:', JSON.stringify(samplePlayer, null, 2));
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.close();
    console.log('Connection closed');
  }
}

// Alternative function if you want to upsert (update existing, insert new)
async function upsertData() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const jsonData = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf8'));
    let playersArray = Array.isArray(jsonData) ? jsonData : Object.values(jsonData);
    
    console.log(`Processing ${playersArray.length} players`);
    
    // Use bulkWrite for efficient upserts
    const operations = playersArray.map(player => ({
      replaceOne: {
        filter: { id: player.id }, // assuming each player has an 'id' field
        replacement: {
          ...player,
          lastUpdated: new Date()
        },
        upsert: true
      }
    }));
    
    const result = await collection.bulkWrite(operations);
    console.log(`Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}`);
    
  } catch (error) {
    console.error('Upsert failed:', error);
  } finally {
    await client.close();
  }
}

// Run the migration
console.log('Starting migration...');
migrateData();

// Or use upsertData() if you prefer upsert behavior
// upsertData();