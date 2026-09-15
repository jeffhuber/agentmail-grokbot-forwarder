#!/usr/bin/env node
/**
 * Handler-level security validation tests.
 * Tests: oversized body (Content-Length + stream), inbox mismatch, missing Cursor env, unsigned.
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
  const secret = overrides.secret || "whsec_dGVzdDEyMzQ1Njc4OTBhYmNkZWY=";
  
  let signature = "";
  if (overrides.includeSignature !== false && secret) {
    signature = generateSvixSignature(secret, id, timestamp, body);
  }
  
  const headers = {
    "content-type": "application/json",
    ...(overrides.headers || {}),
  };
  
  if (overrides.includeSignature !== false) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = timestamp;
    headers["svix-signature"] = signature;
  }
  
  const req = {
    method: overrides.method || "POST",
    headers,
    rawBody: overrides.rawBody !== undefined ? overrides.rawBody : null,
    body: null,
    listeners: {},
    destroyed: false,
    on(event, handler) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(handler);
      return this;
    },
    removeListener(event, handler) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(h => h !== handler);
      }
      return this;
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
      console.log("✓ PASS: Returns 413\n");
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

async function test2_streamOverflow() {
  console.log("Test 2: Oversized body (stream overflow without Content-Length)");
  
  try {
    process.env.CURSOR_WEBHOOK_URL = "https://example.cursor.sh/webhook";
    process.env.CURSOR_WEBHOOK_KEY = "test_key";
    process.env.AGENTMAIL_WEBHOOK_SECRET = "whsec_dGVzdDEyMzQ1Njc4OTBhYmNkZWY=";
    process.env.REQUIRE_AGENTMAIL_SIGNATURE = "1";
    process.env.ALLOWLIST = "test@example.com";
    
    const handler = require("../forwarder/api/index.js");
    
    // Force streaming path: no Content-Length, no rawBody
    const largeBody = "x".repeat(2_500_000);
    const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
    const id = "msg_overflow";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    const req = createMockRequest({
      rawBody: null,
      includeSignature: false,
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": generateSvixSignature(secret, id, timestamp, largeBody),
      },
    });
    
    const res = createMockResponse();
    
    const handlerPromise = handler(req, res);
    
    // Simulate streaming large chunks
    setImmediate(() => {
      if (req.listeners.data && req.listeners.data.length > 0) {
        const chunkSize = 1_000_000;
        for (let i = 0; i < 3; i++) {
          if (req.destroyed) break;
          const chunk = "x".repeat(chunkSize);
          req.listeners.data.forEach(h => h(Buffer.from(chunk)));
        }
        if (!req.destroyed && req.listeners.end && req.listeners.end.length > 0) {
          req.listeners.end.forEach(h => h());
        }
      }
    });
    
    await handlerPromise;
    
    if (res.statusCode === 413 || req.destroyed) {
      console.log("✓ PASS: Stream overflow handled (413 or destroyed)\n");
      return true;
    } else {
      console.log(`✗ FAIL: Expected 413 or destroy, got ${res.statusCode}, destroyed=${req.destroyed}\n`);
      return false;
    }
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    return false;
  } finally {
    delete require.cache[require.resolve("../forwarder/api/index.js")];
  }
}

async function test3_wrongInbox() {
  console.log("Test 3: Wrong inbox ID (with valid Svix signature)");
  
  try {
    process.env.CURSOR_WEBHOOK_URL = "https://example.cursor.sh/webhook";
    process.env.CURSOR_WEBHOOK_KEY = "test_key";
    process.env.AGENTMAIL_WEBHOOK_SECRET = "whsec_dGVzdDEyMzQ1Njc4OTBhYmNkZWY=";
    process.env.REQUIRE_AGENTMAIL_SIGNATURE = "1";
    process.env.ALLOWLIST = "test@example.com";
    process.env.AGENTMAIL_INBOX_ID = "inbox_expected123";
    
    const handler = require("../forwarder/api/index.js");
    
    const payload = JSON.stringify({
      event_type: "message.received",
      message: {
        from: "test@example.com",
        inbox_id: "inbox_wrong456",
        subject: "Test",
        text: "Test message",
      },
    });
    
    const req = createMockRequest({
      rawBody: payload,
      secret: process.env.AGENTMAIL_WEBHOOK_SECRET,
    });
    const res = createMockResponse();
    
    await handler(req, res);
    const body = res.getBody();
    
    if (res.statusCode === 200 && body.skipped && body.reason === "inbox_mismatch") {
      console.log("✓ PASS: Rejects wrong inbox\n");
      return true;
    } else {
      console.log(`✗ FAIL: Expected inbox_mismatch, got ${res.statusCode}, body:`, body, "\n");
      return false;
    }
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    return false;
  } finally {
    delete process.env.AGENTMAIL_INBOX_ID;
    delete require.cache[require.resolve("../forwarder/api/index.js")];
  }
}

async function test4_missingCursorEnv() {
  console.log("Test 4: Missing Cursor env (before dedupe recording)");
  
  try {
    // Explicitly clear any inbox ID from previous tests
    delete process.env.AGENTMAIL_INBOX_ID;
    
    process.env.CURSOR_WEBHOOK_URL = "";
    process.env.CURSOR_WEBHOOK_KEY = "";
    process.env.AGENTMAIL_WEBHOOK_SECRET = "whsec_dGVzdDEyMzQ1Njc4OTBhYmNkZWY=";
    process.env.REQUIRE_AGENTMAIL_SIGNATURE = "1";
    process.env.ALLOWLIST = "test@example.com";
    
    const handler = require("../forwarder/api/index.js");
    
    const payload = JSON.stringify({
      event_type: "message.received",
      message: {
        from: "test@example.com",
        subject: "Test",
        text: "Test",
      },
    });
    
    const req = createMockRequest({
      rawBody: payload,
      secret: process.env.AGENTMAIL_WEBHOOK_SECRET,
    });
    const res = createMockResponse();
    
    await handler(req, res);
    const body = res.getBody();
    
    if (res.statusCode === 500 && body.error === "missing_cursor_env") {
      console.log("✓ PASS: Returns 500 before dedupe\n");
      return true;
    } else {
      console.log(`✗ FAIL: Expected 500 missing_cursor_env, got ${res.statusCode}, body:`, body, "\n");
      return false;
    }
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    return false;
  } finally {
    delete require.cache[require.resolve("../forwarder/api/index.js")];
  }
}

async function test5_unsigned() {
  console.log("Test 5: Unsigned request (signature required)");
  
  try {
    process.env.CURSOR_WEBHOOK_URL = "https://example.cursor.sh/webhook";
    process.env.CURSOR_WEBHOOK_KEY = "test_key";
    process.env.AGENTMAIL_WEBHOOK_SECRET = "";
    process.env.REQUIRE_AGENTMAIL_SIGNATURE = "1";
    process.env.ALLOWLIST = "test@example.com";
    
    const handler = require("../forwarder/api/index.js");
    
    const payload = JSON.stringify({
      event_type: "message.received",
      message: {
        from: "test@example.com",
        subject: "Test",
        text: "Test",
      },
    });
    
    const req = createMockRequest({
      rawBody: payload,
      includeSignature: false,
    });
    const res = createMockResponse();
    
    await handler(req, res);
    const body = res.getBody();
    
    if (res.statusCode === 401 && body.error === "webhook_signature_required") {
      console.log("✓ PASS: Returns 401\n");
      return true;
    } else {
      console.log(`✗ FAIL: Expected 401, got ${res.statusCode}, body:`, body, "\n");
      return false;
    }
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    return false;
  } finally {
    delete require.cache[require.resolve("../forwarder/api/index.js")];
  }
}

async function runTests() {
  console.log("Running handler validation tests...\n");
  
  // Run sequentially to avoid env var conflicts
  const results = [
    await test1_oversizedContentLength(),
    await test2_streamOverflow(),
    await test3_wrongInbox(),
    await test4_missingCursorEnv(),
    await test5_unsigned(),
  ];
  
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  
  console.log("─".repeat(50));
  console.log(`Tests: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.error("\nSome handler validation tests failed.");
    process.exit(1);
  }
  
  console.log("\nAll handler validation tests passed!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
