const test = require('node:test');
const assert = require('node:assert');
const { trimVideos } = require('../videos');

const clip = (id, headline, publishedAt, extra = {}) => ({
    id,
    headline,
    duration: 18,
    originalPublishDate: publishedAt,
    thumbnail: `https://example.com/${id}.jpg`,
    links: {
        web: { href: `https://www.espn.com/video/clip/_/id/${id}` },
        source: { href: `https://example.com/${id}.mp4`, HLS: { href: `https://example.com/${id}.m3u8` } },
    },
    geoRestrictions: { countries: ['US'], type: 'whitelist' },
    ...extra,
});

test('keeps the fields clients show, oldest first, and drops the video files', () => {
    const videos = trimVideos([
        clip(2, 'Game Highlights', '2026-10-07T04:41:59Z', { duration: 73 }),
        clip(1, '  Curry and-1 trey ', '2026-10-07T03:25:17Z'),
    ]);
    assert.deepStrictEqual(videos, [
        {
            id: '1',
            headline: 'Curry and-1 trey',
            duration: 18,
            publishedAt: '2026-10-07T03:25:17Z',
            thumbnail: 'https://example.com/1.jpg',
            url: 'https://www.espn.com/video/clip/_/id/1',
        },
        {
            id: '2',
            headline: 'Game Highlights',
            duration: 73,
            publishedAt: '2026-10-07T04:41:59Z',
            thumbnail: 'https://example.com/2.jpg',
            url: 'https://www.espn.com/video/clip/_/id/2',
        },
    ]);
});

test('skips clips without a link, headline or id, and repeats', () => {
    const videos = trimVideos([
        clip(1, 'Dunk', '2026-10-07T03:00:00Z'),
        clip(1, 'Dunk again', '2026-10-07T03:01:00Z'),
        clip(2, '', '2026-10-07T03:02:00Z'),
        { ...clip(3, 'No link', '2026-10-07T03:03:00Z'), links: {} },
        { ...clip(null, 'No id', '2026-10-07T03:04:00Z') },
        null,
    ]);
    assert.deepStrictEqual(videos.map((v) => v.headline), ['Dunk']);
});

test('treats a missing list as no clips', () => {
    assert.deepStrictEqual(trimVideos(undefined), []);
    assert.deepStrictEqual(trimVideos({}), []);
});
