

// api/server.js - Express API to serve NHL data



import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

let db;
let collection;
const PORT = process.env.PORT;

// MongoDB setup
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

// Connect to MongoDB
async function connectDB() {
  try {
    console.log('Attempting to connect to MongoDB...');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    collection = db.collection(COLLECTION_NAME);
    console.log('Connected to MongoDB successfully');
    return true;
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    console.log('Server will continue without database connection');
    return false;
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Middleware to check DB connection
const checkDB = (req, res, next) => {
  if (!db || !collection) {
    return res.status(503).json({ 
      error: 'Database not available',
      message: 'MongoDB connection not established'
    });
  }
  next();
};

// Routes
app.get('/api/players', checkDB, async (req, res) => {
  try {
    const { team, position, limit = 100 } = req.query;
    
    let query = {};
    if (team) query.team = team;
    if (position) query.position = position;
    
    const players = await collection
      .find(query)
      .limit(parseInt(limit))
      .toArray();
    
    res.json(players);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

app.get('/api/players/random', checkDB, async (req, res) => {

  try {
    const count = await collection.countDocuments();
    const randomIndex = Math.floor(Math.random() * count);
    const randomPlayer = await collection.find().limit(1).skip(randomIndex).next();
    res.json(randomPlayer);
  } catch (error) {
    console.error('Error getting random player:', error);
    res.status(500).json({ error: 'Failed to get random player' });
  }
});




app.get('/api/players/:id', checkDB, async (req, res) => {
  try {
    const player = await collection.findOne({ 
      id: parseInt(req.params.id) 
    });
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    res.json(player);
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ error: 'Failed to fetch player' });
  }
});

app.get('/api/teams', checkDB, async (req, res) => {
  try {
    const teams = await collection.distinct('team');
    res.json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

app.get('/api/search', checkDB, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    const players = await collection
      .find({
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { team: { $regex: q, $options: 'i' } }
        ]
      })
      .limit(20)
      .toArray();
    
    res.json(players);
  } catch (error) {
    console.error('Error searching players:', error);
    res.status(500).json({ error: 'Failed to search players' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: db ? 'connected' : 'disconnected',
    port: PORT
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
  try {
    console.log(`Starting server on port ${PORT}...`);
    
    // Try to connect to DB but don't exit if it fails
    const dbConnected = await connectDB();
    
    // Start the server regardless of DB connection
    const server = app.listen(PORT, () => {
      console.log(`✅ API server running on port ${PORT}`);
      console.log(`🌐 Access your API at: http://localhost:${PORT}`);
      console.log(`🔍 Health check: http://localhost:${PORT}/health`);
      console.log(`📊 Database status: ${dbConnected ? 'Connected' : 'Disconnected'}`);
    });

    // Handle server errors
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Try a different port.`);
        console.log('You can set a different port with: PORT=3002 node server.js');
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}






startServer();