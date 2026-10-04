const test = require('node:test');
const assert = require('node:assert');
const { buildPlayNodes, snapshot, diffPlays } = require('../plays');

const play = (seq, text = `play ${seq}`) => ({ id: `401${seq}`, sequenceNumber: String(seq), text });

test('keys plays by padded sequence number, records ESPN order, and attaches win probability', () => {
    const nodes = buildPlayNodes([play(4), play(10)], [{ playId: '40110', homeWinPercentage: 0.6, tiePercentage: 0 }]);
    assert.deepStrictEqual([...nodes.keys()], ['000004', '000010']);
    assert.strictEqual(nodes.get('000004').order, 0);
    assert.strictEqual(nodes.get('000004').winProbability, null);
    assert.deepStrictEqual(nodes.get('000010').winProbability, { homeWinPercentage: 0.6, tiePercentage: 0 });
});

test('sends nothing when nothing changed', () => {
    const nodes = buildPlayNodes([play(1), play(2)]);
    const { updates } = diffPlays(snapshot(nodes), buildPlayNodes([play(1), play(2)]));
    assert.deepStrictEqual(updates, {});
});

test('sends only new plays', () => {
    const previous = snapshot(buildPlayNodes([play(1), play(2)]));
    const { updates, current } = diffPlays(previous, buildPlayNodes([play(1), play(2), play(3)]));
    assert.deepStrictEqual(Object.keys(updates), ['000003']);
    assert.strictEqual(current.size, 3);
});

test('resends a play ESPN edited', () => {
    const previous = snapshot(buildPlayNodes([play(1), play(2)]));
    const { updates } = diffPlays(previous, buildPlayNodes([play(1), play(2, 'corrected')]));
    assert.deepStrictEqual(Object.keys(updates), ['000002']);
    assert.strictEqual(updates['000002'].text, 'corrected');
});

test('deletes a play ESPN removed', () => {
    const previous = snapshot(buildPlayNodes([play(1), play(2)]));
    const { updates } = diffPlays(previous, buildPlayNodes([play(1)]));
    assert.deepStrictEqual(updates, { '000002': null });
});

test('a late-logged play inserted mid-list updates the order of the plays after it', () => {
    const previous = snapshot(buildPlayNodes([play(1), play(2), play(3)]));
    // Play 9 was logged late but belongs between plays 1 and 2.
    const { updates } = diffPlays(previous, buildPlayNodes([play(1), play(9), play(2), play(3)]));
    assert.deepStrictEqual(Object.keys(updates).sort(), ['000002', '000003', '000009']);
    assert.deepStrictEqual([updates['000009'].order, updates['000002'].order, updates['000003'].order], [1, 2, 3]);
});
