const axios = require("axios");
const moment = require("moment");

// Need to subtract a few hours for games that run late on the west coast
let dt = moment().add(-3, 'hours').format("YYYYMMDD");

const BASE_URL_GAMES = `http://data.nba.net/10s/prod/v1/${dt}/scoreboard.json`;
//console.log(BASE_URL);

//const BASE_URL = "https://api.fantasynerds.com/v1/nba/news?apikey=YHRWRSXVDX7AHC7Y24U3";

module.exports = {
    getGamesByDate: () => axios({
        method:"GET",
        url : BASE_URL_GAMES
        // headers: {
        //     //"content-type":"application/json",
        //     //"x-rapidapi-host":"data.nba.net",
        //     //"x-rapidapi-key": "yourapikey"
        // },
    }),
    getGameBoxScore: getBoxScore
}

function getBoxScore(gameId) {
    const url = `http://data.nba.net/prod/v1/${dt}/${gameId}_boxscore.json`;
    console.log(url);
    return axios.get(url).catch(function (err) {
        console.log('Error on pbp call - ' + url + '    ' + err);
    })
}