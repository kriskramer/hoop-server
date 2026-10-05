// Builds multi-path updates that send only what changed, so a live header or box score
// update reaches clients as a few hundred bytes instead of the whole node.

// Firebase doesn't store nulls or empty objects, so a value "exists" only if it has a
// non-null leaf somewhere.
function exists(value) {
    if (value === null || value === undefined) return false;
    if (typeof value !== 'object') return true;
    return Object.values(value).some(exists);
}

const isTree = (value) => value !== null && typeof value === 'object';

// Returns the multi-path `update()` that turns `before` into `after`: path -> new value for
// each changed leaf or subtree, and null for each key that's gone. Paths are relative to the
// node both values were written to, joined with '/'. Both values must already be
// Firebase-safe (see sanitize.js). Arrays are compared by index, the way Firebase stores them.
// An empty result means nothing changed.
function diffPaths(before, after, prefix = '', updates = {}) {
    if (!exists(after)) {
        if (exists(before)) updates[prefix] = null;
        return updates;
    }
    if (!isTree(before) || !isTree(after) || !exists(before)) {
        if (before !== after) updates[prefix] = after;
        return updates;
    }
    const path = (key) => (prefix ? `${prefix}/${key}` : key);
    for (const key of Object.keys(before)) {
        if (!(key in after)) diffPaths(before[key], undefined, path(key), updates);
    }
    for (const [key, value] of Object.entries(after)) {
        diffPaths(before[key], value, path(key), updates);
    }
    return updates;
}

// Above this many changed paths, replacing the whole node is simpler and about as small.
const MAX_UPDATE_PATHS = 500;

// Writes `after` to `path` with `db` (firebase.js, or a fake with `set` and `update`), sending
// only what changed since `before`. A null `before` (nothing written since startup) replaces
// the whole node, which also clears anything stale. Returns false if nothing changed.
async function writeChanges(db, path, before, after) {
    if (before === null || before === undefined) {
        await db.set(path, after);
        return true;
    }
    const updates = diffPaths(before, after);
    const count = Object.keys(updates).length;
    if (count === 0) return false;
    if ('' in updates || count > MAX_UPDATE_PATHS) {
        await db.set(path, after);
    } else {
        await db.update(path, updates);
    }
    return true;
}

module.exports = { diffPaths, exists, writeChanges, MAX_UPDATE_PATHS };
