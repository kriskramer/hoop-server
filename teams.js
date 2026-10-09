// Team pages, from four ESPN endpoints per team (see espn-data.md): the roster, the regular
// season schedule, the team's season statistics, and its player leaders. Together they're
// about 1 MB per team, almost all of it the schedule's repeated team metadata, so they're
// trimmed to what the team page shows, about 10 KB, and written to `teams/{teamId}`.

// Teams are refreshed daily (for roster moves and injuries) and shortly after each final.
const { KeyedRefresher, AFTER_FINAL_MS, FALLBACK_MS, RETRY_MS } = require('./refresher');

// Team stats kept, as stored key -> ESPN stat `name`. Per-game averages and percentages only.
const STATS = {
    gp: 'gamesPlayed',
    pts: 'avgPoints',
    reb: 'avgRebounds',
    ast: 'avgAssists',
    stl: 'avgSteals',
    blk: 'avgBlocks',
    tov: 'avgTurnovers',
    oreb: 'avgOffensiveRebounds',
    dreb: 'avgDefensiveRebounds',
    pf: 'avgFouls',
    fgm: 'avgFieldGoalsMade',
    fga: 'avgFieldGoalsAttempted',
    fgPct: 'fieldGoalPct',
    tpm: 'avgThreePointFieldGoalsMade',
    tpa: 'avgThreePointFieldGoalsAttempted',
    tpPct: 'threePointPct',
    ftm: 'avgFreeThrowsMade',
    fta: 'avgFreeThrowsAttempted',
    ftPct: 'freeThrowPct',
    astTo: 'assistTurnoverRatio',
};

// Leader categories kept, as stored key -> ESPN category `name`.
const LEADERS = {
    pts: 'pointsPerGame',
    reb: 'reboundsPerGame',
    ast: 'assistsPerGame',
    stl: 'stealsPerGame',
    blk: 'blocksPerGame',
    tpm: '3PointMadePerGame',
};
// Players kept per leader category.
const LEADERS_PER_CATEGORY = 3;

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const num = (value) => (Number.isFinite(value) ? value : null);

// The roster's players, ordered by jersey number, and the head coach's name.
function trimRoster(data) {
    const players = [];
    for (const athlete of Array.isArray(data?.athletes) ? data.athletes : []) {
        if (athlete?.id == null) continue;
        const injury = Array.isArray(athlete.injuries) ? athlete.injuries[0] : null;
        players.push({
            id: String(athlete.id),
            name: str(athlete.displayName) ?? str(athlete.fullName),
            short: str(athlete.shortName),
            jersey: str(athlete.jersey),
            pos: str(athlete.position?.abbreviation),
            ht: str(athlete.displayHeight),
            wt: str(athlete.displayWeight),
            age: num(athlete.age),
            exp: num(athlete.experience?.years),
            college: str(athlete.college?.shortName) ?? str(athlete.college?.name),
            // "Out", "Day-To-Day", ...
            injury: str(injury?.status),
        });
    }
    const jersey = (p) => (p.jersey != null && /^\d+$/.test(p.jersey) ? Number(p.jersey) : Infinity);
    players.sort((a, b) => jersey(a) - jersey(b) || (a.name ?? '').localeCompare(b.name ?? ''));
    const coach = Array.isArray(data?.coach) ? data.coach[0] : null;
    const coachName = [str(coach?.firstName), str(coach?.lastName)].filter(Boolean).join(' ');
    return { players, coach: coachName || null };
}

// 'scheduled', 'live', 'final' or 'postponed' (also canceled), from ESPN's status type.
function gameStatus(type) {
    if (type?.state === 'in') return 'live';
    if (type?.state === 'post') return type.completed ? 'final' : 'postponed';
    return 'scheduled';
}

