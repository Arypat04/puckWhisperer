// hooks/useNHLData.js - Custom React hooks for NHL data
import { useState, useEffect, useRef } from 'react';

const API_BASE_URL = 'https://puckwhisperer-backend.onrender.com/api';

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
// stats.games/goals/assists/points minimums, draft.year, draft.round)
export function useRandomPlayer(filters = {}) {
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasFetched = useRef(false);
  const filtersRef = useRef();

  const fetchRandomPlayer = async (customFilters = null) => {
    try {
      setLoading(true);
      setError(null);
      const activeFilters = customFilters || filters;
      const params = new URLSearchParams(activeFilters);

      const response = await fetch(`${API_BASE_URL}/players/random?${params}`);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to fetch a random player');
      }

      const data = await response.json();
      setPlayer(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Check if filters have changed
  const filtersChanged = JSON.stringify(filters) !== JSON.stringify(filtersRef.current);

  useEffect(() => {
    if (!hasFetched.current || filtersChanged) {
      hasFetched.current = true;
      filtersRef.current = filters;
      fetchRandomPlayer();
    }
  }, [JSON.stringify(filters)]);

  return {
    player,
    loading,
    error,
    refetch: fetchRandomPlayer
  };
}
