const gamesAPI = require('./games');
const pbpAPI = require('./pbp');
const firebaseDb = require('./firebase');
const { getGameBoxScore } = require('./games');
const moment = require("moment");


var allGamesPbp = {};
var counter = 0;

const getGames = async () => {
    try {
        const response = await gamesAPI.getTodayGames();
        if (!response) {
            console.log('No games returned');
        }
        console.log(response.data.numGames);
        //console.log(response.data.games);
    
        //loop through json array of games
        response.data.games.forEach(obj => {
            processGame(obj);
            // Object.entries(obj).forEach(([key, value]) => {
            //     console.log(`${key} ${value}`);
            // });
            console.log('-------------------');
        });    
    }
    catch (err) 
    {
        console.log(err);
    }
}

const getPreviousGames = async () => {
    // Get the previous 3 days worth of games, in case the app crashes overnight.
    for (var i = 1; i <= 15; i++) {
        let dt = moment().add(-i, 'days').format("YYYYMMDD");
        const response = await gamesAPI.getGamesByDate(dt);
        if (response.data != null) {
            response.data.games.forEach(obj => {
                processGame(obj);
            });    
        }    
    }
}

const getUpcomingGames = async () => {
    // Get the next 5 days worth of games
    for (var i = 1; i <= 5; i++) {
        let dt = moment().add(i, 'days').format("YYYYMMDD");
        const response = await gamesAPI.getGamesByDate(dt);
        if (response.data != null) {
            response.data.games.forEach(obj => {
                processGame(obj);
            });    
        }    
    }
}

function processGame(game) {
    console.log(game.gameId);
    console.log(`${game.vTeam.triCode} ${game.vTeam.score} - ${game.hTeam.triCode} ${game.hTeam.score}`);
    console.log(game.startTimeEastern);
    
    getBoxScore(game);
    //console.log(game);
    if (game.isGameActivated) {
        console.log("Game started!");
        console.log(`${game.period.current} - ${game.clock}`);
        //console.log(`${game.vTeam.triCode} ${game.vTeam.score} - ${game.hTeam.triCode} ${game.hTeam.score}`);

        if (game.period.current > 0) {
            //getBoxScore(game);
            getPbp(game.gameId, game.period.current);
        }
    }
}

const getBoxScore = async (game) => {
    const response = await gamesAPI.getGameBoxScore(game);
    firebaseDb.writeGameData(game.gameId, response.data);
}

const getPbp = async (gameId, period) => {
    var response;
    try {
        response = await pbpAPI.getPbp(gameId, period);
    }
    catch (err) {
        console.log(err);
    }

    if (!response) {
        console.log('getPbp response is null');
        return null;
    }
    if (!response.data) {
        console.log('getPbp response.data is null');
        return null;
    }
    if (!response.data.plays) {
        console.log('getPbp response.data.plays is null');
        return null;
    }

    if (response.data.plays.length > 1) {
        //console.log(response.data.plays.length);
    }

    // Need a better way to do this...
    //var existingData = await firebaseDb.getPbpData(gameId);

    if (!allGamesPbp[gameId]) {
        allGamesPbp[gameId] = response.data.plays;
        allGamesPbp[gameId].forEach(p => {
            firebaseDb.writePbpData(gameId, period, p);    
        })
    }

    var newPlays = response.data.plays;
    var existingPlays = allGamesPbp[gameId];
    // console.log(newPlays);
    // console.log(existingPlays);

    // Look for new plays, i.e. plays that aren't already in the existingplays collection
    var difference = newPlays.filter(item1 => !existingPlays.some(item2 => (item2.clock === item1.clock 
                                                                            && item2.eventMsgType === item1.eventMsgType
                                                                            && item2.personId === item1.personId
                                                                            && item2.description === item1.description)));
    //console.log(difference);
    console.log(`new ${newPlays.length} - existing ${existingPlays.length} = diff ${difference.length}`)
    difference.forEach(p => {
        allGamesPbp[gameId].push(p);
        firebaseDb.writePbpData(gameId, period, p);
    })

    // response.data.plays.forEach(p => {
    //     if (allGamesPbp[gameId].some(e => {if (e.description == p.description && e.clock == p.clock && e.hTeamScore == p.hTeamScore && e.vTeamScore == p.vTeamScore) return true;})) {
    //         // already exists in list
    //     } else {
    //         allGamesPbp[gameId].push(p);
    //         firebaseDb.writePbpData(gameId, period, p);
    //     }
    // });

}


// Need a timer to load the day's games every 30-60 seconds
getPreviousGames();
getUpcomingGames();
getGames();
setInterval(async () => {
    await getGames();
    console.log('getGames call # ' + counter++);
    console.log(new Date());
}, 18000);
