import { v4 as uuidv4 } from "uuid";
import { WebSocket } from 'ws';
import * as _ from "lodash";


import * as api from "./api";
import { db_dynamo } from "./dynamoDB";
import { hash_waypointsData, hash_pilotMeta } from "./apiUtil";
import { patreonLUT } from './patreonLookup';
import { addPilotToGroup, Client, getClient, getGroup, newGroupId, popPilotFromGroup, setClient } from "./state";
import { log } from "./logger";




// singleton class representing a db interface
const myDB = new db_dynamo();
const patreon = new patreonLUT();







const sendToOne = (client: Client, action: string, body: any) => {
    try {
        // log(`${to_pilot_id}) sending: ${JSON.stringify(body)}`);
        client.socket.send(JSON.stringify({ action: action, body: body }));
    } catch (err) {
        log(client, `Error: TX general error: ${err}`);
    }
};

const sendToGroup = (fromClient: Client, action: string, msg: any, versionFilter: number = undefined) => {
    if (fromClient.group_id) {
        const group = getGroup(fromClient.group_id);
        // log(`Group ${group_id} has ${group.pilots.size} members`);

        group.pilots.forEach((tx_pilot_id: api.ID) => {
            const txClient = getClient(tx_pilot_id);
            if (txClient) {
                // Skip return to sender
                if (txClient.pilot.id == fromClient.pilot.id) return;

                // Filter by client version number
                if (versionFilter && txClient.apiVersion && txClient.apiVersion < versionFilter) {
                    return;
                }

                if (txClient.group_id != fromClient.group_id) {
                    log(txClient, `Error: de-sync group_id for pilot... ${txClient.group_id} != ${fromClient.group_id}`);
                    popPilotFromGroup(txClient.pilot.id, fromClient.group_id);
                    return;
                }

                sendToOne(txClient, action, msg);
            }
        });
    }
};



// ############################################################################ 
//
//     Handle Bi-Directional Messages 
//
// ############################################################################

// ========================================================================
// handle chatMessage
// ------------------------------------------------------------------------
export const chatMessage = async (client: Client, msg: api.ChatMessage) => {
    // fill in who message came from
    msg.pilot_id = client.pilot.id;
    log(client, `Chat: ${msg.text}`);

    // if no group or invalid group, ignore message
    if (msg.pilot_id == undefined) {
        log(client, "Error: we don't know who this socket belongs to!");
        return;
    }

    // broadcast message to group
    sendToGroup(client, "chatMessage", msg);
};


// ========================================================================
// handle PilotTelemetry
// ------------------------------------------------------------------------
export const pilotTelemetry = async (client: Client, msg: api.PilotTelemetry) => {
    // Override this to be safe
    msg.pilot_id = client.pilot.id;

    // Only send if recent
    if (msg.timestamp > Date.now() / 1000 - 60 * 5) {
        sendToGroup(client, "pilotTelemetry", msg);
    }
};


// ========================================================================
// handle Full copy of flight plan from client
// ------------------------------------------------------------------------
export const waypointsSync = async (client: Client, msg: api.WaypointsSync) => {
    const group = getGroup(client.group_id);
    group.waypoints = msg.waypoints;

    // relay to the group
    sendToGroup(client, "waypointsSync", msg);
};


