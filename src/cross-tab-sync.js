/**
 * cross-tab-sync.js
 *
 * Manages real-time cross-tab communication for the Orbs project.
 *
 * Each tab:
 *   - Owns one orb (identified by its windowIndex).
 *   - Publishes its orb's camera-center-offset (the attractor position) every frame.
 *   - Reads ALL other tabs' attractor positions so its local simulation can drive them.
 *
 * Storage layout (all keys prefixed with "orbs."):
 *   orbs.activeWindowIndices  – JSON array of live window indices  (existing)
 *   orbs.windowIndex          – sessionStorage: this tab's index    (existing)
 *   orbs.orb.<N>.state        – JSON: { cx, cy, ts } for orb N
 *                                cx/cy = cameraCenterOffset x/y
 *                                ts    = Date.now() timestamp (ms)
 *
 * Stale-entry TTL: entries older than STALE_MS are ignored.
 */

const ORB_STATE_PREFIX = 'orbs.orb.'
const STALE_MS = 2000 // ignore entries not updated in 2 s

/**
 * Publish this tab's orb attractor position.
 * @param {number} windowIndex – this tab's index
 * @param {number} cx          – cameraCenterOffset.x
 * @param {number} cy          – cameraCenterOffset.y
 */
export function publishOrbState(windowIndex, cx, cy) {
    try {
        localStorage.setItem(
            `${ORB_STATE_PREFIX}${windowIndex}.state`,
            JSON.stringify({ cx, cy, ts: Date.now() })
        )
    } catch (_) {
        // Storage quota exceeded or private mode – silently ignore.
    }
}

/**
 * Read all live orb attractor positions from other tabs.
 * Returns a Map<windowIndex, {cx, cy}> excluding our own index.
 *
 * @param {number} ownIndex – skip this tab's own entry
 * @param {number[]} activeIndices – indices to read
 * @returns {Map<number, {cx: number, cy: number}>}
 */
export function readRemoteOrbStates(ownIndex, activeIndices) {
    const result = new Map()
    const now = Date.now()
    for (const idx of activeIndices) {
        if (idx === ownIndex) continue
        try {
            const raw = localStorage.getItem(`${ORB_STATE_PREFIX}${idx}.state`)
            if (!raw) continue
            const parsed = JSON.parse(raw)
            if (
                typeof parsed.cx === 'number' &&
                typeof parsed.cy === 'number' &&
                typeof parsed.ts === 'number' &&
                now - parsed.ts < STALE_MS
            ) {
                result.set(idx, { cx: parsed.cx, cy: parsed.cy })
            }
        } catch (_) {
            // Malformed entry – skip.
        }
    }
    return result
}

/**
 * Clean up this tab's published state on unload.
 * @param {number} windowIndex
 */
export function cleanupOrbState(windowIndex) {
    try {
        localStorage.removeItem(`${ORB_STATE_PREFIX}${windowIndex}.state`)
    } catch (_) {}
}