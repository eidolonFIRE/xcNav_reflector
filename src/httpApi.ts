import { IncomingMessage, ServerResponse } from 'http';
import { createHash, timingSafeEqual } from 'crypto';
import * as api from "./api";
import { getClient, getGroup } from './state';
import { log } from './logger';


// Read-only HTTP API for spectators (web map), served on the same port as the websocket.
//
//   GET /group/<group_id>
//   Authorization: Bearer <GROUP_API_TOKEN>


// Positions older than this are dropped (seconds)
const maxPositionAge = 60 * 60 * 12;

const groupIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

const apiToken = process.env.GROUP_API_TOKEN || "";
if (!apiToken) {
    log(null, "Warn: GROUP_API_TOKEN not set, HTTP group API disabled");
}


export interface GroupSnapshotPilot {
    id: api.ID
    name: string
    avatarHash: string
    connected: boolean
    // seconds since the server received the last telemetry
    age: number
    timestamp: api.Timestamp
    lat: number
    lng: number
    alt: number
}

export interface GroupSnapshot {
    group_id: api.ID
    timestamp: api.Timestamp
    pilots: GroupSnapshotPilot[]
    waypoints: api.WaypointsData
}


function sha256(s: string): Buffer {
    return createHash("sha256").update(s).digest();
}

function isAuthorized(req: IncomingMessage): boolean {
    if (!apiToken) return false;
    const header = req.headers["authorization"] || "";
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return false;
    // hash both sides so lengths always match for timingSafeEqual
    return timingSafeEqual(sha256(match[1]), sha256(apiToken));
}

function sendJson(res: ServerResponse, status: number, body: any) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
}


export function getGroupSnapshot(group_id: api.ID): GroupSnapshot | undefined {
    const group = getGroup(group_id);
    if (!group) return undefined;

    const now = Date.now() / 1000;
    const pilots: GroupSnapshotPilot[] = [];

    group.lastKnown.forEach((last, pilot_id) => {
        const age = now - last.received;
        if (age > maxPositionAge) {
            group.lastKnown.delete(pilot_id);
            return;
        }
        const client = getClient(pilot_id);
        const gps = last.telemetry.telemetry?.gps ?? {};
        pilots.push({
            id: pilot_id,
            name: last.name,
            avatarHash: last.avatarHash,
            connected: !!client && client.group_id == group_id,
            age: Math.round(age),
            timestamp: last.telemetry.timestamp,
            lat: gps.lat,
            lng: gps.lng,
            alt: gps.alt,
        });
    });

    return {
        group_id: group_id,
        timestamp: now,
        pilots: pilots,
        waypoints: group.waypoints,
    };
}


export function handleHttp(req: IncomingMessage, res: ServerResponse) {
    try {
        const url = new URL(req.url || "/", "http://localhost");
        const match = /^\/group\/([^/]+)\/?$/.exec(url.pathname);

        if (req.method != "GET" || !match) {
            sendJson(res, 404, { error: "not found" });
            return;
        }

        if (!isAuthorized(req)) {
            sendJson(res, 401, { error: "unauthorized" });
            return;
        }

        const group_id = decodeURIComponent(match[1]);
        if (!groupIdPattern.test(group_id)) {
            sendJson(res, 400, { error: "invalid group_id" });
            return;
        }

        const snapshot = getGroupSnapshot(group_id);
        if (!snapshot) {
            sendJson(res, 404, { error: "group not found" });
            return;
        }

        sendJson(res, 200, snapshot);
    } catch (err) {
        log(null, `Error: HTTP request failed: ${err}`);
        sendJson(res, 500, { error: "internal error" });
    }
}
