const test = require('node:test');
const assert = require('node:assert');
const { buildRoster } = require('../roster');

const athlete = (id, displayName, shortName, jersey, starter = false) => ({
    athlete: { id, displayName, shortName, jersey, headshot: { href: `https://example.com/${id}.png` } },
    starter,
    stats: ['30', '12'],
});

test('lists each team\'s players by athlete id', () => {
    const roster = buildRoster({
        players: [
            { team: { id: '8' }, statistics: [{ athletes: [athlete('1', 'Cade Cunningham', 'C. Cunningham', '2', true)] }] },
            { team: { id: 30 }, statistics: [{ athletes: [athlete(2, 'LaMelo Ball', 'L. Ball', '1')] }] },
        ],
    });
    assert.deepStrictEqual(roster, {
        1: { name: 'Cade Cunningham', short: 'C. Cunningham', jersey: '2', teamId: '8', starter: true },
        2: { name: 'LaMelo Ball', short: 'L. Ball', jersey: '1', teamId: '30', starter: false },
    });
});

test('skips players without an id and teams without an id', () => {
    const roster = buildRoster({
        players: [
            { team: {}, statistics: [{ athletes: [athlete('1', 'A', 'A.', '1')] }] },
            { team: { id: '8' }, statistics: [{ athletes: [{ athlete: { displayName: 'No Id' } }, athlete('2', 'B', undefined, undefined)] }] },
        ],
    });
    assert.deepStrictEqual(roster, { 2: { name: 'B', short: 'B', jersey: null, teamId: '8', starter: false } });
});

test('is null before there are any players', () => {
    assert.strictEqual(buildRoster(undefined), null);
    assert.strictEqual(buildRoster({ players: [] }), null);
    assert.strictEqual(buildRoster({ players: [{ team: { id: '8' }, statistics: [] }] }), null);
});
