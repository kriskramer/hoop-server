const axios = require("axios");

const BASE_URL = "http://data.nba.net/10s/prod/v1/20220425/scoreboard.json";
//const BASE_URL = "https://api.fantasynerds.com/v1/nba/news?apikey=YHRWRSXVDX7AHC7Y24U3";

module.exports = {
    getGamesByDate: () => axios({
        method:"GET",
        url : BASE_URL
        // headers: {
        //     //"content-type":"application/json",
        //     //"x-rapidapi-host":"data.nba.net",
        //     //"x-rapidapi-key": "yourapikey"
        // },
    })
}