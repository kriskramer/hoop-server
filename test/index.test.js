const test = require('node:test');
const assert = require('node:assert');
const { gameState } = require('../index');

const event = (state, completed = false) => ({ status: { type: { state, completed } } });

test('classifies ESPN game status', () => {
    assert.strictEqual(gameState(event('pre')), 'other');
    assert.strictEqual(gameState(event('in')), 'live');
    assert.strictEqual(gameState(event('post', true)), 'final');
});

test('treats postponed or canceled games (post but not completed) as having no details', () => {
    assert.strictEqual(gameState(event('post', false)), 'other');
});

test('tolerates a missing status', () => {
    assert.strictEqual(gameState({}), 'other');
});

const { isSettled } = require('../index');
const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-04T01:35:00Z');
// A game that started 2.5 hours before T0, so it's recent enough to need the quiet period.
const finalGame = (id) => ({ id, date: '2026-10-03T23:00Z' });

test('keeps refreshing a just-finished game while ESPN keeps correcting it', () => {
    const game = finalGame('settle-1');
    assert.strictEqual(isSettled(game, true, T0), false);
    assert.strictEqual(isSettled(game, true, T0 + 13 * MIN), false);
    // 19 minutes after the last change: not yet.
    assert.strictEqual(isSettled(game, false, T0 + 32 * MIN), false);
    // 20 minutes after the last change: settled.
    assert.strictEqual(isSettled(game, false, T0 + 33 * MIN), true);
});

test('stops refreshing after the hard cap even if ESPN never stops changing', () => {
    const game = finalGame('settle-2');
    assert.strictEqual(isSettled(game, true, T0), false);
    assert.strictEqual(isSettled(game, true, T0 + 179 * MIN), false);
    assert.strictEqual(isSettled(game, true, T0 + 180 * MIN), true);
});

test('settles games that started long ago right away (startup backfill)', () => {
    assert.strictEqual(isSettled({ id: 'settle-3', date: '2026-10-01T23:00Z' }, true, T0), true);
});
