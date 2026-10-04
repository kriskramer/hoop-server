// Realtime Database keys can't be empty or contain . $ # [ ] /
// ESPN payloads include keys like "$ref", so replace those characters with "_".
const INVALID_KEY_CHARS = /[.$#[\]/]/g;

function toFirebaseSafe(value) {
    if (Array.isArray(value)) {
        return value.map(toFirebaseSafe);
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, child] of Object.entries(value)) {
            result[key.replace(INVALID_KEY_CHARS, '_') || '_'] = toFirebaseSafe(child);
        }
        return result;
    }
    return value;
}

module.exports = { toFirebaseSafe };
