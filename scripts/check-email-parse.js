#!/usr/bin/env node
/**
 * Small proof script for message.from → allowlist email extraction.
 * Run: node scripts/check-email-parse.js
 * (from repo root; loads forwarder/api/index.js helpers)
 */
const path = require("node:path");
const handler = require(path.join(__dirname, "..", "forwarder", "api", "index.js"));
const { extractEmail, parseAllowlist, isAllowlisted } = handler;

const cases = [
  ["you@example.com", "you@example.com"],
  ["Operator <you@example.com>", "you@example.com"],
  ['"Operator" <operator@example.com>', "operator@example.com"],
  ["  Name  <YOU@Example.COM>  ", "you@example.com"],
  ["not-an-email", ""],
  ["", ""],
  [null, ""],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = extractEmail(input);
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(
    JSON.stringify({ input, expected, got, ok })
  );
}

const allow = parseAllowlist(
  "you@example.com, Operator <operator@example.com>, "
);
console.log("allowlist:", allow);
console.log("empty deny-all:", isAllowlisted("you@example.com", []) === false);
console.log(
  "match angle:",
  isAllowlisted(extractEmail("Operator <you@example.com>"), allow) === true
);
console.log(
  "reject other:",
  isAllowlisted("other@example.com", allow) === false
);

if (failed) {
  console.error(`FAILED ${failed} extractEmail case(s)`);
  process.exit(1);
}
console.log("OK");
