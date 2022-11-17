import { SSM } from 'aws-sdk';
import { SHA256 } from 'crypto-js';
import { patreon } from 'patreon';


export class patreonLUT {
    // Table of hashed email+name to lookup pledged tier
    userPledges = undefined
    client: SSM

    constructor() {
        this.client = new SSM({ region: 'us-west-1' }); // Instantiate the SSM client
    }

    async checkHash(hash: string): Promise<string> {
        if (this.userPledges == null) await this._pullPatreonTable();
        return this.userPledges[hash];
    }

    async _getKey() {
        return (await this.client.getParameter({
            Name: 'patreon_key',
            WithDecryption: true // Ensures that SecureString params get decrypted
        }).promise()).Parameter.Value; // Use async/await to synchronously wait for a response.
    }

    async _pullPatreonTable() {
        const patreonAPIClient = patreon(await this._getKey());
        await patreonAPIClient('/campaigns/8686377/pledges')
            .then(({ store }) => {
                let userEmails = {}
                let userNames = {}
                const user = store.findAll('user').map(user => user.serialize())
                user.forEach(element => {
                    userEmails[element.data.id] = element.data.attributes.email;
                    userNames[element.data.id] = element.data.attributes.first_name;
                });
                // console.log("USERSEmails:", usersEmails)

                let rewards = {}
                const reward = store.findAll('reward').map(reward => reward.serialize())
                reward.forEach(element => {
                    rewards[element.data.id] = element.data.attributes.title
                });
                // console.log("REWARDS:", rewards)

                let _userPledges = {}
                const pledge = store.findAll('pledge').map(pledge => pledge.serialize())
                pledge.forEach(element => {
                    const id = element.data.relationships.patron.data.id;
                    let key = SHA256(userEmails[id] + userNames[id]).toString();
                    _userPledges[key] = rewards[element.data.relationships.reward.data.id]
                })
                this.userPledges = _userPledges;

                // console.log("User pledges:", userPledges)
            })
            .catch(err => {
                console.error('error!', err)
            });
    }
}
