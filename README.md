# McLaren F1 Tracker (unofficial)

An unofficial fan dashboard that follows the McLaren Formula 1 team. Every number, name, result,
schedule, standing and telemetry trace on the site is fetched live in your browser from two open
APIs. Nothing is invented, baked in at build time, or hardcoded.

**Live site:** https://waleedrahman-design.github.io/mclarentracker/

> Unofficial fan project. Not affiliated with, endorsed by, or connected to McLaren Racing,
> Formula 1, the FIA, or Google. F1, FORMULA 1 and related marks are trademarks of Formula One
> Licensing B.V. All other names and marks belong to their respective owners. No team or
> partner logos are used.

## Pages

| Page | What it shows | Source |
| --- | --- | --- |
| Overview | Countdown to the next session (your local time), team driver cards (position, points, wins, podiums, poles computed from results), constructors' position, last Grand Prix and last sprint, teammate head-to-head | Jolpica-F1 |
| Live Session | Session header, leaderboard with gaps and intervals (or best laps outside races), team telemetry (speed, throttle, brake, RPM, gear, DRS) with sparklines, weather, race control feed, team radio playback, pit stops, tyre stints | OpenF1 |
| Standings | Full drivers' and constructors' tables, team rows highlighted | Jolpica-F1 |
| Title Fight | Remaining Grands Prix and sprints, maximum points still available, who is still mathematically in contention, points-progression chart (hand-rolled SVG) | Jolpica-F1 |
| Compare | A team driver vs any driver: season head-to-head plus lap-time and gap charts for any completed session | Jolpica-F1 + OpenF1 |
| Seasons Archive | Any season since the championship began, round by round, with race, sprint and qualifying classifications; lap charts where OpenF1 has the event | Jolpica-F1 + OpenF1 |
| Schedule | Full calendar with every session in local time and its status | Jolpica-F1 + OpenF1 |
| Watch & Links | Outbound links to official places to watch and follow | - |

Every data panel shows its source and the time it was last updated. If an API call fails the
panel shows an error with a Retry button; it never falls back to made-up numbers (a previously
fetched copy may be shown, clearly labelled as cached).

## How "live" works

- **Subject team** is the only constant: Jolpica `constructorId=mclaren` and OpenF1
  `team_name=McLaren`. Drivers are derived from the team's most recent race results; the team
  colour comes from OpenF1 `team_colour`; the season is Jolpica's `current`.
- **Points available** in the Title Fight page are derived from the points actually awarded in
  this season's results, not from a hardcoded table. Until the first sprint of a season has been
  held, sprint points are taken from the previous season's sprint results (the page says so).
- **Live or finished** is decided from the data, not the timetable. A session is live from its
  scheduled start until OpenF1 race control reports the finish (`SessionStatus` "SESSION
  FINISHED" or the chequered flag; for qualifying only the final segment counts). If no finish
  marker arrives, the session is treated as live until two hours after its scheduled end, to
  cover overruns such as red flags and delays. The same rule drives the Live page, the drawer,
  the Schedule and the Compare session list.
- **Live polling** runs only while the Live page is visible and the session is live as above
  (from 5 minutes before the scheduled start). It stops as soon as the finish is reported. It
  issues one OpenF1 request every few seconds, rotating across endpoints and asking only for rows
  newer than the last one received (laps are requested by lap start time, so every driver's new
  laps arrive regardless of how many laps they have run).

## Endpoints used

Jolpica-F1 (`https://api.jolpi.ca/ergast/f1/`):
`current.json`, `{season}.json`, `current/driverStandings.json`, `current/constructorStandings.json`,
`current/last/results.json`, `{season}/results.json`, `{season}/sprint.json`,
`{season}/constructors/mclaren/{results,sprint,qualifying,drivers,constructorStandings}.json`,
`{season}/drivers/{id}/{results,qualifying}.json`, `{year}/{round}/{results,sprint,qualifying}.json`,
`seasons.json`.

OpenF1 (`https://api.openf1.org/v1/`):
`sessions`, `meetings`, `drivers`, `position`, `intervals`, `laps`, `car_data`, `weather`,
`race_control`, `team_radio`, `pit`, `stints`.

## Rate limits and caching

- Requests go through per-API queues: Jolpica at most ~3 requests/second and 60/minute; OpenF1
  at most ~2.5 requests/second and 28/minute.
- Responses are cached in memory and `localStorage` with TTLs: standings and results 10 minutes,
  schedule 6 hours, past seasons 7 days. An OpenF1 session is cached for 7 days only once its
  finish has been confirmed and two further hours have passed, so data that fills in after the
  session is not locked out. Empty answers ("No results found") are kept for 3 minutes at most
  and never stored in `localStorage`.
- A driver's team is taken from their most recent race result (drivers who move mid-season
  appear under their current team).

## Limitations

- OpenF1 serves its historical data for free; **real-time data during a session
  requires an OpenF1 subscription**. On free access the Live page may show nothing new until the
  session ends, at which point the final data appears. The page says so when it happens.
- Under the current technical regulations OpenF1 reports `drs` as null; the telemetry panel
  shows "n/a" whenever the field is not reported.
- Championship contention ignores countback tie-breaks.

## Design

- Styled after broadcast timing graphics and sports data journalism: editorial panels with
  thin rules instead of nested cards, carbon "timing board" blocks for the next session and the
  live session header, and timing-tower rows for standings and the leaderboard.
- Type: Barlow Condensed (headings, positions, countdown), IBM Plex Sans (body) and JetBrains
  Mono (lap times, gaps, timestamps), loaded from Google Fonts. Numbers use tabular figures.
- Colour: the accent is the team colour reported live by OpenF1 (`team_colour`), and the
  standings bars use each constructor's live colour. Tyre chips use the standard compound
  colours. Light theme is a warm paper; dark theme is a near-black carbon.
- Charts label each line directly at its end instead of using a legend.
- Motion is limited to the countdown tick, the loading shimmer and row hover, and is switched off
  under `prefers-reduced-motion`.

## Development

Vanilla HTML, CSS and JavaScript. No build step, no dependencies.

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Files: `index.html`, `style.css`, `app.js`, `favicon.svg`, `manifest.json`.
