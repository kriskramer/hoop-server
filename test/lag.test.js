const test = require('node:test');
const assert = require('node:assert');
const { feedLag, gameSeconds, parseClock, LagMonitor, LAG_GRACE_MS } = require('../lag');

const event = (period, clock, away, home) => ({
    status: { period, clock, displayClock: String(clock) },
    competitions: [{ competitors: [
        { homeAway: 'home', score: String(home) },
        { homeAway: 'away', score: String(away) },
    ] }],
});
const play = (period, clock, away, home) => ({
    period: { number: period }, clock: { displayValue: clock }, awayScore: away, homeScore: home,
});

test('converts clocks to seconds of game played', () => {
    assert.strictEqual(parseClock('5:16'), 316);
    assert.strictEqual(parseClock('45.3'), 45.3);
    assert.strictEqual(parseClock(''), null);
    assert.strictEqual(gameSeconds(1, 720), 0);
    assert.strictEqual(gameSeconds(2, 720), 720);
    assert.strictEqual(gameSeconds(4, 0), 2880);
    assert.strictEqual(gameSeconds(5, 60), 3120);
    assert.strictEqual(gameSeconds(6, 300), 3180);
});

test('flags plays more than 90 s or 7 points behind the header', () => {
    // LAL @ SAC, 2026-10-05: the header reached the 2nd while plays stalled at 5:16 in the 1st.
    const lag = feedLag(event(2, 720, 30, 28), [play(1, '5:16', 13, 16)]);
    assert.deepStrictEqual({ seconds: lag.seconds, points: lag.points }, { seconds: 316, points: 17 });

    assert.strictEqual(feedLag(event(1, 300, 13, 16), [play(1, '6:00', 13, 16)]), null); // 60 s
    assert.ok(feedLag(event(1, 300, 13, 16), [play(1, '6:40', 13, 16)])); // 100 s
    assert.strictEqual(feedLag(event(1, 300, 19, 16), [play(1, '5:00', 13, 16)]), null); // 6 pts
    assert.ok(feedLag(event(1, 300, 20, 16), [play(1, '5:00', 13, 16)])); // 7 pts
});

test('a break between periods is not a gap', () => {
    assert.strictEqual(feedLag(event(3, 720, 55, 60), [play(2, '0.0', 55, 60)]), null);
});

test('ignores games without plays or a clock', () => {
    assert.strictEqual(feedLag(event(1, 600, 2, 0), []), null);
    assert.strictEqual(feedLag(event(1, 600, 2, 0), undefined), null);
    assert.strictEqual(feedLag(event(1, 600, 2, 0), [play(1, '', 0, 0)]), null);
});

test('logs once after the grace period, and once on catching up', () => {
    const logs = [];
    const monitor = new LagMonitor({ log: (line) => logs.push(line) });
    const lag = { seconds: 316, points: 17, header: 'h', play: 'p' };
    monitor.check('401', lag, 0);
    monitor.check('401', lag, LAG_GRACE_MS - 1);
    assert.strictEqual(logs.length, 0);
    monitor.check('401', lag, LAG_GRACE_MS);
    monitor.check('401', lag, LAG_GRACE_MS + 13000);
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0], /behind the scoreboard.*401.*gap 316s, 17 pts/);
    monitor.check('401', null, 120000);
    assert.match(logs[1], /caught up -- 401 \(behind for 120s\)/);
});

test('a short gap that clears before the grace period logs nothing', () => {
    const logs = [];
    const monitor = new LagMonitor({ log: (line) => logs.push(line) });
    monitor.check('401', { seconds: 100, points: 0, header: 'h', play: 'p' }, 0);
    monitor.check('401', null, 13000);
    monitor.check('401', { seconds: 100, points: 0, header: 'h', play: 'p' }, 26000);
    monitor.check('401', { seconds: 100, points: 0, header: 'h', play: 'p' }, 26000 + LAG_GRACE_MS - 1);
    assert.deepStrictEqual(logs, []);
});
