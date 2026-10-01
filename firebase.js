// Uses the Admin SDK so the server authenticates with a service account and the
// database rules can deny client writes to the game data paths.
// Credentials come from GOOGLE_APPLICATION_CREDENTIALS (path to a service account key).
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const app = initializeApp({
    credential: applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://hoopfan-26b24-default-rtdb.firebaseio.com',
});

const database = getDatabase(app);

// Each write returns its promise so callers can await it and handle failures.
module.exports = {
    writeGameHeader: (gameId, data) => database.ref(`gameHeader22/${gameId}`).set({ data }),
    writeGameData: (gameId, data) => database.ref(`gameData22/${gameId}`).set({ data }),
    writePbpData: (gameId, pbp) => database.ref(`gamePbp22/${gameId}`).set({ pbp }),
};
