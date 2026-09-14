# agentmail-grokbot-forwarder

**Experimental**: Security-hardened AgentMail → Cursor Grok Bot webhook forwarder.

Wire an **AgentMail** inbox to a **Grok Bot** (Cursor agent) over a durable webhook path with Svix signature verification, email allowlisting, dedupe, and light rate limiting.

AgentMail delivers `message.received` via **Svix** to a public HTTPS URL. Cursor agent webhooks **require** Bearer auth. This repo’s tiny Vercel forwarder is the hop that verifies the signature, filters, ACKs AgentMail immediately, and forwards the raw body to Cursor with Bearer.

```
AgentMail (message.received, Svix-signed)
  → public HTTPS forwarder (this repo / Vercel)
    → Cursor agent webhook (Bearer)
```

The forwarder **ACKs AgentMail immediately** (`async: true`) and forwards to Cursor via Vercel `waitUntil`. If it awaited Cursor before responding, AgentMail would redeliver the same `svix-id` / `event_id` during long agent wakes and the desk would answer repeatedly.

## Security features

1. **Svix / Standard Webhooks signature verification (fail closed)**  
   Headers: `svix-id`, `svix-timestamp`, `svix-signature` (also accepts `webhook-*`).  
   Signed content: `` `${id}.${timestamp}.${rawBody}` ``. Secret: `whsec_` + base64.  
   Rejects skew &gt; 5 minutes; constant-time compare; HMAC over **raw** body only.

2. **Event filter** — only exact `event_type === "message.received"` (not spam/blocked/sent/…).

3. **Email allowlist** — `ALLOWLIST` comma-separated emails; parses `Name <email@x.com>`; case-insensitive. **Empty allowlist = deny-all**.

4. **Dedupe** — `svix-id` then `event_id` (in-memory TTL ~2 min).

5. **Light rate limit** — per sender (~30 / minute); skips return **200** so AgentMail does not retry forever.

## Quickstart

### 1. Deploy the forwarder

```bash
cd forwarder
npm install
npx vercel          # first time: link / create project
npx vercel --prod
```

Copy `forwarder/.env.example` → set in Vercel → Project → Settings → Environment Variables:

| Variable | Purpose |
|----------|---------|
| `CURSOR_WEBHOOK_URL` | Cursor agent webhook URL |
| `CURSOR_WEBHOOK_KEY` | Bearer token for that webhook |
| `ALLOWLIST` | Comma-separated emails (default intended: `jhuber@gmail.com,jhuber@triatomic.ai`) |
| `AGENTMAIL_WEBHOOK_SECRET` | **Required**: Svix signing secret (`whsec_...`) from AgentMail webhook create |
| `REQUIRE_AGENTMAIL_SIGNATURE` | Set to `1` (recommended) |
| `ALLOW_UNSIGNED_WEBHOOKS` | `1` = dev only escape hatch (not for production) |

Redeploy after setting env. Health check:

```bash
curl -s https://YOUR_DEPLOYMENT/
# → {"ok":true,"service":"agentmail-cursor-forwarder","async":true}
```

### 2. Register AgentMail webhook (later — needs desk Cursor webhook + secret)

**Do not invent Cursor credentials.** Once Chet/desk provides Cursor webhook URL + key, and you have set `AGENTMAIL_WEBHOOK_SECRET` from AgentMail’s create response:

1. Set Vercel env (`CURSOR_*`, `ALLOWLIST`, `AGENTMAIL_WEBHOOK_SECRET`, `REQUIRE_AGENTMAIL_SIGNATURE=1`).
2. Create AgentMail webhook pointing at `https://YOUR_DEPLOYMENT/` for `message.received` only.
3. Store the returned `whsec_...` as `AGENTMAIL_WEBHOOK_SECRET` and redeploy if created after first deploy.

### 3. Desk persona + webhook routine

- [`templates/agentmail-desk-persona.md`](templates/agentmail-desk-persona.md)
- [`templates/webhook-routine.md`](templates/webhook-routine.md)

### 4. Local checks

```bash
cd forwarder && npm install
node ../scripts/check-email-parse.js
node ../scripts/check-svix-verify.js
```

## Docs

- [Architecture](docs/architecture.md)

## Hygiene

- No real webhook URLs, Bearer tokens, or `whsec_` secrets in git.
- Scrub before publishing; keep secrets in Vercel env only.
