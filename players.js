// Player pages, from four ESPN athlete endpoints per player (see espn-data.md): the bio, the
// season's game log, its splits, and career averages by season. The game log alone is about
// 0.8 MB, almost all of it repeated team metadata and links, so they're trimmed to what the
// player page shows, about 10-15 KB, and written to `players/{athleteId}`.

const { KeyedRefresher } = require('./refresher');

// ESPN's column labels -> stored keys. The labels are the same in the game log, splits and
// stats responses, unlike the `names`. "FG", "3PT" and "FT" are "made-attempted".
const COLUMNS = {
    GP: 'gp',
    GS: 'gs',
    MIN: 'min',
    FG: ['fgm', 'fga'],
    'FG%': 'fgPct',
    '3PT': ['tpm', 'tpa'],
    '3P%': 'tpPct',
    FT: ['ftm', 'fta'],
    'FT%': 'ftPct',
    OR: 'oreb',
    DR: 'dreb',
    REB: 'reb',
    AST: 'ast',
    BLK: 'blk',
    STL: 'stl',
    PF: 'pf',
    TO: 'tov',
    PTS: 'pts',
};

// League ranks kept from the bio's season summary, as stored key -> ESPN stat `name`.
const RANKS = {
    pts: 'avgPoints',
    reb: 'avgRebounds',
    ast: 'avgAssists',
    fgPct: 'fieldGoalPct',
};

// Split categories kept, as stored key -> ESPN category `name`.
const SPLITS = {
    general: 'split',
    result: 'byResult',
    month: 'byMonth',
};
// The "All Splits" row is the season average, stored as `averages` instead.
const ALL_SPLITS = 'All Splits';

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const num = (value) => (Number.isFinite(value) ? value : null);
const array = (value) => (Array.isArray(value) ? value : []);

// "23.9" -> 23.9. ESPN shows missing values as "-" or "--".
function parseNumber(text) {
    if (typeof text !== 'string' || !/^-?\d+(\.\d+)?$/.test(text.trim())) return null;
    return Number(text);
}

// One row of stats, keyed by `labels` (ESPN's column labels): { gp, min, pts, fgm, fga, ... }.
// Columns without a value are left out. Returns null if there are none.
function statLine(labels, stats) {
    const line = {};
    array(labels).forEach((label, i) => {
        const key = COLUMNS[label];
        const text = array(stats)[i];
        if (!key || typeof text !== 'string') return;
        if (Array.isArray(key)) {
            const [made, attempted] = text.split('-').map(parseNumber);
            if (made != null && attempted != null) {
                line[key[0]] = made;
                line[key[1]] = attempted;
            }
            return;
        }
        const value = parseNumber(text);
        if (value != null) line[key] = value;
    });
    return Object.keys(line).length > 0 ? line : null;
}

// ESPN's `displayDOB` is day/month/year ("25/9/2001"). Returns "2001-09-25", or null.
function parseBirthDate(text) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(text) ?? '');
    if (!match) return null;
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// The player's bio from `/athletes/{id}`. Returns null without an id and name.
function trimBio(data) {
    const athlete = data?.athlete;
    const name = str(athlete?.displayName) ?? str(athlete?.fullName);
    if (athlete?.id == null || !name) return null;
    const first = str(athlete.firstName);
    const last = str(athlete.lastName);
    const injury = array(athlete.injuries)[0];
    const ranks = {};
    for (const stat of array(athlete.statsSummary?.statistics)) {
        const key = Object.keys(RANKS).find((k) => RANKS[k] === stat?.name);
        if (key && num(stat.rank) != null) ranks[key] = stat.rank;
    }
    return {
        id: String(athlete.id),
        name,
        short: first && last ? `${first[0]}. ${last}` : name,
        jersey: str(athlete.jersey),
        pos: str(athlete.position?.abbreviation),
        teamId: athlete.team?.id != null ? String(athlete.team.id) : null,
        ht: str(athlete.displayHeight),
        wt: str(athlete.displayWeight),
        age: num(athlete.age),
        born: parseBirthDate(athlete.displayDOB),
        birthplace: str(athlete.displayBirthPlace),
        // "2021: Rd 1, Pk 1 (DET)". Missing for undrafted players.
        draft: str(athlete.displayDraft),
        // "6th Season", "Rookie".
        exp: str(athlete.displayExperience),
        college: str(athlete.college?.name),
        // Missing for active players. "Free Agent", "Retired", ...
        status: athlete.active === false ? str(athlete.status?.name) : null,
        injury: injury
            ? {
                status: str(injury.status),
                // "Ankle", "Rest".
                type: str(injury.details?.type),
                // YYYY-MM-DD.
                returns: str(injury.details?.returnDate)?.slice(0, 10) ?? null,
            }
            : null,
        // League ranks in the bio's season (the latest with games).
        ranks: Object.keys(ranks).length > 0 ? ranks : null,
    };
}

// The selected season's name ("2025-26") from a response's season filter.
function seasonOf(data) {
    const filter = array(data?.filters).find((f) => f?.name === 'season');
    const option = array(filter?.options).find((o) => o?.value === filter.value);
    return str(option?.displayValue);
}

// Percentages are left out of game log rows, which are most of a player's stored size: the
// page works them out from makes and attempts.
const LOG_DROPPED = ['fgPct', 'tpPct', 'ftPct'];

// "2025-10-23T00:00:00.000+00:00" -> "2025-10-23T00:00Z", like the team schedule's dates.
function shortDate(text) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

