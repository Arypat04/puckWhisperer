import { useState, useEffect } from 'react';
import './App.css';
import { usePlayerSearch, useRandomPlayer, useTeams } from '../../Scripts/useNHLData';
import puckLogo from '../5320889F-C24B-44FF-BA4F-626C46DCAB12.png';
import hintLogo from '../src/assets/9E113A00-EBF1-4458-AC2F-58895EF9131F.PNG';
import teamsLogo from '../src/assets/BC0625CC-DCE0-4267-98EF-88D7D80B6FCA.PNG';
import questionMark from '../src/assets/question.png';
import guessLogo from '../src/assets/raw.png';

const EMPTY_FILTERS = {
  position: '',
  team: '',
  sweaterNumber: '',
  'stats.games': '',
  'stats.goals': '',
  'stats.assists': '',
  'stats.points': '',
  'draft.year': '',
  'draft.round': ''
};

// Quick-select game modes. Each maps to boolean filters the backend
// understands. "Award Winners" covers major end-of-season trophies (Hart,
// Norris, Vezina, Calder, etc.) - the NHL API doesn't expose actual
// All-Star Game selections anywhere, so this is the closest real proxy.
const GAME_MODES = [
  { key: 'active', label: 'Active Players', hint: 'Only current NHL players.', filters: { isActive: 'true' } },
  { key: 'all', label: 'All Players', hint: 'Hard mode - includes retired players too.', filters: {} },
  { key: 'awards', label: 'Award Winners', hint: 'Has won a major NHL trophy (Hart, Norris, Vezina, Calder, etc).', filters: { hasAwards: 'true' } },
  { key: 'hof', label: 'Hall of Famers', hint: 'Inducted into the Hockey Hall of Fame.', filters: { hallOfFame: 'true' } },
  { key: 'legends', label: 'Legends', hint: 'NHL’s official Top 100 All-Time list.', filters: { topAllTime: 'true' } }
];
// Derived (not hand-maintained) so it can never drift from GAME_MODES.
const MODE_FILTER_KEYS = [...new Set(GAME_MODES.flatMap(m => Object.keys(m.filters)))];

// Player data stores positions as the NHL API's raw single-letter codes.
// Displayed to players as the full skater abbreviation instead (RW/LW read
// better than a bare "R"/"L"); C/D/G are already unambiguous as-is.
const POSITION_LABELS = { L: 'LW', R: 'RW' };
const formatPosition = (code) => POSITION_LABELS[code] || code || 'N/A';

// Generic fallback icon, used only if a trophy name doesn't match any real
// photo below (e.g. a new award the NHL API starts returning).
function TrophyIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 3h10v6a5 5 0 0 1-10 0V3z" fill="currentColor" />
      <path d="M7 5H4v2a4 4 0 0 0 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M17 5h3v2a4 4 0 0 1-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <rect x="11" y="13" width="2" height="4" fill="currentColor" />
      <rect x="9.5" y="17" width="5" height="2" rx="1" fill="currentColor" />
      <rect x="8" y="19" width="8" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

// Real official trophy photos from NHL Records (records.nhl.com), matched
// against the trophy name by keyword rather than exact string - the NHL
// API's award names vary slightly in punctuation (curly quotes, "Memorial"/
// "Award" suffixes), so substring matching is more robust than an exact map.
const TROPHY_IMAGE_BASE = 'https://records.nhl.com/site/asset/public/images/trophy/';
const TROPHY_IMAGE_RULES = [
  ['stanley cup', 'Stanley-Cup@2x.jpg'],
  ['art ross', 'Art-Ross-Trophy@2x.jpg'],
  ['masterton', 'Bill-Masterton-Trophy@2x.jpg'],
  ['calder', 'Calder-Memorial-Trophy@2x.jpg'],
  ['campbell bowl', 'Clarence-S-Campbell-Bowl@2x.jpg'],
  ['conn smythe', 'Conn-Smythe-Trophy@2x.jpg'],
  ['selke', 'Frank-J-Selke-Trophy@2x.jpg'],
  ['hart memorial', 'Hart-Memorial-Trophy@2x.jpg'],
  ['jack adams', 'Jack-Adams-Award@2x.jpg'],
  ['norris', 'James-Norris-Memorial-Trophy@2x.jpg'],
  ['king clancy', 'King-Clancy-Memorial-Trophy@2x.jpg'],
  ['lady byng', 'Lady-Byng-Memorial-Trophy@2x.jpg'],
  ['lester patrick', 'Lester-Patrick-Trophy@2x.jpg'],
  ['messier', 'Mark-Messier-Leadership-Award@2x.jpg'],
  ['richard', 'Maurice-Richard-Trophy@2x.jpg'],
  ['presidents', 'Presidents-Trophy@2x.jpg'],
  ['prince of wales', 'Prince-of-Wales-Trophy@2x.jpg'],
  ['lindsay', 'Ted-Lindsay-Award@2x.jpg'],
  ['vezina', 'Vezina-Trophy@2x.jpg'],
  ['jennings', 'William-M-Jennings-Trophy@2x.jpg']
];

