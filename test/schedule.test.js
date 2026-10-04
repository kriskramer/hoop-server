const test = require('node:test');
const assert = require('node:assert');
const {
    nextPollDelay,
    formatDelay,
    FAST_POLL_MIN_MS,
    FAST_POLL_MAX_MS,
    IDLE_POLL_MS,
    WARMUP_MS,
    LATE_TIP_GRACE_MS,
    RETRY_MS,
} = require('../schedule');

// A date in Eastern Daylight Time (UTC-4), so 23:20Z formats as 7:20 PM ET.
const NOW = Date.parse('2026-10-15T23:00:00Z');
const MIN = 60 * 1000;

const game = (state, startOffsetMs, { completed = false, shortName = 'BOS @ NYK' } = {}) => ({
    id: '401',
    shortName,
    date: new Date(NOW + startOffsetMs).toISOString(),
    status: { type: { state, completed } },
});

const decide = (events, options = {}) => nextPollDelay(events, { now: NOW, random: () => 0.5, ...options });
const assertFast = (decision) => {
    assert.strictEqual(decision.mode, 'fast');
    assert.ok(decision.delayMs >= FAST_POLL_MIN_MS && decision.delayMs <= FAST_POLL_MAX_MS);
};

test('polls fast while a game is live', () => {
    const decision = decide([game('in', -60 * MIN), game('pre', 120 * MIN)]);
    assertFast(decision);
    assert.strictEqual(decision.reason, '1 live');
});

test('polls fast within the warmup window before tip-off', () => {
    assertFast(decide([game('pre', WARMUP_MS - MIN)]));
    assertFast(decide([game('pre', WARMUP_MS)]));
});

test('keeps polling fast for a late tip-off', () => {
    const decision = decide([game('pre', -20 * MIN)]);
    assertFast(decision);
    assert.match(decision.reason, /waiting for BOS @ NYK/);
});

test('stops waiting on a game that never tipped off after the grace period', () => {
    const decision = decide([game('pre', -LATE_TIP_GRACE_MS - MIN)]);
    assert.strictEqual(decision.mode, 'idle');
    assert.strictEqual(decision.delayMs, IDLE_POLL_MS);
});

test('sleeps until the warmup when the next game is less than the idle interval away', () => {
    const decision = decide([game('pre', 20 * MIN)]);
    assert.strictEqual(decision.mode, 'idle');
    assert.strictEqual(decision.delayMs, 20 * MIN - WARMUP_MS);
    assert.match(decision.reason, /next tip-off 7:20 PM ET \(BOS @ NYK\)/);
});

test('caps the idle wait when the next game is far away', () => {
    const decision = decide([game('pre', 5 * 60 * MIN)]);
    assert.strictEqual(decision.mode, 'idle');
    assert.strictEqual(decision.delayMs, IDLE_POLL_MS);
});

test('uses the earliest upcoming game', () => {
    const decision = decide([game('pre', 3 * 60 * MIN, { shortName: 'LAL @ GSW' }), game('pre', 15 * MIN)]);
    assert.strictEqual(decision.delayMs, 15 * MIN - WARMUP_MS);
    assert.match(decision.reason, /BOS @ NYK/);
});

test('never sleeps less than a fast poll just before the warmup starts', () => {
    const decision = decide([game('pre', WARMUP_MS + 1000)]);
    assert.strictEqual(decision.mode, 'idle');
    assert.strictEqual(decision.delayMs, FAST_POLL_MIN_MS);
});

test('idles when there are no games, or they are all final', () => {
    assert.deepStrictEqual(decide([]), { mode: 'idle', delayMs: IDLE_POLL_MS, reason: 'no upcoming games' });
    assert.strictEqual(decide([game('post', -180 * MIN, { completed: true })]).mode, 'idle');
});

test('ignores postponed or canceled games', () => {
    assert.strictEqual(decide([game('post', 10 * MIN)]).mode, 'idle');
});

test('ignores games with an unparseable date', () => {
    assert.strictEqual(decide([{ ...game('pre', 0), date: 'TBD' }]).mode, 'idle');
});

test('jitters fast polls between the min and max interval', () => {
    const live = [game('in', 0)];
    assert.strictEqual(decide(live, { random: () => 0 }).delayMs, FAST_POLL_MIN_MS);
    assert.strictEqual(decide(live, { random: () => 0.999999 }).delayMs, FAST_POLL_MAX_MS);
});

test('stays fast after a failed request if it was already fast', () => {
    assertFast(decide([], { complete: false, previousMode: 'fast' }));
});

test('retries soon after a failed request while idle', () => {
    const decision = decide([], { complete: false, previousMode: 'idle' });
    assert.strictEqual(decision.mode, 'idle');
    assert.strictEqual(decision.delayMs, RETRY_MS);
});

test('a live game on the scoreboard that loaded wins over a failed request', () => {
    assertFast(decide([game('in', 0)], { complete: false, previousMode: 'idle' }));
});

test('formats delays', () => {
    assert.strictEqual(formatDelay(13000), '13s');
    assert.strictEqual(formatDelay(25 * MIN), '25m');
    assert.strictEqual(formatDelay(90 * 1000), '1m 30s');
});

test('polls fast while a final game is still settling', () => {
    const decision = decide([game('post', -150 * MIN, { completed: true })], { settling: 1 });
    assertFast(decision);
    assert.match(decision.reason, /settle/);
});
