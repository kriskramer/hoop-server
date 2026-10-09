# ESPN data

This doc covers the NBA data ESPN provides, which parts hoop-server polls for and stores, and how that data is laid out in Firebase. Client apps read the stored data as-is and derive anything else (advanced stats, groupings, views) themselves. The server does no transformation beyond making keys Firebase-safe and adding `order` and `winProbability` to plays.

For poll timing, game lifecycle, and error handling, see [architecture.md](architecture.md).

Field names and examples below come from real responses (DET @ CHA, event `401811026`, 2026-04-10, and the 2026-10 preseason scoreboards). ESPN's API is unofficial and undocumented, so any of it can change without notice.

## What we poll

The server uses these ESPN endpoints. Most are under `https://site.api.espn.com/apis/site/v2/sports/basketball/nba`. The standings are under `https://site.api.espn.com/apis/v2/sports/basketball/nba` (`v2` without `site`), and team leaders are in the core API (`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba`):

| Endpoint | Called for | When | Stored at |
| --- | --- | --- | --- |
| `/scoreboard?dates=YYYYMMDD` | One ET date's games | Each poll: yesterday and today. Startup: the 5 days before and after today | `gameHeaders/{eventId}`, one per game |
| `/summary?event={eventId}` | One game | Each poll, for games that are live or final and still settling. Scheduled games hourly, and every 10 minutes in the two hours before tip-off | `gameBoxScores/{eventId}`, `gameRosters/{eventId}`, `gamePlays/{eventId}` and `gameExtras/{eventId}`. Scheduled games only `gameExtras/{eventId}` |
| `/standings?seasontype=2`, with and without `level=3` | Both conferences' regular-season standings, and their divisions | At startup, 3 minutes after a game goes final, and at least hourly | `standings`, trimmed |
| `/teams` | The 30 team ids | Once, at startup (retried on failure) | Not stored |
| `/teams/{id}/roster`, `/teams/{id}/schedule?seasontype=2`, `/teams/{id}/statistics?seasontype=2`, and the core API's `/seasons/{year}/types/2/teams/{id}/leaders` | One team's players, games, season stats and leaders | Every team at startup and daily, and a game's two teams 3 minutes after it goes final | `teams/{teamId}`, trimmed |
| The athlete API's `/athletes/{id}`, `/gamelog`, `/splits` and `/stats` | One player's bio, season games, splits and career | Every rostered player at startup and daily, and a final game's two rosters 3 minutes after it goes final | `players/{athleteId}`, trimmed |

