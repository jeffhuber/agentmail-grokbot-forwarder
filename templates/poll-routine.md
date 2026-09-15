# Poll routine template — AgentMail backup

Use this as a **backup polling fallback** when webhooks are down or for scheduled check-ins (e.g., weekday morning).

**Primary path remains webhook-driven** (see `webhook-routine.md`). Use polling sparingly to avoid duplicate replies.

---

## A. Weekday morning poll intent (example)

```text
You are scheduled to poll your AgentMail inbox on weekday mornings (M-F, ~9 AM operator local time).

1. Check current time. If weekend or outside 8-10 AM window: exit quietly.
2. Fetch threads updated since your last-seen timestamp (or last 24 hours if no last-seen).
3. For each thread with unread messages from allowlisted senders:
   a. Extract the latest inbound message_id.
   b. BEFORE replying, inspect the thread. If that message_id already has a bot reply: skip (dedupe).
   c. If webhook already handled it: skip.
   d. Draft reply per desk persona.
   e. Send reply via AgentMail.
   f. ONLY AFTER send succeeds: update last-seen to that message_id / timestamp.
4. If send fails: leave last-seen unchanged; log the error.
5. Do NOT poll more than once per scheduled window.
```

---

## B. Manual on-demand poll (operator request)

```text
Operator asked you to "check email" or "poll inbox" manually.

1. Fetch threads updated since last-seen (or last 6 hours if unset).
2. For each thread with unread messages from allowlisted senders:
   a. Extract latest inbound message_id.
   b. BEFORE replying, inspect the thread. If message_id already has a bot reply: skip.
   c. Draft reply per desk persona.
   d. Send reply via AgentMail.
   e. ONLY AFTER send succeeds: update last-seen to that message_id / timestamp.
3. If send fails: leave last-seen unchanged; log the error.
4. Summarize: "Checked {{INBOX_ADDRESS}}, replied to N threads" or "No new messages."
```

---

## C. Last-seen rule (same as webhook)

```text
NEVER advance last-seen until AFTER a successful outbound send
(or an explicit logged decision that no reply is owed).

Wrong:  fetch message → bump last-seen → try send → fail → message lost
Right:  fetch message → send → confirm → THEN bump last-seen
```

---

## D. Dedupe between webhook + poll

- If webhook already replied to a message_id, polling should skip it (inspect thread first).
- If polling replied, webhook should skip on dedupe (event_id / svix-id seen).
- Prefer webhook as primary; poll is backup only.

---

## E. Rate limit / politeness

- Do not poll more than once per scheduled window.
- Do not poll continuously in a loop.
- Respect AgentMail API rate limits.

---

## F. Allowlist enforcement (same as webhook)

Only reply to messages from allowlisted email addresses. Non-allowlisted senders are ignored.

**Example allowlist**: `operator@example.com,you@example.com`

---

## Notes

- Replace `{{INBOX_ADDRESS}}` and `{{ALLOWLIST_EMAILS}}` with your actual values.
- Combine with `agentmail-desk-persona.md` and `webhook-routine.md` for complete coverage.
- Webhook is real-time; polling is backup. Do not duplicate replies.
