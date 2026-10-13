import { useState, useEffect, useRef } from 'react';
import './App.css';
import { API_BASE_URL, usePlayerSearch, useRandomPlayer, useTeams, useDailyPlayer } from '../../Scripts/useNHLData';
import {
  getDailyRecord,
  getDailyProgress,
  getStats as getLifetimeStats,
  loadRound,
  saveRound,
  loadPrefs,
  savePrefs,
  saveDailyProgress,
  recordDailyResult,
  updateAggregateStats,
  buildShareText,
  currentStreak
} from './dailyStats';
import { track, trackVisit } from './analytics';
import { buildShareImage } from './shareImage';
import puckLogo from '../5320889F-C24B-44FF-BA4F-626C46DCAB12.png';
import questionMark from '../src/assets/question.png';

const DONATE_URL = 'https://buymeacoffee.com/puckwhisperer';

// Shared text links carry utm_source=share so GA can count the visits shares bring in.
const SHARE_LINK = `${window.location.origin}/?utm_source=share`;

const SHARE_IMAGE_LABELS = {
  idle: 'Share image',
  working: 'Making image…',
  shared: 'Shared!',
  copied: 'Image copied!',
  saved: 'Image saved',
  failed: "Couldn't share",
};

const formatDailyDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// The how-to-play dialog opens on a first visit only; the "?" button reopens it.
const WELCOME_KEY = 'puckwhisperer_welcome_seen';
const hasSeenWelcome = () => {
  try { return window.localStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; }
};

const iconProps = {
  viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
};
const ChartIcon = () => (
  <svg {...iconProps}>
    <path d="M5 20v-7M12 20V5M19 20v-10" />
  </svg>
);

// What each hint reveals, in unlock order. Hint 5 is the player's photo.
const HINT_LABELS = ['Draft', 'Number', 'Origin', 'Stats', 'Photo'];

// The data hooks surface raw server/network messages ("Failed to fetch"); show
// what happened and what to do instead. The one case the player can fix
// themselves (filters that match nobody) gets its own message.
const NO_MATCH_ERROR = 'No players match the current filters';
const roundErrorText = (message) => (message === NO_MATCH_ERROR
  ? 'No players match these filters. Open Filters to loosen them, or pick another mode.'
  : "Couldn't load a player. Check your connection and try again.");
const DAILY_ERROR_TEXT = "Couldn't load today's Daily Challenge. Check your connection and try again.";

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
  { key: 'modern', label: 'Modern Era', hint: 'Played sometime in the last 15 years - active players plus recently retired ones.', filters: { modernEra: 'true' } },
  { key: 'all', label: 'All Players', hint: 'Hard mode - includes retired players too.', filters: {} },
  { key: 'awards', label: 'Award Winners', hint: 'Has won an individual NHL trophy (Hart, Norris, Vezina, Calder, etc) - not counting the Stanley Cup.', filters: { hasAwards: 'true' } },
  { key: 'cup', label: 'The Cup', hint: 'Has won the Stanley Cup.', filters: { hasCup: 'true' } },
  { key: 'hof', label: 'Hall of Famers', hint: 'Inducted into the Hockey Hall of Fame.', filters: { hallOfFame: 'true' } },
  { key: 'legends', label: 'Legends', hint: 'NHL’s official Top 100 All-Time list.', filters: { topAllTime: 'true' } },
  { key: 'games100', label: '100+ Games', hint: 'Played at least 100 career games - filters out one-game call-ups.', filters: { 'stats.games': '100' } },
  { key: 'games500', label: '500+ Games', hint: 'A real NHL career - at least 500 games played.', filters: { 'stats.games': '500' } },
  { key: 'games1000', label: '1,000+ Games', hint: 'Ironman territory - at least 1,000 career games.', filters: { 'stats.games': '1000' } },
  { key: 'goals500', label: '500 Goal Club', hint: 'One of hockey’s classic scoring milestones - at least 500 career goals.', filters: { 'stats.goals': '500' } },
  { key: 'points1000', label: '1,000 Point Club', hint: 'A legendary offensive milestone - at least 1,000 career points.', filters: { 'stats.points': '1000' } },
  { key: 'goalieWins300', label: '300+ Goalie Wins', hint: 'Elite winning goaltenders only - at least 300 career wins.', filters: { position: 'G', 'stats.wins': '300' } }
];
// Derived (not hand-maintained) so it can never drift from GAME_MODES.
const MODE_FILTER_KEYS = [...new Set(GAME_MODES.flatMap(m => Object.keys(m.filters)))];

// Groups modes for the mode-picker modal. Every GAME_MODES key must appear
// in exactly one group here.
const MODE_GROUPS = [
  { title: 'Difficulty', keys: ['active', 'modern', 'all'] },
  { title: 'Achievements', keys: ['awards', 'cup', 'hof', 'legends'] },
  { title: 'Milestones', keys: ['games100', 'games500', 'games1000', 'goals500', 'points1000', 'goalieWins300'] }
];

// Player data stores positions as the NHL API's raw single-letter codes.
// Displayed to players as the full skater abbreviation instead (RW/LW read
// better than a bare "R"/"L"); C/D/G are already unambiguous as-is.
const POSITION_LABELS = { L: 'LW', R: 'RW' };
const formatPosition = (code) => POSITION_LABELS[code] || code || 'N/A';

