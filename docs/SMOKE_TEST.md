# Smoke Test Guide

Quick validation steps for the agentmail-grokbot-forwarder after deployment or code changes.

## Prerequisites

- Node.js 18+ installed
- Forwarder deployed to Vercel (or local dev server running)
- AgentMail webhook configured and pointing at your deployment
- Test email account that is in the `ALLOWLIST`

## 1. Local Verification

Run the included check scripts from the repository root:

```bash
cd forwarder
npm install
cd ..

# Test email parsing logic
node scripts/check-email-parse.js

# Test Svix signature verification
node scripts/check-svix-verify.js
```

Both scripts should output `OK` and exit with status 0.

## 2. Health Check

Verify the forwarder is responding:

```bash
curl -s https://YOUR_DEPLOYMENT.vercel.app/
```

Expected response:

```json
{
  "ok": true,
  "service": "agentmail-cursor-forwarder",
  "async": true
}
```

## 3. Environment Variables Check

Verify all required environment variables are set in Vercel:

```bash
npx vercel env ls --environment=production
```

Required variables:

- `CURSOR_WEBHOOK_URL` - Cursor agent webhook URL
- `CURSOR_WEBHOOK_KEY` - Bearer token for Cursor webhook
- `AGENTMAIL_WEBHOOK_SECRET` - Svix signing secret (starts with `whsec_`)
- `ALLOWLIST` - Comma-separated allowlisted emails
- `REQUIRE_AGENTMAIL_SIGNATURE` - Should be set to `1`

Optional (should NOT be set in production):

- `ALLOW_UNSIGNED_WEBHOOKS` - Dev-only escape hatch

## 4. End-to-End Test

Send a test email to your AgentMail inbox from an allowlisted address:

1. **Send**: Email your AgentMail inbox address from an allowlisted email
2. **Verify webhook delivery**: Check Vercel logs for `webhook_forward` event
3. **Verify Cursor wake**: Check that your Cursor agent received the webhook
4. **Verify reply**: Check that the agent replied via AgentMail

### Expected log sequence (Vercel function logs):

```json
{
  "evt": "webhook_forward",
  "ok": true,
  "upstreamStatus": 200,
  "rawBodyLen": 1234
}
```

## 5. Security Test Cases

### Test: Reject unsigned webhooks (production mode)

With `REQUIRE_AGENTMAIL_SIGNATURE=1` set:

```bash
curl -X POST https://YOUR_DEPLOYMENT.vercel.app/ \
  -H "Content-Type: application/json" \
  -d '{"event_type":"message.received","message":{"from":"test@example.com"}}'
```

Expected: `401 Unauthorized` with `"error": "unauthorized"`

### Test: Reject non-allowlisted sender

Send email from an address NOT in `ALLOWLIST`.

Expected: Forwarder returns `200 OK` with `"skipped": true, "reason": "not_allowlisted"` and does NOT forward to Cursor.

### Test: Filter non-message.received events

AgentMail will only send `message.received` for inbound email, but verify filtering works:

Expected: Events like `message.sent`, `message.spam` are skipped with reason `"not_message_received"`.

### Test: Dedupe protection

AgentMail may redeliver the same webhook during slow Cursor agent wakes. The forwarder should dedupe on `svix-id` or `event_id`.

Expected: Second delivery returns `200 OK` with `"skipped": true, "reason": "duplicate"` and does NOT forward again.

## 6. Rate Limit Test

Send 30+ emails rapidly from the same address.

Expected: After ~30 messages/minute, the forwarder returns `200 OK` with `"skipped": true, "reason": "rate_limited"`.

## 7. Monitoring

Check Vercel logs for unexpected errors:

```bash
npx vercel logs YOUR_DEPLOYMENT.vercel.app --follow
```

Look for:

- ✅ `"evt": "webhook_forward", "ok": true` - successful forwards
- ⚠️ `"evt": "webhook_reject"` - signature failures or missing headers
- ⚠️ `"evt": "webhook_skip"` - filtered events (expected for non-allowlisted senders)

## Troubleshooting

### Forwarder returns 401 "unauthorized"

- Verify `AGENTMAIL_WEBHOOK_SECRET` is set correctly
- Verify the secret matches what AgentMail is using to sign webhooks
- Check Vercel logs for specific rejection reason (`signature_mismatch`, `timestamp_skew`, etc.)

### Cursor agent doesn't wake

- Verify `CURSOR_WEBHOOK_URL` and `CURSOR_WEBHOOK_KEY` are correct
- Check Vercel logs for `"evt": "webhook_forward", "ok": false"` or `upstreamStatus` != 200
- Verify the email sender is in `ALLOWLIST`
- Verify `event_type === "message.received"`

### Agent replies multiple times to same email

- Verify forwarder logs show `"async": true` in health check
- Check for multiple distinct `svix-id` values in logs (AgentMail may send multiple events)
- Verify dedupe is working (look for `"reason": "duplicate"` skips)
- Ensure agent webhook routine implements proper idempotency (see `templates/webhook-routine.md`)

### Empty allowlist

If `ALLOWLIST` is empty or unset, forwarder will reject ALL senders with reason `"allowlist_empty"`. This is fail-closed behavior.

## Success Criteria

✅ Local check scripts pass  
✅ Health endpoint returns 200 OK  
✅ Test email triggers Cursor agent wake  
✅ Agent replies successfully via AgentMail  
✅ Unsigned webhooks are rejected  
✅ Non-allowlisted senders are filtered  
✅ No secrets visible in git or logs  
✅ Dedupe prevents duplicate forwards  

## Related Documentation

- [Architecture](architecture.md) - How the webhook flow works
- [README](../README.md) - Deployment and configuration guide
- [templates/webhook-routine.md](../templates/webhook-routine.md) - Agent webhook routine template
