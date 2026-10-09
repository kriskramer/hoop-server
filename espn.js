const axios = require('axios');

// ESPN's public (unofficial, undocumented) site API. No key or special headers needed.
const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// A timeout keeps a hung request from stalling the poll loop indefinitely.
const http = axios.create({ baseURL: BASE_URL, timeout: 10000 });
// Standings live under `apis/v2`, not `apis/site/v2`. An absolute URL overrides `baseURL`.
const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
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
};