// birth.country is an ISO 3166-1 alpha-3 code straight from the NHL API.
// Covers every country that's produced an NHL player historically; an
// unmapped code just falls back to showing the raw code with no flag.
const COUNTRY_MAP = {
  CAN: ['Canada', '🇨🇦'], USA: ['United States', '🇺🇸'], RUS: ['Russia', '🇷🇺'],
  SWE: ['Sweden', '🇸🇪'], FIN: ['Finland', '🇫🇮'], CZE: ['Czechia', '🇨🇿'],
  SVK: ['Slovakia', '🇸🇰'], CHE: ['Switzerland', '🇨🇭'], DEU: ['Germany', '🇩🇪'],
  DNK: ['Denmark', '🇩🇰'], NOR: ['Norway', '🇳🇴'], AUT: ['Austria', '🇦🇹'],
  LVA: ['Latvia', '🇱🇻'], SVN: ['Slovenia', '🇸🇮'], FRA: ['France', '🇫🇷'],
  GBR: ['United Kingdom', '🇬🇧'], JPN: ['Japan', '🇯🇵'], KAZ: ['Kazakhstan', '🇰🇿'],
  BLR: ['Belarus', '🇧🇾'], UKR: ['Ukraine', '🇺🇦'], ITA: ['Italy', '🇮🇹'],
  POL: ['Poland', '🇵🇱'], HUN: ['Hungary', '🇭🇺'], AUS: ['Australia', '🇦🇺'],
  NZL: ['New Zealand', '🇳🇿'], KOR: ['South Korea', '🇰🇷'], CHN: ['China', '🇨🇳'],
  BIH: ['Bosnia and Herzegovina', '🇧🇦'], EST: ['Estonia', '🇪🇪'], LTU: ['Lithuania', '🇱🇹'],
  NLD: ['Netherlands', '🇳🇱'], BEL: ['Belgium', '🇧🇪'], ESP: ['Spain', '🇪🇸'],
  BRA: ['Brazil', '🇧🇷'], MEX: ['Mexico', '🇲🇽'], JAM: ['Jamaica', '🇯🇲'],
  ZAF: ['South Africa', '🇿🇦'], IRL: ['Ireland', '🇮🇪'], HRV: ['Croatia', '🇭🇷'],
  SRB: ['Serbia', '🇷🇸'], ROU: ['Romania', '🇷🇴'], BGR: ['Bulgaria', '🇧🇬'],
  ISL: ['Iceland', '🇮🇸'], THA: ['Thailand', '🇹🇭'], IND: ['India', '🇮🇳'],
  NGA: ['Nigeria', '🇳🇬'], TWN: ['Taiwan', '🇹🇼'], HKG: ['Hong Kong', '🇭🇰'],
  ARE: ['United Arab Emirates', '🇦🇪'], VEN: ['Venezuela', '🇻🇪'], COL: ['Colombia', '🇨🇴'],
  ARG: ['Argentina', '🇦🇷'], CHL: ['Chile', '🇨🇱'], PRI: ['Puerto Rico', '🇵🇷'],
  TTO: ['Trinidad and Tobago', '🇹🇹'], LBN: ['Lebanon', '🇱🇧'], ISR: ['Israel', '🇮🇱'],
  BHR: ['Bahrain', '🇧🇭'], BHS: ['Bahamas', '🇧🇸'], HTI: ['Haiti', '🇭🇹'],
  IDN: ['Indonesia', '🇮🇩'], PRY: ['Paraguay', '🇵🇾'], TZA: ['Tanzania', '🇹🇿'],
  UZB: ['Uzbekistan', '🇺🇿']
};
const formatNationality = (player) => {
  const birth = player?.birth;
  if (!birth?.country) return 'Unknown';
  const entry = COUNTRY_MAP[birth.country];
  const countryLabel = entry ? entry[0] : birth.country;
  const locality = [birth.city, birth.stateProvince].filter(Boolean).join(', ');
  return locality ? `${locality}, ${countryLabel}` : countryLabel;
};

