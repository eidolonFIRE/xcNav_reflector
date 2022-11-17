// |  /!\ This must be incrimented each meaningful change to the protocol.
// | 
// |  TODO: Version is incrimented manually for now, but in the future we should use formal versioning.
// |  https://gitversion.readthedocs.io/en/latest/input/docs/configuration/
export const apiVersion = 6.0;



// ############################################################################ 
//
//     Primative Types
//
// ############################################################################

// UTC time since Unix epoch in milliseconds
export type Timestamp = number;

export interface Duration {
    start: Timestamp
    end: Timestamp
}

export interface Telemetry {
    gps: any
}

export type ID = string;
export const nullID = "";


export interface PilotMeta {
    id: ID
    name: string
    avatarHash: string
    secretToken?: ID
    tier?: string
}

export interface Waypoint {
    id: ID
    name: string
    latlng: number[][]
    icon?: string
    color?: number
    length?: number
}

export type WaypointsData = Record<ID, Waypoint>;

export enum ErrorCode {
    success = 0,
    unknown_error = 1,
    invalid_id,             // invalid "pilot_id" or "group"
    invalid_secretToken,
    denied_group_access,    // IE. making requests for a group you aren't in
    missing_data,           // essential message data was left null
    no_op,                  // No change / Nothing to do (example: leaving group when you aren't in a group)
    // ... add more as needed
}

export enum WaypointAction {
    none = 0,
    update,
    delete,
}


// ############################################################################ 
//
//     Bi-directional
//
// ############################################################################

export interface ChatMessage {
    timestamp: Timestamp
    group_id: ID // target group
    pilot_id: ID // sender
    text: string
    emergency: boolean
}

export interface PilotTelemetry {
    timestamp: Timestamp
    pilot_id: ID
    telemetry: Telemetry
}

export interface NewMapLayer {
    owner: ID    // author pilot_id
    name: string
    data: string // json kml
}

export interface RemoveMapLayer {
    owner: ID
    name: string
}

// full sync of waypoints  data
export interface WaypointsSync {
    timestamp: Timestamp
    waypoints: WaypointsData
}

// update an individual waypoint
export interface WaypointsUpdate {
    timestamp: Timestamp
    hash: string
    action: WaypointAction
    waypoint: Waypoint
}

export type PilotWaypointSelections = Record<ID, ID>;

export interface PilotSelectedWaypoint {
    waypoint_id: ID
}



// ############################################################################ 
//
//     Server Notifications
//
// ############################################################################
export interface PilotJoinedGroup {
    pilot: PilotMeta
}

export interface PilotLeftGroup {
    pilot_id: ID
}



// ############################################################################ 
//
//     Server Requests 
//
// ############################################################################

// ============================================================================
// Client request to authenticate. If client already holds a secretToken, this is how to
// request access to the server API, authenticating the client. When client doesn't yet hold
// a valid secretToken, this is how to have one issued by the server.
//
// - If pilot is not yet registered with this server, request will fail.
// ----------------------------------------------------------------------------
export interface AuthRequest {
    secretToken: ID
    pilot: PilotMeta
    group_id: ID
    tier_hash?: string
    apiVersion: number
}

export interface AuthResponse {
    status: ErrorCode
    secretToken: ID  // private key
    pilot_id: ID   // public key
    pilotMetaHash: string
    group: ID
    tier?: string
    apiVersion: number
}

// ============================================================================
// Client request update user information.
// ----------------------------------------------------------------------------
export interface UpdateProfileRequest {
    pilot: PilotMeta
    secretToken: ID
}

export interface UpdateProfileResponse {
    status: ErrorCode
}


// ============================================================================
// Client request information on a group.
// ----------------------------------------------------------------------------
export interface GroupInfoRequest {
    group: ID
}

export interface GroupInfoResponse {
    status: ErrorCode
    group: ID
    pilots: PilotMeta[]
    waypoints: WaypointsData
    selections: PilotWaypointSelections
}

// ============================================================================
// Client request to join a group
//
// ----------------------------------------------------------------------------
export interface JoinGroupRequest {
    group_id: ID
}

export interface JoinGroupResponse {
    status: ErrorCode
    group_id: ID
}
