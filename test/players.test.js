const test = require('node:test');
const assert = require('node:assert');
const { trimPlayer, trimBio, trimGameLog, trimSplits, trimCareer, statLine, PlayerRefresher } = require('../players');
const { AFTER_FINAL_MS, FALLBACK_MS } = require('../refresher');
// Captured on 2026-10-09. Jalen Duren's bio (he's day-to-day), without the team and college
// team metadata and the page's links, standings and tickets.
const bio = require('./fixtures/player-bio.json');
// Cade Cunningham's 2025-26 game log, cut to 2 regular-season games, an All-Star game, 2 playoff
// games and a preseason game.
const gameLog = require('./fixtures/player-gamelog.json');
// Cunningham's 2025-26 splits, without the by-day and by-opponent ones.
const splits = require('./fixtures/player-splits.json');
// Luka Doncic's career averages, cut to his last 3 seasons. He was traded in 2024-25.
const stats = require('./fixtures/player-stats.json');

test('reads a stat line by ESPN\'s column labels, splitting made-attempted', () => {
    assert.deepStrictEqual(
        statLine(['GP', 'FG', 'FG%', '3PT', 'PTS', 'XYZ'], ['64', '8.6-18.6', '46.1', '-', '23.9', '1']),
        { gp: 64, fgm: 8.6, fga: 18.6, fgPct: 46.1, pts: 23.9 },
    );
    assert.strictEqual(statLine(['PTS'], ['--']), null);
    assert.strictEqual(statLine(null, null), null);
});

test('trims the bio, with the injury and league ranks', () => {
    assert.deepStrictEqual(trimBio(bio), {
        id: '4433621',
        name: 'Jalen Duren',
        short: 'J. Duren',
        jersey: '0',
        pos: 'C',
        teamId: '8',
        ht: '6\' 10"',
        wt: '250 lbs',
        age: 22,
        born: '2003-11-18',
        birthplace: 'Sharon Hill, PA',
        draft: '2022: Rd 1, Pk 13 (CHA)',
        exp: '5th Season',
        college: 'Memphis',
        status: null,
        injury: { status: 'Day-To-Day', type: 'Rest', returns: '2026-10-10' },
        ranks: { pts: 34, reb: 6, ast: 129, fgPct: 4 },
    });
});

test('a bio without an id or name is no bio; missing fields are null', () => {
    assert.strictEqual(trimBio({ athlete: { displayName: 'X' } }), null);
    assert.strictEqual(trimBio(null), null);
    const free = trimBio({ athlete: { id: 1, fullName: 'Free Agent', active: false, status: { name: 'Free Agent' } } });
    assert.strictEqual(free.short, 'Free Agent');
    assert.strictEqual(free.status, 'Free Agent');
    assert.strictEqual(free.teamId, null);
    assert.strictEqual(free.injury, null);
    assert.strictEqual(free.ranks, null);
    assert.strictEqual(free.born, null);
});

test('trims the game log to regular-season and playoff games, in date order', () => {
    const log = trimGameLog(gameLog);
    assert.deepStrictEqual(log.map(g => g.id), ['401809245', '401809984', '401869193', '401871333']);
    assert.deepStrictEqual(log[1], {
        id: '401809984', date: '2025-10-29T23:00Z', home: true, opp: '19', teamId: '8',
        score: 135, oppScore: 116, win: true,
        min: 36, fgm: 12, fga: 24, tpm: 1, tpa: 7, ftm: 5, fta: 5,
        reb: 6, ast: 10, blk: 3, stl: 3, pf: 2, tov: 0, pts: 30,
    });
    assert.strictEqual(log[3].post, true);
    assert.strictEqual(log[3].note, 'East Semifinals - Game 1');
    assert.strictEqual(log[0].post, undefined);
    assert.deepStrictEqual(trimGameLog(null), []);
});

test('trims the splits, keeping the season average apart', () => {
    const { averages, splits: rows } = trimSplits(splits);
    assert.strictEqual(averages.gp, 64);
    assert.strictEqual(averages.pts, 23.9);
    assert.deepStrictEqual(Object.keys(rows), ['general', 'result', 'month']);
    assert.deepStrictEqual(rows.general.map(r => r.name), ['Home', 'Road', 'vs. Division', 'vs. Conference', '3+ Days Rest']);
    assert.deepStrictEqual(rows.result.map(r => [r.name, r.gp, r.pts]), [['Wins', 47, 23.5], ['Losses', 17, 25.2]]);
    assert.deepStrictEqual(trimSplits(null), { averages: null, splits: null });
});

