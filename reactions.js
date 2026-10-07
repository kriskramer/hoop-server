// Keeps per-play reaction totals for clients. Users write their own votes to
// gameReactions/{eventId}/{uid}/{playKey} = one of VALUES, and the database rules let each
// user read only their own. This module listens to a game's votes and writes the totals to
// gameReactionCounts/{eventId}/{playKey} = { cheer: 3, wow: 1, ... }, so clients download a
// few bytes per changed play instead of every vote.
const { writeChanges } = require('./diff');

// Votes arriving within this window are written as one update.
const FLUSH_MS = 1500;
// Keep in sync with database.rules.json and the client's Reaction enum.
const VALUES = ['cheer', 'goat', 'crown', 'ice', 'dagger', 'like', 'wow', 'lol', 'dead', 'brick', 'ref', 'boo'];

// Turns gameReactions/{eventId} ({ uid: { playKey: value } }) into { playKey: { value: count } }.
// Only values with votes are included, plays with no votes are left out, and anything that
// isn't a known value is ignored.
function countReactions(votesByUser) {
    const counts = {};
    for (const votes of Object.values(votesByUser ?? {})) {
        if (!votes || typeof votes !== 'object') continue;
        for (const [playKey, value] of Object.entries(votes)) {
            if (!VALUES.includes(value)) continue;
            counts[playKey] ??= {};
            counts[playKey][value] = (counts[playKey][value] ?? 0) + 1;
        }
    }
    return counts;
}

// Counts one game's reactions while it's live or settling. `db` is firebase.js (or a fake
// with the same `watch`, `set` and `update`).
class ReactionCounter {
    constructor(eventId, db, { flushMs = FLUSH_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        this.eventId = eventId;
        this.db = db;
        this.flushMs = flushMs;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        // The totals last written, or null before the first write.
        this.written = null;
        this.votes = null;
        this.dirty = false;
        this.timer = null;
        this.flushing = null;
        this.unwatch = null;
    }

    start() {
        if (this.unwatch) return;
        this.unwatch = this.db.watch(
            `gameReactions/${this.eventId}`,
            (votes) => {
                this.votes = votes;
                this.dirty = true;
                this.schedule();
            },
            (err) => console.error(`Reaction listener failed -- ${this.eventId}:`, err.message),
        );
    }

    // Stops listening, then writes anything still pending.
    async stop() {
        this.unwatch?.();
        this.unwatch = null;
        if (this.timer) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
        await this.flushing;
        await this.flush();
    }

    schedule() {
        if (this.timer) return;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.flushing = this.flush();
        }, this.flushMs);
    }

    // Writes the totals if any vote changed since the last write. The first write replaces
    // the whole node, which also clears totals left stale while the server was down; later
    // writes send only the plays whose totals changed.
    async flush() {
        if (!this.dirty) return;
        this.dirty = false;
        const counts = countReactions(this.votes);
        const path = `gameReactionCounts/${this.eventId}`;
        try {
            await writeChanges(this.db, path, this.written, counts);
            this.written = counts;
        } catch (err) {
            console.error(`Failed to write reaction counts -- ${this.eventId}:`, err.message);
            // Try again on the next window.
            this.dirty = true;
            if (this.unwatch) this.schedule();
        }
    }
}

module.exports = { countReactions, ReactionCounter, FLUSH_MS };
