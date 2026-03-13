export function parseTimeMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1e12 ? value : Math.round(value * 1000);
    }
    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric > 1e12 ? numeric : Math.round(numeric * 1000);
        }
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    return undefined;
}
export function nowMs() {
    return Date.now();
}
//# sourceMappingURL=time.js.map