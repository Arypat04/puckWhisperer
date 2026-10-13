# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Hockey fans who find the game through Reddit team subreddits and X. Usage is a mix of phone and desktop, with a casual short-session player as the common case. Mobile players currently have to scroll too much during a round.

## Product Purpose
PuckWhisperer is a free, no-signup NHL guessing game. The player gets a mystery NHL player and 3 guesses, with hints that unlock one at a time (draft info, jersey number and position, nationality, stats and trophies, then a silhouette). A Daily Challenge gives every player the same mystery player each day, with a shareable result grid. Success is people finishing rounds, coming back for the daily, and sharing results.

## Positioning
- The career team timeline (logos with years played on each team) is shown from the start and acts as the first clue.
- Hard mode covers every NHL player ever, not just current players.
- Multiple game modes: Active Players, Award Winners, The Cup, Hall of Famers, Modern Era, and Milestone clubs.

## Operating Context
Played in the browser, linked from Reddit and X posts. Player data comes from the NHL's official public APIs, loaded into MongoDB by scraper scripts. Frontend is deployed on Render; backend API on Google Cloud Run.

## Capabilities and Constraints
- Stack: React 19 and Vite frontend, Express and MongoDB backend. All frontend styling lives in `Frontend/src/App.css` and `index.css`; there is no UI framework.
- Team logos and trophy images come from NHL-hosted assets and must be shown as provided.
- Data comes only from official NHL APIs. No salary or contract data exists.
- Known problem: on mobile, a round requires too much scrolling.
- Known problem: users have described the site as looking AI-generated.

## Brand Commitments
- The PuckWhisperer name and the hand-made bubble-font logo art stay as they are (`Frontend/src/assets/`, `Frontend/public/`). Nothing else visual is binding.

## Evidence on Hand
- Google Analytics (GA4) through 8 Aug 2026: 1,839 total users, 10,353 events, average engagement time 2m 03s. About 72% of users arrive as direct traffic, 20% referral, 8% organic search. Traffic spiked on 25 July 2026 after Reddit posts.
- User feedback from Reddit comments that the site looks AI-generated.
- Real assets: logo art, `og-image.png`, app icons, a demo video.
- No testimonials, press, or customer logos exist; do not invent any.

## Product Principles
- A round should be playable without hunting for controls, especially on a phone.
- The clue is the career timeline, so the timeline is the centerpiece of the screen.
- It should feel like a hockey fan made it, not like a generic app template.
- Free and no signup stays true; nothing should add friction before the first guess.