// ========================================================================
// handle waypoints Updates
// ------------------------------------------------------------------------
export const waypointsUpdate = async (client: Client, msg: api.WaypointsUpdate) => {
    const group = getGroup(client.group_id);

    log(client, `Waypoint Update ${msg}`);

    // make backup copy of the plan
    const waypoints = group.waypoints || {};
    const backup = _.cloneDeep(waypoints);

    let should_notify = true;

    // update the plan
    switch (msg.action) {
        case api.WaypointAction.delete:
            // Delete a waypoint
            delete waypoints[msg.waypoint.id];
            break;
        case api.WaypointAction.update:
            // Modify a waypoint
            if (msg.waypoint != null) {
                waypoints[msg.waypoint.id] = msg.waypoint;
            } else {
                should_notify = false;
            }
            break;
        case api.WaypointAction.none:
            // no-op
            should_notify = false;
            break;
    }

    // TODO: hash check disabled for now
    // const hash = hash_waypointsData(waypoints);
    // if (hash != msg.hash) {
    //     // DE-SYNC ERROR
    //     // restore backup
    //     log(`${client.pilot_id}) waypoints Desync`, hash, msg.hash, waypoints);

    //     // assume the client is out of sync, return a full copy of the plan
    //     const notify: api.WaypointsSync = {
    //         timestamp: Date.now(),
    //         // hash: hash_waypointsData(backup),
    //         waypoints: backup,
    //     }
    //     sendToOne(socket, "waypointsSync", notify);
    // } else 
    if (should_notify) {
        // push modified plan back to db
        group.waypoints = waypoints;

        // relay the update to the group
        sendToGroup(client, "waypointsUpdate", msg);
    }
};


// ======================================================================== 
// handle waypoint selections
// ------------------------------------------------------------------------
export const pilotSelectedWaypoint = async (client: Client, msg: api.PilotSelectedWaypoint) => {
    const group = getGroup(client.group_id);
    log(client, `Waypoint Selection ${msg.waypoint_id}`);

    // relay the update to the group
    sendToGroup(client, "pilotSelectedWaypoint", msg);
};





// ############################################################################ 
//
//     Handle Client Requests 
//
// ############################################################################


// ========================================================================
// Authentication
// ------------------------------------------------------------------------
export const authRequest = async (request: api.AuthRequest, socket: WebSocket): Promise<Client> => {
    let newClient: Client = {
        pilot: {
            name: api.nullID,
            id: api.nullID,
            avatarHash: "",
        },
        socket: socket,
        dateCreated: Date.now() / 1000
    };

    const resp: api.AuthResponse = {
        status: api.ErrorCode.unknown_error,
        secretToken: api.nullID,
        pilot_id: request.pilot.id,
        pilotMetaHash: "",
        apiVersion: api.apiVersion,
        group_id: api.nullID,
    };

    const pilot = await myDB.fetchPilot(request.pilot.id);
    if (pilot && pilot.secretToken && pilot.secretToken != request.pilot.secretToken) {
        log(null, `Warn: id=${request.pilot.id} invalid secretToken`);
        resp.status = api.ErrorCode.invalid_secretToken;
    } else if (!request.pilot.name || request.pilot.name.length < 2) {
        log(null, `Warn: id${request.pilot.id}.name == "${request.pilot.name}" (invalid name)`);
        resp.status = api.ErrorCode.missing_data;
    } else {
        // use or create an id
        const pilot_id: api.ID = request.pilot.id || uuidv4().substr(24);

        // Pull the patreon table if it's not already pulled
        resp.tier = await patreon.checkHash(request.tierHash);

        const group_id = request.group_id || newGroupId();

        newClient = {
            pilot: {
                id: pilot_id,
                name: request.pilot.name,
                avatarHash: request.pilot.avatarHash,
                secretToken: request.pilot.secretToken || uuidv4(),
                tier: resp.tier,
            },
            socket: socket,
            group_id: api.nullID, // (We are not yet in the group)
            dateCreated: Date.now() / 1000
        };

        // remember this connection
        setClient(newClient);
        await myDB.pushPilot(
            newClient.pilot,
        );

        if (!addPilotToGroup(pilot_id, group_id)) {
            log(newClient, `Error: Failed to join group ${group_id}`);
            resp.status = api.ErrorCode.invalid_id;
        } else {
            // respond success
            resp.status = api.ErrorCode.success;
            resp.secretToken = newClient.pilot.secretToken;
            resp.pilot_id = newClient.pilot.id;
            resp.group_id = newClient.group_id;
            resp.pilotMetaHash = hash_pilotMeta(newClient.pilot);
        }

        log(newClient, `Authenticated`);
    }
    sendToOne(newClient, "authResponse", resp);
    return newClient;
};


