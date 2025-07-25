import { useState, useEffect } from 'react';
import './App.css';
import { usePlayerSearch, useRandomPlayer } from '../../Scripts/useNHLData';
import puckLogo from '../src/assets/5320889F-C24B-44FF-BA4F-626C46DCAB12.png';
import hintLogo from '../src/assets/9E113A00-EBF1-4458-AC2F-58895EF9131F.PNG';
import teamsLogo from '../src/assets/BC0625CC-DCE0-4267-98EF-88D7D80B6FCA.PNG';
import questionMark from '../src/assets/question.png';
import guessLogo from '../src/assets/raw.png';

function App() {
  const [guesses, setGuesses] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState(null);
  const [revealedHints, setRevealedHints] = useState([]);
  const [hasWon, setHasWon] = useState(false);
  const [hasLost, setHasLost] = useState(false);
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [showNewPlayerOptions, setShowNewPlayerOptions] = useState(false);
  const [showWelcomePopup, setShowWelcomePopup] = useState(true);

  const { results } = usePlayerSearch(query);
  const {
    player: randomPlayer,
    loading: randomLoading,
    refetch: getNewRandomPlayer,
  } = useRandomPlayer();

  useEffect(() => {
    if (randomPlayer) {
      setCorrectAnswer(randomPlayer);
      setRevealedHints([]);
    }
  }, [randomPlayer]);

  const handleNewPlayer = async () => {
    await getNewRandomPlayer();
    setGuesses([]);
    setHasWon(false);
    setHasLost(false);
    setRevealedHints([]);
  };

  const handleHintClick = (hintNumber) => {
    if (hintNumber === 1 || revealedHints.includes(hintNumber - 1)) {
      if (!revealedHints.includes(hintNumber)) {
        setRevealedHints([...revealedHints, hintNumber]);
      }
    }
  };

  const isHintClickable = (hintNumber) => {
    return hintNumber === 1 || revealedHints.includes(hintNumber - 1);
  };

  const getStats = (player) => {
    if (player?.position === 'G') {
      return `Games: ${player.stats.games}, Record: ${player.stats.record}, Save %: ${player.stats.savePercentage}, GAA: ${player.stats.goalsAgainstAverage}`;
    } else {
      return `Games: ${player.stats.games}, Goals: ${player.stats.goals}, Assists: ${player.stats.assists}, Points: ${player.stats.points}`;
    }
  };

  const getDraftInfo = (player) => {
    if (player?.draft.team !== null) {
      return `Drafted by ${player.draft.team} (${player.draft.year}, Round ${player.draft.round}, Pick ${player.draft.pick})`;
    }
    return 'Undrafted';
  };

  const getTeamLogos = (player) => {
    if (!player || !player.teams) return null;
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

  const handleGuess = (player = selectedPlayer) => {
    if (!player || guesses.length >= 3 || hasWon) return;

    const isCorrect = player.id === correctAnswer?.id;
    const newGuess = {
      name: player.name,
      number: guesses.length + 1,
      correct: isCorrect,
    };

    const updatedGuesses = [...guesses, newGuess];
    setGuesses(updatedGuesses);
    setQuery('');
    setSelectedPlayer(null);
    setShowSearch(false);

    if (isCorrect) {
      setHasWon(true);
    } else if (updatedGuesses.length >= 3) {
      setHasLost(true);
    }
  };

  const handleSelect = (player) => {
    handleGuess(player);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showSearch) setShowSearch(false);
        else if (showManualPicker) {
          setShowManualPicker(false);
          setQuery('');
        } else if (showNewPlayerOptions) setShowNewPlayerOptions(false);
        else if (showWelcomePopup) setShowWelcomePopup(false);
      }
    };

    if (showSearch || showManualPicker || showNewPlayerOptions || showWelcomePopup) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, showManualPicker, showNewPlayerOptions, showWelcomePopup]);

  return (
    <>
      {(showSearch || showManualPicker || showNewPlayerOptions || showWelcomePopup) && (
        <div className="overlay-screen"></div>
      )}

      {showWelcomePopup && (
        <>
        <button className="dismiss-button" onClick={() => setShowWelcomePopup(false)}>✖ Close</button>
        

          <div className="welcome-box">
            <h2>Welcome to PuckWhisperer!</h2>
            <div className="rules-content">
              <h3>How to Play:</h3>
              <ul>
                <li>Guess the mystery NHL player in 3 tries or less</li>
                <li>Use hints to help you - they unlock in order (1, 2, 3, 4, 5)</li>
                <li>Hint 1: Years played on specific teams</li>
                <li>Hint 2: Draft info</li>
                <li>Hint 3: Jersey # and position</li>
                <li>Hint 4: Player stats</li>
                <li>Hint 5: Silhouette</li>
              </ul>
            </div>
          </div>
        
        </>
      )}

      <div className="header-section">
        <img src={puckLogo} className="puck-logo" alt="Puck Logo" />
      </div>

      <div className="main-content">
        {/* Left Side - Teams */}
        <div className="team-section">
          <img src={teamsLogo} className="teams-logo" alt="Teams Logo" />
          <div className="team-list" key={correctAnswer?.id}>
            {getTeamLogos(correctAnswer)}
          </div>
        </div>

        {/* Center - Main Game */}
        <div className="main-game-section">
          <img
            src={revealedHints.includes(5) ? correctAnswer?.silhouette : questionMark}
            className="player-mug"
            alt="Player"
          />

          {(showSearch || showManualPicker) && (
                <>
                <button
                className="dismiss-button"
                onClick={() => {
                  setShowSearch(false);
                  setShowManualPicker(false);
                  setQuery('');
                }}
              >
                ✖ Close
              </button>
            <div className="search-overlay">


              <div className="group animate-in">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="search-icon">
                  <g>
                    <path d="M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z" />
                  </g>
                </svg>
                <input
                  id="query"
                  className="input"
                  type="search"
                  placeholder="Search..."
                  name="searchbar"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {query && results.length > 0 && (
                <div className="dropdown animate-in">
                  {results.map((player) => (
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
                            handleSelect(player);
                          }
                          setQuery('');
                        }}
                      >
                        Select
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
          )}

          <div className="buttons-section">
            {!showNewPlayerOptions && (
              <button
                className="new-player-button"
                onClick={() => setShowNewPlayerOptions(true)}
                disabled={randomLoading}
              >
                {randomLoading ? 'Loading...' : 'New Player'}
              </button>
            )}

            <button className="guess-button" onClick={() => setShowSearch(true)}>
              Guess
            </button>
          </div>
      
        <div className="hint-grid">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={`hint-button ${!isHintClickable(n) ? 'disabled' : ''}`}
              onClick={() => handleHintClick(n)}
              disabled={!isHintClickable(n)}
            >
              Hint {n}
            </button>
          ))}
        </div>
      </div>

              <div className="hint-section">
          <img src={hintLogo} className="hint-logo" alt="Hint Logo" />
          <div className="hint-block-container">
            {revealedHints.includes(2) && <div className="hint-block">{getDraftInfo(correctAnswer)}</div>}
            {revealedHints.includes(3) && (
              <div className="hint-block">
                Jersey #: {correctAnswer?.sweaterNumber || 'N/A'} | Position: {correctAnswer?.position || 'N/A'}
              </div>
            )}
            {revealedHints.includes(4) && <div className="hint-block">{getStats(correctAnswer)}</div>}
          </div>
        </div>
      </div>

                <div className="guess-grid">
                  <img src={guessLogo} alt="Guess Logo" className="guess-logo" />
            {guesses.map((guess, index) => (
              <div key={index} className="guess-card">
                Guess #{guess.number} – {guess.name} – {guess.correct ? '✅' : '❌'}
              </div>
            ))}
          </div>
   

          {showNewPlayerOptions && (
            <>
              <button className="dismiss-button" onClick={() => setShowNewPlayerOptions(false)}>✖ Close</button>
              <div className="new-player-options">
                <button className="option-button" onClick={async () => {
                  await handleNewPlayer();
                  setShowNewPlayerOptions(false);
                }}>
                  Random Player
                </button>
                <button className="option-button" onClick={() => {
                  setShowManualPicker(true);
                  setShowNewPlayerOptions(false);
                }}>
                  Manual Player
                </button>
              </div>
            </>
          )}



        {/* Right Side - Hints */}




      {hasWon && (
          <>
          <button onClick={() => setHasWon(false)} className="dismiss-button">✖ Close</button>
          <div className="win-box">
            
            <h2>You guessed correctly!</h2>
            <img src={correctAnswer?.silhouette} alt="Player mugshot" className="mugshot" />
            <p>{correctAnswer?.name}</p>
            
          </div>
          </>
      )}

      {hasLost && (
          <>
          <button onClick={() => setHasLost(false)} className="dismiss-button">✖ Close</button>
          <div className="lose-box">
            <h2>You ran out of guesses!</h2>
            <img src={correctAnswer?.silhouette} alt="Player mugshot" className="mugshot" />
            <p>The answer was: <strong>{correctAnswer?.name}</strong></p>
            <div className="modal-buttons">
              
              <button onClick={async () => {
                await handleNewPlayer();
                setHasLost(false);
              }} className="new-game-button">
                New Game
              </button>
            </div>
          </div>
          </>
      )}
    </>
  );
}

export default App;