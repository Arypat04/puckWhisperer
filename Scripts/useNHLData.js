// hooks/useNHLData.js - Custom React hooks for NHL data
import { useState, useEffect, useRef } from 'react';

export const API_BASE_URL = 'https://puckwhisperer-backend-182082656275.us-central1.run.app/api';

// Hook to search players
export function usePlayerSearch(query) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    async function searchPlayers() {
      try {
        setLoading(true);
        const response = await fetch(
          `${API_BASE_URL}/search?q=${encodeURIComponent(query)}`
        );

        if (!response.ok) {
          throw new Error('Search failed');
        }

        const data = await response.json();
        setResults(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    const debounce = setTimeout(searchPlayers, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  return { results, loading, error };
}

// Hook to fetch the list of teams (for the filter dropdown)
export function useTeams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchTeams() {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}/teams`);

        if (!response.ok) {
          throw new Error('Failed to fetch teams');
        }

        const data = await response.json();
        setTeams(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchTeams();
  }, []);

  return { teams, loading, error };
}

// Hook to get a random player, optionally filtered (position, sweaterNumber,
// stats.games/goals/assists/points minimums, draft.year, draft.round,
// isActive/hasAwards/hallOfFame/topAllTime game-mode presets).
// Fetches once on mount using `initialFilters`; every fetch after that is
// explicit (call fetchRandomPlayer(filters) yourself) - filter state
// changing on its own must never silently swap the active player out from
// under a round.
export function useRandomPlayer(initialFilters = {}) {
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const hasFetched = useRef(false);

  const fetchRandomPlayer = async (filters = {}) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams(filters);

      const response = await fetch(`${API_BASE_URL}/players/random?${params}`);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to fetch a random player');
      }

      const data = await response.json();
      setPlayer(data);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      fetchRandomPlayer(initialFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { player, loading, error, fetchRandomPlayer };
}

// Hook for the deterministic daily-challenge player (same player for every
// visitor on a given UTC day - see Backend's /api/players/daily). Never
// auto-fetches on mount; the caller decides when a fetch is needed (e.g. on
// first render, to check whether today's challenge was already completed,
// and again whenever the player opens the Daily Challenge button).
export function useDailyPlayer() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchDailyPlayer = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/players/daily`);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to fetch the daily player');
      }

      return await response.json();
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, fetchDailyPlayer };
}
