const { Webhook } = require("svix");
const { waitUntil } = require("@vercel/functions");

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEDUPE_TTL_MS = 120_000;

/** @type {Map<string, number[]>} */
const forwardBuckets = new Map();
/** @type {Map<string, number>} */
const seenIds = new Map();

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function header(req, name) {
  const lower = name.toLowerCase();
  const headers = req.headers || {};
  const v = headers[lower] ?? headers[name];
  if (Array.isArray(v)) return v[0] != null ? String(v[0]) : "";
  return v != null ? String(v) : "";
}

/**
 * Always obtain the true raw request body as a UTF-8 string before JSON parse.
 * Never HMAC over JSON.stringify(parsed).
 *
 * Vercel Node helpers read + restore the body via PassThrough patched onto
 * req.on('data'|'end') / req.read. `for await` of that stream hangs or yields
 * nothing — use data/end. Do not access req.body before reading (lazy JSON parse).
 * module.exports.config.api.bodyParser is Next.js-only and is ignored here.
 */
function readRawBody(req) {
  if (typeof req.rawBody === "string") return Promise.resolve(req.rawBody);
  if (Buffer.isBuffer(req.rawBody)) {
    return Promise.resolve(req.rawBody.toString("utf8"));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    const onData = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onEnd = () => {
      if (chunks.length > 0) {
        done(null, Buffer.concat(chunks).toString("utf8"));
        return;
      }
      // Stream empty. Fall back only to string/Buffer body — never re-serialize objects.
      try {
        if (typeof req.body === "string") {
          done(null, req.body);
          return;
        }
        if (Buffer.isBuffer(req.body)) {
          done(null, req.body.toString("utf8"));
          return;
        }
        if (
          req.body &&
          typeof req.body === "object" &&
          Object.keys(req.body).length > 0
        ) {
          done(new Error("raw_body_unavailable"));
          return;
        }
      } catch (_) {
        done(new Error("raw_body_unavailable"));
        return;
      }
      done(null, "");
    };
    const onError = (err) => done(err || new Error("raw_body_read_failed"));

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);

    if (typeof req.readableEnded === "boolean" && req.readableEnded && chunks.length === 0) {
      setImmediate(() => {
        if (!settled && chunks.length === 0) onEnd();
      });
    }
  });
}

/**
 * Extract bare email from AgentMail `message.from`.
 * Accepts: "email@x.com", "Name <email@x.com>", "\"Name\" <email@x.com>".
 * Returns lowercase email or "".
 */
function extractEmail(from) {
  if (from == null) return "";
  const s = String(from).trim();
  if (!s) return "";
  const angle = /<([^<>@\s]+@[^<>@\s]+)>/.exec(s);
  if (angle) return angle[1].trim().toLowerCase();
  // Bare address (optionally with display name without angle brackets — rare)
  const bare = /^([^\s<>]+@[^\s<>]+)$/.exec(s);
  if (bare) return bare[1].toLowerCase();
  // Fallback: first email-shaped token
  const token = /([^\s<>,"]+@[^\s<>,"]+)/.exec(s);
  return token ? token[1].toLowerCase() : "";
}

/**
 * Parse ALLOWLIST env: comma-separated emails, normalized lowercase.
 * Empty list = deny-all (fail closed).
 */
function parseAllowlist(envValue) {
  return String(envValue || "")
    .split(",")
    .map((s) => extractEmail(s.trim()) || s.trim().toLowerCase())
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowlisted(email, allowlist) {
  if (!allowlist.length) return false; // deny-all when empty
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  return allowlist.some((a) => a === e);
}

/**
 * Svix / Standard Webhooks verify via official `svix` package (fail closed when secret is set).
 * AgentMail/Svix: svix-id, svix-timestamp, svix-signature
 * Also accept Standard Webhooks / alias names: webhook-*, Webhook-*, x-webhook-*
 * Mapped into svix-* header names for Webhook.verify.
 */
function verifyWebhookSignature(req, rawBody, secret) {
  const id =
    header(req, "svix-id") ||
    header(req, "webhook-id") ||
    header(req, "Webhook-Id") ||
    header(req, "x-webhook-id");
  const timestamp =
    header(req, "svix-timestamp") ||
    header(req, "webhook-timestamp") ||
    header(req, "Webhook-Timestamp") ||
    header(req, "x-webhook-timestamp");
  const signatureHeader =
    header(req, "svix-signature") ||
    header(req, "webhook-signature") ||
    header(req, "Webhook-Signature") ||
    header(req, "x-webhook-signature") ||
    header(req, "X-Webhook-Signature");

  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: "missing_signature_headers" };
  }

  let secretStr = String(secret).trim();
  if (
    (secretStr.startsWith('"') && secretStr.endsWith('"')) ||
    (secretStr.startsWith("'") && secretStr.endsWith("'"))
  ) {
    secretStr = secretStr.slice(1, -1).trim();
  }
  if (!secretStr) {
    return { ok: false, reason: "invalid_secret_encoding" };
  }

  try {
    const wh = new Webhook(secretStr);
    wh.verify(rawBody, {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signatureHeader,
    });
    return { ok: true, webhookId: id };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).toLowerCase();
    let reason = "signature_mismatch";
    if (msg.includes("timestamp")) reason = "timestamp_skew";
    else if (msg.includes("secret") || msg.includes("base64"))
      reason = "invalid_secret_encoding";
    return { ok: false, reason };
  }
}

