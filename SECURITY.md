# Security Policy

## Supported Versions

This project is experimental and actively maintained. Security updates are applied to the latest version only.

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. **Do** open a private [GitHub Security Advisory](https://github.com/jeffhuber/agentmail-grokbot-forwarder/security/advisories/new).
3. Alternatively, email security concerns to: [security@example.com] (replace with your security contact).

Please include:

- A clear description of the vulnerability
- Steps to reproduce (if applicable)
- Potential impact
- Any suggested fixes (optional)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation timeline within 7 days.

## Security Features

This forwarder implements multiple security layers:

- **Webhook signature verification** (Svix/Standard Webhooks) with fail-closed behavior
- **Email allowlist** with deny-all default when empty
- **Dedupe** to prevent replay attacks
- **Rate limiting** per sender
- **No secrets in git** - all sensitive values in environment variables
- **Async acknowledgment** to prevent AgentMail redelivery storms

## Best Practices

When deploying this forwarder:

1. Always set `REQUIRE_AGENTMAIL_SIGNATURE=1` in production
2. Never commit real `whsec_` secrets, Bearer tokens, or webhook URLs to git
3. Use strong, randomly generated webhook secrets
4. Keep the `ALLOWLIST` as restrictive as possible
5. Monitor logs for `webhook_reject` and `webhook_skip` events
6. Rotate webhook secrets periodically
7. Never set `ALLOW_UNSIGNED_WEBHOOKS=1` in production
