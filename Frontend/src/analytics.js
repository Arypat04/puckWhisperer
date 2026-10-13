// analytics.js - the few GA4 events that answer "do people come back?" and
// "do they share?". Uses the gtag tag already on the page (index.html); it does
// nothing if that tag is blocked or missing, and it never sends anything that
// identifies a person (no names, no answers, no free text).
//
// Events (all appear in GA4 under Reports > Engagement > Events):
//   visit           visit_count, days_since_last, returning   once per page load
//   round_end       game_mode, daily, won, guesses_used, hints_used, gave_up
//   daily_complete  won, guesses_used, streak                 Daily Challenge finished
//   share           method, content_type, won                 text, or image by native/clipboard/download
//
// Visits that arrive from a shared result carry utm_source=share, so GA's
// Acquisition reports show how many visits shares bring in.

export function track(name, params = {}) {
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  } catch {
    // Analytics must never break the game.
  }
}

const VISITS_KEY = 'puckwhisperer_visits';

function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Counts this visit and works out how long it has been since the last one.
// Stored only on this device.
function recordVisit() {
  const today = localDateString();
  let saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem(VISITS_KEY));
  } catch {
    saved = null;
  }

  const visitCount = (saved?.count || 0) + 1;
  let daysSinceLast = null;
  if (saved?.last) {
    const diff = new Date(`${today}T12:00:00`) - new Date(`${saved.last}T12:00:00`);
    daysSinceLast = Math.max(0, Math.round(diff / 86400000));
  }

  try {
    window.localStorage.setItem(VISITS_KEY, JSON.stringify({ count: visitCount, last: today }));
  } catch {
    // Storage unavailable: the visit still counts, it just can't be compared next time.
  }
  return { visit_count: visitCount, days_since_last: daysSinceLast, returning: visitCount > 1 };
}

let visitTracked = false;

// Call once on load. Guarded so React's dev double-mount does not count twice.
export function trackVisit() {
  if (visitTracked) return;
  visitTracked = true;
  const visit = recordVisit();
  track('visit', visit.days_since_last === null ? { ...visit, days_since_last: -1 } : visit);
}
