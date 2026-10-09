// League standings, from ESPN's standings endpoint (see espn-data.md). The response is about
// 164 KB, mostly team metadata and a verbose object per stat, so it's trimmed to what the
// standings screen shows, about 5 KB, and written to `standings`.

// Wait this long after a game goes final before refreshing, so ESPN has counted it.
const AFTER_FINAL_MS = 3 * 60 * 1000;
// Refresh at least this often, in case a final was missed.
const FALLBACK_MS = 60 * 60 * 1000;
// Retry this soon after a failed refresh.
const RETRY_MS = 5 * 60 * 1000;

// ESPN conference abbreviations ("East", "West") -> the stored keys.
const CONFERENCES = { east: 'east', west: 'west' };

// One team's row. Stats are looked up by `type`, which is lowercase and has no spaces,
// rather than by position or by `name` ("vs. Div.").
function trimEntry(entry) {
    const team = entry?.team;
    if (team?.id == null) return null;
    const stats = new Map();
    for (const stat of Array.isArray(entry.stats) ? entry.stats : []) {
        if (typeof stat?.type === 'string') stats.set(stat.type, stat);
    }
    const value = (type) => (Number.isFinite(stats.get(type)?.value) ? stats.get(type).value : null);
    const display = (type) => stats.get(type)?.displayValue ?? stats.get(type)?.summary ?? null;
    // Every seed is 0 until the season's first games.
    const seed = value('playoffseed');
    return {
        teamId: String(team.id),
        abbr: team.abbreviation ?? null,
        name: team.displayName ?? null,
        seed: seed > 0 ? seed : null,
        wins: value('wins') ?? 0,
        losses: value('losses') ?? 0,
        pct: value('winpercent') ?? 0,
        // "-" for the conference leader.
        gb: display('gamesbehind'),
        streak: display('streak'),
        home: display('home'),
        road: display('road'),
        conf: display('vsconf'),
        div: display('vsdiv'),
        l10: display('lasttengames'),
        diff: value('differential'),
    };
}

// Turns the standings response into { season, seasonType, east: [...], west: [...] }, each
// conference ordered by seed, or by name for teams without one. Returns null if neither
// conference is there.
function trimStandings(data) {
    const trimmed = { season: null, seasonType: null };
    let found = false;
    for (const child of Array.isArray(data?.children) ? data.children : []) {
        const key = CONFERENCES[String(child?.abbreviation ?? '').toLowerCase()];
        const standings = child?.standings;
        if (!key || !Array.isArray(standings?.entries)) continue;
        found = true;
        trimmed.season ??= standings.seasonDisplayName ?? data.season?.displayName ?? null;
        trimmed.seasonType ??= Number.isFinite(standings.seasonType) ? standings.seasonType : null;
        trimmed[key] = standings.entries
            .map(trimEntry)
            .filter(Boolean)
            .sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity) || (a.name ?? '').localeCompare(b.name ?? ''));
    }
    return found ? trimmed : null;
}

// Decides when to refresh the standings, and writes them only when they changed.
// `fetch` returns ESPN's response body, and `write` stores the trimmed value.
class StandingsRefresher {
    constructor({ fetch, write, now = Date.now }) {
        this.fetch = fetch;
        this.write = write;
        this.now = now;
        // Refresh on the first poll.
        this.dueAt = 0;
        this.finals = new Set();
        this.written = null;
    }

    // Called after each poll with the ids of the final games it saw. A game seen final for
    // the first time brings the next refresh forward.
    noteFinals(eventIds) {
        for (const id of eventIds) {
            if (this.finals.has(id)) continue;
            this.finals.add(id);
            this.dueAt = Math.min(this.dueAt, this.now() + AFTER_FINAL_MS);
        }
    }

    // Refreshes if one is due. Returns whether anything was written.
    async refreshIfDue() {
        if (this.now() < this.dueAt) return false;
        try {
            const standings = trimStandings(await this.fetch());
            if (!standings) throw new Error('No conferences in standings response');
            this.dueAt = this.now() + FALLBACK_MS;
            const json = JSON.stringify(standings);
            if (json === this.written) return false;
            await this.write({ ...standings, updatedAt: this.now() });
            this.written = json;
            return true;
        } catch (err) {
            this.dueAt = this.now() + RETRY_MS;
            throw err;
        }
    }
}

module.exports = { trimStandings, StandingsRefresher, AFTER_FINAL_MS, FALLBACK_MS, RETRY_MS };
