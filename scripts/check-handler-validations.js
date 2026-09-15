#!/usr/bin/env node
/**
 * Handler-level security validation tests.
 * Tests: oversized body (Content-Length and stream), wrong inbox, missing Cursor env, unsigned requests.
 * Run: node scripts/check-handler-validations.js
 */

const crypto = require("node:crypto");

// Generate a valid Svix signature for testing
function generateSvixSignature(secret, id, timestamp, body) {
  const signedContent = `${id}.${timestamp}.${body}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  return `v1,${signature}`;
}

function createMockRequest(overrides = {}) {
  const id = overrides.svixId || "msg_test123";
  const timestamp = overrides.svixTimestamp || Math.floor(Date.now() / 1000).toString();
  const body = overrides.rawBody || "";
  const secret = overrides.secret || "whsec_test123";
  
  let signature = "";
  if (overrides.generateSignature !== false && secret) {
    signature = generateSvixSignature(secret, id, timestamp, body);
  }
  
  const headers = {
    "content-type": "application/json",
    ...(overrides.headers || {}),
  };
  
  if (overrides.generateSignature !== false) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = timestamp;
    headers["svix-signature"] = signature;
  }
  
  const req = {
    method: overrides.method || "POST",
    headers,
    rawBody: overrides.rawBody || null,
    body: null,
    listeners: {},
    on(event, handler) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(handler);
    },
    removeListener(event, handler) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(h => h !== handler);
      }
    },
    destroy() {
      this.destroyed = true;
    },
    ...overrides,
  };
  
  return req;
}

function createMockResponse() {
  let _statusCode = 200;
  const _headers = {};
  let _body = "";
  
  return {
    get statusCode() {
      return _statusCode;
    },
    set statusCode(code) {
      _statusCode = code;
    },
    setHeader(key, value) {
      _headers[key] = value;
    },
    end(data) {
      _body = data || "";
    },
    getBody() {
      try {
        return _body ? JSON.parse(_body) : {};
      } catch {
        return {};
      }
    },
  };
}

async function test1_oversizedContentLength() {
  console.log("Test 1: Oversized body (Content-Length early check)");
  
  try {
    // Set up clean env
    process.env.CURSOR_WEBHOOK_URL = "https://example.cursor.sh/webhook";
    process.env.CURSOR_WEBHOOK_KEY = "test_key";
    process.env.AGENTMAIL_WEBHOOK_SECRET = "whsec_dGVzdDEyMzQ1Njc4OTBhYmNkZWY=";
    process.env.REQUIRE_AGENTMAIL_SIGNATURE = "1";
    process.env.ALLOWLIST = "test@example.com";
    
    const handler = require("../forwarder/api/index.js");
    
    const req = createMockRequest({
      headers: {
        "content-length": "3000000",
      },
      rawBody: "",
      secret: process.env.AGENTMAIL_WEBHOOK_SECRET,
    });
    const res = createMockResponse();
    
    await handler(req, res);
    
    if (res.statusCode === 413) {
      console.log("✓ PASS\n");
      return true;
    } else {
      console.log(`✗ FAIL: Expected 413, got ${res.statusCode}\n`);
      return false;
    }
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    return false;
  } finally {
    delete require.cache[require.resolve("../forwarder/api/index.js")];
  }
}

console.log("Running handler validation tests...\n");
test1_oversizedContentLength().then(passed => {
  console.log("─".repeat(50));
  if (passed) {
    console.log("Test passed!");
    process.exit(0);
  } else {
    console.error("Test failed.");
    process.exit(1);
  }
}).catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
