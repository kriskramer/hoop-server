// Spots a live game whose play-by-play has fallen behind its scoreboard header. ESPN's
// summary feed sometimes stalls (or drops player names) while the scoreboard keeps going;
// there's nothing to fix on our side, but the log makes it visible. The client runs the
// same check (feedLag in game_math.dart) to warn fans; keep the thresholds in sync.

// A gap this big in game time or in either team's score counts as behind. A minute of play
// with nothing logged is rare but possible around reviews and injuries, hence 90 s.
const MAX_GAP_SECONDS = 90;
const MAX_GAP_POINTS = 7;
// Header and plays are written separately, so they can briefly disagree. Only gaps that
// last this long are logged.
const LAG_GRACE_MS = 60 * 1000;

const QUARTER_SECONDS = 12 * 60;
const OVERTIME_SECONDS = 5 * 60;

// Seconds of game played at `secondsLeft` in `period` (1-4 quarters, 5+ overtimes).
function gameSeconds(period, secondsLeft) {
    if (period <= 4) return (period - 1) * QUARTER_SECONDS + (QUARTER_SECONDS - secondsLeft);
    return 4 * QUARTER_SECONDS + (period - 4) * OVERTIME_SECONDS - secondsLeft;
}

// "5:16" -> 316, "45.3" -> 45.3. Null if it isn't a clock.
function parseClock(text) {
    const match = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(text ?? '').trim());
    if (!match) return null;
    return Number(match[1] ?? 0) * 60 + Number(match[2]);
}

// Compares a scoreboard event with the last of its plays (ESPN's plays array, game order).
// Returns { seconds, points, header, play } describing the gap if it's over either
// threshold, otherwise null. Only meaningful while the game is live.
function feedLag(event, plays) {
    const last = plays?.at(-1);
    const period = event?.status?.period;
    const clock = event?.status?.clock;
    const playPeriod = last?.period?.number;
    const playClock = parseClock(last?.clock?.displayValue);
    if (!last || !(period > 0) || typeof clock !== 'number' || !(playPeriod > 0) || playClock === null) {
        return null;
    }
    const teams = event.competitions?.[0]?.competitors ?? [];
    const score = (side) => Number(teams.find((c) => c.homeAway === side)?.score);
    const home = score('home');
    const away = score('away');

    const seconds = Math.round(Math.abs(gameSeconds(period, clock) - gameSeconds(playPeriod, playClock)));
    const points = Number.isFinite(home) && Number.isFinite(away)
        ? Math.max(Math.abs(home - Number(last.homeScore ?? 0)), Math.abs(away - Number(last.awayScore ?? 0)))
        : 0;
    if (seconds <= MAX_GAP_SECONDS && points < MAX_GAP_POINTS) return null;
    return {
        seconds,
        points,
        header: `P${period} ${event.status.displayClock ?? clock} ${away}-${home}`,
        play: `P${playPeriod} ${last.clock.displayValue} ${last.awayScore}-${last.homeScore}`,
    };
}

// Logs once when a game's play-by-play has been behind for LAG_GRACE_MS, and once when it
// catches up, so a stalled feed doesn't log on every poll.
class LagMonitor {
    constructor({ log = console.log } = {}) {
        this.log = log;
        // eventId -> { since, logged }
        this.games = new Map();
    }

    // `lag` is feedLag()'s result for this poll.
    check(eventId, lag, now) {
        const tracked = this.games.get(eventId);
        if (!lag) {
            if (tracked?.logged) {
                this.log(`Play-by-play caught up -- ${eventId} (behind for ${Math.round((now - tracked.since) / 1000)}s)`);
            }
            this.games.delete(eventId);
            return;
        }
        if (!tracked) {
            this.games.set(eventId, { since: now, logged: false });
            return;
        }
        if (!tracked.logged && now - tracked.since >= LAG_GRACE_MS) {
            tracked.logged = true;
            this.log(`Play-by-play behind the scoreboard, possible ESPN feed problem -- ${eventId}: `
                + `header ${lag.header}, last play ${lag.play} (gap ${lag.seconds}s, ${lag.points} pts)`);
        }
    }

    // Stops tracking a game that's no longer live, without logging.
    forget(eventId) {
        this.games.delete(eventId);
    }
}

module.exports = { feedLag, gameSeconds, parseClock, LagMonitor, MAX_GAP_SECONDS, MAX_GAP_POINTS, LAG_GRACE_MS };
