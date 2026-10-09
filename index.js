const espn = require('./espn');
const { etDate } = require('./dates');
const { buildPlayNodes, snapshot, diffPlays, gameEndedAt } = require('./plays');
const { gameState, nextPollDelay, formatDelay, RETRY_MS } = require('./schedule');
const { writeChanges } = require('./diff');
const { ReactionCounter } = require('./reactions');
const { toFirebaseSafe } = require('./sanitize');
const { feedLag, LagMonitor } = require('./lag');
const { trimVideos } = require('./videos');
const { buildRoster } = require('./roster');
const { StandingsRefresher } = require('./standings');

const BACKFILL_DAYS = 5;

// ESPN keeps correcting plays and stats after the final buzzer (observed every few minutes
// for at least 13 minutes), so a final game keeps refreshing until its data has been
// unchanged this long, up to a hard cap.
const FINAL_QUIET_MS = 20 * 60 * 1000;
const FINAL_MAX_MS = 3 * 60 * 60 * 1000;
// Games that started this long ago (e.g. found by the startup backfill) have settled.
const SETTLED_AFTER_START_MS = 12 * 60 * 60 * 1000;

// Games whose data has settled; they're skipped from then on.
const finalizedGames = new Set();
// eventId -> { firstSeen, lastChange } for final games still being refreshed.
const finalTracking = new Map();
// eventId -> snapshot of the plays last written to Firebase, used to send only changes.
const writtenPlays = new Map();
// eventId -> header and box score last written (Firebase-safe), so each write sends only
// the changed fields. A live header update is well under 1 KB this way instead of ~13 KB.
const writtenHeaders = new Map();
const writtenBoxScores = new Map();
const writtenRosters = new Map();
// eventId -> JSON of the extras last written, to skip unchanged writes.
const writtenExtras = new Map();
// eventId -> when a final game ended (ms), written into its header as `endedAt`. Kept here
// because each header write replaces or diffs the whole header, which would otherwise drop it.
const endTimes = new Map();
// eventId -> ReactionCounter for live and settling games.
const reactionCounters = new Map();
// Keeps `standings` current: shortly after each final, and hourly otherwise.
const standings = new StandingsRefresher({
    fetch: async () => {
        const [conferences, divisions] = await Promise.all([
            espn.getStandings(),
            espn.getStandings({ byDivision: true }),
        ]);
        return { conferences: conferences.data, divisions: divisions.data };
    },
    write: (value) => db().writeStandings(value),
});
// Logs live games whose play-by-play falls behind the scoreboard.
const lagMonitor = new LagMonitor();
let pollCount = 0;
// The last poll's schedule decision: { mode: 'fast' | 'idle', reason }.
let lastDecision = {};

// Firebase is required lazily so the pure helpers can be tested without credentials.
const db = () => require('./firebase');

async function processGame(event) {
    if (finalizedGames.has(event.id)) {
        return;
    }

    // Scheduled games rarely change, so most polls write nothing for them.
    if (await writeTracked(writtenHeaders, 'gameHeaders', event.id, withEndTime(event))) {
        console.log(`Updating game header -- ${event.id} - ${event.shortName} - ${event.date}`);
    }

    const state = gameState(event);
    if (state === 'live') {
        const teams = event.competitions?.[0]?.competitors ?? [];
        const score = (side) => {
            const team = teams.find(c => c.homeAway === side);
            return `${team?.team?.abbreviation} ${team?.score}`;
        };
        console.log(`Game on! ${event.status.type.shortDetail} -- ${score('away')} - ${score('home')}`);
    }

    if (state === 'other') {
        return;
    }

    // Games found by the startup backfill have long settled, so their totals are left alone.
    if (Date.now() - Date.parse(event.date) < SETTLED_AFTER_START_MS) {
        startCountingReactions(event.id);
    }
    const changed = await saveDetails(event, state === 'live');

    // Only runs once the writes succeeded, so a failure is retried on the next poll.
    if (state === 'final' && isSettled(event, changed, Date.now())) {
        finalizedGames.add(event.id);
        finalTracking.delete(event.id);
        writtenPlays.delete(event.id);
        writtenHeaders.delete(event.id);
        writtenBoxScores.delete(event.id);
        writtenRosters.delete(event.id);
        writtenExtras.delete(event.id);
        endTimes.delete(event.id);
        stopCountingReactions(event.id);
        console.log(`Game settled, no longer refreshing -- ${event.id}`);
    }
}

