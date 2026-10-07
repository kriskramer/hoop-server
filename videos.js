// Trims the summary's `videos` (ESPN highlight clips) to what clients show: a headline,
// thumbnail and length, and a link to the clip's page on espn.com. Clients link out rather
// than play ESPN's video files themselves, so the stream and MP4 links aren't stored.

// Turns the summary's videos into a list ordered by publish time, oldest first. Clips
// without a web link or headline are left out, as are repeats of the same id.
function trimVideos(videos) {
    if (!Array.isArray(videos)) return [];
    const seen = new Set();
    const trimmed = [];
    for (const video of videos) {
        const url = video?.links?.web?.href;
        const headline = typeof video?.headline === 'string' ? video.headline.trim() : '';
        const id = video?.id == null ? null : String(video.id);
        if (!url || !headline || !id || seen.has(id)) continue;
        seen.add(id);
        trimmed.push({
            id,
            headline,
            duration: Number.isFinite(video.duration) ? video.duration : null,
            publishedAt: video.originalPublishDate ?? null,
            thumbnail: video.thumbnail ?? null,
            url,
        });
    }
    return trimmed.sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''));
}

module.exports = { trimVideos };
