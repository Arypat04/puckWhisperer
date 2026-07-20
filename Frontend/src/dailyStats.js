// dailyStats.js - localStorage-backed daily challenge results and lifetime
// stats. All reads/writes are wrapped in try/catch since localStorage can
// throw in private-browsing/storage-disabled contexts - the game should
// keep working (just without persistence) rather than crash.

const STATS_KEY = 'puckwhisperer_stats';
const DAILY_KEY_PREFIX = 'puckwhisperer_daily_';
const DEFAULT_STATS = { totalPlayed: 0, totalWon: 0, dailyStreak: 0, maxDailyStreak: 0, lastDailyDate: null };

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) - drop silently.
  }
}

export function getDailyRecord(dateStr) {
  return readJSON(`${DAILY_KEY_PREFIX}${dateStr}`, null);
}

function saveDailyRecord(dateStr, record) {
  writeJSON(`${DAILY_KEY_PREFIX}${dateStr}`, record);
}

export function getStats() {
  return { ...DEFAULT_STATS, ...readJSON(STATS_KEY, {}) };
}

function saveStats(stats) {
  writeJSON(STATS_KEY, stats);
}

function isNextCalendarDay(prevDateStr, dateStr) {
  const diff = new Date(`${dateStr}T00:00:00Z`) - new Date(`${prevDateStr}T00:00:00Z`);
  return diff === 86400000;
}

export function updateAggregateStats({ won, isDaily, dateStr }) {
  const stats = getStats();
  stats.totalPlayed += 1;
  if (won) stats.totalWon += 1;

  if (isDaily) {
    const consecutive = stats.lastDailyDate && isNextCalendarDay(stats.lastDailyDate, dateStr);
    stats.dailyStreak = won ? (consecutive ? stats.dailyStreak + 1 : 1) : 0;
    stats.maxDailyStreak = Math.max(stats.maxDailyStreak, stats.dailyStreak);
    stats.lastDailyDate = dateStr;
  }

  saveStats(stats);
  return stats;
}

// Persists a completed daily round and rolls it into the lifetime stats.
// `guesses` only needs each guess's correctness - trimmed down before
// storage so the share-result grid can be rebuilt without keeping player
// names (which would spoil the answer for anyone reading localStorage).
// Idempotent per date: only the first call for a given day touches the
// aggregate stats/streak, so a duplicate call (e.g. two tabs open on the
// same daily round) can't double-count it.
export function recordDailyResult({ dateStr, won, guesses }) {
  const alreadyRecorded = !!getDailyRecord(dateStr);
  const record = {
    dailyDate: dateStr,
    won,
    guesses: guesses.map(g => ({ correct: g.correct }))
  };
  saveDailyRecord(dateStr, record);
  if (!alreadyRecorded) {
    updateAggregateStats({ won, isDaily: true, dateStr });
  }
  return record;
}

export function buildShareText({ won, guesses, origin }) {
  const squares = guesses.map(g => (g.correct ? '🟩' : '🟥')).join('');
  const result = won ? `${guesses.length}/3` : 'X/3';
  return `PuckWhisperer Daily Challenge ${result}\n${squares}\n${origin}`;
}
