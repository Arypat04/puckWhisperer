// hooks/useNHLData.js - Custom React hooks for NHL data
import { useState, useEffect, useRef } from 'react';

const API_BASE_URL = 'https://puckwhisperer-backend.onrender.com/api';

// Hook to fetch all players
export function usePlayers(filters = {}) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPlayers = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams(filters);
      const response = await fetch(`${API_BASE_URL}/players?${params}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch players');
      }

      const data = await response.json();
      setPlayers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayers();
  }, [JSON.stringify(filters)]);

  return { players, loading, error, refetch: fetchPlayers };
}


// Hook to fetch a single player
export function usePlayer(playerId) {
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!playerId) return;

    async function fetchPlayer() {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}/players/${playerId}`);
        
        if (!response.ok) {
          throw new Error('Player not found');
        }
        
        const data = await response.json();
        setPlayer(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchPlayer();
  }, [playerId]);

  return { player, loading, error };
}

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

// Hook to fetch teams
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



export function useRandomPlayer() {
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasFetched = useRef(false); // ✅ tracks initial fetch

  const fetchRandomPlayer = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/players/random`);
      const data = await response.json();
      setPlayer(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      fetchRandomPlayer(); // ✅ runs only once
    }
  }, []);

  return { player, loading, error, refetch: fetchRandomPlayer };
}