// Writes `value` to `${root}/${eventId}`, sending only what changed since the last write
// recorded in `written`. Returns whether anything was written.
async function writeTracked(written, root, eventId, value) {
    const safe = toFirebaseSafe(value);
    const changed = await writeChanges(db(), `${root}/${eventId}`, written.get(eventId), safe);
    // Only recorded after a successful write, so a failed write is retried in full.
    written.set(eventId, safe);
    return changed;
}

// The header as stored: ESPN's event, plus `endedAt` once the game is known to have ended.
function withEndTime(event) {
    const endedAt = endTimes.get(event.id);
    return endedAt === undefined ? event : { ...event, endedAt };
}

// Records when a final game ended and adds it to the stored header. It comes from the
// plays, so after a restart the backfill writes the same time again. Without plays, it's
// when the server first saw the game as final.
async function saveEndTime(event, plays) {
    const endedAt = gameEndedAt(plays) ?? endTimes.get(event.id) ?? Date.now();
    if (endTimes.get(event.id) === endedAt) return;
    endTimes.set(event.id, endedAt);
    await writeTracked(writtenHeaders, 'gameHeaders', event.id, withEndTime(event));
    console.log(`Game ended at ${new Date(endedAt).toISOString()} -- ${event.id}`);
}

// Live and settling games keep gameReactionCounts up to date. Once a game settles, its
// totals stay as they are.
function startCountingReactions(eventId) {
    if (reactionCounters.has(eventId)) return;
    const counter = new ReactionCounter(eventId, db());
    reactionCounters.set(eventId, counter);
    counter.start();
}

function stopCountingReactions(eventId) {
    const counter = reactionCounters.get(eventId);
    if (!counter) return;
    reactionCounters.delete(eventId);
    counter.stop().catch((err) => console.error(`Failed to stop reaction counter -- ${eventId}:`, err.message));
}

// Decides whether a final game's data has stopped changing.
function isSettled(event, changed, now) {
    if (now - Date.parse(event.date) >= SETTLED_AFTER_START_MS) {
        return true;
    }
    const tracking = finalTracking.get(event.id) ?? { firstSeen: now, lastChange: now };
    if (changed) {
        tracking.lastChange = now;
    }
    finalTracking.set(event.id, tracking);
    return now - tracking.lastChange >= FINAL_QUIET_MS || now - tracking.firstSeen >= FINAL_MAX_MS;
}

// Writes the box score and plays, and for a live game checks that the plays are keeping up
// with the scoreboard. Returns whether anything changed.
async function saveDetails(event, live) {
    const eventId = event.id;
    const { data } = await espn.getSummary(eventId);
    if (live) {
        lagMonitor.check(eventId, feedLag(event, data.plays), Date.now());
    } else {
        lagMonitor.forget(eventId);
    }

    const boxScore = {
        boxscore: data.boxscore ?? null,
        leaders: data.leaders ?? null,
        gameInfo: data.gameInfo ?? null,
    };
    const boxChanged = await writeTracked(writtenBoxScores, 'gameBoxScores', eventId, boxScore);
    if (boxChanged) {
        console.log(`Updating game box score -- ${eventId}`);
    }

    // Player names for clients that don't listen to the box score. A roster change is also a
    // box score change, so it doesn't count separately for settling.
    const roster = buildRoster(data.boxscore);
    if (roster && await writeTracked(writtenRosters, 'gameRosters', eventId, roster)) {
        console.log(`Updating game roster -- ${eventId}`);
    }

    await saveExtras(eventId, data);

    // Plays are absent until tip-off.
    let playsChanged = false;
    if (Array.isArray(data.plays) && data.plays.length > 0) {
        playsChanged = await savePlays(eventId, buildPlayNodes(data.plays, data.winprobability));
    }
    if (gameState(event) === 'final') {
        await saveEndTime(event, data.plays);
    }
    return boxChanged || playsChanged;
}

// Injuries, odds, news, and highlight clips. Kept apart from the box score so clients listening to
// live stats don't re-download them on every update. Not counted as a change for settling,
// because league news keeps changing long after a game ends.
async function saveExtras(eventId, data) {
    const extras = {
        injuries: data.injuries ?? null,
        pickcenter: data.pickcenter ?? null,
        odds: data.odds ?? null,
        againstTheSpread: data.againstTheSpread ?? null,
        news: data.news ?? null,
        videos: trimVideos(data.videos),
    };
    const json = JSON.stringify(extras);
    if (writtenExtras.get(eventId) === json) {
        return;
    }
    await db().writeGameExtras(eventId, extras);
    writtenExtras.set(eventId, json);
    console.log(`Updating game extras -- ${eventId}`);
}

