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

// All game paths are keyed by ESPN event id. Each write returns its promise so callers can
// await it.
module.exports = {
    // League standings, trimmed by standings.js.
    writeStandings: (standings) => write('standings', standings),
    writeGameExtras: (eventId, extras) => write(`gameExtras/${eventId}`, extras),
    // Replaces every play for a game; used for the first write after startup.
    replacePlays: (eventId, playsByKey) => write(`gamePlays/${eventId}`, playsByKey),
    // Atomically writes only the given plays (a null value deletes that play).
    updatePlays: (eventId, playsByKey) => database.ref(`gamePlays/${eventId}`).update(toFirebaseSafe(playsByKey)),
    // Replaces the node at `path`. `value` must already be Firebase-safe.
    set: (path, value) => database.ref(path).set(value),
    // Atomically applies a multi-path update (paths relative to `path`, joined with '/') from
    // diff.js. The values must already be Firebase-safe.
    update: (path, updates) => database.ref(path).update(updates),
    // Calls onValue(value) with the node at `path`, then again on every change. Returns a
    // function that stops listening.
    watch: (path, onValue, onError) => {
        const ref = database.ref(path);
        const listener = ref.on('value', (snapshot) => onValue(snapshot.val()), onError);
        return () => ref.off('value', listener);
    },
};
