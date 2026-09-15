#!/usr/bin/env node
/**
 * Test script for handler-level security validations.
 * Tests: oversized body, wrong inbox, missing Cursor env, unsigned requests.
 * Run: node scripts/check-handler-validations.js
 */

const path = require("node:path");

// Mock environment variables for testing
const originalEnv = { ...process.env };

function mockEnv(overrides) {
  Object.assign(process.env, {
    CURSOR_WEBHOOK_URL: "https://example.cursor.sh/webhook",
    CURSOR_WEBHOOK_KEY: "test_key_123",
    AGENTMAIL_WEBHOOK_SECRET: "whsec_test123",
    REQUIRE_AGENTMAIL_SIGNATURE: "1",
    ALLOWLIST: "test@example.com",
    ...overrides,
  });
}

function restoreEnv() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.assign(process.env, originalEnv);
}

function createMockRequest(overrides = {}) {
  const defaults = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": "msg_test123",
      "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
      "svix-signature": "v1,valid_signature",
    },
    body: null,
    rawBody: null,
    on: () => {},
    removeListener: () => {},
    destroy: () => {},
  };
  return { ...defaults, ...overrides };
}

function createMockResponse() {
  let statusCode = 200;
  let headers = {};
  let body = "";
  return {
    statusCode,
    setHeader: (key, value) => {
      headers[key] = value;
    },
    end: (data) => {
      body = data;
    },
    getStatus: () => statusCode,
    getBody: () => (body ? JSON.parse(body) : {}),
    set statusCode(code) {
      statusCode = code;
    },
  };
}

async function runTests() {
  console.log("Running handler validation tests...\n");
  let passed = 0;
  let failed = 0;

  // Test 1: Oversized body via Content-Length header
  console.log("Test 1: Oversized body (Content-Length check)");
  try {
    mockEnv();
    const handler = require(path.join(__dirname, "..", "forwarder", "api", "index.js"));
    
    const req = createMockRequest({
      headers: {
        "content-length": "3000000", // 3MB, over the 2MB limit
      },
    });
    const res = createMockResponse();
    
    await handler(req, res);
    
    if (res.statusCode === 413) {
      console.log("✓ PASS: Returns 413 for oversized body\n");
      passed++;
    } else {
      console.log(`✗ FAIL: Expected 413, got ${res.statusCode}\n`);
      failed++;
    }
    
    restoreEnv();
    delete require.cache[require.resolve(path.join(__dirname, "..", "forwarder", "api", "index.js"))];
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    failed++;
    restoreEnv();
  }

  // Test 2: Wrong inbox ID
  console.log("Test 2: Wrong inbox ID");
  try {
    mockEnv({ AGENTMAIL_INBOX_ID: "inbox_expected123" });
    const handler = require(path.join(__dirname, "..", "forwarder", "api", "index.js"));
    
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
      headers: {
        "content-type": "application/json",
        "content-length": payload.length.toString(),
      },
    });
    const res = createMockResponse();
    
    await handler(req, res);
    const body = res.getBody();
    
    if (res.statusCode === 200 && body.skipped && body.reason === "inbox_mismatch") {
      console.log("✓ PASS: Rejects wrong inbox ID\n");
      passed++;
    } else {
      console.log(`✗ FAIL: Expected inbox_mismatch skip, got status ${res.statusCode}, body:`, body, "\n");
      failed++;
    }
    
    restoreEnv();
    delete require.cache[require.resolve(path.join(__dirname, "..", "forwarder", "api", "index.js"))];
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    failed++;
    restoreEnv();
  }

  // Test 3: Missing Cursor env (should NOT record dedupe)
  console.log("Test 3: Missing Cursor env");
  try {
    mockEnv({ CURSOR_WEBHOOK_URL: "", CURSOR_WEBHOOK_KEY: "" });
    const handler = require(path.join(__dirname, "..", "forwarder", "api", "index.js"));
    
    const payload = JSON.stringify({
      event_type: "message.received",
      message: {
        from: "test@example.com",
        subject: "Test",
        text: "Test message",
      },
    });
    
    const req = createMockRequest({
      rawBody: payload,
      headers: {
        "content-type": "application/json",
        "content-length": payload.length.toString(),
      },
    });
    const res = createMockResponse();
    
    await handler(req, res);
    const body = res.getBody();
    
    if (res.statusCode === 500 && body.error === "missing_cursor_env") {
      console.log("✓ PASS: Returns 500 for missing Cursor env\n");
      passed++;
    } else {
      console.log(`✗ FAIL: Expected 500 missing_cursor_env, got status ${res.statusCode}, body:`, body, "\n");
      failed++;
    }
    
    restoreEnv();
    delete require.cache[require.resolve(path.join(__dirname, "..", "forwarder", "api", "index.js"))];
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    failed++;
    restoreEnv();
  }

  // Test 4: Unsigned request (no webhook secret set, no allow unsigned)
  console.log("Test 4: Unsigned request");
  try {
    mockEnv({ 
      AGENTMAIL_WEBHOOK_SECRET: "",
      REQUIRE_AGENTMAIL_SIGNATURE: "1",
      ALLOW_UNSIGNED_WEBHOOKS: "0",
    });
    const handler = require(path.join(__dirname, "..", "forwarder", "api", "index.js"));
    
    const payload = JSON.stringify({
      event_type: "message.received",
      message: {
        from: "test@example.com",
        subject: "Test",
        text: "Test message",
      },
    });
    
    const req = createMockRequest({
      rawBody: payload,
      headers: {
        "content-type": "application/json",
        "content-length": payload.length.toString(),
      },
    });
    const res = createMockResponse();
    
    await handler(req, res);
    const body = res.getBody();
    
    if (res.statusCode === 401 && body.error === "webhook_signature_required") {
      console.log("✓ PASS: Returns 401 for unsigned request\n");
      passed++;
    } else {
      console.log(`✗ FAIL: Expected 401 webhook_signature_required, got status ${res.statusCode}, body:`, body, "\n");
      failed++;
    }
    
    restoreEnv();
    delete require.cache[require.resolve(path.join(__dirname, "..", "forwarder", "api", "index.js"))];
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}\n`);
    failed++;
    restoreEnv();
  }

  // Summary
  console.log("─".repeat(50));
  console.log(`Tests completed: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.error("\nSome tests failed.");
    process.exit(1);
  }
  
  console.log("\nAll tests passed!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
