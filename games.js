const axios = require('axios');

const CDN_URL = 'https://cdn.nba.com/static/json/liveData';
const STATS_SCOREBOARD_URL = 'https://stats.nba.com/stats/scoreboardv3';

// stats.nba.com rejects requests that don't look like they come from its own site.
const STATS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.5',
    'x-nba-stats-origin': 'stats',
    'x-nba-stats-token': 'true',
    'Referer': 'https://stats.nba.com/',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
};

// A timeout keeps a hung request from stalling the poll loop indefinitely.
const http = axios.create({ timeout: 10000 });

module.exports = {
    getTodayGames: () => http.get(`${CDN_URL}/scoreboard/todaysScoreboard_00.json`),
    getGameBoxScore: (gameId) => http.get(`${CDN_URL}/boxscore/boxscore_${gameId}.json`),
    getPbp: (gameId) => http.get(`${CDN_URL}/playbyplay/playbyplay_${gameId}.json`),
    getGamesByDate: (date) => http.get(STATS_SCOREBOARD_URL, {
        params: { GameDate: date, LeagueID: '00' },
        headers: STATS_HEADERS,
    }),
};