// ========================================================================
// UpdateProfile
// ------------------------------------------------------------------------
export const updateProfileRequest = (client: Client, request: api.UpdateProfileRequest) => {
    if (client.pilot.secretToken != request.pilot.secretToken) {
        // Invalid secret_id
        // Respond Error.
        sendToOne(client, "updateProfileResponse", { status: api.ErrorCode.invalid_secretToken });
    } else if (!request.pilot.name || request.pilot.name.length < 2) {
        // Invalid name
        // Respond Error.
        sendToOne(client, "updateProfileResponse", { status: api.ErrorCode.missing_data });
    } else {
        // update!
        log(client, `Updated profile.`);
        client.pilot.name = request.pilot.name;
        client.pilot.avatarHash = request.pilot.avatarHash;
        // Save to db
        myDB.pushPilot(client.pilot);

        // notify group of pilot update
        const notify: api.PilotJoinedGroup = {
            pilot: {
                id: client.pilot.id,
                name: client.pilot.name,
                avatarHash: client.pilot.avatarHash,
            }
        };
        sendToGroup(client, "pilotJoinedGroup", notify);

        // Respond Success
        sendToOne(client, "updateProfileResponse", { status: api.ErrorCode.success });
    }
};


// ========================================================================
// Get Group Info
// ------------------------------------------------------------------------
export const groupInfoRequest = async (client: Client, request: api.GroupInfoRequest) => {
    const resp: api.GroupInfoResponse = {
        status: api.ErrorCode.unknown_error,
        group_id: request.group_id,
        pilots: [],
        waypoints: {},
    };

    const group = getGroup(request.group_id);
    if (group) {
        // Respond Success
        resp.status = api.ErrorCode.success;
        let all: Promise<void>[] = [];
        group.pilots.forEach((p: api.ID) => {
            all.push(new Promise<void>(async (resolve) => {
                // Check localstate first...
                const otherClient = getClient(p);
                if (otherClient) {
                    resp.pilots.push({
                        id: p,
                        name: otherClient.pilot.name,
                        avatarHash: otherClient.pilot.avatarHash,
                        tier: otherClient.pilot.tier
                    });
                } else {
                    // Fetch pilot info from DB
                    const pilot = await myDB.fetchPilot(p);
                    if (pilot != undefined) {
                        resp.pilots.push({
                            id: p,
                            name: pilot.name,
                            avatarHash: pilot.avatarHash,
                            tier: pilot.tier
                        } as api.PilotMeta);
                    }
                }
                resolve();
            }));
        });
        await Promise.all(all);
        resp.waypoints = group.waypoints;
    }
    log(client, `Requested group (${request.group_id}), status: ${resp.status}, pilots: ${Array.from(resp.pilots).join(", ")}`);
    sendToOne(client, "groupInfoResponse", resp);
};


// ========================================================================
// user joins group
// ------------------------------------------------------------------------
export const joinGroupRequest = (client: Client, request: api.JoinGroupRequest) => {
    const resp: api.JoinGroupResponse = {
        status: api.ErrorCode.unknown_error,
        group_id: api.nullID,
    };

    log(client, `Requesting to join group "${request.group_id}"`)

    const newGroup_id = request.group_id || newGroupId();

    if (addPilotToGroup(client.pilot.id, newGroup_id)) {
        resp.status = api.ErrorCode.success;
        resp.group_id = client.group_id;

        // notify group there's a new pilot
        const notify: api.PilotJoinedGroup = {
            pilot: {
                id: client.pilot.id,
                name: client.pilot.name,
                avatarHash: client.pilot.avatarHash,
            }
        };

        sendToGroup(client, "pilotJoinedGroup", notify);
    } else {
        log(client, `Error: Failed to join group ${newGroup_id}`);
    }
    sendToOne(client, "joinGroupResponse", resp);
};
