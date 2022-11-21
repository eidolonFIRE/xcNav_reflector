import { WebSocket } from 'ws';
import { v4 as uuidv4 } from "uuid";
import * as api from "./api";
import { log } from './logger';


export interface Client {
    pilot: api.PilotMeta
    socket: WebSocket
    group_id?: api.ID
    apiVersion?: number
    dateCreated: number
}

export interface Group {
    pilots: Set<api.ID>
    waypoints: api.WaypointsData
    dateCreated: number
}


const _clients: Record<api.ID, Client> = {};
const _groups: Record<api.ID, Group> = {};


// ========================================================================
// Simple Get / Set
// ------------------------------------------------------------------------
export function getGroup(group_id: api.ID): Group {
    return _groups[group_id];
}

export function getClient(pilot_id: api.ID): Client {
    return _clients[pilot_id];
}

export function setClient(client: Client) {
    if (client.pilot.id in _clients) {
        log(client, `Warn: Already has a client.`);
    }
    client.dateCreated = Date.now() / 1000;
    _clients[client.pilot.id] = client;
}

export function clientDropped(client: Client) {
    log(client, `Dropped Connection`);
    // Check if client dropping is an older stale client
    if (client.pilot.id in _clients) {
        if (_clients[client.pilot.id].dateCreated <= client.dateCreated) {
            popPilotFromGroup(client.pilot.id, client.group_id);
            delete _clients[client.pilot.id];
        }
    }
}

export function cleanGroups(beforeDate: number) {
    let markForDelete = [];
    for (const group_id in _groups) {
        // check group is older than cutoff
        if (_groups[group_id].dateCreated > beforeDate) continue;

        // check number of active pilots in group
        let numActive = 0;
        for (const pilot_id in _groups[group_id].pilots) {
            if (pilot_id in _clients && _clients[pilot_id].group_id == group_id) {
                numActive++;
            }
        }
        if (numActive) continue;

        // Mark this one for deletion
        markForDelete.push(group_id);
    }

    // Delete all the marked groups.
    for (const group_id in markForDelete) {
        delete _groups[group_id];
    }
}



// ========================================================================
// Macros
// ------------------------------------------------------------------------
export function newGroupId(): api.ID {
    let group_id: api.ID = api.nullID;
    do {
        group_id = uuidv4().substr(0, 6);
    } while (group_id in _groups);
    return group_id;
}


export function addPilotToGroup(pilot_id: api.ID, group_id: api.ID): boolean {
    if (!pilot_id || !group_id) {
        log(getClient(pilot_id), `Error: Tried to push pilot ${pilot_id} into group ${group_id}`);
        return false;
    }

    if (pilot_id in _clients) {
        if (_clients[pilot_id].group_id && _clients[pilot_id].group_id != group_id) {
            popPilotFromGroup(pilot_id, group_id);
        }
        _clients[pilot_id].group_id = group_id;
    } else {
        log(getClient(pilot_id), `Error: unknown pilot ${pilot_id}`);
        return false;
    }

    if (group_id in _groups) {
        _groups[group_id].pilots.add(pilot_id);
        log(_clients[pilot_id], `Added to group ${group_id} which has ${Array.from(_groups[group_id].pilots).join(", ")}`);
    } else {
        // Create new group if it doesn't exist
        const newGroup: Group = {
            pilots: new Set<api.ID>([pilot_id]),
            waypoints: {},
            dateCreated: Date.now() / 1000
        };
        _groups[group_id] = newGroup;
        log(_clients[pilot_id], `Added to new group ${group_id}`);
    }

    return true;
}


export function popPilotFromGroup(pilot_id: api.ID, group_id: api.ID) {
    // Update Group
    if (group_id in _groups) {


        // Update Group
        if (_groups[group_id].pilots.has(pilot_id)) {
            log(getClient(pilot_id), `Removing from group ${group_id}`);
            _groups[group_id].pilots.delete(pilot_id);

            // Update Pilot
            if (pilot_id in _clients) {
                _clients[pilot_id].group_id = api.nullID;
            }
        } else {
            log(getClient(pilot_id), `Error: Couldn't from group ${group_id}... wasn't actually in that group!`);
        }
    }
}
