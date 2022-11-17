import * as api from "./api";
import { DynamoDB } from 'aws-sdk';


export class db_dynamo {

    db: DynamoDB.DocumentClient

    constructor() {
        this.db = new DynamoDB.DocumentClient({ region: 'us-west-1' });
    }

    // ========================================================================
    // dynamoDB getters
    // ------------------------------------------------------------------------
    async fetchPilot(pilot_id: api.ID): Promise<api.PilotMeta> {
        if (pilot_id != undefined) {
            const _p = (await this.db.get({
                TableName: "Pilots",
                Key: { id: pilot_id },
            }).promise()).Item as api.PilotMeta;
            return _p;
        } else {
            return undefined;
        }
    }

    // ========================================================================
    // dynamoDB setters
    // ------------------------------------------------------------------------
    async pushPilot(pilot: api.PilotMeta) {
        await this.db.put({
            TableName: "Pilots",
            Item: {
                id: pilot.id,
                name: pilot.name,
                avatarHash: pilot.avatarHash,
                secretToken: pilot.secretToken,
                tier: pilot.tier,
                expires: Date.now() / 1000 + 120 * 24 * 60 * 60, // 120 days
            }
        }, function (err, data) {
            if (err) console.log(err);
        });
    }
}
