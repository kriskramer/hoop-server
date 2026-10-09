const test = require('node:test');
const assert = require('node:assert');
const { trimTeam, trimSchedule, trimRoster, trimLeaders, TeamRefresher, AFTER_FINAL_MS, FALLBACK_MS, RETRY_MS } = require('../teams');
// Captured on 2026-10-09 for Detroit (8), in the preseason. The roster is cut to 2 players.
const roster = require('./fixtures/team-roster.json');
// The regular-season schedule cut to its first 2 games, plus a preseason final from the same
// day's preseason schedule, out of order.
const schedule = require('./fixtures/team-schedule.json');
// Last season's (2025-26) stats, which ESPN returns before the regular season starts.
const stats = require('./fixtures/team-statistics.json');
// The core API's 2025-26 leaders, cut to 6 per category.
const leaders = require('./fixtures/team-leaders.json');

test('trims the roster, ordered by jersey number, with the coach', () => {
    const { players, coach } = trimRoster(roster);
    assert.strictEqual(coach, 'J.B. Bickerstaff');
    assert.deepStrictEqual(players, [
        {
            id: '4433621', name: 'Jalen Duren', short: 'J. Duren', jersey: '0', pos: 'C', ht: '6\' 10"',
            wt: '250 lbs', age: 22, exp: 5, college: 'Memphis', injury: 'Day-To-Day',
        },
        {
            id: '3908845', name: 'John Collins', short: 'J. Collins', jersey: '20', pos: 'F', ht: '6\' 9"',
            wt: '226 lbs', age: 29, exp: 10, college: 'Wake Forest', injury: null,
        },
    ]);
});

test('puts players without a numeric jersey last, and tolerates missing fields', () => {
    const { players, coach } = trimRoster({ athletes: [{ id: 1, displayName: 'B' }, { id: 2, jersey: '7' }, {}] });
    assert.deepStrictEqual(players.map(p => p.id), ['2', '1']);
    assert.strictEqual(players[1].injury, null);
    assert.strictEqual(coach, null);
});

test('trims the schedule to the team\'s side of each game, in date order', () => {
    assert.deepStrictEqual(trimSchedule(schedule, '8'), [
        { id: '401908947', date: '2026-10-05T23:00Z', home: true, opp: '21', status: 'final', score: 109, oppScore: 107, win: true },
        { id: '401909088', date: '2026-10-20T19:00Z', home: true, opp: '2', status: 'scheduled' },
        { id: '401909847', date: '2026-10-24T00:00Z', home: false, opp: '14', status: 'scheduled' },
    ]);
});

test('marks live, postponed and time-TBD games', () => {
    const event = (id, type, extra = {}) => ({
        id,
        date: `2026-11-0${id}T00:00Z`,
        competitions: [{
            status: { type },
            competitors: [
                { id: '8', homeAway: 'away', score: { value: 50 } },
                { id: '5', homeAway: 'home', score: { value: 48 } },
            ],
        }],
        ...extra,
    });
    const games = trimSchedule({
        events: [
            event(1, { state: 'in', completed: false }),
            event(2, { state: 'post', completed: false }),
            event(3, { state: 'pre' }, { timeValid: false }),
            { id: 4, date: '2026-11-04T00:00Z', competitions: [{ competitors: [{ id: '8' }] }] },
        ],
    }, '8');
    assert.deepStrictEqual(games, [
        { id: '1', date: '2026-11-01T00:00Z', home: false, opp: '5', status: 'live', score: 50, oppScore: 48 },
        { id: '2', date: '2026-11-02T00:00Z', home: false, opp: '5', status: 'postponed' },
        { id: '3', date: '2026-11-03T00:00Z', home: false, opp: '5', status: 'scheduled', tbd: true },
    ]);
});

