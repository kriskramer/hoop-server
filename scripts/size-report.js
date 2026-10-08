// Reports how much the user-generated paths take up in the Realtime Database, per game and in
// total, to decide whether old comments and reaction votes need cleaning up (see
// docs/implementation-plan.md, "Note: usage and cost estimate"). Read-only: it never writes.
//
//   node scripts/size-report.js            gameComments, gameReactions, gameReactionCounts
//   node scripts/size-report.js --all      also the game data paths the server writes
//   node scripts/size-report.js --top 10   list the 10 largest games per path (default 5)
//
// Each game is downloaded once, so a run costs about as much download as the paths' total size
// (RTDB bills $1/GB). Sizes are the length of the node's JSON, which is close to what RTDB
// bills for storage. Needs GOOGLE_APPLICATION_CREDENTIALS, like the server.

const USER_PATHS = ['gameComments', 'gameReactions', 'gameReactionCounts'];
const GAME_PATHS = ['gameHeaders', 'gameBoxScores', 'gamePlays', 'gameExtras'];

// List prices when this was written; check current pricing before relying on them.
const STORAGE_DOLLARS_PER_GB_MONTH = 5;
const FREE_STORAGE_GB = 1;

const GB = 1024 ** 3;

const bytesOf = (value) => (value == null ? 0 : Buffer.byteLength(JSON.stringify(value)));

// Size and counts for one game's node under `path`. Comments are counted with their posters and
// first post time, and reaction votes with their voters.
function measureGame(path, value) {
    const game = { bytes: bytesOf(value), items: 0, users: 0, firstAt: null };
    if (value == null || typeof value !== 'object') return game;
    if (path === 'gameComments') {
        const posters = new Set();
        for (const comment of Object.values(value)) {
            game.items++;
            if (comment?.uid) posters.add(comment.uid);
            const at = comment?.createdAt;
            if (typeof at === 'number' && (game.firstAt == null || at < game.firstAt)) game.firstAt = at;
        }
        game.users = posters.size;
    } else if (path === 'gameReactions') {
        for (const votes of Object.values(value)) {
            game.users++;
            if (votes && typeof votes === 'object') game.items += Object.keys(votes).length;
        }
    } else {
        game.items = Object.keys(value).length;
    }
    return game;
}

// Totals for one path from its games ({ eventId: measureGame result }), with the `top` largest
// games and comment bytes by the month of each game's first comment.
function summarize(games, top = 5) {
    const entries = Object.entries(games);
    const bytes = entries.reduce((sum, [, g]) => sum + g.bytes, 0);
    const items = entries.reduce((sum, [, g]) => sum + g.items, 0);
    const byMonth = {};
    for (const [, g] of entries) {
        if (g.firstAt == null) continue;
        const month = new Date(g.firstAt).toISOString().slice(0, 7);
        byMonth[month] = (byMonth[month] || 0) + g.bytes;
    }
    return {
        games: entries.length,
        bytes,
        items,
        bytesPerGame: entries.length ? bytes / entries.length : 0,
        bytesPerItem: items ? bytes / items : 0,
        largest: entries
            .sort(([, a], [, b]) => b.bytes - a.bytes)
            .slice(0, top)
            .map(([eventId, g]) => ({ eventId, ...g })),
        byMonth,
    };
}

// Monthly storage cost for `bytes`, after the free allowance.
const monthlyCost = (bytes) => Math.max(0, bytes / GB - FREE_STORAGE_GB) * STORAGE_DOLLARS_PER_GB_MONTH;

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const ITEM_NAMES = { gameComments: 'comments', gameReactions: 'votes', gamePlays: 'plays' };

function printSummary(path, s) {
    const itemName = ITEM_NAMES[path] || 'children';
    console.log(`\n${path}: ${formatBytes(s.bytes)} in ${s.games} games`);
    if (!s.games) return;
    console.log(`  ${formatBytes(s.bytesPerGame)} per game, ${s.items} ${itemName}` +
        (s.items ? `, ${formatBytes(s.bytesPerItem)} per ${itemName.replace(/s$/, '')}` : ''));
    for (const g of s.largest) {
        const users = path === 'gameComments' ? `, ${g.users} posters` : path === 'gameReactions' ? `, ${g.users} voters` : '';
        console.log(`  ${g.eventId}  ${formatBytes(g.bytes).padStart(9)}  ${g.items} ${itemName}${users}`);
    }
    for (const [month, bytes] of Object.entries(s.byMonth).sort()) {
        console.log(`  ${month}  ${formatBytes(bytes)}`);
    }
}

// Event ids under `path`, without downloading their contents (REST `shallow=true`).
async function listGames(databaseURL, path, credential) {
    const axios = require('axios');
    const { access_token: token } = await credential.getAccessToken();
    const res = await axios.get(`${databaseURL}/${path}.json`, {
        params: { shallow: true },
        headers: { Authorization: `Bearer ${token}` },
    });
    return Object.keys(res.data || {});
}

async function main(argv) {
    const { initializeApp, applicationDefault } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');

    const topIndex = argv.indexOf('--top');
    const top = topIndex >= 0 ? Number(argv[topIndex + 1]) || 5 : 5;
    const paths = argv.includes('--all') ? [...USER_PATHS, ...GAME_PATHS] : USER_PATHS;

    const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://hoopfan-26b24-default-rtdb.firebaseio.com';
    const credential = applicationDefault();
    const app = initializeApp({ credential, databaseURL });
    const database = getDatabase(app);

    let total = 0;
    for (const path of paths) {
        const games = {};
        // One game at a time, so a big node never has to fit in memory with the others.
        for (const eventId of await listGames(databaseURL, path, credential)) {
            const snapshot = await database.ref(`${path}/${eventId}`).once('value');
            games[eventId] = measureGame(path, snapshot.val());
        }
        const summary = summarize(games, top);
        printSummary(path, summary);
        total += summary.bytes;
    }

    const scope = argv.includes('--all') ? 'these paths' : 'the user paths';
    console.log(`\nTotal for ${scope}: ${formatBytes(total)}, about $${monthlyCost(total).toFixed(2)}/month ` +
        `after the free ${FREE_STORAGE_GB} GB (whole database counts toward it).`);
    await app.delete();
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((err) => {
        console.error('Size report failed:', err.message);
        process.exitCode = 1;
    });
}

module.exports = { measureGame, summarize, monthlyCost, formatBytes };
