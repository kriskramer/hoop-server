const gamesAPI = require('./games');
const pbpAPI = require('./pbp');
const firebaseDb = require('./firebase');
const { getGameBoxScore } = require('./games');
const moment = require("moment");


var allGamesPbp = {};
var counter = 0;

const getGames = async () => {
    try {
        const response = await gamesAPI.getTodayGames2();
        if (!response) {
            console.log('No games returned');
        }
        //console.log(response.data.scoreboard.games.length);
        //console.log(response.data.scoreboard.games);
    
        //loop through json array of games
        response.data.scoreboard.games.forEach(game => {
            processGame(game);
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
        let dt = moment().add(-i, 'days').format("YYYY-MM-DD");
        const response = await gamesAPI.getGamesByDate(dt);
        if (response.data != null) {
            response.data.scoreboard.games.forEach(obj => {
                processGame(obj);
            });    
        }    
    }
}

const getUpcomingGames = async () => {
    // Get the next 5 days worth of games
    for (var i = 1; i <= 5; i++) {
        let dt = moment().add(i, 'days').format("YYYY-MM-DD");
        const response = await gamesAPI.getGamesByDate(dt);
        if (response.data != null) {
            response.data.scoreboard.games.forEach(obj => {
                processGame(obj);
            });    
        }    
    }
}

function processGame(game) {
    console.log(game.gameId);
    console.log(`${game.awayTeam.teamTricode} ${game.awayTeam.score} - ${game.homeTeam.teamTricode} ${game.homeTeam.score}`);
    console.log(game.gameEt);
    firebaseDb.writeGameHeader22(game.gameId, game);
    
    getBoxScore(game);
    //firebaseDb.writeGameData22(game.gameId, game);
    //console.log(game);

    if (game.gameStatus == 2) {
        console.log("Game on!");
        console.log(`${game.period} - ${game.gameClock} - ${game.gameStatusText}`);
        //console.log(`${game.awayTeam.triCode} ${game.awayTeam.score} - ${game.hTeam.triCode} ${game.hTeam.score}`);

        if (game.period > 0) {
            getPbp(game.gameId);
        }
    }
    console.log(" ");
}

const getBoxScore = async (game) => {
    const response = await gamesAPI.getGameBoxScore(game.gameId);
    if (response != null) {
        if (response.data != null) {
            firebaseDb.writeGameData22(game.gameId, response.data);
        }
    }
}

const getPbp = async (gameId) => {
    var response;
    try {
        response = await pbpAPI.getPbp(gameId);
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
    if (!response.data.game) {
        console.log('getPbp response.data.plays is null');
        return null;
    }

    //if (response.data.game.actions.length > 1) {
        //console.log(response.data.plays.length);
    //}

    
    if (!allGamesPbp[gameId]) {
        allGamesPbp[gameId] = response.data.game.actions;
        allGamesPbp[gameId].forEach(p => {
            firebaseDb.writePbpData(gameId, p);    
        })
    }

    // New method to save the PBP data separately from chat and everything else
    firebaseDb.writePbpData22(gameId, response.data.game);

    var newPlays = response.data.game.actions;
    var existingPlays = allGamesPbp[gameId];
    // console.log(newPlays);
    // console.log(existingPlays);

    // Look for new plays, i.e. plays that aren't already in the existingplays collection
    var difference = newPlays.filter(item1 => !existingPlays.some(item2 => (item2.clock === item1.clock 
                                                                            && item2.eventMsgType === item1.eventMsgType
                                                                            && item2.personId === item1.personId
                                                                            && item2.description === item1.description)));
    //console.log(difference);
    console.log(`${gameId} == new ${newPlays.length} - existing ${existingPlays.length} = diff ${difference.length}`)
    difference.forEach(p => {
        allGamesPbp[gameId].push(p);
        firebaseDb.writePbpData(gameId, p);
    })

    // response.data.plays.forEach(p => {
    //     if (allGamesPbp[gameId].some(e => {if (e.description == p.description && e.clock == p.clock && e.hTeamScore == p.hTeamScore && e.awayTeamScore == p.awayTeamScore) return true;})) {
    //         // already exists in list
    //     } else {
    //         allGamesPbp[gameId].push(p);
    //         firebaseDb.writePbpData(gameId, p);
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
}, 14000);
