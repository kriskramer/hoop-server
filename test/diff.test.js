const test = require('node:test');
const assert = require('node:assert');
const { diffPaths, writeChanges, MAX_UPDATE_PATHS } = require('../diff');

const header = (overrides = {}) => ({
    id: '401811026',
    status: { clock: 334, displayClock: '5:34', period: 3, type: { state: 'in', shortDetail: '5:34 - 3rd' } },
    competitions: [{
        competitors: [
            { homeAway: 'home', score: '71', linescores: [{ value: 30 }, { value: 25 }, { value: 16 }] },
            { homeAway: 'away', score: '68', linescores: [{ value: 22 }, { value: 28 }, { value: 18 }] },
        ],
    }],
    ...overrides,
});

test('sends nothing when nothing changed', () => {
    assert.deepStrictEqual(diffPaths(header(), header()), {});
});

test('sends only the changed leaves, by path', () => {
    const after = header();
    after.status.displayClock = '5:12';
    after.status.type.shortDetail = '5:12 - 3rd';
    after.competitions[0].competitors[0].score = '73';
    after.competitions[0].competitors[0].linescores[2].value = 18;
    assert.deepStrictEqual(diffPaths(header(), after), {
        'status/displayClock': '5:12',
        'status/type/shortDetail': '5:12 - 3rd',
        'competitions/0/competitors/0/score': '73',
        'competitions/0/competitors/0/linescores/2/value': 18,
    });
});

test('adds new array entries and subtrees whole', () => {
    const after = header();
    after.competitions[0].competitors[1].linescores.push({ value: 2 });
    after.situation = { lastPlay: { text: 'Jump ball' } };
    assert.deepStrictEqual(diffPaths(header(), after), {
        'competitions/0/competitors/1/linescores/3': { value: 2 },
        situation: { lastPlay: { text: 'Jump ball' } },
    });
});

test('deletes removed keys, shortened arrays, and values that became null', () => {
    const before = header({ situation: { lastPlay: { text: 'Foul' } }, note: 'x' });
    const after = header({ note: null });
    after.competitions[0].competitors[0].linescores.pop();
    assert.deepStrictEqual(diffPaths(before, after), {
        situation: null,
        note: null,
        'competitions/0/competitors/0/linescores/2': null,
    });
});

test('treats empty objects and nulls the way Firebase stores them (as absent)', () => {
    assert.deepStrictEqual(diffPaths({ a: 1, b: {} }, { a: 1, b: null, c: {} }), {});
    assert.deepStrictEqual(diffPaths({ a: 1, b: { c: null } }, { a: 1 }), {});
    assert.deepStrictEqual(diffPaths({ a: 1, b: { c: 2 } }, { a: 1, b: {} }), { b: null });
});

test('replaces a leaf that became a subtree, and a subtree that became a leaf', () => {
    assert.deepStrictEqual(diffPaths({ a: 'x', b: { c: 1 } }, { a: { y: 1 }, b: 2 }), { a: { y: 1 }, b: 2 });
});

test('compares strings and numbers strictly, as ESPN mixes them', () => {
    assert.deepStrictEqual(diffPaths({ score: '7' }, { score: 7 }), { score: 7 });
});

const fakeDb = () => {
    const calls = [];
    return {
        calls,
        set: async (path, value) => calls.push(['set', path, value]),
        update: async (path, updates) => calls.push(['update', path, updates]),
    };
};

test('writeChanges replaces the node on the first write', async () => {
    const db = fakeDb();
    assert.strictEqual(await writeChanges(db, 'gameHeaders/1', undefined, { a: 1 }), true);
    assert.deepStrictEqual(db.calls, [['set', 'gameHeaders/1', { a: 1 }]]);
});

test('writeChanges sends a multi-path update, or nothing when unchanged', async () => {
    const db = fakeDb();
    assert.strictEqual(await writeChanges(db, 'p', { a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }), true);
    assert.strictEqual(await writeChanges(db, 'p', { a: 1 }, { a: 1 }), false);
    assert.deepStrictEqual(db.calls, [['update', 'p', { 'b/c': 3 }]]);
});

test('writeChanges replaces the node when it was empty or the diff is large', async () => {
    const db = fakeDb();
    await writeChanges(db, 'p', {}, { a: 1 });
    const many = Object.fromEntries(Array.from({ length: MAX_UPDATE_PATHS + 1 }, (_, i) => [`k${i}`, i]));
    await writeChanges(db, 'p', { a: 1 }, many);
    assert.deepStrictEqual(db.calls.map(([op]) => op), ['set', 'set']);
});
