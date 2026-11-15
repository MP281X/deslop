# Auth

Deslop's identity authority. Apps POST an IdentifyRequest to /api/identify from Auth's machine and receive Account JSON, 401 sign-in text or 403 access-denied text.

```bash
npm install --global @deslop/auth
auth service install --domain mp281x.xyz --admins <github-id> --github-client-id <client-id>
```

Callers resolve through a shared browser cookie, this machine's tailnet owner (or an allowed on-behalf claim), then Tailscale whois. Tagged nodes do not identify people. GitHub tailnet logins use GitHub ids; other providers use tailnet logins. Tailnet invitations approve access.

Browser sign-in uses GitHub OAuth with PKCE. Return URLs must use HTTPS on the configured domain or its subdomains (same-origin in local mode). The shared Secure, HttpOnly, SameSite=Lax cookie lasts 365 days; sessions expire after 30 days unused. Sign-out revokes the session across apps. An iOS app opens `/sign-in?app=<scheme>` in iOS's authentication sheet (scheme `^[a-z]+(-dev)?$`); the GitHub callback creates the session and redirects to `<scheme>://signed-in?session=<secret>`, the shared cookie's value, which the sheet hands only to the app that opened it.

The home page shows the account and browser sessions; admins also manage people and access requests. MCP offers only list_people, remove_person, list_sessions and sign_out_session. Removing a person deletes sessions; a tailnet person returns on their next request.

Without `DESLOP_DOMAIN` (`--domain`) the account is the local developer, an admin. For hosted sign-in configure the domain, `GITHUB_ADMINS`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Auth alone owns the admin list and includes `admin` in each identity answer based on its people roles.