function pruneMap(map, now, ttlMs) {
  for (const [k, v] of map) {
    const t = typeof v === "number" ? v : 0;
    if (t + ttlMs < now) map.delete(k);
  }
}

function isDuplicate(id) {
  if (!id) return false;
  const now = Date.now();
  pruneMap(seenIds, now, DEDUPE_TTL_MS);
  if (seenIds.has(id)) return true;
  seenIds.set(id, now);
  return false;
}

function isRateLimited(key) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let stamps = forwardBuckets.get(key) || [];
  stamps = stamps.filter((t) => t > cutoff);
  if (stamps.length >= RATE_LIMIT_MAX) {
    forwardBuckets.set(key, stamps);
    return true;
  }
  stamps.push(now);
  forwardBuckets.set(key, stamps);
  return false;
}

async function handler(req, res) {
  if (req.method === "GET") {
    json(res, 200, {
      ok: true,
      service: "agentmail-cursor-forwarder",
      async: true,
    });
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const cursorUrl = process.env.CURSOR_WEBHOOK_URL;
  const cursorKey = process.env.CURSOR_WEBHOOK_KEY;
  const webhookSecret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  const requireSig =
    process.env.REQUIRE_AGENTMAIL_SIGNATURE === "1" ||
    process.env.REQUIRE_AGENTMAIL_SIGNATURE === "true";
  const allowlist = parseAllowlist(process.env.ALLOWLIST);

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    console.error(
      JSON.stringify({
        evt: "webhook_reject",
        reason: "raw_body_unavailable",
        error: String(err && err.message ? err.message : err),
      })
    );
    json(res, 400, { error: "raw_body_unavailable" });
    return;
  }

  // Signature verify when AGENTMAIL_WEBHOOK_SECRET is set (fail closed).
  // If unset: 401 unless ALLOW_UNSIGNED_WEBHOOKS=1 (explicit escape hatch).
  // REQUIRE_AGENTMAIL_SIGNATURE=1 reinforces fail-closed when secret is present.
  let verifiedWebhookId = "";
  if (webhookSecret) {
    const verified = verifyWebhookSignature(req, raw, webhookSecret);
    if (!verified.ok) {
      console.info(
        JSON.stringify({
          evt: "webhook_reject",
          reason: verified.reason,
          rawBodyLen: raw.length,
          hasSvixId: Boolean(header(req, "svix-id") || header(req, "webhook-id")),
          hasSvixTimestamp: Boolean(
            header(req, "svix-timestamp") || header(req, "webhook-timestamp")
          ),
          hasSvixSignature: Boolean(
            header(req, "svix-signature") || header(req, "webhook-signature")
          ),
          requireSig,
        })
      );
      json(res, 401, { error: "unauthorized", reason: verified.reason });
      return;
    }
    verifiedWebhookId = verified.webhookId || "";
  } else {
    const allowUnsigned = process.env.ALLOW_UNSIGNED_WEBHOOKS === "1";
    if (!allowUnsigned || requireSig) {
      console.error(
        JSON.stringify({
          evt: "webhook_reject",
          reason: "webhook_signature_required",
          message: "AGENTMAIL_WEBHOOK_SECRET unset",
          requireSig,
        })
      );
      json(res, 401, {
        error: "webhook_signature_required",
        message:
          "AGENTMAIL_WEBHOOK_SECRET is required. Set ALLOW_UNSIGNED_WEBHOOKS=1 to override (not recommended).",
      });
      return;
    }
    console.warn(
      "ALLOW_UNSIGNED_WEBHOOKS=1 set without AGENTMAIL_WEBHOOK_SECRET; accepting unsigned webhooks"
    );
  }

  let body = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch (_) {
    body = {};
  }

  // AgentMail: ONLY forward exact message.received (not spam/blocked/sent/etc).
  const eventType = body.event_type || body.type || body.event || null;
  const isMessageReceived = eventType === "message.received";

  const msg = body.message || (body.data && body.data.message) || {};
  const fromRaw = msg.from || body.from || null;
  const senderEmail = extractEmail(fromRaw);

  if (!isMessageReceived) {
    console.info(
      JSON.stringify({
        evt: "webhook_skip",
        reason: "not_message_received",
        eventType,
        rawBodyLen: raw.length,
      })
    );
    json(res, 200, {
      ok: true,
      skipped: true,
      reason: "not_message_received",
      eventType,
    });
    return;
  }

  // Missing sender: fail closed with 200 so AgentMail does not retry forever.
  if (!senderEmail) {
    console.info(
      JSON.stringify({
        evt: "webhook_skip",
        reason: "missing_sender",
        eventType,
        rawBodyLen: raw.length,
        fromRawPresent: Boolean(fromRaw),
      })
    );
    json(res, 200, {
      ok: true,
      skipped: true,
      reason: "missing_sender",
      eventType,
    });
    return;
  }

  // Empty allowlist = deny-all (prefer fail closed).
  if (!allowlist.length) {
    console.info(
      JSON.stringify({
        evt: "webhook_skip",
        reason: "allowlist_empty",
        eventType,
        hasSender: true,
      })
    );
    json(res, 200, {
      ok: true,
      skipped: true,
      reason: "allowlist_empty",
      eventType,
    });
    return;
  }

  if (!isAllowlisted(senderEmail, allowlist)) {
    console.info(
      JSON.stringify({
        evt: "webhook_skip",
        reason: "not_allowlisted",
        eventType,
        hasSender: true,
        allowlistCount: allowlist.length,
        rawBodyLen: raw.length,
      })
    );
    json(res, 200, {
      ok: true,
      skipped: true,
      reason: "not_allowlisted",
      eventType,
      hasSender: true,
    });
    return;
  }

  // Dedupe on svix-id then event_id (after verify + allowlist, before forward).
  const eventId =
    body.event_id ||
    body.id ||
    (msg && (msg.message_id || msg.id)) ||
    null;
  const dedupeKey =
    verifiedWebhookId ||
    header(req, "svix-id") ||
    header(req, "webhook-id") ||
    (eventId != null ? String(eventId) : "");
  if (dedupeKey && isDuplicate(dedupeKey)) {
    json(res, 200, {
      ok: true,
      skipped: true,
      reason: "duplicate",
      eventType,
    });
    return;
  }

  const rateKey = senderEmail || dedupeKey || "unknown";
  if (isRateLimited(rateKey)) {
    json(res, 200, {
      ok: true,
      skipped: true,
      reason: "rate_limited",
      eventType,
    });
    return;
  }

  if (!cursorUrl || !cursorKey) {
    json(res, 500, { error: "missing_cursor_env" });
    return;
  }

  // ACK AgentMail immediately so it does not redeliver while Cursor wakes.
  // Order: verify → filters → waitUntil(forward) + immediate 200 { async: true }.
  const forwardPromise = (async () => {
    try {
      const upstream = await fetch(cursorUrl, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + cursorKey,
          "Content-Type": "application/json",
        },
        body: raw,
      });
      const status = upstream.status;
      await upstream.text();
      console.info(
        JSON.stringify({
          evt: "webhook_forward",
          ok: status >= 200 && status < 300,
          upstreamStatus: status,
          rawBodyLen: raw.length,
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          evt: "webhook_forward",
          ok: false,
          error: String(err && err.message ? err.message : err),
        })
      );
    }
  })();

  waitUntil(forwardPromise);

  json(res, 200, {
    ok: true,
    forwarded: true,
    async: true,
  });
}

// Exported helpers for scripts / unit checks (not used by Vercel runtime path).
handler.extractEmail = extractEmail;
handler.parseAllowlist = parseAllowlist;
handler.isAllowlisted = isAllowlisted;
handler.verifyWebhookSignature = verifyWebhookSignature;

// Disable Vercel/Next body parsing so we always HMAC the true raw bytes.
// Must attach AFTER assigning module.exports = handler (assignment replaces exports).
module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
