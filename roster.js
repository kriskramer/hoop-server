// Builds gameRosters/{eventId}: who's on each team, from the summary's box score. Clients
// that only listen to plays (the Watch Party timeline) need player names, and the box score
// is ~40 KB per live update, so this small node (~2–3 KB) changes only when a player is added.

// Turns the summary's `boxscore` into { athleteId: { name, short, jersey, teamId, starter } }.
// Players without an id or a team are left out. Returns null when there are no players yet.
function buildRoster(boxscore) {
    const roster = {};
    for (const team of boxscore?.players ?? []) {
        const teamId = team?.team?.id == null ? null : String(team.team.id);
        if (!teamId) continue;
        for (const table of team.statistics ?? []) {
            for (const entry of table?.athletes ?? []) {
                const athlete = entry?.athlete;
                const id = athlete?.id == null ? null : String(athlete.id);
                if (!id || roster[id]) continue;
                roster[id] = {
                    name: athlete.displayName ?? '',
                    short: athlete.shortName ?? athlete.displayName ?? '',
                    jersey: athlete.jersey ?? null,
                    teamId,
                    starter: entry.starter === true,
                };
            }
        }
    }
    return Object.keys(roster).length > 0 ? roster : null;
}

module.exports = { buildRoster };
