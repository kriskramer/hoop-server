const test = require('node:test');
const assert = require('node:assert');
const { measureGame, summarize, monthlyCost, formatBytes } = require('../scripts/size-report');

test('measures comments with their posters and first post time', () => {
    const comments = {
        a: { uid: 'u1', text: 'Go!', createdAt: 2000 },
        b: { uid: 'u2', text: 'Wow', createdAt: 1000 },
        c: { uid: 'u1', text: 'Again', createdAt: 3000 },
    };
    const game = measureGame('gameComments', comments);
    assert.strictEqual(game.bytes, Buffer.byteLength(JSON.stringify(comments)));
    assert.deepStrictEqual([game.items, game.users, game.firstAt], [3, 2, 1000]);
});

test('measures reaction votes with their voters', () => {
    const game = measureGame('gameReactions', { u1: { '000001': 'cheer', '000002': 'boo' }, u2: { '000001': 'goat' } });
    assert.deepStrictEqual([game.items, game.users], [3, 2]);
});

test('counts children for other paths, and handles empty nodes', () => {
    assert.strictEqual(measureGame('gamePlays', { '000001': {}, '000002': {} }).items, 2);
    assert.deepStrictEqual(measureGame('gameComments', null), { bytes: 0, items: 0, users: 0, firstAt: null });
});

test('summarizes totals, the largest games, and bytes by month', () => {
    const s = summarize({
        g1: { bytes: 100, items: 4, users: 2, firstAt: Date.UTC(2026, 9, 1) },
        g2: { bytes: 300, items: 6, users: 3, firstAt: Date.UTC(2026, 9, 20) },
        g3: { bytes: 200, items: 0, users: 0, firstAt: Date.UTC(2026, 10, 2) },
    }, 2);
    assert.deepStrictEqual([s.games, s.bytes, s.items, s.bytesPerGame, s.bytesPerItem], [3, 600, 10, 200, 60]);
    assert.deepStrictEqual(s.largest.map((g) => g.eventId), ['g2', 'g3']);
    assert.deepStrictEqual(s.byMonth, { '2026-10': 400, '2026-11': 200 });
    assert.strictEqual(summarize({}).bytesPerGame, 0);
});

test('costs nothing within the free allowance, then $5 per GB-month', () => {
    assert.strictEqual(monthlyCost(512 * 1024 ** 2), 0);
    assert.strictEqual(monthlyCost(3 * 1024 ** 3), 10);
});

test('formats byte counts', () => {
    assert.strictEqual(formatBytes(512), '512 B');
    assert.strictEqual(formatBytes(1536), '1.5 KB');
    assert.strictEqual(formatBytes(3 * 1024 ** 3), '3.0 GB');
});
