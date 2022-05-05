const axios = require("axios");
const moment = require("moment");

// Need to subtract a few hours for games that run late on the west coast
let dt = moment().add(-3, 'hours').format("YYYYMMDD");

const BASE_URL = `http://data.nba.net/prod/v1/${dt}/`;

function getPbp(gameId, period) {
    var url = `${BASE_URL}${gameId}_pbp_${period}.json`;
    //console.log(url);
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