const axios = require("axios");
const moment = require("moment");

// Need to subtract a few hours for games that run late on the west coast
//let dt = moment().add(-3, 'hours').format("YYYYMMDD");
let dt = moment().add(-3, 'hours').format("YYYY-MM-DD");

//const BASE_URL_GAMES = `http://data.nba.net/10s/prod/v1/${dt}/scoreboard.json`;  // Previous url for 2021-22 season
const BASE_URL_GAMES = `https://stats.nba.com/stats/scoreboardv3?GameDate=${dt}&LeagueID=00`;
//console.log(BASE_URL);

//const BASE_URL = "https://api.fantasynerds.com/v1/nba/news?apikey=YHRWRSXVDX7AHC7Y24U3";

module.exports = {
    getTodayGames: () => axios({
        method:"GET",
        url : BASE_URL_GAMES,
        headers: {
            'Host': 'stats.nba.com',
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'x-nba-stats-origin': 'stats', 
            'x-nba-stats-token': 'true',
            'Connection': 'keep-alive',
            'Referer': 'https://stats.nba.com/',
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache',
        },
    }),    
    getTodayGames2: () => axios({
        method:"GET",
        url : "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json"
    }),
    getGameBoxScore: getBoxScore,
    getGamesByDate: getGamesByDate
}

function getBoxScore(gameId) {
    //const url = `http://data.nba.net/prod/v1/${dt}/${gameId}_boxscore.json`;
    const url = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;
    console.log(url);
    return axios.get(url).catch(function (err) {
        console.log('Error on boxscore call - ' + url + '    ' + err);
    })
}

function getGamesByDate(dt) {
    //const url = `http://data.nba.net/10s/prod/v1/${dt}/scoreboard.json`;
    const url = `https://stats.nba.com/stats/scoreboardv3?GameDate=${dt}&LeagueID=00`;
    console.log(url);
    return axios({method:"GET",
    url : url,
    headers: {
        'Host': 'stats.nba.com',
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'x-nba-stats-origin': 'stats', 
        'x-nba-stats-token': 'true',
        'Connection': 'keep-alive',
        'Referer': 'https://stats.nba.com/',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
    }}).catch(function (err) {
        console.log('Error on gamesbydate call - ' + url + '    ' + err);
    })
}