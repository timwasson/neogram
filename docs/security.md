# Neogram Security Architecture & Threat Model

> **Responsible Disclosure Contact:** `sysop@neogram.club`

This document details Neogram's threat model, security invariants, cryptographic foundations, operational checklists, and known accepted risks.

---

## 1. Threat Model & Trust Boundaries

Neogram connects two distinct security contexts:
1. **The Authenticated Workstation (`https://neogram.club`):** A modern, session-authenticated web app for creators to manage their static sites, chat with peers, and broadcast photos.
2. **Untrusted Third-Party Personal Static Sites (`*.neocities.org`, `*.nekoweb.org`, etc.):** Static sites where creators host embeddable Neogram widgets (hit counters, guestbooks, comments, pagers) visited by arbitrary anonymous web users.

### Security Invariants & Core Boundaries:
- **Zero Server Media Retention:** Photos staged for static publishing are optimized, pushed to the user's remote host, and wiped from local disk immediately upon upload confirmation. The server retains 0 bytes of user media.
- **Remote Host Source of Truth:** Live `feed.json` manifests on user static sites represent the sole source of truth. If a station is wiped via FTP, Neogram reflects that immediately without resurrecting deleted posts from central databases.
- **Isolated Static Subdirectory:** Compilations target isolated folders (`/neogram/` by default). Root homepages, blogs, and other remote files are never touched or deleted.
- **Fail-Closed Runtime:** If `NODE_ENV` is unset or blank, the system fails closed to `production` mode, disabling all development fallbacks and demo conveniences.

---

## 2. Comprehensive Security Controls

### 2.1 Authentication & Session Integrity
- **Passwordless OTP with Keyed Hashing:** `POST /api/auth/request-otp` stores strictly an HMAC-SHA256 keyed hash (`code_hash`) of the 6-digit code in `otp_challenges`. Plaintext codes are never stored in the database.
- **Deferred User Provisioning:** Accounts are created only after successful code verification (`POST /api/auth/verify-otp`). Unverified identifier spam cannot create ghost accounts or exhaust numeric UIN sequences.
- **Persisted Attempt Counters & Code Burning:** Challenge verification attempts are persisted in PostgreSQL. After 5 incorrect attempts, the challenge is immediately burned (deleted). Generic error responses prevent account enumeration.
- **Stateless HS256 JWTs:** JWTs are signed and verified with algorithm explicitly pinned to `HS256`. Requests with `alg: none` or foreign signatures are rejected.
- **URL Token Prohibition:** Tokens are strictly rejected from URL query parameters (`?token=`) on all HTTP endpoints, preventing credential leaks in logs, browser history, and HTTP `Referer` headers (the only exception is `/ws/chat?token=` for extension WebSocket handshakes).
- **Immutable SysOp Whitelist:** Administrative privileges (`/admin`, `/api/admin/*`) are governed by `ADMIN_EMAILS`, which is cached once in an immutable set on boot. Privileges cannot be elevated at runtime without a server restart.

### 2.2 Scoped Cyber-Pass SSO & Widget Security
- **Explicit User Consent Screen:** Cross-domain authorization at `/auth/connect` displays the requesting destination origin and scope. Tokens are never dispatched automatically without explicit user approval.
- **Destination Validation:** The requesting origin and optional return URL must use standard `http:` or `https:` protocols, contain no embedded credentials (`user:pass@`), and match exactly. Wildcard origins (`*`) are prohibited.
- **Scoped 1-Hour Pass Tokens:** Authorizations issue tokens scoped with `{ scope: 'pass' }` valid for 1 hour. Pass tokens are strictly permitted on social endpoints (likes, comments, guestbook, pager DM) and rejected on all settings, publishing, and administrative routes via `verifySessionToken(token, allowPass = false)`.
- **Exact-Origin postMessage & Receiver Origin Checks:** Popups communicate tokens back via `window.opener.postMessage(..., destinationOrigin)`. Embed widgets validate `event.origin` before accepting tokens.

### 2.3 Network, SSRF & Edge Protections
- **SSRF Defense with Socket-Level Inspection (`safeGet`):** All outbound server fetches for user-supplied URLs (feeds, remote JSON) must use `safeGet` (`server/utils/safeFetch.ts`). IP addresses are validated inside the socket's `lookup` hook, defeating DNS-rebinding attacks.
- **Private Subnet & Cloud Metadata Blocking:** Resolves are blocked for loopback (`127.0.0.0/8`, `::1`), RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / cloud metadata (`169.254.169.254`, `fe80::/10`), CGNAT (`100.64.0.0/10`), and IPv6 ULA/multicast (`fc00::/7`, `ff00::/8`).
- **Site URL Validation:** Site URLs saved in settings are pre-validated on ingress using `isSafePublicUrl`. In production, only public `https://` URLs are accepted.
- **Federated Feed Ownership Rule:** Untrusted remote `feed.json` files cannot spoof identity or ownership. `federatedFriends.ts` strictly ignores any `userId` or `siteId` declared in remote JSON; the verified local database friend record alone dictates attribution.

