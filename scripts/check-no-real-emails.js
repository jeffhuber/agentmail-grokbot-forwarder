#!/usr/bin/env node
/**
 * PII scanner: reject any non-example.com/example.org email addresses
 * in docs, scripts, templates, and forwarder code.
 *
 * Usage: node scripts/check-no-real-emails.js
 * Exit 0 if clean, exit 1 if real emails found.
 */

const fs = require("node:fs");
const path = require("node:path");

// Email regex that matches typical email addresses
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Allowed domains (case-insensitive)
const ALLOWED_DOMAINS = ["example.com", "example.org"];

// Directories to scan
const SCAN_DIRS = ["README.md", "SECURITY.md", "LICENSE", "scripts", "templates", "docs", "forwarder"];

// File extensions to check
const EXTENSIONS = [".js", ".json", ".md", ".example"];

// Files to skip
const SKIP_FILES = ["node_modules", ".git", "package-lock.json"];

function shouldScanFile(filePath) {
  const basename = path.basename(filePath);
  
  // Skip certain files/directories
  if (SKIP_FILES.some(skip => filePath.includes(skip))) {
    return false;
  }
  
  // Check if it's a specific file we want (like .env.example)
  if (basename === ".env.example") {
    return true;
  }
  
  // Check extensions
  return EXTENSIONS.some(ext => filePath.endsWith(ext));
}

function extractEmails(content) {
  const matches = content.match(EMAIL_REGEX) || [];
  return matches.map(email => email.toLowerCase());
}

function isAllowedEmail(email) {
  const domain = email.split("@")[1];
  return ALLOWED_DOMAINS.some(allowed => domain === allowed);
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const emails = extractEmails(content);
  const violations = emails.filter(email => !isAllowedEmail(email));
  
  if (violations.length > 0) {
    return { filePath, violations: [...new Set(violations)] };
  }
  
  return null;
}

function scanDirectory(dirPath, results = []) {
  if (!fs.existsSync(dirPath)) {
    return results;
  }
  
  const stat = fs.statSync(dirPath);
  
  if (stat.isFile()) {
    if (shouldScanFile(dirPath)) {
      const violation = scanFile(dirPath);
      if (violation) {
        results.push(violation);
      }
    }
    return results;
  }
  
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (SKIP_FILES.includes(entry)) continue;
      const fullPath = path.join(dirPath, entry);
      scanDirectory(fullPath, results);
    }
  }
  
  return results;
}

function main() {
  console.log("Scanning for non-example.com email addresses...\n");
  
  const allViolations = [];
  
  for (const target of SCAN_DIRS) {
    const violations = scanDirectory(target);
    allViolations.push(...violations);
  }
  
  if (allViolations.length === 0) {
    console.log("✓ No non-example.com email addresses found");
    console.log("  Scanned:", SCAN_DIRS.join(", "));
    process.exit(0);
  }
  
  console.error("✗ Found non-example.com email addresses:\n");
  for (const { filePath, violations } of allViolations) {
    console.error(`  ${filePath}:`);
    for (const email of violations) {
      console.error(`    - ${email}`);
    }
  }
  console.error("\nOnly example.com or example.org addresses are allowed in documentation.");
  process.exit(1);
}

main();
