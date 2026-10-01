const test = require('node:test');
const assert = require('node:assert');
const { etDate } = require('../dates');

test('uses the Eastern Time date, not UTC', () => {
    // 02:00 UTC on Oct 1 is still the evening of Sep 30 in New York.
    assert.strictEqual(etDate(0, new Date('2026-10-01T02:00:00Z')), '2026-09-30');
});

test('offsets by calendar days across month boundaries', () => {
    const now = new Date('2026-09-30T16:00:00Z');
    assert.strictEqual(etDate(1, now), '2026-10-01');
    assert.strictEqual(etDate(-30, now), '2026-08-31');
});

test('does not skip a day across the spring DST change', () => {
    // 23:30 EST on Sat Mar 7 2026; DST starts Sun Mar 8.
    const now = new Date('2026-03-08T04:30:00Z');
    assert.strictEqual(etDate(0, now), '2026-03-07');
    assert.strictEqual(etDate(1, now), '2026-03-08');
    assert.strictEqual(etDate(2, now), '2026-03-09');
});
