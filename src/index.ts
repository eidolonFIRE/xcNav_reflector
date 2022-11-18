import * as Actions from './actions';
import { config } from 'aws-sdk';
import { WebSocketServer, WebSocket } from 'ws';
import { Client, clientDropped } from './state';
import { log } from './logger';


config.update({ region: "us-west-1" });

const server = new WebSocketServer({
    port: 8088
});


server.on('connection', function (socket) {
    let client: Client = undefined;

    socket.on('message', function (msg_raw) {
        const msg = JSON.parse(msg_raw.toString());

        log("Client Connected");


        // Special handler for authentication request
        if (msg.action == "authRequest" && !client) {
            Actions.authRequest(msg.body, socket).then((newClient) => { client = newClient });
        } else {
            // Handle all the various messages
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

                default:
                    console.error(`Unhandled action: ${msg}`);
                    break;
            }
        }
    });

    // When a socket closes, or disconnects, remove it from the array.
    socket.on('close', function () {
        if (client) {
            clientDropped(client.pilot.id);
        }
    });
});
