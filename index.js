const nba = require('./games');
const { etDate } = require('./dates');

const POLL_INTERVAL_MS = 14000;
const BACKFILL_DAYS = 5;

const STATUS_LIVE = 2;
const STATUS_FINAL = 3;

// Games whose final box score and play-by-play have been saved; they never change again.
const finalizedGames = new Set();
let pollCount = 0;
let polling = false;

// Firebase is required lazily so the pure helpers can be tested without credentials.
const db = () => require('./firebase');

function needsDetails(game) {
    return game.gameStatus === STATUS_LIVE || game.gameStatus === STATUS_FINAL;
}

async function processGame(game) {
    if (finalizedGames.has(game.gameId)) {
        return;
    }

    console.log(`Updating game header -- ${game.gameId} - ${game.gameEt}`);
    await db().writeGameHeader(game.gameId, game);

    if (game.gameStatus === STATUS_LIVE) {
        console.log('Game on!');
        console.log(`${game.period} - ${game.gameClock} - ${game.gameStatusText}`);
        console.log(`${game.awayTeam.teamTricode} ${game.awayTeam.score} - ${game.homeTeam.teamTricode} ${game.homeTeam.score}`);
    }

    if (!needsDetails(game)) {
        return;
    }

    await Promise.all([
        saveBoxScore(game),
        game.period > 0 ? savePbp(game.gameId) : null,
    ]);

    // Only mark final once both writes succeeded, so a failure is retried on the next poll.
    if (game.gameStatus === STATUS_FINAL) {
        finalizedGames.add(game.gameId);
    }
}

async function processGames(games) {
    const results = await Promise.allSettled(games.map(processGame));
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            console.error(`Failed to process game ${games[i].gameId}:`, result.reason.message);
        }
    });
}

async function saveBoxScore(game) {
    const response = await nba.getGameBoxScore(game.gameId);
    console.log(`Updating game box score -- ${game.gameId} - ${game.gameEt}`);
    await db().writeGameData(game.gameId, response.data);
}

async function savePbp(gameId) {
    const response = await nba.getPbp(gameId);
    if (!response.data?.game) {
        throw new Error(`Play-by-play response for ${gameId} has no game data`);
    }
    await db().writePbpData(gameId, response.data.game);
    console.log(`Write PBP data - ${gameId}`);
}

async function loadGamesForDate(date) {
    try {
        const response = await nba.getGamesByDate(date);
        const games = response.data?.scoreboard?.games;
        if (!Array.isArray(games)) {
            console.error(`No games in scoreboard response for ${date}`);
            return;
        }
        await processGames(games);
    } catch (err) {
        console.error(`Failed to load games for ${date}:`, err.message);
    }
}

// Catch up on recent games (in case the server was down) and pre-load upcoming ones.
async function backfill() {
    for (let i = 1; i <= BACKFILL_DAYS; i++) {
        await loadGamesForDate(etDate(-i));
        await loadGamesForDate(etDate(i));
    }
}

async function pollToday() {
    // Skip this tick if the previous poll is still running, so polls never overlap.
    if (polling) {
        console.log('Previous poll still running, skipping');
        return;
    }
    polling = true;
    try {
        const response = await nba.getTodayGames();
        const games = response.data?.scoreboard?.games;
        if (!Array.isArray(games)) {
            console.error('No games in today\'s scoreboard response');
            return;
        }
        await processGames(games);
        console.log(`getGames call # ${pollCount++} - ${new Date().toISOString()}`);
    } catch (err) {
        console.error('Failed to poll today\'s games:', err.message);
    } finally {
        polling = false;
    }
}

function main() {
    // Last line of defense: log instead of letting the long-running poller crash.
    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled rejection:', reason);
    });

    backfill();
    pollToday();
    setInterval(pollToday, POLL_INTERVAL_MS);
}

if (require.main === module) {
    main();
}

module.exports = { needsDetails };
