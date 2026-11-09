import * as Actions from './actions';
import { config } from 'aws-sdk';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Client, clientDropped } from './state';
import { handleHttp } from './httpApi';
import { log } from './logger';


config.update({ region: "us-west-1" });

// Plain HTTP requests go to the read-only group API, upgrades go to the websocket.
const httpServer = createServer(handleHttp);
const server = new WebSocketServer({ server: httpServer });
// Only reachable through the nginx proxy
httpServer.listen(8088, "127.0.0.1");


server.on('connection', function (socket) {
    let client: Client = undefined;

    socket.on('message', function (msg_raw) {
        const msg = JSON.parse(msg_raw.toString());

        // Special handler for authentication request
        if (msg.action == "authRequest") {
            Actions.authRequest(msg.body, socket).then((newClient) => { client = newClient });
        } else {
            // Handle all the various messages
            if (client) {
                switch (msg.action) {
                    case "updateProfile":
                        Actions.updateProfileRequest(client, msg.body);
                        break;
                    case "chatMessage":
                        Actions.chatMessage(client, msg.body);
                        break;
                    case "pilotTelemetry":
                        Actions.pilotTelemetry(client, msg.body);
                        break;
                    case "groupInfoRequest":
                        Actions.groupInfoRequest(client, msg.body);
                        break;
                    case "joinGroupRequest":
                        Actions.joinGroupRequest(client, msg.body);
                        break;
                    case "waypointsSync":
                        Actions.waypointsSync(client, msg.body);
                        break;
                    case "waypointsUpdate":
                        Actions.waypointsUpdate(client, msg.body);
                        break;
                    case "pilotSelectedWaypoint":
                        Actions.pilotSelectedWaypoint(client, msg.body);
                        break;
                    case "airplanesObserved":
                        Actions.airplanesObserved(client, msg.body);
                        break;

                    default:
                        log(client, `Error: Unhandled action: ${msg}`);
                        break;
                }
            } else {
                log(null, `Error: Unhandled action because no authorized client: ${msg}`);
            }
        }
    });

    // When a socket closes, or disconnects, remove it from the array.
    socket.on('close', function () {
        if (client) {
            clientDropped(client);
        }
    });
});
