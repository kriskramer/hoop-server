const axios = require("axios");

const BASE_URL = "http://data.nba.net/prod/v1/20220425/"; //0042100164_pbp_1.json";

function getPbp(gameId, period) {
    var url = `${BASE_URL}${gameId}_pbp_${period}.json`;
    console.log(url);
    return axios.get(url).catch(function (err) {
        console.log('Error on pbp call - ' + url + '    ' + err);
    })
}
module.exports = {
    getPbp: getPbp,
    // getPbp: (gameId, period) => axios.get({
    //     method:"GET",
    //     url : `${BASE_URL}${gameId}_pbp_${period}.json`,
    //     headers: {
    //         //"content-type":"application/json",
    //         //"x-rapidapi-host":"data.nba.net",
    //     },
    // }).catch(function (err) {
    //     console.log('Error on pbp call - ' + err);
    // })
}