const test = require('node:test');
const assert = require('node:assert');
const { toFirebaseSafe } = require('../sanitize');

test('replaces characters Firebase rejects in keys, at any depth', () => {
    const input = { team: { $ref: 'http://x' }, list: [{ 'a.b': 1, 'c#[d]/e': 2 }] };
    assert.deepStrictEqual(toFirebaseSafe(input), {
        team: { _ref: 'http://x' },
        list: [{ a_b: 1, c__d__e: 2 }],
    });
});

test('leaves values untouched', () => {
    assert.deepStrictEqual(toFirebaseSafe({ text: 'a.b $1 #2', n: 0, ok: false, none: null }),
        { text: 'a.b $1 #2', n: 0, ok: false, none: null });
});
