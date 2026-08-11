#!/usr/bin/env node
/**
 * Allocate a free block of dev ports.
 *
 * The branch-name hash only picks a preferred block, and there are just 49, so collisions
 * are routine. Nothing used to check the block was free, so a colliding instance silently
 * drove another one's stack. Database names are unaffected. See docs/DEV_DATABASE.md.
 *
 * Usage: required by scripts/dev.js and scripts/test.js.
 */

'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const instance = require('../instance');

// Host-wide, matching the lock scripts/dev-db.sh takes for the shared container.
const LOCK_FILE = path.join(os.tmpdir(), 'autotaskcalendar-ports.lock');
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 100;

/** Binds 0.0.0.0, matching the servers, so a port taken on any interface counts as busy. */
function portIsFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '0.0.0.0');
    });
}

function portsForOffset(offset) {
    const { BASE_PORTS, PORT_STRIDE } = instance;
    return {
        offset,
        apiPort: BASE_PORTS.apiPort + offset * PORT_STRIDE,
        webPort: BASE_PORTS.webPort + offset * PORT_STRIDE,
        inspectPort: BASE_PORTS.inspectPort + offset * PORT_STRIDE,
    };
}

/**
 * Best-effort cross-process lock, so two agents starting at once cannot both pass the
 * free-port probe and then race to bind. Exclusive create rather than flock(1), which is
 * not everywhere; a lock left by a crashed process goes stale after LOCK_STALE_MS.
 */
async function withLock(fn) {
    const deadline = Date.now() + LOCK_STALE_MS;
    let held = false;

    while (Date.now() < deadline) {
        try {
            fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
            held = true;
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;

            let age = Infinity;
            try {
                age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
            } catch {
                // Vanished under us; loop round and try to take it.
            }

            if (age > LOCK_STALE_MS) {
                try { fs.unlinkSync(LOCK_FILE); } catch { /* someone else won the race */ }
                continue;
            }

            await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
        }
    }

    try {
        return await fn();
    } finally {
        if (held) {
            try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
        }
    }
}

/**
 * Find a block whose api/web/inspect ports are all free. Explicit per-port overrides are
 * honoured untouched; only the derived block moves.
 */
async function allocatePorts({ preferredOffset = instance.offset } = {}) {
    const pinned = {
        apiPort: process.env.AUTOTASKCALENDAR_API_PORT,
        webPort: process.env.AUTOTASKCALENDAR_WEB_PORT,
        inspectPort: process.env.AUTOTASKCALENDAR_INSPECT_PORT,
    };
    const fullyPinned = pinned.apiPort && pinned.webPort && pinned.inspectPort;

    if (fullyPinned) {
        return {
            offset: instance.offset,
            apiPort: Number(pinned.apiPort),
            webPort: Number(pinned.webPort),
            inspectPort: Number(pinned.inspectPort),
            movedFrom: null,
            pinned: true,
        };
    }

    return withLock(async () => {
        const { MAX_OFFSET } = instance;

        // Wrap around so a high preferred offset can still reach the low blocks.
        for (let step = 0; step <= MAX_OFFSET; step++) {
            const offset = ((preferredOffset - 1 + step) % MAX_OFFSET) + 1;
            const candidate = portsForOffset(offset);

            const free = await Promise.all([
                pinned.apiPort ? true : portIsFree(candidate.apiPort),
                pinned.webPort ? true : portIsFree(candidate.webPort),
                pinned.inspectPort ? true : portIsFree(candidate.inspectPort),
            ]);

            if (free.every(Boolean)) {
                return {
                    ...candidate,
                    apiPort: pinned.apiPort ? Number(pinned.apiPort) : candidate.apiPort,
                    webPort: pinned.webPort ? Number(pinned.webPort) : candidate.webPort,
                    inspectPort: pinned.inspectPort
                        ? Number(pinned.inspectPort)
                        : candidate.inspectPort,
                    movedFrom: offset === preferredOffset ? null : preferredOffset,
                    pinned: false,
                };
            }
        }

        throw new Error(
            `No free port block found after trying all ${MAX_OFFSET} offsets. ` +
            'Stop some running instances, or pin ports with AUTOTASKCALENDAR_API_PORT, ' +
            'AUTOTASKCALENDAR_WEB_PORT and AUTOTASKCALENDAR_INSPECT_PORT.'
        );
    });
}

module.exports = { allocatePorts, portIsFree, portsForOffset };
