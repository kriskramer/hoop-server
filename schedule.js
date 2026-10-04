// Decides how long to wait before the next poll: fast while games are live or about to
// start, slow otherwise, so the server isn't hitting ESPN every few seconds all day.

// Fast polling is jittered within this range so requests don't land on a fixed beat.
const FAST_POLL_MIN_MS = 12 * 1000;
const FAST_POLL_MAX_MS = 14 * 1000;
// Longest wait between polls when no game is live or about to start.
const IDLE_POLL_MS = 30 * 60 * 1000;
// Switch to fast polling this long before a game's scheduled start.
const WARMUP_MS = 5 * 60 * 1000;
// Keep fast polling for a game still 'pre' after its start time (a late tip-off), but
// give up after this long so a game ESPN never updates can't hold fast mode forever.
const LATE_TIP_GRACE_MS = 3 * 60 * 60 * 1000;
// Retry delay when a scoreboard request failed and we weren't already polling fast.
const RETRY_MS = 60 * 1000;

const ET_TIME = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
});

// ESPN status.type.state is 'pre' (scheduled), 'in' (live), or 'post'. Postponed and
// canceled games are also 'post' but never complete, so they have no box score to fetch.
function gameState(event) {
    const type = event.status?.type ?? {};
    if (type.state === 'in') return 'live';
    if (type.state === 'post' && type.completed) return 'final';
    return 'other';
}

function fastPollDelay(random = Math.random) {
    return FAST_POLL_MIN_MS + Math.round(random() * (FAST_POLL_MAX_MS - FAST_POLL_MIN_MS));
}

// Earliest scheduled game that hasn't tipped off, ignoring ones past the late-tip grace period.
function nextScheduledGame(events, now) {
    let next = null;
    for (const event of events) {
        if (event.status?.type?.state !== 'pre') continue;
        const start = Date.parse(event.date);
        if (!Number.isFinite(start) || start < now - LATE_TIP_GRACE_MS) continue;
        if (!next || start < next.start) next = { event, start };
    }
    return next;
}

// Returns { mode: 'fast' | 'idle', delayMs, reason }.
// `events` are the games from this poll's scoreboards. `complete` is false when a scoreboard
// request failed, so `events` may be missing games; `previousMode` is the last poll's mode.
// `settling` counts final games still being refreshed for post-game stat corrections.
function nextPollDelay(events, { now = Date.now(), complete = true, previousMode = null, settling = 0, random = Math.random } = {}) {
    const fast = (reason) => ({ mode: 'fast', delayMs: fastPollDelay(random), reason });

    const live = events.filter(event => gameState(event) === 'live').length;
    if (live > 0) {
        return fast(`${live} live`);
    }
    if (settling > 0) {
        return fast(`${settling} final, waiting for stats to settle`);
    }

    let decision;
    const next = nextScheduledGame(events, now);
    if (!next) {
        decision = { mode: 'idle', delayMs: IDLE_POLL_MS, reason: 'no upcoming games' };
    } else {
        const name = next.event.shortName ?? next.event.id;
        const untilWarmup = next.start - WARMUP_MS - now;
        if (untilWarmup <= 0) {
            return fast(next.start <= now ? `waiting for ${name} to tip off` : `${name} starts soon`);
        }
        decision = {
            mode: 'idle',
            // Never sleep less than a fast poll, so a warmup moments away doesn't cause a burst.
            delayMs: Math.max(FAST_POLL_MIN_MS, Math.min(untilWarmup, IDLE_POLL_MS)),
            reason: `next tip-off ${ET_TIME.format(next.start)} ET (${name})`,
        };
    }

    // With missing data we can't be sure nothing is live: stay fast if we were, else retry soon.
    if (!complete) {
        if (previousMode === 'fast') return fast('scoreboard request failed, staying fast');
        return { ...decision, delayMs: Math.min(decision.delayMs, RETRY_MS), reason: `${decision.reason}; scoreboard request failed, retrying soon` };
    }
    return decision;
}

function formatDelay(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

module.exports = {
    gameState,
    nextPollDelay,
    formatDelay,
    FAST_POLL_MIN_MS,
    FAST_POLL_MAX_MS,
    IDLE_POLL_MS,
    WARMUP_MS,
    LATE_TIP_GRACE_MS,
    RETRY_MS,
};
