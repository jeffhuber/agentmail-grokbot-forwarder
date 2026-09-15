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

const allowlistCases = [
  {
    name: "empty deny-all",
    got: isAllowlisted("you@example.com", []),
    expected: false,
  },
  {
    name: "match angle",
    got: isAllowlisted(extractEmail("Operator <you@example.com>"), allow),
    expected: true,
  },
  {
    name: "reject other",
    got: isAllowlisted("other@example.com", allow),
    expected: false,
  },
];

for (const { name, got, expected } of allowlistCases) {
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(JSON.stringify({ name, expected, got, ok }));
}

if (failed) {
  console.error(`FAILED ${failed} case(s)`);
  process.exit(1);
}
console.log("OK");
