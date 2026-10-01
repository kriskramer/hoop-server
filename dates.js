// NBA schedules are keyed by Eastern Time dates, so compute dates there
// rather than in the server's local time zone.
const ET_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

// Returns the ET calendar date `offsetDays` from `now`, formatted YYYY-MM-DD.
// Day arithmetic is done on the calendar date (not by adding 24h) so DST
// transitions can't skip or repeat a day.
function etDate(offsetDays = 0, now = new Date()) {
    const parts = Object.fromEntries(ET_PARTS.formatToParts(now).map(p => [p.type, p.value]));
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays));
    return date.toISOString().slice(0, 10);
}

module.exports = { etDate };
