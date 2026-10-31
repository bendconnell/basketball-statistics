# Basketball Stats Interface Candidates

This project is a local-only frontend workflow for possession-level basketball analytics.

## What is tracked

- Passes per possession
- Paint touches
- Point differential for groups of players
  - exact 5-player lineups
  - custom 2-5 player groups
- Unified tagging and review workflow (single mode)
- Game clock controls (start, stop, correction)
- Lineup differential by fixed time stints

## Tabs

- Tagging
  - One-tap event registration with large action buttons
  - Uses global game clock timestamp for each tag
- Possession Matrix
  - Review-only possession table and event detail panel
- Lineup Differential
  - Fixed stints:
    - Q1 12:00-07:00 -> players 1-5
    - Q1 07:00-02:00 -> players 6-10
  - Shows possessions, points for/against, and differential per stint

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start development server:

```bash
npm run dev
```

3. Open the local URL printed by Vite.

## Test script suggestion

Use the same scenario in the Tagging and Matrix tabs:

1. Pick one possession.
2. Go to Tagging.
3. Add events:
   - pass
   - pass
   - paint_touch
   - shot_made (2 points)
4. Confirm updates in:
  - possession pass count
  - paint touch count
  - matrix event list
  - lineup differential tab totals

## Notes

- All data is synthetic and stored in src/data/seed.ts.
- No server or persistence is used in this phase.
