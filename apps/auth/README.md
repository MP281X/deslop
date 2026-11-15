# Auth

Deslop's identity authority. Apps POST an IdentifyRequest to /api/identify from Auth's machine and receive Account JSON, 401 sign-in text or 403 access-denied text.

Callers resolve through a shared browser cookie, this machine's tailnet owner (or an allowed on-behalf claim), then Tailscale whois. Tagged nodes do not identify people. GitHub tailnet logins use GitHub ids; other providers use tailnet logins. Tailnet invitations approve access.

Browser sign-in uses GitHub OAuth with PKCE. Return URLs must use HTTPS on APP_URL's parent domain or its subdomains (same-origin in local mode). The shared Secure, HttpOnly, SameSite=Lax cookie lasts 365 days; sessions expire after 30 days unused. Sign-out revokes the session across apps.

The home page shows the account and browser sessions; admins also manage people and access requests. MCP offers only list_people, remove_person, list_sessions and sign_out_session. Removing a person deletes sessions; a tailnet person returns on their next request.

Without AUTH_URL the account is the local developer. Configure APP_URL, GITHUB_ADMINS, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET for hosted sign-in.
