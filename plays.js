// Turns ESPN's plays array into the nodes stored under gamePlays/{eventId}, and works out
// which nodes changed since the last write so each poll only sends new or edited plays.

// Sequence numbers are unique and never reused, so they make stable keys. Padding keeps
// keys the same length; they still don't sort in game order (see `order` below).
const playKey = (sequenceNumber) => String(sequenceNumber).padStart(6, '0');

// Returns Map(key -> node). Each node is the ESPN play plus:
// - `order`: its position in ESPN's list. ESPN lists plays in game order, but sequence
//   numbers follow entry order, so a play logged late has a higher number than its
//   neighbors. Clients should sort by `order`.
// - `winProbability`: the matching entry from the summary's win-probability series, if any.
function buildPlayNodes(plays, winprobability = []) {
    const winProbabilityByPlayId = new Map(winprobability.map(({ playId, ...rest }) => [playId, rest]));
    const nodes = new Map();
    plays.forEach((play, order) => {
        nodes.set(playKey(play.sequenceNumber), {
            ...play,
            order,
            winProbability: winProbabilityByPlayId.get(play.id) ?? null,
        });
    });
    return nodes;
}

// Records what was written, as JSON strings, for comparison on the next poll.
function snapshot(nodes) {
    return new Map([...nodes].map(([key, node]) => [key, JSON.stringify(node)]));
}

// Compares nodes with the previous snapshot. Returns `updates` (key -> node, or null to
// delete a play ESPN removed) for a multi-path update, and the new snapshot.
function diffPlays(previous, nodes) {
    const updates = {};
    const current = snapshot(nodes);
    for (const [key, json] of current) {
        if (previous.get(key) !== json) {
            updates[key] = nodes.get(key);
        }
    }
    for (const key of previous.keys()) {
        if (!current.has(key)) {
            updates[key] = null;
        }
    }
    return { updates, current };
}

// When a final game ended, in milliseconds: the "End Game" play's wallclock, else the
// latest wallclock among the plays. Null if no play has one. Stored as
// gameHeaders/{eventId}/endedAt, which the database rules use to close Watch Party
// comments and reactions 10 minutes later and the After Party chat 3 days later.
function gameEndedAt(plays) {
    if (!Array.isArray(plays)) return null;
    const time = (play) => Date.parse(play?.wallclock ?? '');
    const end = plays.findLast((p) => p?.type?.text === 'End Game' && Number.isFinite(time(p)));
    if (end) return time(end);
    const times = plays.map(time).filter(Number.isFinite);
    return times.length > 0 ? Math.max(...times) : null;
}

module.exports = { buildPlayNodes, snapshot, diffPlays, gameEndedAt };
