const axios = require('axios');

// ESPN's public (unofficial, undocumented) site API. No key or special headers needed.
const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// A timeout keeps a hung request from stalling the poll loop indefinitely.
const http = axios.create({ baseURL: BASE_URL, timeout: 10000 });

module.exports = {
    // `date` is YYYY-MM-DD. The NBA scoreboard doesn't support date ranges, so callers fetch one day at a time.
    getScoreboard: (date) => http.get('/scoreboard', { params: { dates: date.replace(/-/g, '') } }),
    // Box score, play-by-play, win probability, leaders, and game info for one event.
    getSummary: (eventId) => http.get('/summary', { params: { event: eventId } }),
};
