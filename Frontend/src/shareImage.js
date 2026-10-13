// shareImage.js - draws a result as a picture of the back of a hockey card, in
// the browser, so a player can post it. It shows the result only (the squares,
// the score, the streak), never the player's name, so it can't spoil the answer.

const STOCK = '#bfbfaf';
const PAPER = '#e6e5db';
const INK = '#0d1928';
const HAIRLINE = '#878876';
const SUCCESS = '#005827';
const DANGER = '#b00c15';
const ACCENT = '#194292';
const MUTED = '#414e5f';

const SIZE = 1080;

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Sets a font from the page's own family. `stretch` uses the variable font's
// width axis where the browser supports it; otherwise it falls back to normal.
function setFont(g, weight, px, stretch = 'normal') {
  if ('fontStretch' in g) g.fontStretch = stretch;
  g.font = `${weight} ${px}px Archivo, 'Helvetica Neue', Arial, sans-serif`;
}

/**
 * @param {object} opts
 * @param {string} opts.logoSrc   URL of the wordmark (same origin, so the canvas stays clean)
 * @param {boolean} opts.won
 * @param {{correct:boolean}[]} opts.guesses
 * @param {boolean} opts.daily
 * @param {string} [opts.dateLabel]  e.g. "Oct 12", shown for the Daily Challenge
 * @param {number} [opts.streak]     current daily streak, 0 to hide
 * @returns {Promise<Blob>} a PNG
 */
export async function buildShareImage({ logoSrc, won, guesses, daily, dateLabel = '', streak = 0 }) {
  // Make sure the page's font is actually loaded before drawing with it.
  try {
    await Promise.all([document.fonts.load('800 64px Archivo'), document.fonts.load('600 40px Archivo')]);
  } catch {
    // Falls back to the system sans if the font cannot be confirmed.
  }
  const logo = await loadImage(logoSrc);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';

  // Stock, then the card: paper, an ink edge and a printed keyline.
  g.fillStyle = STOCK;
  g.fillRect(0, 0, SIZE, SIZE);
  roundRectPath(g, 54, 54, SIZE - 108, SIZE - 108, 36);
  g.fillStyle = PAPER;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = INK;
  g.stroke();
  roundRectPath(g, 84, 84, SIZE - 168, SIZE - 168, 22);
  g.lineWidth = 2;
  g.strokeStyle = HAIRLINE;
  g.stroke();

  // Wordmark.
  const logoW = 440;
  const logoH = (logoW * logo.height) / logo.width;
  g.drawImage(logo, (SIZE - logoW) / 2, 112, logoW, logoH);

  // What this is.
  const label = daily ? `DAILY CHALLENGE${dateLabel ? ` · ${dateLabel.toUpperCase()}` : ''}` : 'GUESS THE NHL PLAYER';
  setFont(g, 800, 50, 'condensed');
  g.fillStyle = INK;
  const labelY = 112 + logoH + 84;
  g.fillText(label, SIZE / 2, labelY);

  // The score.
  const score = won ? `${guesses.length}/3` : 'X/3';
  setFont(g, 800, 170, 'condensed');
  g.fillStyle = won ? SUCCESS : DANGER;
  const scoreY = labelY + 170;
  g.fillText(score, SIZE / 2, scoreY);

  // One square per guess.
  let contentBottom = scoreY;
  if (guesses.length > 0) {
    const cell = 124;
    const gap = 24;
    const rowW = guesses.length * cell + (guesses.length - 1) * gap;
    let x = (SIZE - rowW) / 2;
    const y = scoreY + 40;
    guesses.forEach((guess) => {
      roundRectPath(g, x, y, cell, cell, 16);
      g.fillStyle = guess.correct ? SUCCESS : DANGER;
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = INK;
      g.stroke();
      x += cell + gap;
    });
    contentBottom = y + cell;
  }

  // Streak, then the invitation (kept well inside the keyline).
  if (daily && streak > 0) {
    setFont(g, 700, 44, 'normal');
    g.fillStyle = MUTED;
    g.fillText(`${streak}-day streak`, SIZE / 2, contentBottom + 72);
  }
  setFont(g, 800, 38, 'condensed');
  g.fillStyle = ACCENT;
  g.fillText('CAN YOU BEAT IT?  PUCKWHISPERER.APP', SIZE / 2, SIZE - 124);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render the image'))), 'image/png');
  });
}