test('keeps each leader category\'s top 3 players on the current roster', () => {
    const rosterIds = new Set(['4433621', '4432166', '3157465', '4684742']);
    const trimmed = trimLeaders(leaders, rosterIds);
    assert.deepStrictEqual(trimmed.pts, [
        { id: '4432166', value: '23.9' },
        { id: '4433621', value: '19.5' },
        { id: '3157465', value: '12.2' },
    ]);
    assert.deepStrictEqual(Object.keys(trimmed), ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm']);
    assert.ok(Object.values(trimmed).flat().every(l => rosterIds.has(l.id)));
    assert.strictEqual(trimLeaders(leaders, new Set()), null);
    assert.strictEqual(trimLeaders(null, rosterIds), null);
});

test('trims a whole team, labeling the season the stats are from', () => {
    const team = trimTeam('8', { roster, schedule, stats, leaders });
    assert.strictEqual(team.season, '2026-27');
    assert.strictEqual(team.statsSeason, '2025-26');
    assert.strictEqual(team.coach, 'J.B. Bickerstaff');
    assert.strictEqual(team.roster.length, 2);
    assert.strictEqual(team.schedule.length, 3);
    assert.deepStrictEqual(team.stats, {
        gp: 82, pts: 117.8, reb: 45.6, ast: 27.8, stl: 10.4, blk: 6.4, tov: 14.2, oreb: 13.1, dreb: 32.5, pf: 22,
        fgm: 43.4, fga: 89.5, fgPct: 48.5, tpm: 11, tpa: 30.9, tpPct: 35.6, ftm: 19.9, fta: 26.1, ftPct: 76.3, astTo: 1.961,
    });
    // Only Duren of the 2 roster players is a 2025-26 leader.
    assert.deepStrictEqual(team.leaders.reb, [{ id: '4433621', value: '10.5' }]);
});

test('a team without stats or leaders still trims, but one without a roster or schedule does not', () => {
    const team = trimTeam('8', { roster, schedule, stats: null, leaders: null });
    assert.strictEqual(team.stats, null);
    assert.strictEqual(team.statsSeason, null);
    assert.strictEqual(team.leaders, null);
    assert.strictEqual(trimTeam('8', { roster: {}, schedule: {}, stats, leaders }), null);
});

function refresher({ ids = ['1', '2'], fail = new Set() } = {}) {
    let now = 1000;
    const writes = [];
    const fetched = [];
    const versions = new Map();
    const r = new TeamRefresher({
        listTeams: async () => ids,
        fetch: async (id) => {
            fetched.push(id);
            if (fail.has(id)) throw new Error(`boom ${id}`);
            return { roster: [], schedule: [{ id: 'g', version: versions.get(id) ?? 0 }] };
        },
        write: async (id, value) => writes.push([id, value]),
        now: () => now,
    });
    return { r, writes, fetched, versions, advance: (ms) => { now += ms; }, now: () => now };
}

test('refreshes every team on the first run, then not again until due', async () => {
    const { r, writes, fetched, advance } = refresher();
    assert.deepStrictEqual(await r.refreshDue(), ['1', '2']);
    assert.deepStrictEqual(writes.map(([id, v]) => [id, v.updatedAt]), [['1', 1000], ['2', 1000]]);
    advance(FALLBACK_MS - 1);
    assert.deepStrictEqual(await r.refreshDue(), []);
    assert.strictEqual(fetched.length, 2);
    advance(1);
    // Due again, but nothing changed, so nothing is written.
    assert.deepStrictEqual(await r.refreshDue(), []);
    assert.strictEqual(fetched.length, 4);
    assert.strictEqual(writes.length, 2);
});

test('refreshes a final game\'s two teams shortly after it goes final', async () => {
    const { r, fetched, versions, advance } = refresher({ ids: ['1', '2', '3'] });
    await r.refreshDue();
    fetched.length = 0;
    r.noteFinals([{ id: 'g1', teamIds: ['1', '3'] }]);
    advance(AFTER_FINAL_MS - 1);
    await r.refreshDue();
    assert.deepStrictEqual(fetched, []);
    advance(1);
    versions.set('1', 1);
    assert.deepStrictEqual(await r.refreshDue(), ['1']);
    assert.deepStrictEqual(fetched, ['1', '3']);
    // The same final seen again on later polls doesn't refresh again.
    fetched.length = 0;
    r.noteFinals([{ id: 'g1', teamIds: ['1', '3'] }]);
    advance(AFTER_FINAL_MS);
    await r.refreshDue();
    assert.deepStrictEqual(fetched, []);
});

test('retries a failed team later without stopping the others', async () => {
    const fail = new Set(['1']);
    const { r, writes, fetched, advance } = refresher({ fail });
    const errors = [];
    assert.deepStrictEqual(await r.refreshDue({ onError: (id, err) => errors.push([id, err.message]) }), ['2']);
    assert.deepStrictEqual(errors, [['1', 'boom 1']]);
    fail.clear();
    advance(RETRY_MS - 1);
    await r.refreshDue();
    assert.deepStrictEqual(fetched, ['1', '2']);
    advance(1);
    assert.deepStrictEqual(await r.refreshDue(), ['1']);
    assert.strictEqual(writes.length, 2);
});

test('treats a team with no roster or schedule as a failure', async () => {
    const r = new TeamRefresher({
        listTeams: async () => ['1'],
        fetch: async () => null,
        write: async () => assert.fail('should not write'),
    });
    const errors = [];
    await r.refreshDue({ onError: (id, err) => errors.push(id) });
    assert.deepStrictEqual(errors, ['1']);
});

test('retries listing the teams after a failure', async () => {
    let calls = 0;
    let now = 0;
    const r = new TeamRefresher({
        listTeams: async () => {
            calls++;
            if (calls === 1) throw new Error('down');
            return ['1'];
        },
        fetch: async () => ({ roster: [], schedule: [] }),
        write: async () => {},
        now: () => now,
    });
    const errors = [];
    assert.deepStrictEqual(await r.refreshDue({ onError: (id, err) => errors.push([id, err.message]) }), []);
    assert.deepStrictEqual(errors, [[null, 'down']]);
    now = RETRY_MS;
    assert.deepStrictEqual(await r.refreshDue(), ['1']);
    assert.strictEqual(calls, 2);
});

test('ignores a refresh started while one is running', async () => {
    let release;
    const r = new TeamRefresher({
        listTeams: async () => ['1'],
        fetch: () => new Promise((resolve) => { release = () => resolve({ roster: [], schedule: [] }); }),
        write: async () => {},
    });
    const first = r.refreshDue();
    await new Promise(setImmediate);
    assert.deepStrictEqual(await r.refreshDue(), []);
    release();
    assert.deepStrictEqual(await first, ['1']);
});
