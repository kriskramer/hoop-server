const test = require('node:test');
const assert = require('node:assert');
const {
    buildExtras,
    trimInjuries,
    trimLines,
    pregameRefreshDue,
    PREGAME_REFRESH_MS,
    PREGAME_SOON_REFRESH_MS,
    PREGAME_SOON_MS,
} = require('../extras');
// The summary's injuries and lines for ATL @ IND (preseason, 2026-10-10), captured on 2026-10-09,
// the day before tip-off.
const fixture = require('./fixtures/summary-extras.json');

test('trims the injury report to each team\'s players', () => {
    const report = trimInjuries(fixture.injuries);
    assert.deepStrictEqual(report.map(t => [t.teamId, t.abbr, t.players.length]), [['11', 'IND', 3], ['1', 'ATL', 5]]);
    assert.deepStrictEqual(report[0].players[2], {
        id: '5157066',
        name: 'Johnny Furphy',
        short: 'J. Furphy',
        pos: 'G',
        jersey: '12',
        status: 'Out',
        tag: 'OUT',
        part: 'Knee',
        detail: 'Surgery',
        side: 'Right',
        returnDate: '2027-01-01',
        updated: '2026-02-09T21:43Z',
    });
    // "Not Specified" and missing details are stored as null.
    const veesaar = report[1].players.find(p => p.short === 'H. Veesaar');
    assert.strictEqual(veesaar.tag, 'OFS');
    assert.strictEqual(veesaar.detail, null);
    assert.strictEqual(veesaar.side, 'Right');
});

test('drops teams with no players and entries without an athlete', () => {
    assert.deepStrictEqual(trimInjuries(undefined), []);
    assert.deepStrictEqual(trimInjuries([
        { team: { id: 1 }, injuries: [] },
        { team: { id: 2, abbreviation: 'BOS' }, injuries: [{ status: 'Out' }, { status: 'Out', athlete: { id: 7, displayName: 'A Player' } }] },
    ]), [{
        teamId: '2',
        abbr: 'BOS',
        players: [{
            id: '7', name: 'A Player', short: 'A Player', pos: null, jersey: null, status: 'Out', tag: null,
            part: null, detail: null, side: null, returnDate: null, updated: null,
        }],
    }]);
});

test('trims the line to the spread, total and moneylines, with the opening line', () => {
    assert.deepStrictEqual(trimLines(fixture.pickcenter), {
        provider: 'DraftKings',
        details: 'IND -2.5',
        spread: -2.5,
        overUnder: 234.5,
        overOdds: -108,
        underOdds: -112,
        home: { teamId: '11', moneyLine: -135, spreadOdds: -108, favorite: true },
        away: { teamId: '1', moneyLine: 114, spreadOdds: -112, favorite: false },
        open: { spread: -2.5, overUnder: 234.5, homeMoneyLine: -135, awayMoneyLine: 114 },
    });
});

test('picks the highest-priority sportsbook that has a line', () => {
    const line = trimLines([
        { provider: { name: 'Later', priority: 2 }, details: 'BOS -1', spread: -1 },
        { provider: { name: 'Empty', priority: 0 } },
        { provider: { name: 'First', priority: 1 }, details: 'EVEN', spread: 0 },
    ]);
    assert.strictEqual(line.provider, 'First');
    assert.strictEqual(line.spread, 0);
    assert.deepStrictEqual(line.open, { spread: null, overUnder: null, homeMoneyLine: null, awayMoneyLine: null });
    assert.strictEqual(trimLines([]), null);
    assert.strictEqual(trimLines(undefined), null);
});

test('builds extras without ESPN\'s raw injuries, pickcenter, odds or ATS records', () => {
    const extras = buildExtras({ ...fixture, news: { header: 'NBA News' }, videos: [] });
    assert.deepStrictEqual(Object.keys(extras), ['injuryReport', 'lines', 'news', 'videos']);
    assert.ok(JSON.stringify(extras).length < 4000, 'trimmed extras stay small');
    assert.deepStrictEqual(buildExtras({}), { injuryReport: [], lines: null, news: null, videos: [] });
});

test('refreshes scheduled games hourly, and every 10 minutes close to tip-off', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const later = now + PREGAME_SOON_MS + 60_000;
    const soon = now + PREGAME_SOON_MS;
    assert.strictEqual(pregameRefreshDue(later, undefined, now), true);
    assert.strictEqual(pregameRefreshDue(later, now - PREGAME_SOON_REFRESH_MS, now), false);
    assert.strictEqual(pregameRefreshDue(later, now - PREGAME_REFRESH_MS, now), true);
    assert.strictEqual(pregameRefreshDue(soon, now - PREGAME_SOON_REFRESH_MS + 1, now), false);
    assert.strictEqual(pregameRefreshDue(soon, now - PREGAME_SOON_REFRESH_MS, now), true);
    // A late tip-off is still "soon".
    assert.strictEqual(pregameRefreshDue(now - 60_000, now - PREGAME_SOON_REFRESH_MS, now), true);
});
