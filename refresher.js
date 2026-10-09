// Keeps a set of keyed Firebase nodes (teams, players) current: each key is refreshed when it's
// due, one at a time so ESPN isn't hit with hundreds of requests at once, and written only when
// its trimmed value changed.

// Wait this long after a game goes final before refreshing what it changed, so ESPN has counted it.
const AFTER_FINAL_MS = 3 * 60 * 1000;
// Refresh every key at least this often.
const FALLBACK_MS = 24 * 60 * 60 * 1000;
// Retry a key this soon after a failed refresh.
const RETRY_MS = 5 * 60 * 1000;

// `fetch(key)` returns the trimmed value, or null or throws if it couldn't, and
// `write(key, value)` stores it with `updatedAt` added.
class KeyedRefresher {
    constructor({ fetch, write, now = Date.now }) {
        this.fetch = fetch;
        this.write = write;
        this.now = now;
        // key -> when it's next due. A key is due straight away when first tracked.
        this.dueAt = new Map();
        // key -> JSON of the value last written.
        this.written = new Map();
        this.running = false;
    }

    track(key) {
        if (!this.dueAt.has(key)) this.dueAt.set(key, 0);
    }

    untrack(key) {
        this.dueAt.delete(key);
        this.written.delete(key);
    }

    // Brings a tracked key's next refresh forward to `AFTER_FINAL_MS` from now.
    dueAfterFinal(key) {
        if (!this.dueAt.has(key)) return;
        const due = this.now() + AFTER_FINAL_MS;
        this.dueAt.set(key, Math.min(this.dueAt.get(key), due));
    }

    // Refreshes every key that's due, one at a time, and returns the keys written. One key's
    // failure doesn't stop the others: it's logged through `onError` and retried later. Keys
    // tracked while this runs are picked up by the same run. Calls while a refresh is running
    // return an empty list straight away.
    async refreshDue({ onError = () => {} } = {}) {
        if (this.running) return [];
        this.running = true;
        try {
            await this.beforeRefresh(onError);
            const written = [];
            for (const [key, dueAt] of this.dueAt) {
                if (this.now() < dueAt) continue;
                try {
                    if (await this.refreshKey(key)) written.push(key);
                } catch (err) {
                    // It may have been untracked while it was being fetched.
                    if (this.dueAt.has(key)) this.dueAt.set(key, this.now() + RETRY_MS);
                    onError(key, err);
                }
            }
            return written;
        } finally {
            this.running = false;
        }
    }

    // Subclasses can find their keys here.
    async beforeRefresh() {}

    async refreshKey(key) {
        const value = await this.fetch(key);
        if (!value) throw new Error(`No data for ${key}`);
        if (!this.dueAt.has(key)) return false;
        this.dueAt.set(key, this.now() + FALLBACK_MS);
        const json = JSON.stringify(value);
        if (json === this.written.get(key)) return false;
        await this.write(key, { ...value, updatedAt: this.now() });
        this.written.set(key, json);
        return true;
    }
}

module.exports = { KeyedRefresher, AFTER_FINAL_MS, FALLBACK_MS, RETRY_MS };
