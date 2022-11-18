import { WebSocket } from 'ws';

import * as api from "./api";
import { log } from './logger';


export interface Client extends api.PilotMeta {
    pilot: api.PilotMeta
    socket: WebSocket
    group_id?: api.ID
    apiVersion?: number
    dateCreated?: number
}

export interface Group {
    pilots: Set<api.ID>
    waypoints: api.WaypointsData
    selections: api.PilotWaypointSelections
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
        log(`Warn: Already have client for ${client.pilot.id}`);
    } else {
        client.dateCreated = Date.now() / 1000;
        _clients[client.pilot.id] = client;
    }
}

export function clientDropped(pilot_id: api.ID) {
    if (pilot_id in _clients) {
        delete _clients[pilot_id];
    }
}



// ========================================================================
// Macros
// ------------------------------------------------------------------------
export function addPilotToGroup(pilot_id: api.ID, group_id: api.ID): boolean {
    if (!pilot_id || !group_id) {
        log(`Error: Tried to push pilot ${pilot_id} into group ${group_id}`);
        return false;
    }

    if (pilot_id in _clients) {
        if (_clients[pilot_id].group_id) {
            popPilotFromGroup(pilot_id, group_id);
        }
        _clients[pilot_id].group_id = group_id;
    } else {
        log(`Error: unknown pilot ${pilot_id}`);
        return false;
    }

    if (group_id in _groups) {
        _groups[group_id].pilots.add(pilot_id);
        log(`Added pilot: ${pilot_id} to group ${group_id} which has ${Array.from(_groups[group_id].pilots)}`);
    } else {
        // Create new group if it doesn't exist
        const newGroup: Group = {
            pilots: new Set<api.ID>([pilot_id]),
            waypoints: {},
            selections: {},
            dateCreated: Date.now() / 1000
        };
        _groups[group_id] = newGroup;
        log(`Added pilot: ${pilot_id} to new group ${group_id}`);
    }

    return true;
}


export function popPilotFromGroup(pilot_id: api.ID, group_id: api.ID) {
    // Update Group
    if (group_id in _groups) {
        log(`Removing pilot ${pilot_id} from group ${group_id}`);

        // Update Group
        _groups[group_id].pilots.delete(pilot_id);

        // Update Pilot
        if (pilot_id in _clients) {
            _clients[pilot_id].group_id = api.nullID;
        }
    }
}
