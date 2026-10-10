// Trims the summary's `article` (the AP game recap ESPN publishes after the final) to what
// clients show: the headline, the summary line, a link to ESPN's page, and the story as
// paragraphs. ESPN's story is HTML with player and team links; it's parsed here into plain
// text runs, so clients don't need an HTML renderer, and player and team links keep only
// their ids, so the app can open its own pages.
//
// The recap usually appears 10–30 minutes after the final buzzer, and is often revised over
// the next hour or so as quotes are added. Some come hours later. A final game's data
// settles sooner than that, so settled games keep checking for the recap (`recapWatchDone`).

// How often a settled game's summary is fetched for its recap.
const RECAP_REFRESH_MS = 10 * 60 * 1000;
// A recap is stored for good once it hasn't changed for this long.
const RECAP_QUIET_MS = 60 * 60 * 1000;
// Settled games stop looking for a recap this long after the game ended.
const RECAP_WAIT_MS = 12 * 60 * 60 * 1000;

// { id, type, headline, description, source, published, updated, url, story }, or null if
// there's no article or it has no headline or story. `type` is ESPN's ("Recap"). `story` is
// [ { kind: 'p' | 'h', runs: [ { text, playerId?, team? } ] } ], where `team` is the
// lowercase abbreviation in ESPN's team link ("det", "gs").
function trimArticle(article) {
    const headline = text(article?.headline);
    const story = parseStory(article?.story);
    if (!headline || story.length === 0) return null;
    return {
        id: article.id == null ? null : String(article.id),
        type: text(article.type),
        headline,
        // ESPN's starts with the dateline's dash: "— Jalen Duren had 20 points, ..."
        description: text(article.description)?.replace(/^[—–-]+\s*/, '') || null,
        source: text(article.source),
        published: article.published ?? null,
        updated: article.lastModified ?? article.published ?? null,
        url: https(article.links?.web?.href),
        story,
    };
}

// Splits the story's HTML into paragraphs, on blank lines. A `<hl2>` heading starts its own
// block. The "------" line and AP's sign-off after it are dropped.
function parseStory(html) {
    if (typeof html !== 'string') return [];
    const blocks = [];
    for (const chunk of html.split(/\r?\n\s*\r?\n/)) {
        if (/^\s*-{3,}\s*$/.test(chunk)) break;
        const heading = chunk.match(/^\s*<hl2>([\s\S]*?)<\/hl2>([\s\S]*)$/i);
        if (heading) {
            pushBlock(blocks, 'h', heading[1]);
            pushBlock(blocks, 'p', heading[2]);
        } else {
            pushBlock(blocks, 'p', chunk);
        }
    }
    // AP's dateline: "CHARLOTTE, N.C. -- — Jalen Duren had ..."
    const first = blocks[0]?.runs[0];
    if (first) first.text = first.text.replace(/^([^a-z]*?) -- — /, '$1 — ');
    return blocks;
}

function pushBlock(blocks, kind, html) {
    const runs = parseRuns(html);
    if (runs.length > 0) blocks.push({ kind, runs });
}

// Turns inline HTML into text runs. Player and team links become runs with their id; other
// links (AP articles, posts on X) and any other tags keep only their text. Links can nest
// (an AP link around a player's), so the innermost player or team link wins.
function parseRuns(html) {
    const runs = [];
    const links = [];
    const add = (raw) => {
        const value = decode(raw).replace(/\s+/g, ' ');
        if (!value) return;
        const link = links.findLast(l => l !== null) ?? {};
        const last = runs.at(-1);
        if (last && last.playerId === link.playerId && last.team === link.team) {
            last.text += value;
        } else {
            runs.push({ text: value, ...link });
        }
    };
    let index = 0;
    for (const match of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
        add(html.slice(index, match.index));
        index = match.index + match[0].length;
        if (match[2].toLowerCase() !== 'a') continue;
        if (match[1]) {
            links.pop();
        } else {
            links.push(linkTarget(match[3].match(/href\s*=\s*"([^"]*)"/i)?.[1]));
        }
    }
    add(html.slice(index));
    if (runs.length > 0) {
        runs[0].text = runs[0].text.trimStart();
        runs.at(-1).text = runs.at(-1).text.trimEnd();
    }
    return runs.filter(r => r.text);
}

// { playerId } or { team } for ESPN's player and team pages, else null.
function linkTarget(href) {
    const player = href?.match(/espn\.com\/nba\/player\/_\/id\/(\d+)/);
    if (player) return { playerId: player[1] };
    const team = href?.match(/espn\.com\/nba\/team\/_\/name\/([a-z]+)/i);
    if (team) return { team: team[1].toLowerCase() };
    return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
        if (name[0] === '#') {
            const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
        }
        return ENTITIES[name.toLowerCase()] ?? entity;
    });
}

function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ESPN's links are http.
function https(url) {
    return typeof url === 'string' && url ? url.replace(/^http:\/\//, 'https://') : null;
}

// Whether a settled game can stop checking for its recap: once the stored recap hasn't
// changed for RECAP_QUIET_MS, or RECAP_WAIT_MS after the game ended. `updated` is the
// stored recap's last change (ms), undefined if there's none yet.
function recapWatchDone({ endedAt, updated }, now) {
    if (now - endedAt >= RECAP_WAIT_MS) return true;
    return updated !== undefined && now - updated >= RECAP_QUIET_MS;
}

// AP doesn't write recaps for preseason games, so those aren't watched after they settle.
function watchesRecap(event) {
    return event?.season?.type !== 1;
}

module.exports = {
    trimArticle,
    parseStory,
    recapWatchDone,
    watchesRecap,
    RECAP_REFRESH_MS,
    RECAP_QUIET_MS,
    RECAP_WAIT_MS,
};
