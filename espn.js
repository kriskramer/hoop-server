const axios = require('axios');

// ESPN's public (unofficial, undocumented) site API. No key or special headers needed.
const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// A timeout keeps a hung request from stalling the poll loop indefinitely.
const http = axios.create({ baseURL: BASE_URL, timeout: 10000 });
// Standings live under `apis/v2`, not `apis/site/v2`. An absolute URL overrides `baseURL`.
const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
// Player leaders are only in the core API, which links resources with `$ref` URLs.
const CORE_URL = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
// ESPN's season types: 1 preseason, 2 regular season, 3 playoffs.
const REGULAR_SEASON = 2;

module.exports = {
    // `date` is YYYY-MM-DD. The NBA scoreboard doesn't support date ranges, so callers fetch one day at a time.
    getScoreboard: (date) => http.get('/scoreboard', { params: { dates: date.replace(/-/g, '') } }),
    // Box score, play-by-play, win probability, leaders, and game info for one event.
    getSummary: (eventId) => http.get('/summary', { params: { event: eventId } }),
    // East and West conference standings, or with `byDivision`, each conference's three
    // divisions. Without `seasontype`, ESPN returns the current season type, which in October
    // is the preseason.
    getStandings: ({ byDivision = false } = {}) =>
        http.get(STANDINGS_URL, { params: { seasontype: REGULAR_SEASON, ...(byDivision && { level: 3 }) } }),
    // All 30 teams.
    getTeams: () => http.get('/teams'),
    // A team's players and coach.
    getTeamRoster: (teamId) => http.get(`/teams/${teamId}/roster`),
    // A team's regular-season games and results for the current season (about 0.8 MB).
    getTeamSchedule: (teamId) => http.get(`/teams/${teamId}/schedule`, { params: { seasontype: REGULAR_SEASON } }),
    // A team's season stats. Before the regular season starts, ESPN returns last season's,
    // and `requestedSeason` says which season it is.
    getTeamStatistics: (teamId) => http.get(`/teams/${teamId}/statistics`, { params: { seasontype: REGULAR_SEASON } }),
    // A team's player leaders for a regular season, by its end year (2026 for 2025-26).
    getTeamLeaders: (teamId, seasonYear) =>
        http.get(`${CORE_URL}/seasons/${seasonYear}/types/${REGULAR_SEASON}/teams/${teamId}/leaders`),
};
