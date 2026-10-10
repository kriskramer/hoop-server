const test = require('node:test');
const assert = require('node:assert');
const {
    trimArticle,
    parseStory,
    recapWatchDone,
    watchesRecap,
    RECAP_QUIET_MS,
    RECAP_WAIT_MS,
} = require('../article');
// The AP recap of DET @ CHA (2026-04-10), from the game's summary, captured on 2026-10-10.
const fixture = require('./fixtures/summary-article.json');

// A paragraph's text, with player and team links marked: "[Jalen Duren#4433621]", "[Detroit Pistons@det]".
const marked = (block) => block.runs
    .map(r => r.playerId ? `[${r.text}#${r.playerId}]` : r.team ? `[${r.text}@${r.team}]` : r.text)
    .join('');

test('keeps the headline, summary, source, times and ESPN link', () => {
    const article = trimArticle(fixture.article);
    const { story, ...rest } = article;
    assert.deepStrictEqual(rest, {
        id: '48452846',
        type: 'Recap',
        headline: 'Jalen Duren scores 20 points and the Detroit Pistons beat the Charlotte Hornets 118-100',
        description: 'Jalen Duren had 20 points, Duncan Robinson scored 19 and the Detroit Pistons beat Charlotte 118-100 on Friday night, locking the Hornets into the play-in tournament.',
        source: 'AP',
        published: '2026-04-11T01:47:59Z',
        updated: '2026-04-11T01:51:00Z',
        url: 'https://www.espn.com/nba/recap?gameId=401811026',
    });
    assert.ok(JSON.stringify(article).length < 3000, 'about 2.5 KB, against 5.6 KB untrimmed');
});

test('parses the story into paragraphs, with player and team links', () => {
    const story = trimArticle(fixture.article).story;
    assert.strictEqual(story.length, 11);
    // AP's "-- —" dateline is tidied, and the X link keeps only its text.
    assert.strictEqual(marked(story[0]),
        'CHARLOTTE, N.C. — [Jalen Duren#4433621] had 20 points, [Duncan Robinson#3157465] scored 19 and the ' +
        '[Detroit Pistons@det] beat Charlotte 118-100 on Friday night, locking the Hornets into the play-in tournament.');
    assert.strictEqual(marked(story[1]),
        'Already assured of the top seed in the Eastern Conference, the Pistons played their regular starters against the Hornets.');
    // The "Up next" heading is its own block, and AP's sign-off is dropped.
    assert.deepStrictEqual(story.slice(-3).map(b => [b.kind, marked(b)]), [
        ['h', 'Up next'],
        ['p', 'Pistons: Visit Indiana on Sunday.'],
        ['p', 'Hornets: Visit New York on Sunday for their regular-season finale.'],
    ]);
    assert.ok(story.every(b => b.runs.every(r => !/[<>]/.test(r.text))), 'no HTML left');
});

test('a player link inside another link keeps the player', () => {
    const [block] = parseStory(
        'The win was not without cost, <a href="https://apnews.com/article/x">who lost guard ' +
        '<a href="http://www.espn.com/nba/player/_/id/4593803/jalen-williams">Jalen Williams</a></a> &amp; more.');
    assert.deepStrictEqual(block.runs, [
        { text: 'The win was not without cost, who lost guard ' },
        { text: 'Jalen Williams', playerId: '4593803' },
        { text: ' & more.' },
    ]);
});

test('a heading followed by text on the next line splits into two blocks', () => {
    assert.deepStrictEqual(parseStory('<hl2>Up next</hl2>\n   Thunder: Host Utah.').map(b => [b.kind, marked(b)]), [
        ['h', 'Up next'],
        ['p', 'Thunder: Host Utah.'],
    ]);
});

test('no article, or one without a headline or story, is null', () => {
    assert.strictEqual(trimArticle(undefined), null);
    assert.strictEqual(trimArticle({ ...fixture.article, headline: ' ' }), null);
    assert.strictEqual(trimArticle({ ...fixture.article, story: '' }), null);
    assert.strictEqual(trimArticle({ ...fixture.article, story: '------\n\nAP NBA: x' }), null);
});

test('settled games check for a recap until it stops changing, or for 12 hours', () => {
    const endedAt = Date.parse('2026-04-11T01:29:00Z');
    assert.strictEqual(recapWatchDone({ endedAt, updated: undefined }, endedAt + RECAP_WAIT_MS - 1), false);
    assert.strictEqual(recapWatchDone({ endedAt, updated: undefined }, endedAt + RECAP_WAIT_MS), true);
    const updated = endedAt + 20 * 60 * 1000;
    assert.strictEqual(recapWatchDone({ endedAt, updated }, updated + RECAP_QUIET_MS - 1), false);
    assert.strictEqual(recapWatchDone({ endedAt, updated }, updated + RECAP_QUIET_MS), true);
});

test('preseason games aren\'t watched for a recap', () => {
    assert.strictEqual(watchesRecap({ season: { type: 1 } }), false);
    assert.strictEqual(watchesRecap({ season: { type: 2 } }), true);
    assert.strictEqual(watchesRecap({ season: { type: 3 } }), true);
});
