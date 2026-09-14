#!/usr/bin/env node
/**
 * Prove Svix signature verify via official svix package (sign + verify round-trip).
 * Run: node scripts/check-svix-verify.js
 */
const path = require("node:path");
const { Webhook } = require(path.join(__dirname, "..", "forwarder", "node_modules", "svix"));
const handler = require(path.join(__dirname, "..", "forwarder", "api", "index.js"));
const { verifyWebhookSignature } = handler;

const crypto = require("node:crypto");
const key = crypto.randomBytes(32);
const secret = "whsec_" + key.toString("base64");
const id = "msg_test_123";
const timestamp = String(Math.floor(Date.now() / 1000));
const rawBody = JSON.stringify({
  event_type: "message.received",
  event_id: "evt_test",
  message: { from: "Jeff <jhuber@gmail.com>", subject: "hi", text: "hello" },
});

const wh = new Webhook(secret);
const sig = wh.sign(id, new Date(Number(timestamp) * 1000), rawBody);

function fakeReq(headers) {
  return { headers };
}

const ok = verifyWebhookSignature(
  fakeReq({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": sig,
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
    "webhook-signature": sig,
  }),
  rawBody,
  secret
);

// Direct library round-trip (independent of our wrapper)
let libOk = false;
try {
  wh.verify(rawBody, {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": sig,
  });
  libOk = true;
} catch (_) {
  libOk = false;
}

console.log(JSON.stringify({ ok, bad, viaWebhookHeaders, libOk }, null, 2));

if (!ok.ok || bad.ok || !viaWebhookHeaders.ok || !libOk) {
  console.error("FAILED svix verify checks");
  process.exit(1);
}
console.log("OK");