// Career span used to tell same-named players apart in the guess dropdown -
// a start/end year range gives enough context to disambiguate without
// revealing which team(s) a player is on, unlike showing team/position would.
const getCareerSpan = (player) => {
  if (!player?.teams || player.teams.length === 0) return null;
  const startYear = player.teams[0].startYear;
  const lastTeam = player.teams[player.teams.length - 1];
  return `${startYear}–${lastTeam.isActive ? 'Active' : lastTeam.endYear}`;
};

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
  // True once the round is decided (won, out of guesses, or given up) and
  // stays true until a new round starts. The result shows on the card itself.
  const [roundOver, setRoundOver] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [showWelcomePopup, setShowWelcomePopup] = useState(() => !hasSeenWelcome());
  const [showFilter, setShowFilter] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);

  const [savedPrefs] = useState(() => {
    const prefs = loadPrefs();
    return prefs && GAME_MODES.some((m) => m.key === prefs.mode) ? prefs : null;
  });
  const [mode, setMode] = useState(savedPrefs?.mode || GAME_MODES[0].key);
  const [filters, setFilters] = useState(savedPrefs?.filters || GAME_MODES[0].filters);
  const [tempFilters, setTempFilters] = useState(savedPrefs?.tempFilters || EMPTY_FILTERS);

  const [isDailyMode, setIsDailyMode] = useState(false);
  const [dailyRecord, setDailyRecord] = useState(null);
  const [showDailyResult, setShowDailyResult] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showGiveUpConfirm, setShowGiveUpConfirm] = useState(false);
  // An action that would discard the current round, held until the player confirms.
  const [pendingAbandon, setPendingAbandon] = useState(null);
  // The current Daily Challenge date (Eastern), known once the daily has been fetched.
  const [todayDate, setTodayDate] = useState(null);
  // The round just left behind, kept one step back so it can be picked up again.
  const [resumable, setResumable] = useState(null);
  const [shareFailed, setShareFailed] = useState(false);
  const [shareImageState, setShareImageState] = useState('idle');
  // Phone layout only: the secondary-actions menu. On desktop the actions
  // are always visible and this flag has no visual effect.
  const [menuOpen, setMenuOpen] = useState(false);
  const [stats, setStats] = useState(getLifetimeStats);

  // A round saved by an earlier visit, restored once on load (see below).
  const [savedRound] = useState(loadRound);
  const [restoring, setRestoring] = useState(!!savedRound);
  const skipRandomRef = useRef(!!savedRound);
  const prevRoundOver = useRef(false);
  const prevHintCount = useRef(0);

  const { results, error: searchError, settledQuery } = usePlayerSearch(query);
  const { teams } = useTeams();
  const { player: randomPlayer, loading: randomLoading, error: randomError, fetchRandomPlayer } = useRandomPlayer(filters);
  const { loading: dailyLoading, error: dailyError, fetchDailyPlayer, clearError: clearDailyError } = useDailyPlayer();

  const randomPlayerRef = useRef(null);
  randomPlayerRef.current = randomPlayer;

  useEffect(() => {
    // While a saved round is being restored, the random player the page
    // fetches on load must not take its place.
    if (randomPlayer && !skipRandomRef.current) {
      setCorrectAnswer(randomPlayer);
    }
  }, [randomPlayer]);

  // Restore the round from the last visit: re-fetch its player by id (or the
  // daily player, if it is still that day's), then put guesses, hints and mode
  // back exactly as they were. If anything fails the normal random round stands.
  useEffect(() => {
    if (!savedRound) return undefined;
    let cancelled = false;
    (async () => {
      let player = null;
      try {
        if (savedRound.isDaily) {
          const daily = await fetchDailyPlayer();
          if (daily && daily.dailyDate === savedRound.dailyDate && daily.id === savedRound.answerId) player = daily;
        } else {
          const response = await fetch(`${API_BASE_URL}/players/${savedRound.answerId}`);
          if (response.ok) player = await response.json();
        }
      } catch {
        player = null;
      }
      if (cancelled) return;
      skipRandomRef.current = false;
      if (player) {
        setCorrectAnswer(player);
        setIsDailyMode(!!savedRound.isDaily);
        setGuesses(savedRound.guesses || []);
        setRevealedHints(savedRound.revealedHints || []);
        prevRoundOver.current = !!savedRound.roundOver; // restoring is not a round ending
        prevHintCount.current = (savedRound.revealedHints || []).length; // nor a hint being unlocked
        setRoundOver(!!savedRound.roundOver);
        setGaveUp(!!savedRound.gaveUp);
        if (savedRound.mode) setMode(savedRound.mode);
        if (savedRound.filters) setFilters(savedRound.filters);
        if (savedRound.tempFilters) setTempFilters(savedRound.tempFilters);
      } else if (randomPlayerRef.current) {
        setCorrectAnswer(randomPlayerRef.current);
      }
      setRestoring(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    savePrefs({ mode, filters, tempFilters });
  }, [mode, filters, tempFilters]);

  // Keep the saved round current after every change.
  useEffect(() => {
    if (restoring || !correctAnswer) return;
    saveRound({
      answerId: correctAnswer.id,
      isDaily: isDailyMode,
      dailyDate: correctAnswer.dailyDate || null,
      guesses,
      revealedHints,
      roundOver,
      gaveUp,
      mode,
      filters,
      tempFilters,
    });
    if (isDailyMode && correctAnswer.dailyDate && !roundOver) {
      saveDailyProgress({ dailyDate: correctAnswer.dailyDate, guesses, revealedHints });
    }
  }, [restoring, correctAnswer, isDailyMode, guesses, revealedHints, roundOver, gaveUp, mode, filters, tempFilters]);

  // On first load, silently check whether today's daily challenge was
  // already completed (so the button can show "Completed" immediately
  // instead of only after the player clicks it).
  useEffect(() => {
    (async () => {
      const daily = await fetchDailyPlayer();
      if (!daily) return;
      setTodayDate(daily.dailyDate);
      const existing = getDailyRecord(daily.dailyDate);
      if (existing) {
        setDailyRecord({ ...existing, playerName: daily.name });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Starts a brand new round: fetches a player (using whatever filters are
  // passed) and resets every piece of round state together, atomically, so
  // there's never a moment where guesses/hints are stale relative to the
  // player currently on screen. If the fetch fails (e.g. a filter/mode
  // combo matches zero players), the current round is left untouched
  // instead of silently wiping guesses/hints against a stale player.
  const startNewRound = async (filtersForRound = filters) => {
    const result = await fetchRandomPlayer(filtersForRound);
    if (!result) return;
    // The network is clearly working again, so an old Daily error is stale.
    clearDailyError();
    setIsDailyMode(false);
    setGuesses([]);
    setGaveUp(false);
    setRevealedHints([]);
    setRoundOver(false);
  };

  const refreshStats = () => setStats(getLifetimeStats());

  // Anything that replaces a half-played round asks first. The Daily Challenge
  // keeps its progress, so leaving it needs no confirmation.
  const roundInProgress = !isDailyMode && !roundOver && (guesses.length > 0 || revealedHints.length > 0);
  const guardRound = (action) => {
    if (roundInProgress) setPendingAbandon(() => action);
    else action();
  };
  const confirmAbandon = () => {
    const action = pendingAbandon;
    setPendingAbandon(null);
    if (correctAnswer) setResumable({ player: correctAnswer, guesses, revealedHints });
    if (action) action();
  };
  const resumeLastRound = () => {
    if (!resumable) return;
    setIsDailyMode(false);
    setCorrectAnswer(resumable.player);
    setGuesses(resumable.guesses);
    setRevealedHints(resumable.revealedHints);
    setGaveUp(false);
    setRoundOver(false);
    setResumable(null);
  };

  // Opens the Daily Challenge: if today's puzzle was already solved/missed,
  // shows the recap/share view instead of letting the player retry it.
  const openDailyChallenge = async () => {
    const daily = await fetchDailyPlayer();
    if (!daily) return;
    setTodayDate(daily.dailyDate);

    const existing = getDailyRecord(daily.dailyDate);
    if (existing) {
      setDailyRecord({ ...existing, playerName: daily.name });
      setShowDailyResult(true);
      return;
    }

    // Leaving an unfinished Daily Challenge and coming back continues it:
    // the guesses and hints already used stay used.
    const progress = getDailyProgress(daily.dailyDate);
    guardRound(() => {
      setIsDailyMode(true);
      setCorrectAnswer(daily);
      setGuesses(progress?.guesses || []);
      setRevealedHints(progress?.revealedHints || []);
      setGaveUp(false);
      setRoundOver(false);
    });
  };

  // kind 'daily' shares the saved Daily Challenge result; 'round' shares the
  // round on screen.
  const handleShareResult = async (kind = 'daily') => {
    const source = kind === 'daily' ? dailyRecord : { won: roundWon, guesses };
    if (!source) return;
    const text = buildShareText({
      won: source.won,
      guesses: source.guesses,
      origin: SHARE_LINK,
      daily: kind === 'daily'
    });
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
      track('share', { method: 'text', content_type: kind === 'daily' ? 'daily_result' : 'round_result', won: source.won });
    } catch {
      // Clipboard permission denied/unavailable: say so instead of leaving
      // the button looking untouched.
      setShareFailed(true);
      setTimeout(() => setShareFailed(false), 2500);
    }
  };

  // Shares the result as a picture: the phone's share sheet where it can send a
  // file, otherwise the clipboard, otherwise a download.
  const handleShareImage = async (kind = 'daily') => {
    const source = kind === 'daily' ? dailyRecord : { won: roundWon, guesses };
    if (!source || shareImageState === 'working') return;

    const flash = (state) => {
      setShareImageState(state);
      setTimeout(() => setShareImageState('idle'), 2500);
    };
    setShareImageState('working');
    try {
      const blob = await buildShareImage({
        logoSrc: puckLogo,
        won: source.won,
        guesses: source.guesses,
        daily: kind === 'daily',
        dateLabel: kind === 'daily' ? formatDailyDate(dailyRecord?.dailyDate) : '',
        streak: kind === 'daily' ? dailyStreak : 0,
      });
      const file = new File([blob], 'puckwhisperer-result.png', { type: 'image/png' });
      const text = buildShareText({ won: source.won, guesses: source.guesses, origin: SHARE_LINK, daily: kind === 'daily' });
      const event = { content_type: kind === 'daily' ? 'daily_result' : 'round_result', won: source.won };

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
          track('share', { method: 'image_native', ...event });
          flash('shared');
        } catch (err) {
          if (err && err.name === 'AbortError') setShareImageState('idle'); // they closed the sheet
          else throw err;
        }
        return;
      }

      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
          track('share', { method: 'image_clipboard', ...event });
          flash('copied');
          return;
        } catch {
          // Clipboard images blocked here: fall through to a download.
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'puckwhisperer-result.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      track('share', { method: 'image_download', ...event });
      flash('saved');
    } catch {
      flash('failed');
    }
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

  const applyFilters = () => {
    setShowFilter(false);
    guardRound(async () => {
      const combined = combineFilters(mode, cleanFineFilters(tempFilters));
      setFilters(combined);
      await startNewRound(combined);
    });
  };

  const clearFilters = () => {
    setShowFilter(false);
    guardRound(async () => {
      setTempFilters(EMPTY_FILTERS);
      setMode(GAME_MODES[0].key);
      const combined = combineFilters(GAME_MODES[0].key, {});
      setFilters(combined);
      await startNewRound(combined);
    });
  };

  const handleHintClick = (hintNumber) => {
    if (!isHintClickable(hintNumber)) return;
    if (!revealedHints.includes(hintNumber)) {
      setRevealedHints([...revealedHints, hintNumber]);
    }
  };

  const isHintClickable = (hintNumber) => {
    if (!correctAnswer || anyRoundLoading) return false;
    return hintNumber === 1 || revealedHints.includes(hintNumber - 1);
  };

  // Career line as [abbreviation, value] pairs for the stat block, or null.
  const getStatPairs = (player) => {
    if (!player || !player.stats) return null;

    if (player.position === 'G') {
      const savePct = Number(player.stats.savePercentage || 0).toFixed(3);
      const gaa = Number(player.stats.goalsAgainstAverage || 0).toFixed(2);
      return [['GP', player.stats.games], ['REC', player.stats.record], ['SV%', savePct], ['GAA', gaa]];
    }
    return [['GP', player.stats.games], ['G', player.stats.goals], ['A', player.stats.assists], ['PTS', player.stats.points]];
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
    return `${player.draft.team} · ${player.draft.year}, Round ${player.draft.round}, Pick ${player.draft.pick}`;
  };

  // A tenure's startYear is season-granular, not trade-date-granular: a
  // player traded away mid-season still has that same season's startYear
  // on their NEW team's tenure (we only know which season they joined, not
  // when in it), which reads as if they'd already been on the new team back
  // when they were still finishing out the season with their old one.
  // Detect that overlap by checking whether this tenure's startYear is the
  // same season as the previous tenure's endYear (previousTeam.endYear - 1
  // === team.startYear) - if so, treat the tenure as effectively starting
  // the following calendar year instead, same as the old team's tenure
  // already ends there.
  //
  // Whether to collapse to a single year must be based on the RAW season
  // span (team.endYear - team.startYear), not the adjusted one: a tenure
  // that's traded-in mid-season and then continues for another full season
  // (e.g. joined during 2024-25, still there for 2025-26) spans two seasons
  // and needs to read as "2025 - 2026", not collapse to just "2026" because
  // the adjustment already absorbed one of those two seasons.
  const formatTeamYears = (team, previousTeam, isCurrent = false) => {
    const isSplitStart = previousTeam && team.startYear === previousTeam.endYear - 1;
    const effectiveStartYear = isSplitStart ? previousTeam.endYear : team.startYear;
    const seasonSpan = team.endYear - team.startYear;

    // The data stores the end of the current season for a player's present
    // team ("2027"), which reads as a future date; show it as ongoing.
    if (isCurrent) return `${effectiveStartYear}–now`;

    if (seasonSpan <= 1) {
      return `${team.endYear}`;
    }
    return `${effectiveStartYear}–${team.endYear}`;
  };

  const getTeamLogos = (player) => {
    if (!player) {
      return <p className="team-empty">{anyRoundLoading ? 'Loading player…' : 'No player loaded.'}</p>;
    }
    if (!player.teams || player.teams.length === 0) {
      return <p className="team-empty">No team history yet</p>;
    }
    return player.teams.map((team, index) => (
      <div key={`${player.id}-${index}-${team.teamId}-${team.startYear}`} className="team-hint">
        <img
          src={team.teamLogo || `https://assets.nhle.com/logos/nhl/svg/${team.teamAbbrev}_light.svg`}
          alt=""
          className="team-logo"
        />
        <span className="team-name">{team.teamName}</span>
        <span className="team-years">
          {formatTeamYears(team, player.teams[index - 1], index === player.teams.length - 1 && (player.isActive || team.isActive))}
        </span>
      </div>
    ));
  };

  // Shared by any path that ends a round (a deciding guess or a give-up) -
  // records the daily result/share data if this was a daily round, or just
  // rolls the outcome into lifetime stats otherwise.
  const finishRound = (won, finalGuesses, gave = false) => {
    if (isDailyMode && correctAnswer?.dailyDate) {
      const record = recordDailyResult({
        dateStr: correctAnswer.dailyDate,
        won,
        guesses: finalGuesses
      });
      setDailyRecord({ ...record, playerName: correctAnswer.name });
    } else {
      updateAggregateStats({ won, isDaily: false });
    }
    refreshStats();

    track('round_end', {
      game_mode: isDailyMode ? 'daily' : mode,
      daily: isDailyMode,
      won,
      guesses_used: finalGuesses.length,
      hints_used: revealedHints.length,
      gave_up: gave,
    });
    if (isDailyMode && correctAnswer?.dailyDate) {
      track('daily_complete', { won, guesses_used: finalGuesses.length, streak: getLifetimeStats().dailyStreak });
    }
  };

  const handleGuess = (player) => {
    if (!player || guesses.length >= 3 || roundOver) return;
    if (guesses.some((g) => g.id === player.id)) return;

    const isCorrect = player.id === correctAnswer?.id;
    const newGuess = {
      id: player.id,
      name: player.name,
      number: guesses.length + 1,
      correct: isCorrect,
    };

    const updatedGuesses = [...guesses, newGuess];
    setGuesses(updatedGuesses);
    setQuery('');
    setShowSearch(false);

    const won = isCorrect;
    const lost = !isCorrect && updatedGuesses.length >= 3;

    if (won || lost) {
      setRoundOver(true);
      finishRound(won, updatedGuesses);
    }
  };

  const handleGiveUp = () => {
    if (!correctAnswer || roundOver || guesses.length >= 3 || anyRoundLoading) return;
    setGaveUp(true);
    setRoundOver(true);
    finishRound(false, guesses, true);
  };

  // Shared by the dropdown's Select button and Enter-key submission - picks
  // `player` as either the custom-player answer or a guess, whichever
  // overlay is open.
  const selectSearchResult = (player) => {
    if (showManualPicker) {
      setShowManualPicker(false);
      guardRound(() => {
        setCorrectAnswer(player);
        setIsDailyMode(false);
        setGuesses([]);
        setRevealedHints([]);
        setGaveUp(false);
        setRoundOver(false);
      });
    } else {
      // Guessing the same player twice would burn a guess for nothing.
      if (guesses.some((g) => g.id === player.id)) return;
      handleGuess(player);
    }
    setQuery('');
  };

  const confirmGiveUp = () => {
    setShowGiveUpConfirm(false);
    handleGiveUp();
  };

  const closeAllOverlays = () => {
    setShowGiveUpConfirm(false);
    setPendingAbandon(null);
    setShowSearch(false);
    setShowManualPicker(false);
    setQuery('');
    setShowWelcomePopup(false);
    setShowFilter(false);
    setShowModePicker(false);
    setShowDailyResult(false);
    setShowStats(false);
  };

  const anyOverlayOpen = showSearch || showManualPicker || showWelcomePopup || showFilter || showModePicker || showDailyResult || showStats || showGiveUpConfirm || !!pendingAbandon;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (menuOpen) setMenuOpen(false);
      else if (showGiveUpConfirm) setShowGiveUpConfirm(false);
      else if (pendingAbandon) setPendingAbandon(null);
      else if (showSearch) setShowSearch(false);
      else if (showManualPicker) {
        setShowManualPicker(false);
        setQuery('');
      } else if (showWelcomePopup) setShowWelcomePopup(false);
      else if (showFilter) setShowFilter(false);
      else if (showModePicker) setShowModePicker(false);
      else if (showDailyResult) setShowDailyResult(false);
      else if (showStats) setShowStats(false);
    };

    // The menu closes on Escape too, but it has its own backdrop, so it
    // doesn't count as a modal overlay above.
    if (anyOverlayOpen || menuOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [anyOverlayOpen, menuOpen, showGiveUpConfirm, pendingAbandon, showSearch, showManualPicker, showWelcomePopup, showFilter, showModePicker, showDailyResult, showStats]);

  // One "visit" event per page load, with how long it has been since the last one.
  useEffect(() => {
    trackVisit();
  }, []);

  // Showing the dialog counts as seeing it, however it later gets closed.
  useEffect(() => {
    if (!showWelcomePopup) return;
    try { window.localStorage.setItem(WELCOME_KEY, '1'); } catch { /* storage unavailable: it just shows again next visit */ }
  }, [showWelcomePopup]);

  // While a modal is open, keyboard and screen-reader users stay inside it:
  // focus moves to the dialog, the page behind is inert, and focus returns to
  // whatever opened it when the dialog closes.
  useEffect(() => {
    if (!anyOverlayOpen) return undefined;
    const opener = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    const behind = [...document.querySelectorAll('#root > *')]
      .filter((el) => el !== dialog && !el.matches('.overlay-screen, [role="dialog"]'));
    behind.forEach((el) => el.setAttribute('inert', ''));
    return () => {
      behind.forEach((el) => el.removeAttribute('inert'));
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [anyOverlayOpen]);

  // Keyboard: 1-5 unlock the next hint, G opens the guess box.
  const shortcutRef = useRef(null);
  shortcutRef.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (anyOverlayOpen || menuOpen) return;
    const key = e.key.toLowerCase();
    if (/^[1-5]$/.test(key)) {
      handleHintClick(Number(key));
    } else if (key === 'g' && !guessDisabled) {
      e.preventDefault();
      setShowSearch(true);
    } else if (key === 'n' && !anyRoundLoading) {
      e.preventDefault();
      guardRound(() => startNewRound()); // asks first if a round is in progress
    } else if (key === 'd' && !anyRoundLoading) {
      e.preventDefault();
      openDailyChallenge();
    } else if (key === 'q' && !guessDisabled) {
      e.preventDefault();
      setShowGiveUpConfirm(true); // always confirms
    }
  };
  useEffect(() => {
    const onKey = (e) => shortcutRef.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // When a round ends the Guess button becomes New player: keep keyboard focus on it.
  useEffect(() => {
    if (roundOver && !prevRoundOver.current && !restoring) {
      document.querySelector('.guess-cta')?.focus({ preventScroll: true });
    }
    prevRoundOver.current = roundOver;
  }, [roundOver, restoring]);

  // A clue unlocked on a phone can land below the pinned Guess bar when the
  // career is long; bring the newest row into view (the row's scroll-margin
  // keeps it clear of the bar).
  useEffect(() => {
    const count = revealedHints.length;
    if (count > prevHintCount.current && !restoring) {
      const rows = document.querySelectorAll('.card-hints .stat-row');
      const newest = rows[rows.length - 1];
      if (newest) {
        const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        newest.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
      }
    }
    prevHintCount.current = count;
  }, [revealedHints, restoring]);

  // A new mystery player starts clean: close the menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [correctAnswer?.id]);

  const getActiveFilterCount = () => Object.keys(filters).filter(k => !MODE_FILTER_KEYS.includes(k)).length;

  const anyRoundLoading = randomLoading || dailyLoading || restoring;
  const guessDisabled = roundOver || guesses.length >= 3 || !correctAnswer || anyRoundLoading;
  // The "?" tile turns face-up when the Photo hint is used or the round ends.
  const faceUp = revealedHints.includes(5) || roundOver;
  const roundWon = guesses.some((g) => g.correct);
  const resultTitle = roundWon
    ? (isDailyMode ? 'Daily Challenge solved!' : 'You got it!')
    : isDailyMode ? 'Daily Challenge missed' : gaveUp ? 'You gave up!' : 'You ran out of guesses!';
  // Offered while the round that replaced it is still untouched.
  const showResume = !!resumable && !!correctAnswer && correctAnswer.id !== resumable.player.id
    && !isDailyMode && !roundOver && !roundInProgress;
  const dailyStreak = currentStreak(stats, todayDate);
  const searchSettled = settledQuery === query;
  const searchTitle = showManualPicker ? 'Choose the Mystery Player' : 'Make Your Guess';
  const currentYear = new Date().getFullYear();
  const trophyChips = revealedHints.includes(4) ? getTrophyChips(correctAnswer) : null;
  const currentModeInfo = GAME_MODES.find(m => m.key === mode) || GAME_MODES[0];
  const winPct = stats.totalPlayed > 0 ? Math.round((stats.totalWon / stats.totalPlayed) * 100) : 0;

  return (
    <>
      {anyOverlayOpen && <div className="overlay-screen" onClick={closeAllOverlays}></div>}

      {showWelcomePopup && (
        <div className="modal-card welcome-box" role="dialog" aria-modal="true" aria-label="How to play" tabIndex={-1}>
          <button className="dismiss-button" onClick={() => setShowWelcomePopup(false)} aria-label="Close">×</button>
          <h2>Welcome to PuckWhisperer!</h2>
          <div className="rules-content">
            <p className="current-mode-note">
              Current mode: <strong>{currentModeInfo.label}</strong> — {currentModeInfo.hint}
            </p>
            <h3>How to Play</h3>
            <ul>
              <li>You get 3 guesses to name the mystery NHL player.</li>
              <li>The teams they played for, and when, are shown from the start.</li>
              <li>Tap a hint to unlock a clue. Hints unlock one at a time, in order:</li>
              <li className="rules-sub"><strong>Draft:</strong> who drafted them, and when</li>
              <li className="rules-sub"><strong>Number:</strong> jersey number and position</li>
              <li className="rules-sub"><strong>Origin:</strong> birthplace and country</li>
              <li className="rules-sub"><strong>Stats:</strong> career totals and trophies</li>
              <li className="rules-sub"><strong>Photo:</strong> their picture</li>
              <li>Tap Mode to switch to Hall of Famers, Award Winners, milestone clubs, or All Players (hard mode, every player ever).</li>
              <li>The Daily Challenge is one puzzle a day, the same for everyone.</li>
              <li>On a keyboard: 1–5 unlock hints, G guesses, N is a new player, D opens the Daily Challenge and Q gives up.</li>
            </ul>
          </div>
        </div>
      )}

      <div className="header-section">
        <div className="header-actions-left">
          <button
            className="header-button"
            onClick={() => { setShowStats(true); refreshStats(); }}
            title="Your stats"
          >
            <ChartIcon />
            <span>Stats</span>
          </button>
        </div>
        <img src={puckLogo} className="puck-logo" alt="PuckWhisperer" />
        <div className="header-actions-right">
          <button className="header-button" onClick={() => setShowWelcomePopup(true)} title="How to play">
            <span className="help-mark" aria-hidden="true">?</span>
            <span>Help</span>
          </button>
        </div>
      </div>

      <div className="top-actions">
        <button
          className={`daily-button ${dailyRecord ? 'completed' : ''}`}
          onClick={openDailyChallenge}
          disabled={anyRoundLoading}
          aria-label={dailyRecord ? 'Daily Challenge complete, view your result' : 'Daily Challenge'}
          aria-keyshortcuts="D"
          title="Daily Challenge (press D)"
        >
          <span className="daily-main">
            {dailyRecord
              ? <>✓ Daily<span className="daily-long daily-done-long"> Challenge Complete</span></>
              : anyRoundLoading ? 'Loading…' : <>Daily<span className="daily-long"> Challenge</span></>}
          </span>
          {(dailyRecord || dailyStreak > 0) && (
            <span className="daily-meta">
              {dailyRecord && (
                <span className="daily-result">{dailyRecord.won ? `Solved ${dailyRecord.guesses.length}/3` : 'Missed'}</span>
              )}
              {dailyStreak > 0 && <span className="daily-streak">{dailyStreak}-day streak</span>}
            </span>
          )}
        </button>

        <button
          className="mode-pill"
          onClick={() => setShowModePicker(true)}
          disabled={anyRoundLoading}
        >
          <span className="mode-prefix">Mode: </span><strong>{currentModeInfo.label}</strong> ▾
        </button>
      </div>
      <p className="mode-description">
        {isDailyMode ? "Today's puzzle, the same for everyone. One round a day." : currentModeInfo.hint}
      </p>
      {dailyError && (
        <div className="random-error error-row" role="alert">
          <p>{DAILY_ERROR_TEXT}</p>
          <button className="btn btn-secondary" onClick={openDailyChallenge} disabled={anyRoundLoading}>Try again</button>
        </div>
      )}

      <main className="card">
        <div className="card-photo">
          <div className={`card-flip ${faceUp ? 'face-up' : ''}`}>
            <img
              src={questionMark}
              className="player-mug flip-face flip-back"
              alt="Mystery player, photo hidden"
              aria-hidden={faceUp}
            />
            <img
              src={correctAnswer?.silhouette}
              className="player-mug flip-face flip-front"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              alt={roundOver ? correctAnswer?.name : 'Photo of the mystery player'}
              aria-hidden={!faceUp}
            />
          </div>
          <div className="guess-slots">
            <h2 className="card-label">Guesses</h2>
            <ol className="guess-list">
              {[0, 1, 2].map((slot) => {
                const guess = guesses[slot];
                return guess ? (
                  <li key={slot} className={`guess-chip ${guess.correct ? 'correct' : 'incorrect'}`}>
                    #{guess.number} {guess.name} {guess.correct ? '✓' : '✗'}
                  </li>
                ) : (
                  <li key={slot} className="guess-chip empty" aria-label={`Guess ${slot + 1}, not used yet`}>
                    #{slot + 1}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <section className="card-timeline">
          <h2 className="card-label">Teams</h2>
          <div className="team-list" key={correctAnswer?.id}>
            {getTeamLogos(correctAnswer)}
          </div>
          {randomError && (
            <div className="random-error error-row" role="alert">
              <p>{roundErrorText(randomError)}</p>
              <button className="btn btn-secondary" onClick={() => startNewRound()} disabled={anyRoundLoading}>Try again</button>
            </div>
          )}
        </section>

        <div className="hint-tabs">
          <h2 className="card-label">Hints</h2>
          <div className="hint-tab-row">
            {HINT_LABELS.map((label, index) => {
              const n = index + 1;
              return (
                <button
                  key={n}
                  className={`hint-button ${revealedHints.includes(n) ? 'revealed' : isHintClickable(n) ? 'available' : ''}`}
                  title={`${label} (press ${n})`}
                  aria-keyshortcuts={String(n)}
                  onClick={() => handleHintClick(n)}
                  disabled={!isHintClickable(n)}
                  aria-label={isHintClickable(n) || revealedHints.includes(n)
                    ? `${label} hint`
                    : `${label} hint, locked until ${HINT_LABELS[index - 1]} is unlocked`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <section className="card-hints" aria-label="Unlocked hints" aria-live="polite">
          {showResume && (
            <div className="resume-notice">
              <p>You left a round in progress.</p>
              <button className="btn btn-secondary" onClick={resumeLastRound}>Resume it</button>
            </div>
          )}
          {roundOver && correctAnswer && (
            <div className={`round-result ${roundWon ? 'won' : 'lost'}`} role="status">
              <div className="round-result-text">
                <p className="round-result-title">{resultTitle}</p>
                <p className="round-result-name">
                  {roundWon ? <strong>{correctAnswer.name}</strong> : <>The answer was <strong>{correctAnswer.name}</strong></>}
                </p>
              </div>
              {(isDailyMode || guesses.length > 0) && (
                <div className="round-result-actions">
                  <button className="btn btn-secondary" onClick={() => handleShareImage(isDailyMode ? 'daily' : 'round')} disabled={shareImageState === 'working'}>
                    {SHARE_IMAGE_LABELS[shareImageState]}
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleShareResult(isDailyMode ? 'daily' : 'round')}>
                    {shareCopied ? 'Copied!' : shareFailed ? "Couldn't copy" : 'Copy text'}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="hint-block-container">
            {![1, 2, 3, 4].some((n) => revealedHints.includes(n)) ? (
              <p className="hint-block-empty">Tap Draft to unlock your first clue.</p>
            ) : (
              <dl className="stat-block">
                {revealedHints.includes(1) && (
                  <div className="stat-row"><dt>Draft</dt><dd>{getDraftInfo(correctAnswer)}</dd></div>
                )}
                {revealedHints.includes(2) && (
                  <div className="stat-row">
                    <dt>Number</dt>
                    <dd>{correctAnswer?.sweaterNumber ? `#${correctAnswer.sweaterNumber}` : 'N/A'} · {formatPosition(correctAnswer?.position)}</dd>
                  </div>
                )}
                {revealedHints.includes(3) && (
                  <div className="stat-row"><dt>Born</dt><dd>{formatNationality(correctAnswer)}</dd></div>
                )}
                {revealedHints.includes(4) && (
                  <div className="stat-row">
                    <dt>Career</dt>
                    <dd className="stat-figures">
                      {getStatPairs(correctAnswer)
                        ? getStatPairs(correctAnswer).map(([key, value]) => (
                          <span key={key} className="stat-figure"><span className="stat-key">{key}</span> {value}</span>
                        ))
                        : 'Stats unavailable'}
                    </dd>
                  </div>
                )}
                {revealedHints.includes(4) && trophyChips && (
                  <div className="stat-row"><dt>Trophies</dt><dd><div className="trophy-row">{trophyChips}</div></dd></div>
                )}
              </dl>
            )}
          </div>
        </section>

        {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
        <div className="card-bar">
          {roundOver ? (
            <button
              className="btn btn-primary guess-cta"
              onClick={() => startNewRound()}
              disabled={anyRoundLoading}
              aria-keyshortcuts="N"
              title="New player (press N)"
            >
              {anyRoundLoading ? 'Loading…' : 'New player'}
            </button>
          ) : (
            <button
              className="btn btn-primary guess-cta"
              onClick={() => setShowSearch(true)}
              disabled={guessDisabled}
              aria-keyshortcuts="G"
              title="Guess (press G)"
            >
              {anyRoundLoading ? 'Loading…' : 'Guess'}
            </button>
          )}

          <button
            className="btn btn-secondary menu-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            More
          </button>

          <div className={`card-menu ${menuOpen ? 'open' : ''}`}>
            <button
              className="btn btn-secondary"
              onClick={() => { setMenuOpen(false); guardRound(() => startNewRound()); }}
              disabled={anyRoundLoading}
              aria-keyshortcuts="N"
              title="New player (press N)"
            >
              New player
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { setMenuOpen(false); setShowFilter(true); }}
            >
              Filters{getActiveFilterCount() > 0 && ` (${getActiveFilterCount()})`}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { setMenuOpen(false); setShowManualPicker(true); }}
            >
              Custom player
            </button>
            <button
              className="btn btn-ghost give-up"
              onClick={() => { setMenuOpen(false); setShowGiveUpConfirm(true); }}
              disabled={guessDisabled}
              aria-keyshortcuts="Q"
              title="Give up (press Q)"
            >
              Give up
            </button>
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <p className="footer-support">
          <a href={DONATE_URL} target="_blank" rel="noopener noreferrer">
            Enjoying PuckWhisperer? Buy me a coffee<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
        <p>
          PuckWhisperer is not affiliated or associated in any way with the National Hockey League.
          Use of any logos on this website does not constitute a sponsorship or endorsement by the
          teams, league, or trademark holders.
        </p>
      </footer>

      {(showSearch || showManualPicker) && (
        <div className="search-overlay animate-in" role="dialog" aria-modal="true" aria-label={searchTitle} tabIndex={-1}>
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
              placeholder="Search players by name"
              aria-label="Search players by name"
              name="searchbar"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results.length > 0 && searchSettled) {
                  selectSearchResult(results[0]);
                }
              }}
            />
          </div>

          {query && (
            <div className="dropdown animate-in">
              {query.length < 2 ? (
                <div className="dropdown-empty">Type at least 2 letters.</div>
              ) : results.length > 0 ? (
                results.map((player) => (
                  <button
                    type="button"
                    key={player.id}
                    className="dropdown-item"
                    onClick={() => selectSearchResult(player)}
                    disabled={!showManualPicker && guesses.some((g) => g.id === player.id)}
                  >
                    <span className="dropdown-item-info">
                      <span className="dropdown-item-name">{player.name}</span>
                      {getCareerSpan(player) && (
                        <span className="dropdown-item-years">{getCareerSpan(player)}</span>
                      )}
                    </span>
                    <span className="select-button">
                      {!showManualPicker && guesses.some((g) => g.id === player.id) ? 'Guessed' : 'Select'}
                    </span>
                  </button>
                ))
              ) : !searchSettled ? (
                <div className="dropdown-empty">Searching…</div>
              ) : searchError ? (
                <div className="dropdown-empty" role="alert">Couldn't search right now. Check your connection and try again.</div>
              ) : (
                <div className="dropdown-empty">No players match “{query}”. Check the spelling.</div>
              )}
            </div>
          )}
        </div>
      )}

      {showFilter && (
        <div className="filter-overlay animate-in" role="dialog" aria-modal="true" aria-label="Filter players" tabIndex={-1}>
          <button className="dismiss-button" onClick={() => setShowFilter(false)} aria-label="Close">×</button>
          <div className="filter-header">
            <h3>Filter Players</h3>
          </div>

          <div className="filter-content">
            <div className="filter-section">
              <h4>Basic Info</h4>
              <div className="filter-row">
                <div className="filter-group">
                  <label htmlFor="filter-1">Position</label>
                  <select
                    id="filter-1"
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
                  <label htmlFor="filter-2">Jersey Number</label>
                  <input
                    id="filter-2"
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
                  <label htmlFor="filter-3">Team</label>
                  <select
                    id="filter-3"
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
                  <label htmlFor="filter-4">Games Played</label>
                  <input
                    id="filter-4"
                    type="number"
                    min="0"
                    value={tempFilters['stats.games']}
                    onChange={(e) => handleFilterChange('stats.games', e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="filter-5">Goals</label>
                  <input
                    id="filter-5"
                    type="number"
                    min="0"
                    value={tempFilters['stats.goals']}
                    onChange={(e) => handleFilterChange('stats.goals', e.target.value)}
                  />
                </div>
              </div>
              <div className="filter-row">
                <div className="filter-group">
                  <label htmlFor="filter-6">Assists</label>
                  <input
                    id="filter-6"
                    type="number"
                    min="0"
                    value={tempFilters['stats.assists']}
                    onChange={(e) => handleFilterChange('stats.assists', e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="filter-7">Points</label>
                  <input
                    id="filter-7"
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
                  <label htmlFor="filter-8">Draft Year</label>
                  <input
                    id="filter-8"
                    type="number"
                    min="1963"
                    max={currentYear}
                    value={tempFilters['draft.year']}
                    onChange={(e) => handleFilterChange('draft.year', e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="filter-9">Draft Round</label>
                  <select
                    id="filter-9"
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
              Clear Filters
            </button>
            <button className="apply-filters-btn" onClick={applyFilters} disabled={randomLoading}>
              Apply Filters
            </button>
          </div>
        </div>
      )}

      {showModePicker && (
        <div className="mode-picker-overlay animate-in" role="dialog" aria-modal="true" aria-label="Choose a game mode" tabIndex={-1}>
          <button className="dismiss-button" onClick={() => setShowModePicker(false)} aria-label="Close">×</button>
          <h3>Choose a Game Mode</h3>
          {MODE_GROUPS.map((group) => (
            <div key={group.title} className="mode-group">
              <h4>{group.title}</h4>
              <div className="mode-group-grid">
                {group.keys.map((key) => {
                  const m = GAME_MODES.find((gm) => gm.key === key);
                  return (
                    <button
                      key={m.key}
                      className={`mode-button ${mode === m.key ? 'selected' : ''}`}
                      onClick={() => { setShowModePicker(false); guardRound(() => selectMode(m.key)); }}
                      disabled={anyRoundLoading}
                      title={m.hint}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showGiveUpConfirm && (
        <div className="modal-card keyline accent-danger" role="dialog" aria-modal="true" aria-label="Confirm give up" tabIndex={-1}>
          <button className="dismiss-button" onClick={() => setShowGiveUpConfirm(false)} aria-label="Close">×</button>
          <h2>Give up?</h2>
          <p>
            {isDailyMode
              ? "The answer will be revealed and today's Daily Challenge will count as missed. You can't retry it."
              : 'The answer will be revealed and this round counts as a loss.'}
          </p>
          <div className="modal-actions">
            <button className="btn btn-danger" onClick={confirmGiveUp}>Give up</button>
            <button className="btn btn-secondary" onClick={() => setShowGiveUpConfirm(false)} autoFocus>Keep playing</button>
          </div>
        </div>
      )}

      {pendingAbandon && (
        <div className="modal-card keyline" role="dialog" aria-modal="true" aria-label="Leave this round" tabIndex={-1}>
          <button className="dismiss-button" onClick={() => setPendingAbandon(null)} aria-label="Close">×</button>
          <h2>Leave this round?</h2>
          <p>You can pick it back up until you start playing the next player.</p>
          <div className="modal-actions">
            <button className="btn btn-danger" onClick={confirmAbandon}>Leave round</button>
            <button className="btn btn-secondary" onClick={() => setPendingAbandon(null)} autoFocus>Keep playing</button>
          </div>
        </div>
      )}

      {showDailyResult && dailyRecord && (
        <div className="modal-card keyline accent-daily" role="dialog" aria-modal="true" aria-label="Daily Challenge result" tabIndex={-1}>
          <button onClick={() => setShowDailyResult(false)} className="dismiss-button" aria-label="Close">×</button>
          <h2>Daily Challenge</h2>
          <dl className="stat-block stat-block-wide">
            <div className="stat-row">
              <dt>Result</dt>
              <dd>{dailyRecord.won ? `Solved in ${dailyRecord.guesses.length}/3` : 'Missed'}</dd>
            </div>
            {dailyRecord.playerName && (
              <div className="stat-row"><dt>Answer</dt><dd>{dailyRecord.playerName}</dd></div>
            )}
            <div className="stat-row">
              <dt>Guesses</dt>
              <dd>
                <div className="share-grid">
                  {dailyRecord.guesses.map((g, i) => (
                    <span
                      key={i}
                      className={`share-cell ${g.correct ? 'hit' : 'miss'}`}
                      role="img"
                      aria-label={g.correct ? 'Correct guess' : 'Wrong guess'}
                    />
                  ))}
                </div>
              </dd>
            </div>
          </dl>
          <div className="modal-actions">
            <button onClick={() => handleShareImage('daily')} className="btn btn-primary" disabled={shareImageState === 'working'}>
              {SHARE_IMAGE_LABELS[shareImageState]}
            </button>
            <button onClick={() => handleShareResult('daily')} className="btn btn-secondary">
              {shareCopied ? 'Copied!' : shareFailed ? "Couldn't copy" : 'Copy text'}
            </button>
          </div>
          <p className="daily-next">A new Daily Challenge unlocks tomorrow.</p>
        </div>
      )}

      {showStats && (
        <div className="modal-card keyline" role="dialog" aria-modal="true" aria-label="Your stats" tabIndex={-1}>
          <button onClick={() => setShowStats(false)} className="dismiss-button" aria-label="Close">×</button>
          <h2>Your Stats</h2>
          <dl className="stat-block stat-block-wide">
            <div className="stat-row"><dt>Played</dt><dd className="stat-big">{stats.totalPlayed}</dd></div>
            <div className="stat-row"><dt>Win rate</dt><dd className="stat-big">{winPct}%</dd></div>
            <div className="stat-row"><dt>Daily streak</dt><dd className="stat-big">{stats.dailyStreak}</dd></div>
            <div className="stat-row"><dt>Best daily streak</dt><dd className="stat-big">{stats.maxDailyStreak}</dd></div>
          </dl>
          <p className="daily-next">Stats are saved on this device only.</p>
        </div>
      )}
    </>
  );
}

export default App;