async function savePlays(eventId, nodes) {
    const previous = writtenPlays.get(eventId);

    // First write for this game since startup: replace the whole node, which also clears
    // anything stale left from before a restart.
    if (!previous) {
        await db().replacePlays(eventId, Object.fromEntries(nodes));
        writtenPlays.set(eventId, snapshot(nodes));
        console.log(`Write plays -- ${eventId} (all ${nodes.size})`);
        return true;
    }

    const { updates, current } = diffPlays(previous, nodes);
    const count = Object.keys(updates).length;
    if (count > 0) {
        await db().updatePlays(eventId, updates);
        console.log(`Write plays -- ${eventId} (${count} changed of ${nodes.size})`);
    }
    // Only advance the snapshot after a successful write, so a failed write is retried in full.
    writtenPlays.set(eventId, current);
    return count > 0;
}

async function processGames(events) {
    const results = await Promise.allSettled(events.map(processGame));
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            console.error(`Failed to process game ${events[i].id}:`, result.reason.message);
        }
    });
}

async function loadGamesForDate(date) {
    const response = await espn.getScoreboard(date);
    const events = response.data?.events;
    if (!Array.isArray(events)) {
        throw new Error(`No events in scoreboard response for ${date}`);
    }
    await processGames(events);
    return events;
}

// Catch up on recent games (in case the server was down) and pre-load upcoming ones.
async function backfill() {
    for (let i = 1; i <= BACKFILL_DAYS; i++) {
        for (const date of [etDate(-i), etDate(i)]) {
            try {
                await loadGamesForDate(date);
            } catch (err) {
                console.error(`Failed to load games for ${date}:`, err.message);
            }
        }
    }
}

// Returns the games seen on both scoreboards, and whether both requests succeeded.
async function poll() {
    const events = [];
    let complete = true;
    // Include yesterday so games running past midnight ET keep updating until final.
    // Yesterday's finished games are skipped, so this costs one scoreboard request.
    for (const date of [etDate(-1), etDate(0)]) {
        try {
            events.push(...await loadGamesForDate(date));
        } catch (err) {
            complete = false;
            console.error(`Failed to poll games for ${date}:`, err.message);
        }
    }
    console.log(`Poll # ${pollCount++} - ${new Date().toISOString()}`);
    return { events, complete };
}

// Polls, then schedules the next poll based on the games it saw. Each poll starts only
// after the previous one finishes, so polls never overlap.
async function pollLoop() {
    let delayMs = RETRY_MS;
    try {
        const { events, complete } = await poll();
        // Final games not yet settled still need refreshing for post-game corrections.
        const settling = events.filter(e => gameState(e) === 'final' && !finalizedGames.has(e.id)).length;
        const decision = nextPollDelay(events, { complete, previousMode: lastDecision.mode, settling });
        // Fast polls are frequent, so only log when the reason changes; idle polls are rare.
        if (decision.reason !== lastDecision.reason || decision.mode === 'idle') {
            const label = decision.mode === 'fast' ? 'Fast polling' : 'Idle';
            console.log(`${label}: ${decision.reason} -- next poll in ${formatDelay(decision.delayMs)}`);
        }
        lastDecision = decision;
        delayMs = decision.delayMs;
        await refreshStandings(events);
    } catch (err) {
        console.error('Poll failed:', err);
    } finally {
        setTimeout(pollLoop, delayMs);
    }
}

// Refreshes the standings if a game just went final or the last refresh is old. A failure
// is logged and retried later; it doesn't hold up polling.
async function refreshStandings(events) {
    standings.noteFinals(events.filter(e => gameState(e) === 'final').map(e => e.id));
    try {
        if (await standings.refreshIfDue()) {
            console.log('Updating standings');
        }
    } catch (err) {
        console.error('Failed to refresh standings:', err.message);
    }
}

function main() {
    // Last line of defense: log instead of letting the long-running poller crash.
    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled rejection:', reason);
    });

    backfill();
    pollLoop();
}

if (require.main === module) {
    main();
}

module.exports = { gameState, isSettled };
