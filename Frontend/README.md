# PuckWhisperer frontend

The React 19 + Vite app. See the [main README](../README.md) for what the game is, how it fits together and how to run the whole stack.

```bash
npm install
npm run dev      # http://localhost:5173 (uses the hosted API)
npm run lint
npm run build    # outputs to dist/
```

## Where things are

| File | Purpose |
| --- | --- |
| `src/App.jsx` | The game: round state, hints, modes, dialogs and the card layout |
| `src/App.css` | All styling, driven by the design tokens at the top of the file |
| `src/dailyStats.js` | Everything saved on the device: daily results, lifetime stats, the round in progress, remembered mode |
| `src/analytics.js` | The few Google Analytics events (visit, round end, daily complete, share) |
| `src/shareImage.js` | Draws the shareable result card on a canvas |
| `../Scripts/useNHLData.js` | The data hooks (search, random player, daily player) and `API_BASE_URL` |

The logo and app icons are in `public/` and this folder. `PRODUCT.md` at the repo root records the design principles behind the card-back look.
