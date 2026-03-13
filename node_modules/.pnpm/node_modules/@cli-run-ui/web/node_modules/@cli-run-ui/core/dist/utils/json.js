export function safeJsonParse(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
export function pickString(obj, keys) {
    if (!obj || typeof obj !== 'object')
        return undefined;
    for (const key of keys) {
        const value = getByPath(obj, key);
        if (typeof value === 'string' && value.length > 0)
            return value;
    }
    return undefined;
}
export function pickNumber(obj, keys) {
    if (!obj || typeof obj !== 'object')
        return undefined;
    for (const key of keys) {
        const value = getByPath(obj, key);
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
    }
    return undefined;
}
export function getByPath(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (!current || typeof current !== 'object')
            return undefined;
        current = current[part];
    }
    return current;
}
//# sourceMappingURL=json.js.map