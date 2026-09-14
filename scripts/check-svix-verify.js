#!/usr/bin/env node
/**
 * Prove Svix-style signature verify accepts svix-* headers.
 * Run: node scripts/check-svix-verify.js
 */
const crypto = require("node:crypto");
const path = require("node:path");
const handler = require(path.join(__dirname, "..", "forwarder", "api", "index.js"));
const { verifyWebhookSignature } = handler;

const key = crypto.randomBytes(32);
const secret = "whsec_" + key.toString("base64");
const id = "msg_test_123";
const timestamp = String(Math.floor(Date.now() / 1000));
const rawBody = JSON.stringify({
  event_type: "message.received",
  event_id: "evt_test",
  message: { from: "Jeff <jhuber@gmail.com>", subject: "hi", text: "hello" },
});

const signedContent = `${id}.${timestamp}.${rawBody}`;
const sig = crypto.createHmac("sha256", key).update(signedContent, "utf8").digest("base64");

function fakeReq(headers) {
  return { headers };
}

const ok = verifyWebhookSignature(
  fakeReq({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${sig}`,
  }),
  rawBody,
  secret
);

const bad = verifyWebhookSignature(
  fakeReq({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  }),
  rawBody,
  secret
);

const viaWebhookHeaders = verifyWebhookSignature(
  fakeReq({
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${sig}`,
  }),
  rawBody,
  secret
);

console.log(JSON.stringify({ ok, bad, viaWebhookHeaders }, null, 2));

if (!ok.ok || bad.ok || !viaWebhookHeaders.ok) {
  console.error("FAILED svix verify checks");
  process.exit(1);
}
console.log("OK");
