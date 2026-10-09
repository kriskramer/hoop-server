const test = require('node:test');
const assert = require('node:assert');
const { trimStandings, StandingsRefresher, AFTER_FINAL_MS, FALLBACK_MS, RETRY_MS } = require('../standings');
// Captured on 2026-10-09 (preseason), cut to 3 teams per conference.
const fixture = require('./fixtures/standings.json');

test('trims each conference to the fields clients show, ordered by seed', () => {
    const standings = trimStandings(fixture);
    assert.strictEqual(standings.season, '2026-27');
    assert.strictEqual(standings.seasonType, 1);
    assert.deepStrictEqual(standings.east.map(t => t.abbr), ['CLE', 'TOR', 'NY']);
    assert.deepStrictEqual(standings.east[2], {
        teamId: '18',
        abbr: 'NY',
        name: 'New York Knicks',
        seed: 15,
        wins: 0,
        losses: 2,
        pct: 0,
        gb: '2',
        streak: 'L2',
        home: '0-1',
        road: '0-1',
        conf: '0-2',
        div: '0-1',
        l10: '0-2',
        diff: -12.5,
    });
    assert.strictEqual(standings.west.length, 3);
});

test('reads stats by type, whatever their order, and tolerates missing ones', () => {
    const entry = {
        team: { id: 1, abbreviation: 'ATL', displayName: 'Atlanta Hawks' },
        stats: [
            { type: 'lasttengames', displayValue: '7-3' },
            { type: 'wins', value: 9 },
            { type: 'playoffseed', value: 2 },
        ],
    };
    const standings = trimStandings({
        children: [{ abbreviation: 'East', standings: { seasonType: 2, entries: [entry, { team: {} }] } }],
    });
    assert.deepStrictEqual(standings.east, [{
        teamId: '1', abbr: 'ATL', name: 'Atlanta Hawks', seed: 2, wins: 9, losses: 0, pct: 0,
        gb: null, streak: null, home: null, road: null, conf: null, div: null, l10: '7-3', diff: null,
    }]);
    assert.strictEqual(standings.west, undefined);
});

test('stores no seed before the season starts, and orders those teams by name', () => {
    const team = (id, name) => ({ team: { id, displayName: name }, stats: [{ type: 'playoffseed', value: 0 }] });
    const standings = trimStandings({
        children: [{ abbreviation: 'West', standings: { entries: [team(9, 'Golden State Warriors'), team(7, 'Denver Nuggets')] } }],
    });
    assert.deepStrictEqual(standings.west.map(t => [t.teamId, t.seed]), [['7', null], ['9', null]]);
});

test('returns null when the response has no conferences', () => {
    assert.strictEqual(trimStandings({}), null);
    assert.strictEqual(trimStandings({ children: [{ abbreviation: 'AT', standings: {} }] }), null);
});

function refresher(responses) {
    let now = 1_000_000;
    const writes = [];
    const r = new StandingsRefresher({
        fetch: async () => {
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next;
        },
        write: async (value) => writes.push(value),
        now: () => now,
    });
    return { r, writes, advance: (ms) => { now += ms; }, now: () => now };
}

test('refreshes on the first poll, then hourly, writing only changes', async () => {
    const { r, writes, advance } = refresher([fixture, fixture]);
    assert.strictEqual(await r.refreshIfDue(), true);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(typeof writes[0].updatedAt, 'number');

    advance(FALLBACK_MS - 1);
    assert.strictEqual(await r.refreshIfDue(), false);
    advance(1);
    // Due, but unchanged.
    assert.strictEqual(await r.refreshIfDue(), false);
    assert.strictEqual(writes.length, 1);
});

test('a game going final brings the next refresh forward, once', async () => {
    const changed = structuredClone(fixture);
    changed.children[0].standings.entries[0].stats.find(s => s.type === 'wins').value = 1;
    const { r, writes, advance } = refresher([fixture, changed]);
    r.noteFinals(['401']);
    await r.refreshIfDue();

    r.noteFinals(['401', '402']);
    advance(AFTER_FINAL_MS - 1);
    assert.strictEqual(await r.refreshIfDue(), false);
    advance(1);
    assert.strictEqual(await r.refreshIfDue(), true);
    assert.ok(writes[1].east.some(t => t.wins === 1));

    // Already seen: no early refresh.
    r.noteFinals(['401', '402']);
    advance(AFTER_FINAL_MS);
    assert.strictEqual(await r.refreshIfDue(), false);
});

test('retries a failed refresh a few minutes later', async () => {
    const { r, writes, advance } = refresher([new Error('timeout'), {}, fixture]);
    await assert.rejects(r.refreshIfDue(), /timeout/);
    advance(RETRY_MS);
    await assert.rejects(r.refreshIfDue(), /No conferences/);
    advance(RETRY_MS);
    assert.strictEqual(await r.refreshIfDue(), true);
    assert.strictEqual(writes.length, 1);
});
