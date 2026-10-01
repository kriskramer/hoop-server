const test = require('node:test');
const assert = require('node:assert');
const { needsDetails } = require('../index');

test('fetches box score and play-by-play only for live or final games', () => {
    assert.strictEqual(needsDetails({ gameStatus: 1 }), false);
    assert.strictEqual(needsDetails({ gameStatus: 2 }), true);
    assert.strictEqual(needsDetails({ gameStatus: 3 }), true);
});