Scheduled (`pre`) games get a header and extras, and postponed and canceled games only a header. Live games get all five paths refreshed every 12–14 seconds. Final games keep refreshing until ESPN stops correcting them (see [Settling after the final buzzer](architecture.md#settling-after-the-final-buzzer)).

Every game path is keyed by **ESPN event id** (for example `401811026`). The same id appears in the header, the box score, the plays, and the extras, so clients join on it.

## Firebase layout

```
gameHeaders/{eventId}                  scoreboard event: schedule, teams, score, status
gameBoxScores/{eventId}
    boxscore                           team and player stats
    leaders                            top performers per team
    gameInfo                           venue, attendance, officials
gameRosters/{eventId}/{athleteId}      name, short name, jersey, team and starter, from the box score
gamePlays/{eventId}/{playKey}          one node per play, with order and winProbability
gameExtras/{eventId}
    injuryReport                       both teams' injured players, trimmed (see below)
    lines                              the sportsbook line, trimmed (see below)
    news                               league news articles
    videos                             highlight clips, trimmed (see below)
standings                              East and West standings, trimmed (see below)
teams/{teamId}                         one team's roster, schedule, stats and leaders, trimmed (see below)
players/{athleteId}                    one player's bio, game log, splits and career, trimmed (see below)
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

## Injuries, odds, news, and highlights: `gameExtras`

The server builds these from the same summary request as the box score, in `extras.js`. The injury report, line and clips are trimmed, and `news` is stored unchanged:

```js
{ injuryReport, lines, news, videos }
```

They're kept out of `gameBoxScores` so clients listening to live stats don't re-download them on every box score change. The node is rewritten whole, and only when something in it changed. Changes here don't count toward [settling](architecture.md#settling-after-the-final-buzzer), because league news keeps changing long after a game ends.

| Key | Contents |
| --- | --- |
| `injuryReport[]` | From the summary's `injuries`, one entry per team with injured players: `{ teamId, abbr, players: [ { id, name, short, pos, jersey, status, tag, part, detail, side, returnDate, updated } ] }`. `status` is `"Out"` or `"Day-To-Day"`. `tag` is ESPN's fantasy label: `OUT`, `OFS` (out for the season) or `GTD`. `part` is the body part or reason (`"Knee"`, `"Rest"`), and ESPN's `"Not Specified"` is stored as no value. About 1–2 KB, against 8–12 KB untrimmed |
| `lines` | From the summary's `pickcenter`, the highest-priority sportsbook (DraftKings so far): `{ provider, details, spread, overUnder, overOdds, underOdds, home, away, open }`. `details` is ESPN's text (`"IND -2.5"`). `spread` is the home team's line, so it's positive when the away team is favored. `home` and `away` are `{ teamId, moneyLine, spreadOdds, favorite }`. `open` is `{ spread, overUnder, homeMoneyLine, awayMoneyLine }`, the opening line, parsed from ESPN's display strings (`"+114"`, `"o232.5"`). Missing when no sportsbook has a line |
| `news` | `{ header, link, articles: [ ... ] }`. League-wide, not specific to this game |
| `videos[]` | ESPN highlight clips, oldest first, trimmed by `videos.js` to `{ id, headline, duration, publishedAt, thumbnail, url }`. `url` is the clip's espn.com page. In-game clips appear a few minutes after the play; the recap appears shortly after the final buzzer. The stream and MP4 links, and the per-country restrictions (Canada isn't on the list), aren't stored, because the app links out to espn.com instead of playing ESPN's files |

Things to know:

- **Scheduled games get extras too.** The summary of a `pre` game has the injury report and line (and empty box score and plays), so the server fetches it hourly, and every 10 minutes in the two hours before tip-off (`pregameRefreshDue`). That covers today's games, which are polled. Games up to 5 days ahead are fetched once by the startup backfill. Postponed and canceled games aren't fetched.
- **When the line appears.** On 2026-10-09, `pickcenter` had a DraftKings line for preseason games the next day and for opening-night games 12 days out, though not for every game on the schedule. Earlier in the preseason it was empty for games two days out. During and after a game, it shows the line ESPN has then, which is the closing line, with the opening line under `pointSpread`, `moneyline` and `total`.
- **The scoreboard has the line too.** A scheduled game's header has the same DraftKings line at `competitions[0].odds[0]`, untrimmed. ESPN drops it from the scoreboard once the game is over, so clients use the header's only before `lines` is stored.
- **Not stored:** the summary's `odds` (always empty so far), `againstTheSpread` (each team's ATS record, with empty `records` in the preseason), and the sportsbook links in `pickcenter`. Games stored before 2026-10-09 have the untrimmed `injuries`, `pickcenter`, `odds` and `againstTheSpread` instead.
- **`news` repeats across games.** Every game played the same day stores the same news.
- **The summary's `standings` isn't stored.** It covers only the game's conferences and repeats across games. The full standings are in [`standings`](#standings-standings) instead. Until 2026-10-09 it was stored here, so older games' extras still have it.

## Standings: `standings`

`GET https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2` returns `children[]`, one per conference (`abbreviation` `"East"` or `"West"`), each with `standings.entries[]` of 15 teams. Each entry has `team` (id, names, logos, links) and about 22 `stats`, each an object with `name`, `type`, `abbreviation`, `value` and `displayValue`. Records such as home and road have a `summary` (`"12-5"`) instead of a `value`. With `?level=3`, each conference has `children[]` of three divisions instead (`name` `"Atlantic"`), each with its own `standings.entries[]`. The stats are the same as in the conference response, with one difference: `gamesbehind` is games behind the division leader, not the conference leader.

Without `seasontype`, it returns the current season type, which in October is the preseason (`seasonType: 1`, with preseason records). The server always asks for the regular season. Until the first regular-season games, every team is 0-0 with `playoffSeed` 0, and the entries are in alphabetical order, not by seed.

The server fetches both, in parallel. Each response is about 164 KB, so `standings.js` trims them to about 6.5 KB together:

```
standings = {
  season: "2026-27", seasonType: 2, updatedAt: <ms>,
  east: [ { teamId, abbr, name, seed, wins, losses, pct, gb, streak, home, road, conf, div, l10, diff }, ... 15 ],
  west: [ ... 15 ],
  divisions: {
    east: [ { name: "Atlantic", teams: [ { teamId, gb }, ... 5 ] }, ... 3 ],
    west: [ ... 3 ]
  }
}
```

| Field | From (`stats[].type`) | Example |
| --- | --- | --- |
| `seed` | `playoffseed` value. `null` before the season, when ESPN sends 0 | `3` |
| `wins`, `losses`, `pct` | `wins`, `losses`, `winpercent` values | `12`, `5`, `0.706` |
| `gb` | `gamesbehind` display value. `"-"` for the leader | `"1.5"` |
| `streak` | `streak` display value | `"W3"` |
| `home`, `road`, `conf`, `div`, `l10` | `home`, `road`, `vsconf`, `vsdiv`, `lasttengames` display values | `"7-2"` |
| `diff` | `differential`: average point differential per game | `-4.5` |

Stats are looked up by `type` rather than by position or `name` (`"vs. Div."`). Each conference is ordered by seed, then by name for teams without one.

A division stores only each team's id and its games behind the division leader (`gb`, `"-"` for the leader), because the rest of the row is the same as the team's conference row. Divisions are ordered by name, and each division's teams by games behind, then by seed. `divisions` is `null` if the `level=3` response has none.

`updatedAt` is when the server last wrote a change.

The server refreshes the standings on its first poll, 3 minutes after it first sees a game as final, and at least every hour. It writes only when the trimmed standings changed, and retries a failed refresh 5 minutes later.

## Team pages: `teams/{teamId}`

Four requests per team, all keyed by ESPN team id:

- **`/teams/{id}/roster`** (about 90 KB): `athletes[]` with bio fields (`displayName`, `shortName`, `jersey`, `position`, `displayHeight`, `displayWeight`, `age`, `experience.years`, `college`), `injuries[]` (`status` such as `"Day-To-Day"`), and `coach[]`.
- **`/teams/{id}/schedule?seasontype=2`** (about 0.8 MB, almost all repeated team metadata): `events[]` for the current season's regular season, each a scoreboard-like event with one competition, its two competitors (`homeAway`, `score.value` once started, `winner` once final) and `status.type`. `timeValid: false` means the tip-off time isn't set yet. Without `seasontype`, ESPN returns the current season type, which in October is the preseason's 4 games.
- **`/teams/{id}/statistics?seasontype=2`** (about 12 KB): `results.stats.categories[]` (`general`, `offensive`, `defensive`), each with `stats[]` named like `avgPoints` or `fieldGoalPct` (0–100). There are no opponent stats or league ranks. **Before the regular season starts, it returns last season**, and `requestedSeason` (`{ year: 2026, displayName: "2025-26" }`) says which. `?season=2027` returns 404 then.
- **Core API `/seasons/{year}/types/2/teams/{id}/leaders`** (about 140 KB): `categories[]` (`pointsPerGame`, `reboundsPerGame`, ...), each with 20 `leaders[]` of `{ displayValue, value, athlete: { $ref } }`. The athlete id is at the end of the `$ref` URL. The server asks for the season the statistics came from, so the two match. A season with no games yet returns 404.

`teams.js` trims them to about 11 KB per team:

```
teams/{teamId} = {
  season: "2026-27", statsSeason: "2025-26", coach: "J.B. Bickerstaff", updatedAt: <ms>,
  roster: [ { id, name, short, jersey, pos, ht, wt, age, exp, college, injury }, ... ],
  schedule: [ { id, date, home, opp, status, tbd?, score?, oppScore?, win? }, ... 82 ],
  stats: { gp, pts, reb, ast, stl, blk, tov, oreb, dreb, pf, fgm, fga, fgPct, tpm, tpa, tpPct, ftm, fta, ftPct, astTo },
  leaders: { pts: [ { id, value }, ... 3 ], reb, ast, stl, blk, tpm }
}
```

- **`roster`** is ordered by jersey number. `injury` is the first injury's status, or `null`. Clients build headshot URLs from the athlete id.
- **`schedule`** is ordered by date. `id` is the event id, the same key as `gameHeaders`, but headers only exist for games the server has seen (about 5 days ahead). `opp` is the opponent's team id. `status` is `scheduled`, `live`, `final` or `postponed` (also canceled). `score` and `oppScore` are there once a game has started, and `win` once it's final.
- **`stats`** are per-game averages and percentages, rounded to 1 decimal place (3 for `astTo`). `null` if the request failed.
- **`leaders`** keeps each category's top 3 players **who are on the current roster**, so before the season they're last season's leaders among this season's players. `null` if there are none.
- **`statsSeason`** is the season `stats` and `leaders` are from. When it differs from `season`, the page labels them as last season's.

The server lists the teams once, then refreshes every team at startup and every 24 hours, one team at a time, in the background so polling doesn't wait. A game's two teams are refreshed 3 minutes after it's first seen as final. A team is written only when its trimmed value changed, and a failed team is retried 5 minutes later. A failed statistics or leaders request doesn't fail the team: it's stored without them.

## Player pages: `players/{athleteId}`

Four requests per player, all on the athlete API (`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athleteId}`). Checked on 2026-10-09:

- **`/athletes/{id}`** (about 80 KB, mostly team metadata, the roster switcher and ticket links): `athlete` with `displayName`, `firstName`, `lastName`, `jersey`, `position`, `team`, `displayHeight`, `displayWeight`, `age`, `displayDOB` (**day/month/year**, "25/9/2001"), `displayBirthPlace`, `displayDraft` ("2021: Rd 1, Pk 1 (DET)"), `displayExperience` ("6th Season"), `college`, `active` and `status`, `injuries[]` (`status`, `details.type`, `details.returnDate`), and `statsSummary`: points, rebounds, assists and FG% with the league `rank`, for the latest season with games.
- **`/gamelog`** (about 0.8 MB, 26 KB gzipped, because each game repeats both teams' metadata and links): `events` keyed by event id (`gameDate`, `atVs`, `homeTeamId`, `homeTeamScore`, `awayTeamScore`, `gameResult`, `opponent`, `team`, and `eventNote` such as "East Semifinals - Game 7"), and `seasonTypes[]` ("2025-26 Postseason", "2025-26 Regular Season", "2025-26 Preseason"), each with `categories[]` (by month or by playoff round) of `events[]` `{ eventId, stats }`. **The All-Star games are listed as regular-season games** (`eventNote` "NBA All-Star - ..."). The `season` filter says which season it is. Without `?season=`, it's the latest season with games, so before the regular season starts it's last season, as with the team statistics.
- **`/splits`** (about 12 KB): `splitCategories[]` (`split` with "All Splits", Home, Road, vs. Division and so on; `byResult`; `byMonth`; `byDay`; `byOpponent`; `byPosition`), each split `{ displayName, stats }`.
- **`/stats`** (about 18 KB): `categories[]` (`averages`, `totals`, `miscellaneous`), each with a row per season, `{ teamId, season: { displayName }, stats }`, and the career `totals`. **A season split between teams has a row per team and a combined row without `teamId`.**

The column `names` differ between these responses (`/splits` has "Free Throws Made-Attempted Per Game"), but the `labels` (`GP`, `MIN`, `FG`, `FG%`, `3PT`, `OR`, `TO`, ...) are the same, so `players.js` reads stats by label. `FG`, `3PT` and `FT` are "made-attempted".

`players.js` trims them to about 15–25 KB per player, most of it the game log:

```
players/{athleteId} = {
  id, name, short, jersey, pos, teamId, ht, wt, age, born: "2001-09-25", birthplace, draft, exp, college,
  status,                                   // only for inactive players: "Free Agent", ...
  injury: { status, type, returns } | null,
  ranks: { pts, reb, ast, fgPct },          // league ranks
  season: "2025-26", updatedAt: <ms>,
  averages: { gp, min, pts, reb, ast, stl, blk, tov, oreb, dreb, pf, fgm, fga, fgPct, tpm, tpa, tpPct, ftm, fta, ftPct },
  log: [ { id, date, home, opp, teamId?, score, oppScore, win, post?, note?, min, pts, reb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta }, ... ],
  splits: { general: [ { name, ...averages } ], result, month },
  career: [ { season, teamId?, gp, gs, ...averages }, ... ],
  careerTotal: { ... }
}
```

- **`log`** has the season's regular-season and playoff games (`post: true`) in date order. Preseason and All-Star games are left out. Rows have no percentages; clients work them out from makes and attempts. `teamId` is only there when it isn't the player's current team (after a trade). `id` is the event id, but `gameHeaders` only has the games the server has seen.
- **`averages`** is the splits' "All Splits" row. `splits` keeps the general, by-result and by-month splits.
- **`career`** is the regular season by season, oldest first, with a traded season's rows as ESPN gives them.
- Only the bio is required. If the game log, splits or stats request fails, the player is stored without that part.

The server refreshes every player on a team's roster at startup and every 24 hours, one at a time in the background. It gets the rosters from the team pages, so the first refresh starts as the teams come in. A final game's two rosters are refreshed 3 minutes after the server first sees the game as final. A player is written only when the trimmed value changed, and a failed refresh is retried 5 minutes later. A player who leaves every roster stops being refreshed, but their node stays. A full refresh is about 2,100 requests (about 25 MB gzipped) and takes a few minutes.

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

The server doesn't call these, except the team and player endpoints marked as stored. They all returned data when tested on 2026-10-03, need no key, and are just as unofficial as the endpoints above.

### Site API: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba`

| Path | Contents |
| --- | --- |
| `/teams` | All 30 teams with logos and colors. Called for the team ids |
| `/teams/{teamId}` | One team: record, venue, next event |
| `/teams/{teamId}/roster` | Players (bio, position, jersey, headshot) and coach. Stored, see [Team pages](#team-pages-teamsteamid) |
| `/teams/{teamId}/schedule` | The team's full season schedule and results. Stored |
| `/teams/{teamId}/statistics` | The team's season stats. Stored |
| `/injuries` | League-wide injury report, including teams not playing today |
| `/news` | League news articles (the same feed stored in `gameExtras/news`) |

League standings (`/apis/v2/sports/basketball/nba/standings`) are now stored. See [Standings](#standings-standings).

### Player API: `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athleteId}`

| Path | Contents |
| --- | --- |
| (no path) | Bio, current team, injuries, and season averages with league ranks. Stored, see [Player pages](#player-pages-playersathleteid) |
| `/overview` | Season averages, recent games, next game, news, awards, and a Rotowire note. Not stored |
| `/gamelog` | Every game this season with the traditional box score line. Stored |
| `/splits` | Season stats split by home/away, month, opponent, and so on. Stored |
| `/stats` | Career averages and totals by season. Stored |

### Core API: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba`

A more granular, paged API in which responses link to each other with `$ref` URLs. One useful resource is per-player game stats at `/events/{id}/competitions/{id}/competitors/{teamId}/roster/{athleteId}/statistics/0`. It includes stats the site box score doesn't, such as two-point makes and attempts, points in the paint, `estimatedPossessions`, `pointsPerEstimatedPossessions`, `shootingEfficiency`, `scoringEfficiency`, `assistTurnoverRatio`, double-doubles and triple-doubles. That's one request per player per game, so it isn't practical to poll live.

## Quirks

- **One date per scoreboard request.** `dates=20261003-20261005` returns 400.
- **Strings everywhere.** Scores in headers and every box score stat are strings, while scores in plays are numbers.
- **Post-game corrections.** ESPN keeps editing plays and stats for at least 15 minutes after the final, and occasionally the next day. Clients should expect final-game data to change.
- **No push feed.** Live data is only as fresh as the poll interval (12–14 s) plus ESPN's own delay.
