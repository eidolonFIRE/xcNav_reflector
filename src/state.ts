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
    dateCreated?: number
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

function setGroup(group_id: api.ID, group: Group) {
    group.dateCreated = Date.now() / 1000;
    _groups[group_id] = group;
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
    const client = getClient(pilot_id);
    if (client != undefined) {
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

    const group = getGroup(group_id);
    if (!group) {
        // Create new group if it doesn't exist
        const newGroup: Group = {
            pilots: new Set([pilot_id]),
            waypoints: {},
            selections: {}
        };
        setGroup(group_id, newGroup);
        log(`Added pilot: ${pilot_id} to new group ${group_id}`);
    } else {
        log(`Added pilot: ${pilot_id} to group ${group_id} (${group.pilots})`);
        group.pilots.add(pilot_id);
    }

    const client = getClient(pilot_id);
    if (client) {
        if (client.group_id) {
            popPilotFromGroup(pilot_id, group_id);
        }
        client.group_id = group_id;
    } else {
        log(`Error: unknown pilot ${pilot_id}`);
        return false;
    }

    return true;
}


export function popPilotFromGroup(pilot_id: api.ID, group_id: api.ID) {
    // Update Group

    const group = getGroup(group_id);
    if (group != undefined) {

        // Update Group
        group.pilots.delete(pilot_id);

        // Update Pilot
        const client = getClient(pilot_id);

        client.group_id = api.nullID;
    }
}