### 2.4 Browser Security & Headers
- **CORS Boundary:** Third-party origins are never granted credentialed access (`Access-Control-Allow-Credentials: true` is never returned to third-party domains). Public embed endpoints accept Bearer tokens only.
- **CSRF Origin Guard:** All mutating state changes (`POST`, `PUT`, `DELETE`, `PATCH`) authenticated via cookies must pass `validateCsrfOrigin`. The `Origin` or `Referer` header must match `APP_URL`. Pure Bearer clients (browser extensions, API consumers) are unaffected.
- **Content Security Policy (CSP):** Baseline workstation CSP enforces `default-src 'self'`, `frame-ancestors 'self'`, and `X-XSS-Protection: 0`. Embed routes explicitly permit embedding via `frame-ancestors *`.
- **Safe HTML Output:** Dynamic user content, including marquee announcements and user handles, is properly escaped to prevent stored XSS.

### 2.5 Storage, Concurrency & Image Hardening
- **Crypto v2 Vault & Zero-Downtime Key Rotation:** Sensitive credentials (Neocities/Nekoweb API keys) are encrypted using AES-256-GCM with `scrypt`-derived keys under the `NGv2` envelope: `[4-byte "NGv2"][12-byte IV][16-byte AuthTag][Ciphertext]`. `ENCRYPTION_SECRET_PREVIOUS` allows seamless decryption and automatic upgrade of records encrypted with an earlier key.
- **Atomic File Writes & Mutex Serialization:** Static JSON files (`posts.json`, `feed.json`, comments) are serialized through an in-memory per-station async `Mutex` and written with `writeFileAtomic` (atomic rename from a temporary file). Readers never observe partially written or corrupt JSON under heavy concurrency.
- **Like De-Duplication & Debouncing:** Likes are tracked in `post_likes` (one per user/IP hash). Static site builds and remote pushes triggered by likes are debounced with a 20-second coalescing window.
- **Hit Counter De-Duplication:** Web counter hits are de-duplicated per visitor IP per 30-minute sliding window; repeat loads within the window read current counts without incrementing. Counter increments are clamped to positive values.
- **Media Upload Pipeline:** Strictly whitelists image MIME types (`image/jpeg`, `image/png`, `image/webp`, `image/gif`). SVG uploads are blocked to eliminate stored SVG script injection. Sharp image decodes enforce a 50-megapixel cap and limit concurrency to 2 parallel tasks.

---

## 3. Operator Security Checklist

When deploying or maintaining a production Neogram node:

1. **Secrets Generation:** Generate high-entropy 48-byte hex secrets:
   ```bash
   openssl rand -hex 48 # For JWT_SECRET
   openssl rand -hex 48 # For ENCRYPTION_SECRET
   openssl rand -hex 32 # For POSTGRES_PASSWORD
   ```
2. **Never Enable Demo Mode in Production:** Ensure `ALLOW_DEMO_OTP` is `false` or unset. (The application ignores `ALLOW_DEMO_OTP` when `NODE_ENV=production` as a defense-in-depth measure.)
3. **Configure Admin Access:** Set `ADMIN_EMAILS=sysop@yourdomain.com` in `.env`.
4. **Key Rotation Procedure:**
   - To rotate `ENCRYPTION_SECRET`: Set `ENCRYPTION_SECRET_PREVIOUS` to your current `ENCRYPTION_SECRET`, and set `ENCRYPTION_SECRET` to a newly generated secret. Restart the server. Existing credentials remain readable and upgrade to the new key on subsequent saves.
   - To rotate `JWT_SECRET`: Generate a new `JWT_SECRET` and restart the server. This invalidates all active sessions and Cyber-Pass tokens, requiring users to log in again.
5. **Backups:** Perform automated nightly PostgreSQL database dumps:
   ```bash
   pg_dump -U neogram neogram_db > /opt/backups/neogram_$(date +%F).sql
   ```
   Retain tarballs of the persistent Docker volumes (`static_galleries` and `public_uploads`).

---

## 4. Known Accepted Risks

- **Inline Scripts in Templates (`'unsafe-inline'`):** Workstation Nunjucks views (`views/index.njk`, `docs.njk`) currently rely on inline script blocks for tab orchestration, requiring `'unsafe-inline'` in `script-src` and `style-src`. Migration to external scripts with cryptographic nonces is scheduled.
- **Indirect Dependency Vulnerability (`archiver` -> `readdir-glob` -> `minimatch`):** `archiver ^8.0.0` pulls `readdir-glob` which references `minimatch 7.0.0 - 11.0.0` (moderate ReDoS). Running `npm audit fix --force` would downgrade `archiver` to `v7` (breaking change). The archiver is used strictly server-side on trusted local station build files.
- **Stateless Session Revocation Window:** User sessions use 7-day stateless JWTs without individual database revocation checks. Banning a user immediately freezes their account on authenticated routes, but rotating `JWT_SECRET` is required to globally revoke all issued tokens.
- **Single-Instance In-Memory State:** Rate limiters, live chat presence, static build queues, like debouncers, and counter de-duplication caches operate in-process and assume a single primary application process.

---

## 5. Security & Verification Testing

The Neogram codebase includes automated regression suites to enforce these invariants:

```bash
# Hermetic integration test suite (31 security assertions)
npm run test:security

# Pure unit tests (safeFetch IP/URL tables, mock safeGet, crypto v2, Mutex, atomicFile)
npm run test:unit
```
Both suites run hermetically in isolated memory sandboxes (`server/tests/helpers/sandbox.ts`) without connecting to external networks or live databases.