function getTrophyImageUrl(trophyName) {
  const normalized = trophyName.toLowerCase();
  const rule = TROPHY_IMAGE_RULES.find(([keyword]) => normalized.includes(keyword));
  return rule ? `${TROPHY_IMAGE_BASE}${rule[1]}` : null;
}

// Falls back to the generic TrophyIcon if there's no image rule for this
// trophy, or if the real photo fails to load (e.g. NHL renamed the file).
function TrophyImage({ name, className }) {
  const [failed, setFailed] = useState(false);
  const src = !failed ? getTrophyImageUrl(name) : null;
  if (!src) return <TrophyIcon className={className} />;
  return <img src={src} alt={name} className={className} onError={() => setFailed(true)} />;
}

function App() {
  const [guesses, setGuesses] = useState([]);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState(null);
  const [revealedHints, setRevealedHints] = useState([]);
  const [hasWon, setHasWon] = useState(false);
  const [hasLost, setHasLost] = useState(false);
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [showWelcomePopup, setShowWelcomePopup] = useState(true);
  const [showFilter, setShowFilter] = useState(false);

  const [mode, setMode] = useState(GAME_MODES[0].key);
  const [filters, setFilters] = useState(GAME_MODES[0].filters);
  const [tempFilters, setTempFilters] = useState(EMPTY_FILTERS);

  const { results } = usePlayerSearch(query);
  const { teams } = useTeams();
  const { player: randomPlayer, loading: randomLoading, error: randomError, fetchRandomPlayer } = useRandomPlayer(filters);

  useEffect(() => {
    if (randomPlayer) {
      setCorrectAnswer(randomPlayer);
    }
  }, [randomPlayer]);

  // Starts a brand new round: fetches a player (using whatever filters are
  // passed) and resets every piece of round state together, atomically, so
  // there's never a moment where guesses/hints are stale relative to the
  // player currently on screen. If the fetch fails (e.g. a filter/mode
  // combo matches zero players), the current round is left untouched
  // instead of silently wiping guesses/hints against a stale player.
  const startNewRound = async (filtersForRound = filters) => {
    const result = await fetchRandomPlayer(filtersForRound);
    if (!result) return;
    setGuesses([]);
    setHasWon(false);
    setHasLost(false);
    setRevealedHints([]);
  };

  const handleFilterChange = (key, value) => {
    setTempFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const cleanFineFilters = (source) => Object.entries(source).reduce((acc, [key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {});

  const combineFilters = (modeKey, fineFilters) => {
    const modeFilters = GAME_MODES.find(m => m.key === modeKey)?.filters || {};
    return { ...modeFilters, ...fineFilters };
  };

  const selectMode = async (modeKey) => {
    setMode(modeKey);
    const combined = combineFilters(modeKey, cleanFineFilters(tempFilters));
    setFilters(combined);
    await startNewRound(combined);
  };

  const applyFilters = async () => {
    const combined = combineFilters(mode, cleanFineFilters(tempFilters));
    setFilters(combined);
    setShowFilter(false);
    await startNewRound(combined);
  };

  const clearFilters = async () => {
    setTempFilters(EMPTY_FILTERS);
    setMode(GAME_MODES[0].key);
    const combined = combineFilters(GAME_MODES[0].key, {});
    setFilters(combined);
    await startNewRound(combined);
  };

  const handleHintClick = (hintNumber) => {
    if (!isHintClickable(hintNumber)) return;
    if (!revealedHints.includes(hintNumber)) {
      setRevealedHints([...revealedHints, hintNumber]);
    }
  };

  const isHintClickable = (hintNumber) => {
    if (!correctAnswer || randomLoading) return false;
    return hintNumber === 1 || revealedHints.includes(hintNumber - 1);
  };

  const getStats = (player) => {
    if (!player || !player.stats) return 'Stats unavailable';

    if (player.position === 'G') {
      const savePct = Number(player.stats.savePercentage || 0).toFixed(3);
      const gaa = Number(player.stats.goalsAgainstAverage || 0).toFixed(2);
      return `Games: ${player.stats.games}, Record: ${player.stats.record}, Save %: ${savePct}, GAA: ${gaa}`;
    }
    return `Games: ${player.stats.games}, Goals: ${player.stats.goals}, Assists: ${player.stats.assists}, Points: ${player.stats.points}`;
  };

  const getTrophyChips = (player) => {
    if (!player?.trophies || player.trophies.length === 0) return null;
    return player.trophies.map((t, i) => {
      const wins = t.seasons?.length || 1;
      return (
        <div key={`${t.name}-${i}`} className="trophy-chip" title={wins > 1 ? `${t.name} - won ${wins} times` : t.name}>
          <TrophyImage name={t.name} className="trophy-icon" />
          <span className="trophy-name">{t.name}</span>
          {wins > 1 && <span className="trophy-count">×{wins}</span>}
        </div>
      );
    });
  };

  const getDraftInfo = (player) => {
    if (!player || !player.draft || player.draft.team === null) return 'Undrafted';
    return `Drafted by ${player.draft.team} (${player.draft.year}, Round ${player.draft.round}, Pick ${player.draft.pick})`;
  };

  const getTeamLogos = (player) => {
    if (!player || !player.teams || player.teams.length === 0) {
      return <p className="team-empty">No team history yet</p>;
    }
    return player.teams.map((team) => (
      <div key={`${player.id}-${team.teamId}-${team.startYear}`} className="team-hint">
        <img
          src={`https://assets.nhle.com/logos/nhl/svg/${team.teamAbbrev}_light.svg`}
          alt={team.teamName}
          className="team-logo"
        />
        {revealedHints.includes(1) && <p className="team-years">{team.startYear} - {team.endYear}</p>}
      </div>
    ));
  };

  const handleGuess = (player) => {
    if (!player || guesses.length >= 3 || hasWon || hasLost) return;

    const isCorrect = player.id === correctAnswer?.id;
    const newGuess = {
      name: player.name,
      number: guesses.length + 1,
      correct: isCorrect,
    };

    const updatedGuesses = [...guesses, newGuess];
    setGuesses(updatedGuesses);
    setQuery('');
    setShowSearch(false);

    if (isCorrect) {
      setHasWon(true);
    } else if (updatedGuesses.length >= 3) {
      setHasLost(true);
    }
  };

  const closeAllOverlays = () => {
    setShowSearch(false);
    setShowManualPicker(false);
    setQuery('');
    setShowWelcomePopup(false);
    setShowFilter(false);
    setHasWon(false);
    setHasLost(false);
  };

  const anyOverlayOpen = showSearch || showManualPicker || showWelcomePopup || showFilter || hasWon || hasLost;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (showSearch) setShowSearch(false);
      else if (showManualPicker) {
        setShowManualPicker(false);
        setQuery('');
      } else if (showWelcomePopup) setShowWelcomePopup(false);
      else if (showFilter) setShowFilter(false);
      else if (hasWon) setHasWon(false);
      else if (hasLost) setHasLost(false);
    };

    if (anyOverlayOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [anyOverlayOpen, showSearch, showManualPicker, showWelcomePopup, showFilter, hasWon, hasLost]);

  const getActiveFilterCount = () => Object.keys(filters).filter(k => !MODE_FILTER_KEYS.includes(k)).length;

  const guessDisabled = hasWon || hasLost || guesses.length >= 3 || !correctAnswer || randomLoading;
  const searchTitle = showManualPicker ? 'Choose the Mystery Player' : 'Make Your Guess';
  const currentYear = new Date().getFullYear();
  const trophyChips = revealedHints.includes(4) ? getTrophyChips(correctAnswer) : null;
  const currentModeInfo = GAME_MODES.find(m => m.key === mode) || GAME_MODES[0];

  return (
    <>
      {anyOverlayOpen && <div className="overlay-screen" onClick={closeAllOverlays}></div>}

      {showWelcomePopup && (
        <div className="modal-card welcome-box">
          <button className="dismiss-button" onClick={() => setShowWelcomePopup(false)} aria-label="Close">×</button>
          <h2>Welcome to PuckWhisperer!</h2>
          <div className="rules-content">
            <p className="current-mode-note">
              Current mode: <strong>{currentModeInfo.label}</strong> — {currentModeInfo.hint}
            </p>
            <h3>How to Play</h3>
            <ul>
              <li>Guess the mystery NHL player in 3 tries or less</li>
              <li>Hints unlock in order (1 → 5)</li>
              <li>Hint 1: Years played on each team</li>
              <li>Hint 2: Draft info</li>
              <li>Hint 3: Jersey # and position</li>
              <li>Hint 4: Player stats and trophies</li>
              <li>Hint 5: Silhouette</li>
              <li>Starts on Active Players - use the mode buttons up top to try Hall of Famers, Award Winners, or Hard mode (every player ever)</li>
            </ul>
          </div>
        </div>
      )}

      <div className="header-section">
        <img src={puckLogo} className="puck-logo" alt="Puck Logo" />
        <button className="help-button" onClick={() => setShowWelcomePopup(true)} aria-label="Help">?</button>
      </div>

      <div className="mode-bar">
        {GAME_MODES.map((m) => (
          <button
            key={m.key}
            className={`mode-button ${mode === m.key ? 'selected' : ''}`}
            onClick={() => selectMode(m.key)}
            disabled={randomLoading}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mode-description">{currentModeInfo.hint}</p>

      <div className="main-content">
        <div className="team-section panel">
          <img src={teamsLogo} className="teams-logo" alt="Teams" />
          <div className="team-list" key={correctAnswer?.id}>
            {getTeamLogos(correctAnswer)}
          </div>
        </div>

        <div className="main-game-section panel">
          <img
            src={revealedHints.includes(5) ? correctAnswer?.silhouette : questionMark}
            className="player-mug"
            alt="Mystery player"
          />

          <div className="buttons-section">
            <button
              className="btn btn-primary"
              onClick={() => startNewRound()}
              disabled={randomLoading}
            >
              {randomLoading ? 'Loading…' : 'Random Player'}
            </button>

            {randomError && <p className="random-error">{randomError}</p>}

            <div className="secondary-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowSearch(true)}
                disabled={guessDisabled}
              >
                Guess
              </button>
              <button className="btn btn-secondary" onClick={() => setShowFilter(true)}>
                Filters{getActiveFilterCount() > 0 && ` (${getActiveFilterCount()})`}
              </button>
            </div>

            <button className="btn btn-ghost" onClick={() => setShowManualPicker(true)}>
              Set a custom player instead
            </button>
          </div>

          <div className="hint-grid">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`hint-button ${revealedHints.includes(n) ? 'revealed' : ''}`}
                onClick={() => handleHintClick(n)}
                disabled={!isHintClickable(n)}
              >
                Hint {n}
              </button>
            ))}
          </div>
        </div>

        <div className="hint-section panel">
          <img src={hintLogo} className="hint-logo" alt="Hints" />
          <div className="hint-block-container">
            {!revealedHints.includes(2) && !revealedHints.includes(3) && !revealedHints.includes(4) && (
              <p className="hint-block-empty">Unlock hints below to see clues here</p>
            )}
            {revealedHints.includes(2) && <div className="hint-block">{getDraftInfo(correctAnswer)}</div>}
            {revealedHints.includes(3) && (
              <div className="hint-block">
                Jersey #: {correctAnswer?.sweaterNumber || 'N/A'} · Position: {formatPosition(correctAnswer?.position)}
              </div>
            )}
            {revealedHints.includes(4) && (
              <>
                <div className="hint-block">{getStats(correctAnswer)}</div>
                {trophyChips && <div className="trophy-row">{trophyChips}</div>}
              </>
            )}
          </div>
        </div>
      </div>

      {guesses.length > 0 && (
        <div className="guess-grid">
          <img src={guessLogo} alt="Guesses" className="guess-logo" />
          {guesses.map((guess, index) => (
            <div key={index} className={`guess-card ${guess.correct ? 'correct' : 'incorrect'}`}>
              #{guess.number} · {guess.name} · {guess.correct ? 'Correct' : 'Incorrect'}
            </div>
          ))}
        </div>
      )}

      {(showSearch || showManualPicker) && (
        <div className="search-overlay animate-in">
          <button
            className="dismiss-button"
            onClick={() => {
              setShowSearch(false);
              setShowManualPicker(false);
              setQuery('');
            }}
            aria-label="Close"
          >
            ×
          </button>
          <h3>{searchTitle}</h3>
          <div className="group">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="search-icon">
              <g>
                <path d="M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z" />
              </g>
            </svg>
            <input
              id="query"
              className="input"
              type="search"
              placeholder="Search for a player..."
              name="searchbar"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {query && (
            <div className="dropdown animate-in">
              {results.length > 0 ? (
                results.map((player) => (
                  <div key={player.id} className="dropdown-item">
                    <span>{player.name}</span>
                    <button
                      className="select-button"
                      onClick={() => {
                        if (showManualPicker) {
                          setCorrectAnswer(player);
                          setGuesses([]);
                          setRevealedHints([]);
                          setHasWon(false);
                          setHasLost(false);
                          setShowManualPicker(false);
                        } else {
                          handleGuess(player);
                        }
                        setQuery('');
                      }}
                    >
                      Select
                    </button>
                  </div>
                ))
              ) : (
                <div className="dropdown-empty">No matching players</div>
              )}
            </div>
          )}
        </div>
      )}

      {showFilter && (
        <div className="filter-overlay animate-in">
          <button className="dismiss-button" onClick={() => setShowFilter(false)} aria-label="Close">×</button>
          <div className="filter-header">
            <h3>Filter Players</h3>
          </div>

          <div className="filter-content">
            <div className="filter-section">
              <h4>Basic Info</h4>
              <div className="filter-row">
                <div className="filter-group">
                  <label>Position</label>
                  <select
                    value={tempFilters.position}
                    onChange={(e) => handleFilterChange('position', e.target.value)}
                  >
                    <option value="">Any Position</option>
                    <option value="C">C</option>
                    <option value="L">LW</option>
                    <option value="R">RW</option>
                    <option value="D">D</option>
                    <option value="G">G</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Jersey Number</label>
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={tempFilters.sweaterNumber}
                    onChange={(e) => handleFilterChange('sweaterNumber', e.target.value)}
                  />
                </div>
              </div>
              <div className="filter-row">
                <div className="filter-group">
                  <label>Team</label>
                  <select
                    value={tempFilters.team}
                    onChange={(e) => handleFilterChange('team', e.target.value)}
                  >
                    <option value="">Any Team</option>
                    {teams.map((t) => (
                      <option key={t.teamAbbrev} value={t.teamAbbrev}>{t.teamName}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="filter-section">
              <h4>Career Stats (Minimum)</h4>
              <div className="filter-row">
                <div className="filter-group">
                  <label>Games Played</label>
                  <input
                    type="number"
                    min="0"
                    value={tempFilters['stats.games']}
                    onChange={(e) => handleFilterChange('stats.games', e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label>Goals</label>
                  <input
                    type="number"
                    min="0"
                    value={tempFilters['stats.goals']}
                    onChange={(e) => handleFilterChange('stats.goals', e.target.value)}
                  />
                </div>
              </div>
              <div className="filter-row">
                <div className="filter-group">
                  <label>Assists</label>
                  <input
                    type="number"
                    min="0"
                    value={tempFilters['stats.assists']}
                    onChange={(e) => handleFilterChange('stats.assists', e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label>Points</label>
                  <input
                    type="number"
                    min="0"
                    value={tempFilters['stats.points']}
                    onChange={(e) => handleFilterChange('stats.points', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="filter-section">
              <h4>Draft Info</h4>
              <div className="filter-row">
                <div className="filter-group">
                  <label>Draft Year</label>
                  <input
                    type="number"
                    min="1963"
                    max={currentYear}
                    value={tempFilters['draft.year']}
                    onChange={(e) => handleFilterChange('draft.year', e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label>Draft Round</label>
                  <select
                    value={tempFilters['draft.round']}
                    onChange={(e) => handleFilterChange('draft.round', e.target.value)}
                  >
                    <option value="">Any Round</option>
                    {[1, 2, 3, 4, 5, 6, 7].map(round => (
                      <option key={round} value={round}>Round {round}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="filter-footer">
            <button className="clear-filters-btn" onClick={clearFilters} disabled={randomLoading}>
              Clear All
            </button>
            <button className="apply-filters-btn" onClick={applyFilters} disabled={randomLoading}>
              Apply Filters
            </button>
          </div>
        </div>
      )}

      {hasWon && (
        <div className="modal-card accent-success">
          <button onClick={() => setHasWon(false)} className="dismiss-button" aria-label="Close">×</button>
          <h2>You guessed correctly!</h2>
          <img src={correctAnswer?.silhouette} alt="Player" className="mugshot" />
          <p>{correctAnswer?.name}</p>
          <div className="modal-actions">
            <button
              onClick={async () => {
                setHasWon(false);
                await startNewRound();
              }}
              className="btn btn-primary"
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {hasLost && (
        <div className="modal-card accent-danger">
          <button onClick={() => setHasLost(false)} className="dismiss-button" aria-label="Close">×</button>
          <h2>You ran out of guesses!</h2>
          <img src={correctAnswer?.silhouette} alt="Player" className="mugshot" />
          <p>The answer was <strong>{correctAnswer?.name}</strong></p>
          <div className="modal-actions">
            <button
              onClick={async () => {
                setHasLost(false);
                await startNewRound();
              }}
              className="btn btn-primary"
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
