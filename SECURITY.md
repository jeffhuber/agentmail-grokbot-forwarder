# Security

## Vulnerability Reporting

If you discover a security vulnerability in this forwarder, please report it via [GitHub Security Advisories](https://github.com/jeffhuber/agentmail-grokbot-forwarder/security/advisories/new).

**Do not** open a public GitHub issue for security vulnerabilities.

## Threat Model and Trust Boundaries

### Sender Authentication

The forwarder's email allowlist matches the `From` header in the AgentMail `message.received` event payload. **Important trust considerations:**

1. **SMTP-level From spoofing**: The `From` header can be forged at the SMTP protocol level by any sender.

2. **AgentMail authentication dependency**: The security of this forwarder depends on whether AgentMail validates sender authenticity via **SPF**, **DKIM**, and **DMARC** before emitting `message.received` events.

3. **Event type filtering**: This forwarder only accepts events where `event_type === "message.received"` (exact match). If AgentMail provides separate event types like `message.received.unauthenticated` for messages that fail SPF/DKIM/DMARC, those events would be rejected by the event type filter.

4. **Operator responsibility**: **Operators must verify AgentMail's authentication policy** by consulting AgentMail's documentation or support. If AgentMail does not perform SPF/DKIM/DMARC validation, or if it emits `message.received` for unauthenticated messages, the allowlist should be treated as a **convenience filter only**, not as a sole trust boundary.

### Webhook Signature Verification

Svix webhook signatures (via the `svix-id`, `svix-timestamp`, `svix-signature` headers) provide cryptographic assurance that:
- The webhook originated from the AgentMail/Svix service
- The payload has not been tampered with in transit
- The timestamp is within an acceptable window (5 minutes), providing replay protection

### Request Size Limits

The forwarder enforces a body size limit (~2MB) to prevent resource exhaustion attacks via oversized payloads.

### Inbox Binding

When `AGENTMAIL_INBOX_ID` is set, the forwarder validates that incoming webhooks match the expected inbox ID, providing defense-in-depth against misconfigured webhooks or cross-inbox attacks.

### Data Flow and Privacy

**This forwarder passes the full AgentMail JSON payload to your Cursor agent webhook by design.** This includes:
- All email headers (From, To, Subject, etc.)
- Complete email body (text, HTML, and attachments metadata)
- AgentMail event metadata (inbox ID, thread ID, message ID)

The forwarder is an authentication and authorization hop, **not a data filter or privacy layer**. If you need content filtering or redaction, implement it in your Cursor agent or in a separate processing layer.

## Security Features

This forwarder implements multiple security layers:

- **Webhook signature verification** (Svix/Standard Webhooks) with fail-closed behavior
- **Email allowlist** with deny-all default when empty (see threat model above)
- **Dedupe** (in-memory, per-isolate; primary replay protection via Svix timestamp window)
- **Rate limiting** per sender (in-memory, per-isolate)
- **Request body size limits** to prevent resource exhaustion
- **Optional inbox ID binding** for defense-in-depth
- **No secrets in git** - all sensitive values in environment variables
- **Async acknowledgment** to prevent AgentMail redelivery storms

### Vercel Isolate Limitations

The in-memory dedupe and rate limiting are **per-isolate** on Vercel's serverless infrastructure. This means:
- Each serverless function instance maintains its own in-memory state
- State is not shared across multiple concurrent instances
- In-memory state is lost when an instance is recycled

**Primary replay protection** comes from the Svix timestamp window (5 minutes), not the in-memory dedupe map. The in-memory dedupe provides additional protection for rapid retries within a single isolate's lifetime.

## Best Practices

When deploying this forwarder:

1. Always set `REQUIRE_AGENTMAIL_SIGNATURE=1` in production
2. Never commit real `whsec_` secrets, Bearer tokens, or webhook URLs to git
3. Use strong, randomly generated webhook secrets
4. Keep the `ALLOWLIST` as restrictive as possible
5. Monitor logs for `webhook_reject` and `webhook_skip` events
6. Rotate webhook secrets periodically
7. Never set `ALLOW_UNSIGNED_WEBHOOKS=1` in production