test('trims career averages, with a row per team and a combined row for a traded season', () => {
    const { seasons, total } = trimCareer(stats);
    assert.deepStrictEqual(seasons.map(s => [s.season, s.teamId, s.gp]), [
        ['2024-25', '6', 22],
        ['2024-25', '13', 28],
        ['2024-25', undefined, 50],
        ['2025-26', '13', 64],
    ]);
    assert.ok(total.gp > 400);
    assert.deepStrictEqual(trimCareer(null), { seasons: [], total: null });
});

test('trims a whole player, keeping a game\'s team only when it isn\'t the current one', () => {
    const player = trimPlayer({ bio, gameLog, splits, stats });
    assert.strictEqual(player.name, 'Jalen Duren');
    assert.strictEqual(player.season, '2025-26');
    assert.strictEqual(player.averages.pts, 23.9);
    // The fixtures mix players, so Cunningham's Detroit games are Duren's current team.
    assert.ok(player.log.every(g => g.teamId === undefined));
    assert.strictEqual(player.career.length, 4);
    const traded = trimPlayer({ bio: { athlete: { id: 1, displayName: 'X', team: { id: 5 } } }, gameLog });
    assert.ok(traded.log.every(g => g.teamId === '8'));
});

test('a player without a bio isn\'t trimmed; one without the rest still is', () => {
    assert.strictEqual(trimPlayer({ bio: null, gameLog, splits, stats }), null);
    const player = trimPlayer({ bio, gameLog: null, splits: null, stats: null });
    assert.deepStrictEqual(player.log, []);
    assert.deepStrictEqual(player.career, []);
    assert.strictEqual(player.averages, null);
    assert.strictEqual(player.splits, null);
    assert.strictEqual(player.careerTotal, null);
    assert.strictEqual(player.season, null);
});

function refresher() {
    let now = 1000;
    const fetched = [];
    const writes = [];
    const r = new PlayerRefresher({
        fetch: async (id) => {
            fetched.push(id);
            return { id, version: now };
        },
        write: async (id, value) => writes.push([id, value]),
        now: () => now,
    });
    return { r, fetched, writes, advance: (ms) => { now += ms; } };
}

test('refreshes the players on the rosters it was given, then daily', async () => {
    const { r, fetched, advance } = refresher();
    r.setRoster('8', ['a', 'b']);
    r.setRoster('5', ['c']);
    assert.deepStrictEqual(await r.refreshDue(), ['a', 'b', 'c']);
    advance(FALLBACK_MS - 1);
    assert.deepStrictEqual(await r.refreshDue(), []);
    advance(1);
    assert.deepStrictEqual(await r.refreshDue(), ['a', 'b', 'c']);
    assert.strictEqual(fetched.length, 6);
});

test('drops a player who leaves every roster, and adds a new one', async () => {
    const { r, fetched } = refresher();
    r.setRoster('8', ['a', 'b']);
    r.setRoster('5', ['c']);
    await r.refreshDue();
    fetched.length = 0;
    // b moves from 8 to 5, a is waived, d signs. (Had 8 been refreshed first, b would have been
    // on no roster for a moment and refreshed again, which is harmless.)
    r.setRoster('5', ['c', 'b']);
    r.setRoster('8', ['d']);
    assert.deepStrictEqual([...r.dueAt.keys()].sort(), ['b', 'c', 'd']);
    await r.refreshDue();
    assert.deepStrictEqual(fetched, ['d']);
});

test('refreshes a final game\'s two rosters shortly after it goes final', async () => {
    const { r, fetched, advance } = refresher();
    r.setRoster('8', ['a']);
    r.setRoster('5', ['b']);
    r.setRoster('2', ['c']);
    await r.refreshDue();
    fetched.length = 0;
    r.noteFinals([{ id: 'g1', teamIds: ['8', '5'] }]);
    advance(AFTER_FINAL_MS);
    await r.refreshDue();
    assert.deepStrictEqual(fetched, ['a', 'b']);
    fetched.length = 0;
    r.noteFinals([{ id: 'g1', teamIds: ['8', '5'] }]);
    advance(AFTER_FINAL_MS);
    await r.refreshDue();
    assert.deepStrictEqual(fetched, []);
});