// The team's games in date order: { id, date, home, opp, status }, plus the score and result
// once a game has started, and `tbd` when ESPN hasn't set the tip-off time.
function trimSchedule(data, teamId) {
    const games = [];
    for (const event of Array.isArray(data?.events) ? data.events : []) {
        const competition = event?.competitions?.[0];
        const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
        const us = competitors.find((c) => String(c?.id) === teamId);
        const them = competitors.find((c) => c !== us);
        if (event?.id == null || !str(event.date) || !us || them?.id == null) continue;
        const status = gameStatus(competition.status?.type);
        const game = {
            id: String(event.id),
            date: event.date,
            home: us.homeAway === 'home',
            opp: String(them.id),
            status,
        };
        if (event.timeValid === false) game.tbd = true;
        if (status === 'live' || status === 'final') {
            game.score = num(us.score?.value);
            game.oppScore = num(them.score?.value);
        }
        if (status === 'final' && typeof us.winner === 'boolean') game.win = us.winner;
        games.push(game);
    }
    return games.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

// The season's per-game team stats, looked up by `name` across ESPN's categories.
// Returns null if none of them are there.
function trimStats(data) {
    const byName = new Map();
    for (const category of Array.isArray(data?.results?.stats?.categories) ? data.results.stats.categories : []) {
        for (const stat of Array.isArray(category?.stats) ? category.stats : []) {
            if (typeof stat?.name === 'string' && !byName.has(stat.name)) byName.set(stat.name, stat.value);
        }
    }
    const stats = {};
    let found = false;
    for (const [key, name] of Object.entries(STATS)) {
        const value = num(byName.get(name));
        if (value == null) continue;
        // ESPN's percentages are 0-100. Round to 1 decimal place, or 3 for the ratio, so tiny
        // float changes don't count as a change.
        const scale = key === 'gp' ? 1 : key === 'astTo' ? 1000 : 10;
        stats[key] = Math.round(value * scale) / scale;
        found = true;
    }
    return found ? stats : null;
}

// The athlete id at the end of a core API `$ref` such as ".../athletes/4432166?lang=en".
function athleteIdOf(ref) {
    const match = /\/athletes\/(\d+)/.exec(typeof ref === 'string' ? ref : '');
    return match ? match[1] : null;
}

// Each category's top players who are on the current roster: { pts: [ { id, value } ], ... }.
// Before a season, the leaders are last season's, and players who have left are skipped, so
// the page shows the current roster's leaders. Returns null if no category has any.
function trimLeaders(data, rosterIds) {
    const byName = new Map();
    for (const category of Array.isArray(data?.categories) ? data.categories : []) {
        if (typeof category?.name === 'string') byName.set(category.name, category);
    }
    const leaders = {};
    let found = false;
    for (const [key, name] of Object.entries(LEADERS)) {
        const list = [];
        for (const leader of Array.isArray(byName.get(name)?.leaders) ? byName.get(name).leaders : []) {
            const id = athleteIdOf(leader?.athlete?.$ref);
            if (!id || !rosterIds.has(id) || list.some((l) => l.id === id)) continue;
            const value = str(leader.displayValue);
            if (value == null) continue;
            list.push({ id, value });
            if (list.length === LEADERS_PER_CATEGORY) break;
        }
        if (list.length === 0) continue;
        leaders[key] = list;
        found = true;
    }
    return found ? leaders : null;
}

// Turns one team's four responses into the stored value. `statsData` and `leadersData` may be
// null (a failed or missing request): the page then shows no stats. Returns null if the roster
// and schedule are both empty, which means the responses weren't what was expected.
function trimTeam(teamId, { roster, schedule, stats, leaders }) {
    const { players, coach } = trimRoster(roster);
    const games = trimSchedule(schedule, teamId);
    if (players.length === 0 && games.length === 0) return null;
    const rosterIds = new Set(players.map((p) => p.id));
    return {
        season: str(schedule?.requestedSeason?.displayName) ?? str(schedule?.season?.displayName),
        coach,
        roster: players,
        schedule: games,
        // Before the regular season starts, ESPN's stats are last season's, so the page labels them.
        statsSeason: str(stats?.requestedSeason?.displayName),
        stats: trimStats(stats),
        leaders: trimLeaders(leaders, rosterIds),
    };
}

// Refreshes every team daily, and a final game's two teams shortly after it. `listTeams`
// returns ESPN's team ids, `fetch(teamId)` the trimmed value (or null or throws), and
// `write(teamId, value)` stores it. A team is written only when it changed.
class TeamRefresher extends KeyedRefresher {
    constructor({ listTeams, ...options }) {
        super(options);
        this.listTeams = listTeams;
        this.finals = new Set();
        this.listed = false;
        this.listRetryAt = 0;
    }

    // Called after each poll with the final games it saw, as { id, teamIds }. A game seen
    // final for the first time brings its teams' next refresh forward.
    noteFinals(games) {
        for (const { id, teamIds } of games) {
            if (this.finals.has(id)) continue;
            this.finals.add(id);
            for (const teamId of teamIds) this.dueAfterFinal(teamId);
        }
    }

    // Lists the teams once, retrying a failure later. `onError` gets a null key for it.
    async beforeRefresh(onError) {
        if (this.listed || this.now() < this.listRetryAt) return;
        try {
            const ids = await this.listTeams();
            if (ids.length === 0) throw new Error('No teams in teams response');
            for (const id of ids) this.track(id);
            this.listed = true;
        } catch (err) {
            this.listRetryAt = this.now() + RETRY_MS;
            onError(null, err);
        }
    }
}

module.exports = {
    trimTeam,
    trimRoster,
    trimSchedule,
    trimStats,
    trimLeaders,
    TeamRefresher,
    AFTER_FINAL_MS,
    FALLBACK_MS,
    RETRY_MS,
};
