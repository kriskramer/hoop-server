const gamesAPI = require('./games');
const pbp = require('./pbp');
const pbpAPI = require('./pbp');

const getGames = async () => {
    const response = await gamesAPI.getGamesByDate();
    console.log(response.data.numGames);
    //console.log(response.data.games);

    //loop through json array of games
    response.data.games.forEach(obj => {
        processGame(obj);
        Object.entries(obj).forEach(([key, value]) => {
            //console.log(`${key} ${value}`);
        });
        console.log('-------------------');
    });
}

const getPbp = async (gameId, period) => {
    const response = await pbpAPI.getPbp(gameId, period);
    console.log(response.data);

}

function processGame(game) {
    console.log(game.gameId);
    
    //console.log(game);
    if (game.isGameActivated) {
        console.log("Game started!");
        console.log(`${game.period.current} - ${game.clock}`);
        console.log(`${game.vTeam.triCode} ${game.vTeam.score} - ${game.hTeam.triCode} ${game.hTeam.score}`);

        //if the game has started, pull the play-by-play data
        const response = getPbp(game.gameId, game.period.current);
    }
}

// Need a timer to load the day's games every 30-60 seconds
getGames();

