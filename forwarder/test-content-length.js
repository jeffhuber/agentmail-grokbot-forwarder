#!/usr/bin/env node
/**
 * Test script for Content-Length mismatch handling.
 * Simulates requests with incomplete bodies relative to declared Content-Length.
 */

const http = require("http");
const handler = require("./api/index.js");

const PORT = 3456;

// Create test server
const server = http.createServer(handler);

server.listen(PORT, () => {
  console.log(`Test server listening on port ${PORT}`);
  runTests();
});

function makeRequest(options, body, onResponse) {
  const req = http.request(
    {
      hostname: "localhost",
      port: PORT,
      method: "POST",
      path: "/api",
      headers: options.headers || {},
    },
    (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        onResponse(res.statusCode, data);
      });
    }
  );

  req.on("error", (err) => {
    console.error("Request error:", err);
  });

  if (body) {
    req.write(body);
  }

  // Simulate premature connection close if requested
  if (options.abortBeforeEnd) {
    setTimeout(() => {
      req.destroy();
    }, 50);
  } else {
    req.end();
  }
}

async function runTests() {
  console.log("\n=== Test 1: Content-Length mismatch (declared 100, actual 7) ===");
  await new Promise((resolve) => {
    makeRequest(
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "100",
        },
      },
      '{"a":1}',
      (status, body) => {
        console.log(`Status: ${status}`);
        console.log(`Body: ${body}`);
        try {
          const parsed = JSON.parse(body);
          if (status === 400 && (parsed.error === "body_incomplete" || parsed.error === "content_length_mismatch" || parsed.error === "body_read_timeout")) {
            console.log("✅ PASS: Returns 400 with body_incomplete/content_length_mismatch/body_read_timeout error");
          } else {
            console.log(`❌ FAIL: Expected 400 with body_incomplete/content_length_mismatch error, got ${status} with ${parsed.error}`);
          }
        } catch (e) {
          console.log(`❌ FAIL: Non-JSON response or parse error: ${e.message}`);
        }
        resolve();
      }
    );
  });

  console.log("\n=== Test 2: Premature abort with Content-Length ===");
  await new Promise((resolve) => {
    makeRequest(
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "50",
        },
        abortBeforeEnd: true,
      },
      '{"test"',
      (status, body) => {
        console.log(`Status: ${status}`);
        console.log(`Body: ${body || "(empty)"}`);
        if (status === 400) {
          console.log("✅ PASS: Premature abort returns 400");
        } else {
          console.log(`❌ FAIL: Expected 400, got ${status}`);
        }
        resolve();
      }
    );
  });

  console.log("\n=== Test 3: Valid request (Content-Length matches) ===");
  await new Promise((resolve) => {
    const body = '{"a":1}';
    makeRequest(
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body, "utf8")),
        },
      },
      body,
      (status, body) => {
        console.log(`Status: ${status}`);
        console.log(`Body: ${body}`);
        // This should return 200 (skipped) or 401 (no auth) or 500 (no env vars), not 400
        if (status !== 400) {
          console.log("✅ PASS: Valid Content-Length does not return 400");
        } else {
          console.log("❌ FAIL: Valid Content-Length incorrectly rejected with 400");
        }
        resolve();
      }
    );
  });

  console.log("\n=== Test 4: Oversized Content-Length (> 2MB) ===");
  await new Promise((resolve) => {
    makeRequest(
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "3000000", // 3MB
        },
      },
      '{"a":1}',
      (status, body) => {
        console.log(`Status: ${status}`);
        console.log(`Body: ${body}`);
        try {
          const parsed = JSON.parse(body);
          if (status === 413 && parsed.error === "body_too_large") {
            console.log("✅ PASS: Oversized Content-Length returns 413");
          } else {
            console.log(`❌ FAIL: Expected 413 with body_too_large, got ${status} with ${parsed.error}`);
          }
        } catch (e) {
          console.log(`❌ FAIL: Non-JSON response: ${body}`);
        }
        resolve();
      }
    );
  });

  console.log("\n=== All tests complete ===\n");
  server.close();
  process.exit(0);
}
