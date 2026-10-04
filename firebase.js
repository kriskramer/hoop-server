// Uses the Admin SDK so the server authenticates with a service account and the
// database rules can deny client writes to the game data paths.
// Credentials come from GOOGLE_APPLICATION_CREDENTIALS (path to a service account key).
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { toFirebaseSafe } = require('./sanitize');

const app = initializeApp({
    credential: applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://hoopfan-26b24-default-rtdb.firebaseio.com',
});

const database = getDatabase(app);

const write = (path, value) => database.ref(path).set(toFirebaseSafe(value));

// All paths are keyed by ESPN event id. Each write returns its promise so callers can await it.
module.exports = {
    writeGameHeader: (eventId, event) => write(`gameHeaders/${eventId}`, event),
    writeBoxScore: (eventId, boxScore) => write(`gameBoxScores/${eventId}`, boxScore),
    writeGameExtras: (eventId, extras) => write(`gameExtras/${eventId}`, extras),
    // Replaces every play for a game; used for the first write after startup.
    replacePlays: (eventId, playsByKey) => write(`gamePlays/${eventId}`, playsByKey),
    // Atomically writes only the given plays (a null value deletes that play).
    updatePlays: (eventId, playsByKey) => database.ref(`gamePlays/${eventId}`).update(toFirebaseSafe(playsByKey)),
};
