const test = require('node:test');
const assert = require('node:assert');
const { countReactions, ReactionCounter } = require('../reactions');

test('totals votes per play, ignoring unknown values', () => {
    const counts = countReactions({
        u1: { '000010': 'cheer', '000011': 'boo' },
        u2: { '000010': 'cheer', '000012': 'meh', '000013': 'brick', '000014': 'goat' },
        u3: { '000010': 'boo' },
        u4: 'not a map',
    });
    assert.deepStrictEqual(counts, {
        '000010': { cheer: 2, boo: 1 },
        '000011': { boo: 1 },
        '000013': { brick: 1 },
        '000014': { goat: 1 },
    });
    assert.deepStrictEqual(countReactions(null), {});
});

// A fake database and timer: votes arrive with `emit`, and `tick` runs the pending flush.
function setup() {
    const calls = [];
    let onValue = null;
    let timer = null;
    const db = {
        watch: (path, listener) => {
            calls.push(['watch', path]);
            onValue = listener;
            return () => {
                calls.push(['unwatch', path]);
                onValue = null;
            };
        },
        set: async (path, value) => calls.push(['set', path, value]),
        update: async (path, updates) => calls.push(['update', path, updates]),
    };
    const counter = new ReactionCounter('401', db, {
        setTimer: (fn) => (timer = fn),
        clearTimer: () => (timer = null),
    });
    return {
        calls,
        counter,
        emit: (votes) => onValue(votes),
        tick: async () => {
            const fn = timer;
            timer = null;
            fn?.();
            await counter.flushing;
        },
        hasTimer: () => timer !== null,
    };
}

test('writes all totals first, then only the plays that changed, once per window', async () => {
    const { calls, counter, emit, tick } = setup();
    counter.start();
    emit({ u1: { '000010': 'cheer' }, u2: { '000011': 'boo' } });
    await tick();
    // Several vote changes in one window make one write.
    emit({ u1: { '000010': 'boo' }, u2: { '000011': 'boo' } });
    emit({ u1: { '000010': 'boo' }, u2: { '000011': 'boo' }, u3: { '000012': 'cheer' } });
    await tick();
    assert.deepStrictEqual(calls, [
        ['watch', 'gameReactions/401'],
        ['set', 'gameReactionCounts/401', { '000010': { cheer: 1 }, '000011': { boo: 1 } }],
        ['update', 'gameReactionCounts/401', {
            '000010/cheer': null,
            '000010/boo': 1,
            '000012': { cheer: 1 },
        }],
    ]);
});

test('removes a play whose last vote was cleared', async () => {
    const { calls, counter, emit, tick } = setup();
    counter.start();
    emit({ u1: { '000010': 'cheer', '000011': 'boo' } });
    await tick();
    emit({ u1: { '000011': 'boo' } });
    await tick();
    assert.deepStrictEqual(calls.at(-1), ['update', 'gameReactionCounts/401', { '000010': null }]);
});

test('writes nothing until a vote arrives', async () => {
    const { calls, counter, tick, hasTimer } = setup();
    counter.start();
    await tick();
    assert.strictEqual(hasTimer(), false);
    assert.deepStrictEqual(calls, [['watch', 'gameReactions/401']]);
});

test('stop() unsubscribes and writes votes still waiting for their window', async () => {
    const { calls, counter, emit, hasTimer } = setup();
    counter.start();
    emit({ u1: { '000010': 'cheer' } });
    await counter.stop();
    assert.strictEqual(hasTimer(), false);
    assert.deepStrictEqual(calls.slice(1), [
        ['unwatch', 'gameReactions/401'],
        ['set', 'gameReactionCounts/401', { '000010': { cheer: 1 } }],
    ]);
});

test('retries a failed write on the next window', async (t) => {
    const { calls, counter, emit, tick, hasTimer } = setup();
    let fail = true;
    const set = counter.db.set;
    counter.db.set = async (...args) => {
        if (fail) throw new Error('offline');
        return set(...args);
    };
    t.mock.method(console, 'error', () => {});

    counter.start();
    emit({ u1: { '000010': 'cheer' } });
    await tick();
    assert.strictEqual(hasTimer(), true);
    fail = false;
    await tick();
    assert.deepStrictEqual(calls.at(-1), ['set', 'gameReactionCounts/401', { '000010': { cheer: 1 } }]);
});
