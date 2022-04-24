const axios = require("axios");

const BASE_URL = "http://data.nba.net/prod/v1/20220424/"; //0042100164_pbp_1.json";

module.exports = {
    getPbp: (gameId, period) => axios({
        method:"GET",
        url : BASE_URL + gameId + "_pbp_" + period + ".json",
        headers: {
            //"content-type":"application/json",
            //"x-rapidapi-host":"data.nba.net",
        },
    })
}