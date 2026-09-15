# AgentMail Grok Bot Forwarder

> **agentmail-grokbot-forwarder** (Vercel service: `agentmail-cursor-forwarder`)

Webhook forwarder connecting **AgentMail** inboxes to **Cursor Grok Bot** agents with signature verification, allowlisting, dedupe, and rate limiting.

AgentMail delivers `message.received` via **Svix** to a public HTTPS URL. Cursor agent webhooks **require** Bearer auth. This repo’s tiny Vercel forwarder is the hop that verifies the signature, filters, ACKs AgentMail immediately, and forwards the raw body to Cursor with Bearer.

```
AgentMail (message.received, Svix-signed)
  → public HTTPS forwarder (this repo / Vercel)
    → Cursor agent webhook (Bearer)
```

The forwarder **ACKs AgentMail immediately** (`async: true`) and forwards to Cursor via Vercel `waitUntil`. If it awaited Cursor before responding, AgentMail would redeliver the same `svix-id` / `event_id` during long agent wakes and the agent would answer repeatedly.

## Security features

1. **Svix / Standard Webhooks signature verification (fail closed)**  
   Headers: `svix-id`, `svix-timestamp`, `svix-signature` (also accepts `webhook-*`).  
   Signed content: `` `${id}.${timestamp}.${rawBody}` ``. Secret: `whsec_` + base64.  
   Rejects skew &gt; 5 minutes; constant-time compare; HMAC over **raw** body only.

2. **Event filter** — only exact `event_type === "message.received"` (not spam/blocked/sent/…).

3. **Email allowlist** — `ALLOWLIST` comma-separated emails; parses `Name <user@example.com>`; case-insensitive. **Empty allowlist = deny-all**.

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
| `ALLOWLIST` | Comma-separated emails (example: `you@example.com,operator@example.com`) |
| `AGENTMAIL_WEBHOOK_SECRET` | **Required**: Svix signing secret (`whsec_...`) from AgentMail webhook create |
| `REQUIRE_AGENTMAIL_SIGNATURE` | Set to `1` (recommended) |
| `AGENTMAIL_INBOX_ID` | Optional: Specific inbox ID for defense-in-depth (validated when secret is set) |
| `ALLOW_UNSIGNED_WEBHOOKS` | `1` = dev only escape hatch (not for production); ignored when secret set |

Redeploy after setting env. Health check:

```bash
curl -s https://YOUR_DEPLOYMENT/
# → {"ok":true,"service":"agentmail-cursor-forwarder","async":true}
```

### 2. Register AgentMail webhook (requires Cursor agent webhook credentials)

**Do not invent Cursor credentials.** Once you have obtained your Cursor agent webhook URL and key from the webhook routine panel, and you have set `AGENTMAIL_WEBHOOK_SECRET` from AgentMail’s create response:

1. Set Vercel env (`CURSOR_*`, `ALLOWLIST`, `AGENTMAIL_WEBHOOK_SECRET`, `REQUIRE_AGENTMAIL_SIGNATURE=1`).
2. Create AgentMail webhook pointing at `https://YOUR_DEPLOYMENT/` for `message.received` only.
3. Store the returned `whsec_...` as `AGENTMAIL_WEBHOOK_SECRET` and redeploy if created after first deploy.

### 3. Agent persona + webhook routine templates

- [`templates/agentmail-agent-persona.md`](templates/agentmail-agent-persona.md) - Sample agent persona
- [`templates/webhook-routine.md`](templates/webhook-routine.md) - Webhook handling routine

### 4. Local checks

```bash
cd forwarder && npm install
node ../scripts/check-email-parse.js
node ../scripts/check-svix-verify.js
```

## Documentation

- [Architecture](docs/architecture.md) - How the webhook forwarder works
- [Smoke Test Guide](docs/SMOKE_TEST.md) - Testing and validation procedures
- [Security Policy](SECURITY.md) - Vulnerability reporting

## Related Projects

This is one of several Grok Bot communication channels:

- [grokbot-imessage-skill](https://github.com/jeffhuber/grokbot-imessage-skill) - iMessage channel
- [twilio-grok-voice-bridge](https://github.com/jeffhuber/twilio-grok-voice-bridge) - Voice channel (Twilio)
- [linq-grokbot-text-channel](https://github.com/jeffhuber/linq-grokbot-text-channel) - SMS/RCS channel (Linq)
- [agentmail-grokbot-forwarder](https://github.com/jeffhuber/agentmail-grokbot-forwarder) - Email channel (this repo)

## What This Is Not

- **Not a complete email client** - This is a webhook forwarder only. Your Cursor agent handles email operations via AgentMail MCP tools.
- **Not for mass email** - Designed for personal assistant use cases with small allowlists.
- **Not a standalone service** - Requires both AgentMail and Cursor agent webhook to function.

## Security

This forwarder implements multiple security layers:

- ✅ Webhook signature verification (Svix/Standard Webhooks) with fail-closed behavior
- ✅ Email allowlist with deny-all default (filters on AgentMail `From` header; see [SECURITY.md](SECURITY.md) for trust model)
- ✅ In-memory dedupe (per-isolate; primary replay protection via Svix timestamp window)
- ✅ Per-sender rate limiting (per-isolate)
- ✅ Request body size limits
- ✅ Optional inbox ID binding
- ✅ No secrets committed to git
- ✅ Async acknowledgment to prevent webhook storms

**Note**: This forwarder passes the full AgentMail JSON payload (including all headers and body content) to your Cursor agent webhook by design. It is not a privacy filter, only an authentication and authorization hop.

See [SECURITY.md](SECURITY.md) for the complete threat model and vulnerability reporting.

## Contributing

Contributions welcome! Please:

1. Keep the fail-closed security properties intact
2. Add tests for new filtering logic
3. Update documentation for configuration changes
4. Never commit real secrets or PII

## License

MIT License - see LICENSE file for details.
