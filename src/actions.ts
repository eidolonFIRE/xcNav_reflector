import { v4 as uuidv4 } from "uuid";
import { WebSocket } from 'ws';
import * as _ from "lodash";


import * as api from "./api";
import { db_dynamo } from "./dynamoDB";
import { hash_waypointsData, hash_pilotMeta } from "./apiUtil";
import { patreonLUT } from './patreonLookup';
import { addPilotToGroup, Client, getClient, getGroup, setClient } from "./state";
import { log } from "./logger";




// singleton class representing a db interface
const myDB = new db_dynamo();
const patreon = new patreonLUT();







const sendToOne = (socket: WebSocket, action: string, body: any, to_pilot_id: api.ID) => {
    try {
        log(`${to_pilot_id}) sending: ${JSON.stringify(body)}`);
        socket.send(JSON.stringify({ action: action, body: body }));
    } catch (err) {
        log(`Error: sendTo, general error: ${err}`);
    }
};

const sendToGroup = (group_id: api.ID, action: string, msg: any, fromPilot_id: api.ID, versionFilter: number = undefined) => {
    if (group_id) {
        const group = getGroup(group_id);
        log(`Group ${group_id} has ${group.pilots.size} members`);

        group.pilots.forEach((p: api.ID) => {
            const client = getClient(p);
            if (client) {
                // Skip return to sender
                if (client.pilot.id == fromPilot_id) return;


                // Filter by client version number
                if (versionFilter && client.apiVersion && client.apiVersion < versionFilter) {
                    return;
                }

                if (client.group_id != group_id) {
                    log(`Error: de-sync group_id... ${client.group_id} != ${group_id}`);
                    return;
                }

                sendToOne(client.socket, action, msg, client.pilot.id);
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
    log(`${msg.pilot_id}) Msg: ${msg}`);

    // if no group or invalid group, ignore message
    if (msg.pilot_id == undefined) {
        log("Error: we don't know who this socket belongs to!");
        return;
    }

    if (client.group_id != msg.group_id) {
        log(`Error: ${client.pilot.id}) Tried to send message to group they aren't in! (${client.group_id} != ${msg.group_id})`)
        return;
    }

    // broadcast message to group
    sendToGroup(msg.group_id, "chatMessage", msg, client.pilot.id);
};


// ========================================================================
// handle PilotTelemetry
// ------------------------------------------------------------------------
export const pilotTelemetry = async (client: Client, msg: api.PilotTelemetry) => {
    // Override this to be safe
    msg.pilot_id = client.pilot.id;

    // Only send if recent
    if (msg.timestamp > Date.now() / 1000 - 60 * 5) {
        sendToGroup(client.group_id, "pilotTelemetry", msg, client.pilot.id);
    }
};


// ========================================================================
// handle Full copy of flight plan from client
// ------------------------------------------------------------------------
export const waypointsSync = async (client: Client, msg: api.WaypointsSync) => {
    const group = getGroup(client.group_id);
    group.waypoints = msg.waypoints;

    // relay to the group
    sendToGroup(client.group_id, "waypointsSync", msg, client.pilot.id);
};


// ========================================================================
// handle waypoints Updates
// ------------------------------------------------------------------------
export const waypointsUpdate = async (client: Client, msg: api.WaypointsUpdate) => {
    const group = getGroup(client.group_id);

    log(`${client.pilot.id}) Waypoint Update ${msg}`);

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
        sendToGroup(client.group_id, "waypointsUpdate", msg, client.pilot.id);
    }
};


// ======================================================================== 
// handle waypoint selections
// ------------------------------------------------------------------------
export const pilotSelectedWaypoint = async (client: Client, msg: api.PilotSelectedWaypoint) => {
    const group = getGroup(client.group_id);
    log(`${client.pilot.id}) Waypoint Selection ${msg.waypoint_id}`);
    group.selections[client.pilot.id] = msg.waypoint_id;

    // relay the update to the group
    sendToGroup(client.group_id, "pilotSelectedWaypoint", msg, client.pilot.id);
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
    let newClient: Client = undefined;

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
        log(`Warn: ${request.pilot.id}) invalid secretToken`);
        resp.status = api.ErrorCode.invalid_secretToken;
    } else if (!request.pilot.name || request.pilot.name.length < 2) {
        log(`Warn: ${request.pilot.id}.name == "${request.pilot.name}" (invalid name)`);
        resp.status = api.ErrorCode.missing_data;
    } else {
        // use or create an id
        const pilot_id = request.pilot.id || uuidv4().substr(24);
        log(`${pilot_id}) Authenticated`);

        // Pull the patreon table if it's not already pulled
        resp.tier = await patreon.checkHash(request.tierHash);

        const group_id = request.group_id || uuidv4().substr(0, 8);


        newClient = {
            pilot: {
                id: pilot_id,
                name: request.pilot.name,
                avatarHash: request.pilot.avatarHash,
                secretToken: request.pilot.secretToken || uuidv4(),
            } as api.PilotMeta,
            socket: socket,
            group_id: group_id,
            tier: resp.tier
        } as Client;

        // remember this connection
        setClient(newClient);
        await myDB.pushPilot(
            newClient.pilot,
        );

        if (!addPilotToGroup(pilot_id, group_id)) {
            log(`Warn: ${request.pilot.id}) Failed to join group ${group_id}`);
            resp.status = api.ErrorCode.invalid_id;
        } else {
            // respond success
            resp.status = api.ErrorCode.success;
            resp.secretToken = newClient.pilot.secretToken;
            resp.pilot_id = newClient.pilot.id;
            resp.group_id = newClient.group_id;
            resp.pilotMetaHash = hash_pilotMeta(newClient.pilot);
        }
    }
    sendToOne(socket, "authResponse", resp, resp.pilot_id);
    return newClient;
};


// ========================================================================
// UpdateProfile
// ------------------------------------------------------------------------
export const updateProfileRequest = (client: Client, request: api.UpdateProfileRequest) => {
    if (client.pilot.secretToken != request.pilot.secretToken) {
        // Invalid secret_id
        // Respond Error.
        sendToOne(client.socket, "updateProfileResponse", { status: api.ErrorCode.invalid_secretToken }, client.pilot.id);
    } else if (!request.pilot.name || request.pilot.name.length < 2) {
        // Invalid name
        // Respond Error.
        sendToOne(client.socket, "updateProfileResponse", { status: api.ErrorCode.missing_data }, client.pilot.id);
    } else {
        // update!
        log(`${client.pilot.id}) Updated profile.`);
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
        sendToGroup(client.group_id, "pilotJoinedGroup", notify, client.pilot.id);

        // Respond Success
        sendToOne(client.socket, "updateProfileResponse", { status: api.ErrorCode.success }, client.pilot.id);
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
        selections: {}
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
        resp.selections = group.selections;
    }
    log(`${client.pilot.id}) requested group (${request.group_id}), status: ${resp.status}, pilots: ${resp.pilots}`);
    sendToOne(client.socket, "groupInfoResponse", resp, client.pilot.id);
};


// ========================================================================
// user joins group
// ------------------------------------------------------------------------
export const joinGroupRequest = (client: Client, request: api.JoinGroupRequest) => {
    const resp: api.JoinGroupResponse = {
        status: api.ErrorCode.unknown_error,
        group_id: api.nullID,
    };

    log(`${client.pilot.id}) requesting to join group "${request.group_id}"`)

    const newGroup_id = request.group_id || uuidv4().substr(0, 8);

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

        sendToGroup(resp.group_id, "pilotJoinedGroup", notify, client.pilot.id);
    } else {
        log(`Error: ${client.pilot.id}) Failed to join group ${newGroup_id}`);
    }
    sendToOne(client.socket, "joinGroupResponse", resp, client.pilot.id);
};