// The season's regular-season and playoff games in date order, from `/gamelog`:
// { id, date, home, opp, teamId, win, score, oppScore, ...stat line without percentages },
// plus `post` for playoff games and `note` ("East Semifinals - Game 7", "NBA Cup - Group
// Play"). Preseason and All-Star games are left out.
function trimGameLog(data) {
    const games = [];
    const meta = data?.events && typeof data.events === 'object' ? data.events : {};
    for (const seasonType of array(data?.seasonTypes)) {
        const name = str(seasonType?.displayName) ?? '';
        const post = name.endsWith('Postseason');
        if (!post && !name.endsWith('Regular Season')) continue;
        for (const category of array(seasonType.categories)) {
            if (category?.type !== 'event') continue;
            for (const row of array(category.events)) {
                const event = meta[row?.eventId];
                const teamId = event?.team?.id != null ? String(event.team.id) : null;
                const note = str(event?.eventNote);
                const date = shortDate(event?.gameDate);
                if (!event || !teamId || !date || event.opponent?.id == null) continue;
                if (note && /all-star/i.test(note)) continue;
                const home = String(event.homeTeamId) === teamId;
                const game = {
                    id: String(row.eventId),
                    date,
                    home,
                    opp: String(event.opponent.id),
                    teamId,
                };
                const score = parseNumber(home ? event.homeTeamScore : event.awayTeamScore);
                const oppScore = parseNumber(home ? event.awayTeamScore : event.homeTeamScore);
                if (score != null && oppScore != null) {
                    game.score = score;
                    game.oppScore = oppScore;
                }
                if (event.gameResult === 'W' || event.gameResult === 'L') game.win = event.gameResult === 'W';
                if (post) game.post = true;
                if (note) game.note = note;
                Object.assign(game, statLine(data.labels, row.stats));
                for (const key of LOG_DROPPED) delete game[key];
                games.push(game);
            }
        }
    }
    // A game can be listed in more than one category; keep the first.
    const unique = [...new Map(games.map((g) => [g.id, g])).values()];
    return unique.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

// The season's averages and splits from `/splits`: { averages, splits: { general, result,
// month } }, each split a list of { name, ...stat line }.
function trimSplits(data) {
    let averages = null;
    const splits = {};
    for (const [key, name] of Object.entries(SPLITS)) {
        const category = array(data?.splitCategories).find((c) => c?.name === name);
        const rows = [];
        for (const split of array(category?.splits)) {
            const label = str(split?.displayName);
            const line = statLine(data.labels, split?.stats);
            if (!label || !line) continue;
            if (label === ALL_SPLITS) averages = line;
            else rows.push({ name: label, ...line });
        }
        if (rows.length > 0) splits[key] = rows;
    }
    return { averages, splits: Object.keys(splits).length > 0 ? splits : null };
}

// Regular-season averages for each season of the player's career, oldest first, from
// `/stats`: { season, teamId, ...stat line }. A season split between teams has a row per team
// and a combined row without `teamId`. `total` is the career average.
function trimCareer(data) {
    const averages = array(data?.categories).find((c) => c?.name === 'averages');
    const seasons = [];
    for (const row of array(averages?.statistics)) {
        const season = str(row?.season?.displayName);
        const line = statLine(averages.labels, row?.stats);
        if (!season || !line) continue;
        seasons.push({ season, ...(row.teamId != null && { teamId: String(row.teamId) }), ...line });
    }
    return { seasons, total: statLine(averages?.labels, averages?.totals) };
}

// Turns one player's four responses into the stored value. Only the bio is required: the
// others may be null (a failed request), and the page then leaves their sections out.
// Returns null without a bio.
function trimPlayer({ bio, gameLog, splits, stats }) {
    const player = trimBio(bio);
    if (!player) return null;
    const { averages, splits: splitRows } = trimSplits(splits);
    const career = trimCareer(stats);
    // A game's team is only kept when it isn't the player's current team (a trade).
    const log = trimGameLog(gameLog).map(({ teamId, ...game }) =>
        (teamId === player.teamId ? game : { ...game, teamId }));
    return {
        ...player,
        // The season of the game log, splits and ranks: last season's until the regular season
        // starts.
        season: seasonOf(gameLog) ?? seasonOf(splits),
        averages,
        log,
        splits: splitRows,
        career: career.seasons,
        careerTotal: career.total,
    };
}

// Refreshes every player on a team's roster daily, and a final game's two rosters shortly
// after it. Rosters come from the team pages (`setRoster`), so a player who leaves every roster
// stops being refreshed, but their node stays.
class PlayerRefresher extends KeyedRefresher {
    constructor(options) {
        super(options);
        // teamId -> athlete ids on its roster.
        this.rosters = new Map();
        this.finals = new Set();
    }

    // Replaces a team's roster. New players are due straight away.
    setRoster(teamId, athleteIds) {
        this.rosters.set(teamId, new Set(athleteIds));
        const onRosters = new Set([...this.rosters.values()].flatMap((ids) => [...ids]));
        for (const id of athleteIds) this.track(id);
        for (const id of [...this.dueAt.keys()]) if (!onRosters.has(id)) this.untrack(id);
    }

    // Called after each poll with the final games it saw, as { id, teamIds }. A game seen
    // final for the first time brings its two rosters' next refresh forward.
    noteFinals(games) {
        for (const { id, teamIds } of games) {
            if (this.finals.has(id)) continue;
            this.finals.add(id);
            for (const teamId of teamIds) {
                for (const athleteId of this.rosters.get(teamId) ?? []) this.dueAfterFinal(athleteId);
            }
        }
    }
}

module.exports = {
    trimPlayer,
    trimBio,
    trimGameLog,
    trimSplits,
    trimCareer,
    statLine,
    PlayerRefresher,
};
