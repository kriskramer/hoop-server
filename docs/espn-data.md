# ESPN data

This doc covers the NBA data ESPN provides, which parts hoop-server polls for and stores, and how that data is laid out in Firebase. Client apps read the stored data as-is and derive anything else (advanced stats, groupings, views) themselves. The server does no transformation beyond making keys Firebase-safe and adding `order` and `winProbability` to plays.

For poll timing, game lifecycle, and error handling, see [architecture.md](architecture.md).

Field names and examples below come from real responses (DET @ CHA, event `401811026`, 2026-04-10, and the 2026-10 preseason scoreboards). ESPN's API is unofficial and undocumented, so any of it can change without notice.

## What we poll

The server uses two ESPN endpoints, both under `https://site.api.espn.com/apis/site/v2/sports/basketball/nba`:

| Endpoint | Called for | When | Stored at |
| --- | --- | --- | --- |
| `/scoreboard?dates=YYYYMMDD` | One ET date's games | Each poll: yesterday and today. Startup: the 5 days before and after today | `gameHeaders/{eventId}`, one per game |
| `/summary?event={eventId}` | One game | Each poll, for games that are live or final and still settling | `gameBoxScores/{eventId}`, `gamePlays/{eventId}` and `gameExtras/{eventId}` |

Scheduled (`pre`), postponed and canceled games only get a header. Live games get all four paths refreshed every 12–14 seconds. Final games keep refreshing until ESPN stops correcting them (see [Settling after the final buzzer](architecture.md#settling-after-the-final-buzzer)).

Every path is keyed by **ESPN event id** (for example `401811026`). The same id appears in the header, the box score, the plays, and the extras, so clients join on it.

## Firebase layout

```
gameHeaders/{eventId}                  scoreboard event: schedule, teams, score, status
gameBoxScores/{eventId}
    boxscore                           team and player stats
    leaders                            top performers per team
    gameInfo                           venue, attendance, officials
gamePlays/{eventId}/{playKey}          one node per play, with order and winProbability
gameExtras/{eventId}
    injuries                           both teams' injury reports
    pickcenter, odds, againstTheSpread betting lines and ATS records
    standings                          conference standings
    news                               league news articles
    videos                             highlight clips, trimmed (see below)
```

Two things apply to every stored value:

- **Keys are sanitized.** Firebase rejects `. $ # [ ] /` in keys, so `toFirebaseSafe` replaces them with `_`. In practice this only affects ESPN's `$ref` links, which become `_ref`.
- **Arrays come back as arrays, usually.** Firebase stores arrays as objects with numeric keys and returns them as arrays when the keys are dense. A client that reads one element at a time, or an array with `null`s, may see an object instead.

## Scheduled games, times, and scores: `gameHeaders`

Each node is the scoreboard's `event` object, unchanged. It's the source for the schedule, tip-off times, live scores, and game status.

### Finding games

The server writes headers for every game on the 11 dates around today at startup, plus yesterday and today on every poll, so the next 5 days of games are always present. There's no per-date index; clients query by `date` (an ISO UTC timestamp). To do that efficiently, add `".indexOn": ["date"]` to the `gameHeaders` rule and use `orderByChild('date')` with `startAt`/`endAt`. Headers are never deleted, so old games accumulate.

NBA dates are Eastern Time. A 10:30 PM ET tip-off is `03:30Z` on the following UTC day, so convert to ET before grouping games by day.

### Event fields

| Field | Example | Notes |
| --- | --- | --- |
| `id` | `"401811026"` | ESPN event id |
| `date` | `"2026-04-10T23:00Z"` | Scheduled tip-off, UTC |
| `name`, `shortName` | `"Detroit Pistons at Charlotte Hornets"`, `"DET @ CHA"` | |
| `season` | `{ year: 2026, type: 2, slug: "regular-season" }` | `type`: 1 preseason, 2 regular season, 3 postseason |
| `status` | see below | Game state, clock, and period |
| `competitions[0]` | see below | Teams, scores, venue, broadcasts. There's always exactly one |
| `links` | | ESPN web pages (gamecast, box score, and so on) |

### Status and game clock

`status` is the same at the top level and on `competitions[0]`:

```json
{
  "clock": 720, "displayClock": "12:00", "period": 4,
  "type": {
    "name": "STATUS_FINAL", "state": "post", "completed": true,
    "description": "Final", "detail": "Final", "shortDetail": "Final"
  }
}
```

| `type.state` | Meaning | Example `shortDetail` |
| --- | --- | --- |
| `pre` | Scheduled | `"10/5 - 7:00 PM EDT"` |
| `in` | Live | Period and clock as a display string |
| `post` + `completed: true` | Final | `"Final"` |
| `post` + `completed: false` | Postponed or canceled | |

Use `type.state` and `completed` for logic and `shortDetail`/`detail` for display. `period` is 0 before tip-off, 1–4 in regulation, and 5+ in overtime. `clock` is seconds remaining in the period.

### `competitions[0]`

| Field | Notes |
| --- | --- |
| `competitors[]` | Two entries, one per team (below) |
| `venue` | `{ fullName, address: { city, state }, indoor }` |
| `attendance` | 0 until reported |
| `broadcasts[]` | `{ market: "home", names: ["FanDuel SN SE"] }`, one per market |
| `playByPlayAvailable` | |
| `tickets` | Only before the game |
| `headlines` | Recap after the game |
| `notes` | Playoff/series notes, if any |

Each competitor:

| Field | Example | Notes |
| --- | --- | --- |
| `homeAway` | `"home"` | Use this, not array position, to tell the teams apart |
| `team` | `{ id: "30", abbreviation: "CHA", displayName, color, alternateColor, logo }` | `color` is hex without `#` |
| `score` | `"100"` | A string. `"0"` before tip-off |
| `linescores[]` | `{ period: 1, value: 30, displayValue: "30" }` | Points per period, including OT. Absent before tip-off |
| `winner` | `false` | Only once the game is final |
| `records[]` | `{ type: "total", summary: "43-38" }` | Also `home` and `road` records |
| `statistics[]` | `{ name: "fieldGoalPct", displayValue: "50.6" }` | Team totals for this game, plus season averages (`avgPoints`, …) |
| `leaders[]` | `points`, `rebounds`, `assists`, `rating` | The game's top player per category, once the game starts |

## Box scores: `gameBoxScores`

The server writes three parts of the summary response, unchanged:

```js
{ boxscore, leaders, gameInfo }
```

### `boxscore.teams[]`

One entry per team: `{ team, homeAway, displayOrder, statistics[] }`. Each statistic is `{ name, label, displayValue }`. All values are display strings, such as `"45-89"` and `"50.6"`.

The 25 team statistics:

- **Shooting:** `fieldGoalsMade-fieldGoalsAttempted`, `fieldGoalPct`, `threePointFieldGoalsMade-threePointFieldGoalsAttempted`, `threePointFieldGoalPct`, `freeThrowsMade-freeThrowsAttempted`, `freeThrowPct`
- **Rebounds:** `totalRebounds`, `offensiveRebounds`, `defensiveRebounds`
- **Other box stats:** `assists`, `steals`, `blocks`, `turnovers`, `teamTurnovers`, `totalTurnovers`, `fouls`, `technicalFouls`, `totalTechnicalFouls`, `flagrantFouls`
- **Game flow:** `turnoverPoints`, `fastBreakPoints`, `pointsInPaint`, `largestLead`, `leadChanges`, `leadPercentage`

### `boxscore.players[]`: player stats

One entry per team: `{ team, displayOrder, statistics: [ ... ] }`. `statistics` has a single element that holds the column definitions and every player's row:

| Field | Value |
| --- | --- |
| `keys` | `minutes, points, fieldGoalsMade-fieldGoalsAttempted, threePointFieldGoalsMade-threePointFieldGoalsAttempted, freeThrowsMade-freeThrowsAttempted, rebounds, assists, turnovers, steals, blocks, offensiveRebounds, defensiveRebounds, fouls, plusMinus` |
| `labels` / `names` | `MIN, PTS, FG, 3PT, FT, REB, AST, TO, STL, BLK, OREB, DREB, PF, +/-` |
| `descriptions` | Long names (`"Minutes"`, …) |
| `totals` | The team row, in the same column order (minutes and +/- are blank) |
| `athletes[]` | One row per player on the roster |

Each athlete row:

```json
{
  "athlete": { "id": "...", "displayName": "Tobias Harris", "shortName": "T. Harris",
               "jersey": "12", "position": { "abbreviation": "F" }, "headshot": { "href": "..." } },
  "starter": true,
  "active": false,
  "didNotPlay": false,
  "reason": "",
  "ejected": false,
  "stats": ["25", "8", "3-5", "1-1", "1-3", "6", "0", "1", "0", "0", "1", "5", "2", "+2"]
}
```

- `stats[i]` is the value for `keys[i]`. Build the lookup from `keys` rather than hard-coding positions, because ESPN can add or reorder columns.
- Every value is a string. Made-attempted pairs such as `"3-5"` need splitting, and `plusMinus` has a sign.
- A player who didn't play has `didNotPlay: true`, an empty `stats`, and a `reason` such as `"COACH'S DECISION"`.
- `active` means the player is on the floor right now. It's only meaningful while the game is live.
- `athlete.id` matches the ids in play `participants`, so plays can be attributed to players.

This covers the traditional box score only. Advanced stats (usage, true shooting, on/off splits, lineups, and so on) have to be derived from these totals and the play-by-play. Two-point makes, for example, are FG minus 3PT.

### `leaders`

An array with one entry per team: `{ team, leaders: [ { name, displayName, leaders: [ { displayValue, value, athlete, statistics } ] } ] }`. Categories are `points`, `rebounds` and `assists`, with the top player in each. It duplicates what the box score already contains, in a ready-to-display form.

### `gameInfo`

- `venue`: `{ fullName, address: { city, state }, images }`
- `attendance`
- `officials[]`: `{ displayName, position: { displayName }, order }`

## Play-by-play: `gamePlays`

One node per play, written once plays exist (from tip-off). The server sends only new or changed plays on each poll (see [Incremental play writes](architecture.md#incremental-play-writes)).

### Keys and ordering

- **Key**: the play's `sequenceNumber`, zero-padded to six digits (`000142`).
- **`order`** (added by the server): the play's position in ESPN's list. **Sort by `order`, not by key.** Sequence numbers follow the order plays were logged, so a late-logged play has a higher number than the plays around it.

Plays can change after they first appear. ESPN corrects them during and after the game (reclassifying shots, fixing participants) and occasionally deletes one. A client listening with `onChildAdded`, `onChildChanged` and `onChildRemoved` sees each of these as it happens.

### Play fields

```json
{
  "id": "40181102614",
  "sequenceNumber": "14",
  "order": 9,
  "type": { "id": "98", "text": "Free Throw - 1 of 2" },
  "text": "Brandon Miller makes free throw 1 of 2",
  "shortDescription": "+1 Point",
  "period": { "number": 1, "displayValue": "1st Quarter" },
  "clock": { "displayValue": "11:34" },
  "wallclock": "2026-04-10T23:11:40Z",
  "awayScore": 0,
  "homeScore": 1,
  "scoringPlay": true,
  "scoreValue": 1,
  "shootingPlay": true,
  "pointsAttempted": 1,
  "team": { "id": "30" },
  "participants": [{ "athlete": { "id": "4433287" } }],
  "coordinate": { "x": -214748340, "y": -214748365 },
  "winProbability": { "homeWinPercentage": 0.537, "tiePercentage": 0 }
}
```

| Field | Notes |
| --- | --- |
| `type.text` | Specific play type: `Jump Shot`, `Pullup Jump Shot`, `Driving Layup Shot`, `Defensive Rebound`, `Bad Pass Turnover`, `Shooting Foul`, `Substitution`, `Full Timeout`, `Coach's Challenge (Overturned)`, `End Period`, `End Game`, and about 70 others. `type.id` is the stable code |
| `text` | Human-readable description |
| `awayScore`, `homeScore` | Score after the play |
| `scoringPlay`, `scoreValue` | Whether points were scored, and how many |
| `shootingPlay`, `pointsAttempted` | Any shot attempt (made or missed, including free throws), and its point value. A missed shot is `shootingPlay: true, scoringPlay: false` |
| `team.id` | The team the play belongs to. Missing on some neutral plays such as challenges |
| `participants[]` | Athlete ids involved, primary first. A made shot can list the shooter then the assister. A jump ball lists both jumpers then the player who gained possession |
| `clock.displayValue` | Game clock as text (`"11:34"`, or tenths in the last minute) |
| `wallclock` | Real-world UTC time of the play |
| `coordinate` | Court location (below) |
| `winProbability` | Added by the server from the summary's `winprobability` series. `null` when ESPN has no entry for the play |

### Shot coordinates

For shots taken from the floor, `coordinate` is in feet on a half court: `x` runs 0–50 sideline to sideline and `y` is distance from the baseline, with the basket near `(25, 5)`. Shots at both ends are mapped onto the same half. Long heaves can have a large `y` (78 was observed).

Free throws, jump balls, timeouts and other plays without a location use the sentinel `{ x: -214748340, y: -214748365 }`. Treat any negative coordinate as "no location". Some non-shot plays (rebounds, fouls) do have real coordinates.

### Win probability

`winProbability.homeWinPercentage` is a fraction from 0 to 1. The away team's chance is `1 - homeWinPercentage - tiePercentage`. In the sample game every play had an entry (506 plays, 506 entries).

## Injuries, odds, standings, news, and highlights: `gameExtras`

The server writes these parts of the summary from the same summary request as the box score. All but `videos` are stored unchanged:

```js
{ injuries, pickcenter, odds, againstTheSpread, standings, news, videos }
```

They're kept out of `gameBoxScores` so clients listening to live stats don't re-download about 45 KB of news and standings on every box score change. The node is rewritten whole, and only when something in it changed. Changes here don't count toward [settling](architecture.md#settling-after-the-final-buzzer), because league news keeps changing long after a game ends.

| Key | Contents |
| --- | --- |
| `injuries[]` | One entry per team: `{ team, injuries: [ { status: "Day-To-Day", date, athlete, type, details } ] }` |
| `pickcenter[]` | One entry per betting provider: `details` (`"CHA -6.5"`), `spread`, `overUnder`, `overOdds`, `underOdds`, and `homeTeamOdds`/`awayTeamOdds` with `moneyLine`, `spreadOdds` and `favorite` |
| `odds` | Usually empty; `pickcenter` has the lines |
| `againstTheSpread[]` | Each team's record against the spread this season |
| `standings` | `{ header: "2026-27 Standings", groups: [ ... ] }`, one group per conference involved, with each team's record |
| `news` | `{ header, link, articles: [ ... ] }`. League-wide, not specific to this game |
| `videos[]` | ESPN highlight clips, oldest first, trimmed by `videos.js` to `{ id, headline, duration, publishedAt, thumbnail, url }`. `url` is the clip's espn.com page. In-game clips appear a few minutes after the play; the recap appears shortly after the final buzzer. The stream and MP4 links, and the per-country restrictions (Canada isn't on the list), aren't stored, because the app links out to espn.com instead of playing ESPN's files |

Things to know:

- **Captured only once a game starts.** The summary is fetched for live and final games only, so a scheduled game has no `gameExtras` node yet. The injury report and lines are written from tip-off onward.
- **`pickcenter` is empty until close to the game.** It was empty for preseason games and for regular games two days out. When present during or after a game, it shows the line ESPN currently has, which may be the closing line.
- **`standings` and `news` repeat across games.** Every game played the same day stores the same news, and games in the same conference store the same standings.

## Summary data we don't store

The summary response also includes these. `saveDetails` in `index.js` drops them. Each one is a one-line addition there if a client needs it.

| Key | Contents |
| --- | --- |
| `header` | Game status and per-period linescores, plus flags such as `shotChartAvailable`, `possessionArrowAvailable` and `timeoutsAvailable`. Mostly duplicates `gameHeaders` |
| `seasonseries` | Head-to-head series this season, with the other meetings' event ids |
| `broadcasts` | TV and radio |
| `article` | Game recap article |
| `winprobability` | Merged into each play rather than stored separately |
| `format`, `meta`, `wallclockAvailable` | Metadata |

## Other ESPN endpoints

The server doesn't call any of these. They all returned data when tested on 2026-10-03, need no key, and are just as unofficial as the endpoints above.

### Site API: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba`

| Path | Contents |
| --- | --- |
| `/teams` | All 30 teams with logos and colors |
| `/teams/{teamId}` | One team: record, venue, next event |
| `/teams/{teamId}/roster` | Players (bio, position, jersey, headshot) and coach |
| `/teams/{teamId}/schedule` | The team's full season schedule and results |
| `/injuries` | League-wide injury report, including teams not playing today |
| `/news` | League news articles (the same feed stored in `gameExtras/news`) |

League standings are at `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings` (note `v2` without `site`).

### Player API: `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athleteId}`

| Path | Contents |
| --- | --- |
| `/overview` | Season averages, recent games, next game, news |
| `/gamelog` | Every game this season with the traditional box score line |
| `/splits` | Season stats split by home/away, month, opponent, and so on |

### Core API: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba`

A more granular, paged API in which responses link to each other with `$ref` URLs. One useful resource is per-player game stats at `/events/{id}/competitions/{id}/competitors/{teamId}/roster/{athleteId}/statistics/0`. It includes stats the site box score doesn't, such as two-point makes and attempts, points in the paint, `estimatedPossessions`, `pointsPerEstimatedPossessions`, `shootingEfficiency`, `scoringEfficiency`, `assistTurnoverRatio`, double-doubles and triple-doubles. That's one request per player per game, so it isn't practical to poll live.

## Quirks

- **One date per scoreboard request.** `dates=20261003-20261005` returns 400.
- **Strings everywhere.** Scores in headers and every box score stat are strings, while scores in plays are numbers.
- **Post-game corrections.** ESPN keeps editing plays and stats for at least 15 minutes after the final, and occasionally the next day. Clients should expect final-game data to change.
- **No push feed.** Live data is only as fresh as the poll interval (12–14 s) plus ESPN's own delay.
