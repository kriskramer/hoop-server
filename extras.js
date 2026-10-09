// Builds `gameExtras/{eventId}` from a summary: the injury report, the betting line, league
// news and highlight clips. The injury report and line are trimmed to what clients show,
// since ESPN's versions are mostly team and athlete metadata and sportsbook links.
//
// Scheduled games get their extras too, refreshed on a slow cadence (`pregameRefreshDue`),
// so the injury report and line are there before tip-off.

const { trimVideos } = require('./videos');

// How often a scheduled game's summary is fetched. Injury news and line moves pick up close
// to tip-off, so games starting soon are refreshed more often.
const PREGAME_REFRESH_MS = 60 * 60 * 1000;
const PREGAME_SOON_REFRESH_MS = 10 * 60 * 1000;
const PREGAME_SOON_MS = 2 * 60 * 60 * 1000;

function buildExtras(data) {
    return {
        injuryReport: trimInjuries(data?.injuries),
        lines: trimLines(data?.pickcenter),
        news: data?.news ?? null,
        videos: trimVideos(data?.videos),
    };
}

// One entry per team with injured players, in ESPN's order:
// { teamId, abbr, players: [ { id, name, short, pos, jersey, status, tag, part, detail, side, returnDate, updated } ] }
// `status` is "Out" or "Day-To-Day"; `tag` is ESPN's short label ("OUT", "OFS" for out for
// the season, "GTD"). `part` is the body part or reason ("Knee", "Rest").
function trimInjuries(injuries) {
    if (!Array.isArray(injuries)) return [];
    const teams = [];
    for (const entry of injuries) {
        const teamId = entry?.team?.id;
        if (teamId == null) continue;
        const players = [];
        for (const injury of Array.isArray(entry.injuries) ? entry.injuries : []) {
            const athlete = injury?.athlete;
            if (athlete?.id == null || !athlete.displayName) continue;
            const details = injury.details ?? {};
            players.push({
                id: String(athlete.id),
                name: athlete.displayName,
                short: athlete.shortName ?? athlete.displayName,
                pos: athlete.position?.abbreviation ?? null,
                jersey: athlete.jersey ?? null,
                status: injury.status ?? null,
                tag: details.fantasyStatus?.abbreviation ?? null,
                part: specified(details.type),
                detail: specified(details.detail),
                side: specified(details.side),
                returnDate: details.returnDate ?? null,
                updated: injury.date ?? null,
            });
        }
        if (players.length > 0) {
            teams.push({ teamId: String(teamId), abbr: entry.team.abbreviation ?? null, players });
        }
    }
    return teams;
}

// The first sportsbook's line (by ESPN's `priority`), or null if there's none yet:
// { provider, details, spread, overUnder, overOdds, underOdds, home, away, open }
// `spread` is the home team's line (-2.5 when home is favored). `home` and `away` are
// { teamId, moneyLine, spreadOdds, favorite }. `open` has the opening spread, total and
// moneylines, where ESPN has them.
function trimLines(pickcenter) {
    if (!Array.isArray(pickcenter)) return null;
    const line = pickcenter
        .filter(p => p && (p.details || Number.isFinite(p.spread) || Number.isFinite(p.overUnder)))
        .sort((a, b) => (a.provider?.priority ?? Infinity) - (b.provider?.priority ?? Infinity))[0];
    if (!line) return null;
    const side = (odds) => ({
        teamId: odds?.teamId == null ? null : String(odds.teamId),
        moneyLine: number(odds?.moneyLine),
        spreadOdds: number(odds?.spreadOdds),
        favorite: odds?.favorite === true,
    });
    return {
        provider: line.provider?.name ?? null,
        details: line.details ?? null,
        spread: number(line.spread),
        overUnder: number(line.overUnder),
        overOdds: number(line.overOdds),
        underOdds: number(line.underOdds),
        home: side(line.homeTeamOdds),
        away: side(line.awayTeamOdds),
        open: {
            spread: number(line.pointSpread?.home?.open?.line),
            overUnder: number(line.total?.over?.open?.line),
            homeMoneyLine: number(line.moneyline?.home?.open?.odds),
            awayMoneyLine: number(line.moneyline?.away?.open?.odds),
        },
    };
}

// Whether a scheduled game starting at `startMs` is due for a summary fetch, given when it
// was last fetched (undefined if never).
function pregameRefreshDue(startMs, lastFetched, now) {
    if (lastFetched === undefined) return true;
    const soon = Number.isFinite(startMs) && startMs - now <= PREGAME_SOON_MS;
    return now - lastFetched >= (soon ? PREGAME_SOON_REFRESH_MS : PREGAME_REFRESH_MS);
}

// ESPN fills unknown injury details with "Not Specified".
function specified(value) {
    return typeof value === 'string' && value && value !== 'Not Specified' ? value : null;
}

// Numbers, or ESPN's display strings for them ("+114", "-2.5", "o232.5").
function number(value) {
    if (Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const parsed = Number.parseFloat(value.replace(/^[ou]/, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
    buildExtras,
    trimInjuries,
    trimLines,
    pregameRefreshDue,
    PREGAME_REFRESH_MS,
    PREGAME_SOON_REFRESH_MS,
    PREGAME_SOON_MS,
};
