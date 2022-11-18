import { SSM, CloudWatchLogs } from 'aws-sdk';


async function getSSMParameterByName(name) {
    let ssm = new SSM();
    return new Promise((resolve, reject) => {
        ssm.getParameter({ Name: name }, function (err, data) {
            if (err) reject(err);
            resolve(data.Parameter.Value);
        });
    });
}

function cloudWatchPutLogEvents(events, group, stream, sequenceToken): Promise<CloudWatchLogs.PutLogEventsResponse> {
    return new Promise((resolve, reject) => {
        const cloudwatchlogs = new CloudWatchLogs();
        var params = {
            logEvents: events,
            logGroupName: group,
            logStreamName: stream,
            sequenceToken: sequenceToken
        } as CloudWatchLogs.PutLogEventsRequest;
        cloudwatchlogs.putLogEvents(params, function (err, data) {
            if (err) reject(err);
            resolve(data);
        });
    });
}

function cloudWatchDescribeLogStreams(group): Promise<CloudWatchLogs.DescribeLogStreamsResponse> {
    return new Promise((resolve, reject) => {
        const cloudwatchlogs = new CloudWatchLogs();
        var params = {
            logGroupName: group,
        };
        cloudwatchlogs.describeLogStreams(params, function (err, data) {
            if (err) reject(err);
            resolve(data);
        });
    });
}




let nextSequenceToken = null; // need this for sending log to AWS. Will update after each request.
let eventsQueue = [];
let interval = null; // use a queue to send log to couldWatch one at a time to avoid throttling
async function startLogQueueToCloudWatch() {
    if (interval == null) {
        interval = setInterval(async () => {
            if (eventsQueue.length == 0) {
                clearInterval(interval);
                interval = null;
                return;
            } let event = eventsQueue.shift();
            try {
                // log(event);
                let res = await cloudWatchPutLogEvents(
                    [event],
                    "server_2",
                    "prod",
                    nextSequenceToken
                );
                nextSequenceToken = res.nextSequenceToken; // store the new sequence token
            } catch (error) { // to allow retry
                log(error);
            }

        }, 1000);
    }
}

export async function log(message) {
    log(message);
    if (nextSequenceToken == null) {
        // just ran server, get the token from AWS
        let res = await cloudWatchDescribeLogStreams("server_2");
        nextSequenceToken = res.logStreams[0].uploadSequenceToken;
    }
    eventsQueue.push({
        message: message,
        timestamp: (new Date()).getTime()
    });
    await startLogQueueToCloudWatch();
}
