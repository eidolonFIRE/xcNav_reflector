import * as api from "./api";


// Custom high-speed dirty hash for checking waypoints changes
export function hash_waypointsData(plan: api.WaypointsData): string {
    // build long string
    let str = "Plan";
    Object.keys(plan).forEach((wp, i) => {
        str += wp + plan[wp].name + (plan[wp].icon ?? "") + (plan[wp].color ?? "");
        plan[wp].latlng.forEach((g) => {
            // large tolerance for floats
            str += g[0].toFixed(5) + g[1].toFixed(5);
        });
    });

    // fold string into hash
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash &= 0xffffff;
    }
    return (hash < 0 ? hash * -2 : hash).toString(16);
}

// Custom high-speed dirty hash
export function hash_pilotMeta(pilot: api.PilotMeta): string {
    // build long string
    const str = "Meta" + (pilot.name || "") + (pilot.id || "") + (pilot.avatarHash || "") + (pilot.tier || "");

    // fold string into hash
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash &= 0xffffff;
    }
    return (hash < 0 ? hash * -2 : hash).toString(16);
}
