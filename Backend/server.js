

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

// Minimum-value filters (Career Stats section on the frontend)
const MINIMUM_STAT_FIELDS = ['stats.games', 'stats.goals', 'stats.assists', 'stats.points'];
// Exact-match numeric filters
const EXACT_NUMERIC_FIELDS = ['sweaterNumber', 'draft.year', 'draft.round'];
// Game Mode presets: boolean fields, sent as the string "true"/"false".
// Omitted entirely means "don't filter on this" (e.g. isActive omitted =
// include both active and retired players).
const BOOLEAN_FIELDS = { isActive: 'isActive', hallOfFame: 'hallOfFame', topAllTime: 'topAllTime' };

// Only accept plain strings for filter values that flow into the query
// object - defends against operator injection (e.g. a client sending a
// nested object like {$ne: null} for a field) even though Express 5's
// default "simple" query parser doesn't produce nested objects from query
// strings today. Cheap insurance against that changing later.
function asPlainString(value) {
  return typeof value === 'string' ? value : undefined;
}

// Escapes regex metacharacters so user search input is treated as a literal
// substring match instead of an arbitrary regex - prevents ReDoS (e.g. a
// crafted pattern like `(a+)+$`) and surprising wildcard behavior.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Builds a Mongo filter from the query params the frontend's filter panel
// and search/random endpoints send.
function buildPlayerQuery(query) {
  const filter = {};

  const position = asPlainString(query.position);
  if (position) filter.position = position;

  const team = asPlainString(query.team);
  if (team) filter['teams.teamAbbrev'] = team;

  for (const [param, field] of Object.entries(BOOLEAN_FIELDS)) {
    const raw = query[param];
    if (raw === undefined || raw === '') continue;
    filter[field] = raw === 'true';
  }

  if (query.hasAwards === 'true') {
    filter['trophies.0'] = { $exists: true };
  }

  for (const field of MINIMUM_STAT_FIELDS) {
    const raw = query[field];
    if (raw === undefined || raw === '') continue;
    const num = Number(raw);
    if (!Number.isNaN(num)) filter[field] = { $gte: num };
  }

  for (const field of EXACT_NUMERIC_FIELDS) {
    const raw = query[field];
    if (raw === undefined || raw === '') continue;
    const num = Number(raw);
    if (!Number.isNaN(num)) filter[field] = num;
  }

  return filter;
}

// Routes
app.get('/api/players', checkDB, async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const query = buildPlayerQuery(req.query);

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
    const query = buildPlayerQuery(req.query);

    const [randomPlayer] = await collection.aggregate([
      { $match: query },
      { $sample: { size: 1 } }
    ]).toArray();

    if (!randomPlayer) {
      return res.status(404).json({ error: 'No players match the current filters' });
    }

    res.json(randomPlayer);
  } catch (error) {
    console.error('Error getting random player:', error);
    res.status(500).json({ error: 'Failed to get random player' });
  }
});

app.get('/api/teams', checkDB, async (req, res) => {
  try {
    const teams = await collection.aggregate([
      { $unwind: '$teams' },
      { $match: { 'teams.teamAbbrev': { $ne: '' } } },
      { $group: { _id: '$teams.teamAbbrev', teamName: { $first: '$teams.teamName' } } },
      { $project: { _id: 0, teamAbbrev: '$_id', teamName: 1 } },
      { $sort: { teamName: 1 } }
    ]).toArray();

    res.json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
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

app.get('/api/search', checkDB, async (req, res) => {
  try {
    const q = asPlainString(req.query.q);
    if (!q) return res.json([]);

    const players = await collection
      .find({ name: { $regex: escapeRegex(q), $options: 'i' } })
      .limit(20)
      .toArray();
    
    res.json(players);
  } catch (error) {
    console.error('Error searching players:', error);
    res.status(500).json({ error: 'Failed to search players' });
  }
});

// Health check
app.get('/', (req, res) => {
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