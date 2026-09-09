# Account API contract

The backend is maintained separately. These endpoints must be implemented before registration and account administration work. All paths below use the existing /api prefix. JSON errors: { "message": "User-facing error" } with an appropriate non-2xx status.

## Authentication

- POST /auth/register: { login, password }. Return 201 with { status: "pending" }, or 204. Create a pending user with role user; never issue a session here. Reject duplicate normalized logins with 409.
- POST /auth/login: { login, password }. Return { token, login, userId, role: "admin" | "user" }. Only active accounts may sign in. Return a clear 403 message for pending, rejected or blocked accounts. Existing admin sessions without a role need a new login after this update.
- PUT /auth/password: { currentPassword, password }. Authenticate the user, verify currentPassword, change the password and return 204. Revoke other sessions.

## Administration (active admin required)

- GET /admin/users: return an array of Account objects. The frontend polls this list every 30 seconds while the administration page is open and visible. Pending accounts appear as requests with a count in the administration UI.
- PATCH /admin/users/:id: accepts login, role, status; returns the complete updated Account.
- DELETE /admin/users/:id: delete the account and revoke sessions; return 204.
- DELETE /admin/users/:id/sessions: revoke all sessions for the user; return 204.

Account: { id: string, login: string, role: "admin" | "user", status: "pending" | "active" | "blocked" | "rejected", createdAt: ISO8601 string }.

Approval is PATCH { status: "active" }; rejection is PATCH { status: "rejected" }. Blocking is PATCH { status: "blocked" }. Enforce valid transitions and prevent self-deletion, self-demotion, self-blocking and removal of the last active administrator transactionally. Invalidate sessions when blocking/deleting or changing privileges. Check current database status/role on protected requests; client-side role checks are display controls only.

Validate and normalize input server-side, hash passwords with an established password hashing implementation, enforce at least 12 characters for new passwords, rate-limit login/registration, never return password hashes. Record actor, target, action and time for administrative changes. Restrict editable fields to an allowlist.

## Posters

PUT /videos/:id/poster: admin only, multipart/form-data with file field poster (JPEG, PNG or WebP, maximum 10 MiB). Validate actual image bytes and dimensions on the server, save under a server-generated name, return the complete VideoFile with posterUrl. Do not overwrite custom posters during library scans.
