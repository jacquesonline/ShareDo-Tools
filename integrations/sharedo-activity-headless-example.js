"use strict";
// node integrations/sharedo-activity-headless-example.js
const createTracker = require("./sharedo-activity-headless");

const tracker = createTracker({
    baseUrl: "http://localhost:3000",
    source: "ShareDo",
    trackingKey: "performance",
    userEmail: "jsteenkamp@mbdts.com.au",
    userId: null,
    userName: null,
    workItemId: "123",
    reference: "ABC-123",
    maxEvents: 10,
    logCheckLimit: 200
});

const intervalMs = 30000;
let timer = null;

async function run() {
    console.log("Starting tracking...");
    const startResult = await tracker.start();
    console.log("Start result:", startResult);

    timer = setInterval(async function () {
        try {
            const eventResult = await tracker.event("heartbeat", {
                page: "sharedo-vnext",
                path: "/work-items/123",
                data: {
                    when: new Date().toISOString(),
                    status: "active"
                }
            });

            console.log("Event result:", eventResult);

            if (eventResult && eventResult.stopped) {
                console.log("Limit reached, stopping interval.");
                clearInterval(timer);
                timer = null;
            }

            if (eventResult && eventResult.skipped && eventResult.reason === "recording-not-started") {
                console.log("Recording is not active, stopping interval.");
                clearInterval(timer);
                timer = null;
            }
        } catch (err) {
            console.error("Event error:", err.message || err);
            clearInterval(timer);
            timer = null;
        }
    }, intervalMs);
}

process.on("SIGINT", async function () {
    console.log("Stopping tracking...");
    try {
        const stopResult = await tracker.stop();
        console.log("Stop result:", stopResult);
    } catch (err) {
        console.error("Stop error:", err.message || err);
    } finally {
        if (timer) clearInterval(timer);
        process.exit(0);
    }
});

run().catch(async function (err) {
    console.error("Run error:", err.message || err);
    try {
        await tracker.stop();
    } catch (e) {}
    process.exit(1);
});
