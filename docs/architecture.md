# Architecture

## Problem

| Side | Constraint |
|------|------------|
| **Cursor agent webhook** | Requires `Authorization: Bearer <key>` |
| **AgentMail outbound webhook** | POSTs JSON via Svix; **does not** send Cursor Bearer auth |
| **AgentMail events** | `message.received` (and spam/blocked/sent/… variants) |

So you cannot point AgentMail straight at Cursor. You need a tiny public hop that receives AgentMail’s POST, verifies the Svix signature, filters, and re-POSTs to Cursor with Bearer.

## Durable path (production)

```
Human email
  → AgentMail inbox
    → AgentMail webhook (event: message.received, Svix-signed)
      → Public HTTPS forwarder (Vercel serverless in this repo)
        → verify svix-* signature (fail closed)
        → allowlist + dedupe + light rate limit
        → ACK 200 { ok, forwarded, async: true } immediately
        → waitUntil → Cursor agent webhook (Bearer)
          → Grok Bot / desk agent
            → AgentMail reply in thread
```

### Why Vercel (or any public HTTPS function)

- Always-on public URL (no laptop tunnel).
- Env vars for URL + key + signing secret (not in git).
- Allowlist filter before waking the agent.
- Cheap idle cost; scales with inbound volume.

### Critical: ACK AgentMail before awaiting Cursor

The forwarder must return **200 to AgentMail immediately** (`async: true`) and forward to Cursor in the background (Vercel `waitUntil`).

If it **awaits** the Cursor agent webhook before responding, AgentMail/Svix treats the slow response as a failed delivery and **redelivers** (same `svix-id` / `event_id`). Long agent wakes then cause the desk to answer the same inbound repeatedly.

Health check: `{ "ok": true, "service": "agentmail-cursor-forwarder", "async": true }`.

## Filtering

The forwarder:

- Accepts `GET` (health) and `POST` (events).
- Verifies Svix / Standard Webhooks signatures (`svix-id` / `svix-timestamp` / `svix-signature`, also `webhook-*`).
- Forwards **only** exact `event_type === "message.received"` (skips spam/blocked/sent/etc).
- Extracts sender from `message.from` (`Name <email@x.com>` or bare email); matches `ALLOWLIST` case-insensitively.
- **Empty `ALLOWLIST` = deny-all** (fail closed).
- Dedupes on `svix-id` then `event_id`.
- Light per-sender rate limit; skips return **200** so AgentMail does not retry forever.

## Signature scheme

Same as Standard Webhooks / Svix:

- Signed content: `` `${id}.${timestamp}.${rawBody}` ``
- Secret: `whsec_` + base64 key material
- Header signatures: space-separated `v1,<base64>` entries
- Max timestamp skew: 300 seconds

HMAC is always over the **raw body bytes**, never `JSON.stringify(parsed)`.

## What not to put in this repo

- Real emails beyond documented allowlist defaults in `.env.example`, webhook URLs, Bearer tokens, `whsec_` secrets.
- Private `.env` / deploy notes with live secrets.

Use placeholders and Vercel / secret stores only.
