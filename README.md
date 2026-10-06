# VegaChat

A real-time chat application: one-to-one messaging and group chats with role-based permissions, built so that every REST call and every socket event proves who the user is and checks what they are allowed to do.

**Live demo: https://vegachat.onrender.com**

- Sign in with any of the demo buttons on the login page (password `Password123!`), or create an account.
- To see the real-time features, sign in as two different users in two browsers, or one normal and one private window.
- The demo runs on free hosting that sleeps when idle, so **the first load can take about a minute**. Shared files and images do not survive a restart of the service; messages do.

| | |
|---|---|
| Frontend | React 18 (Vite), Tailwind CSS, Zustand, React Router |
| Backend | Node.js 20, Express, Socket.IO |
| Database | PostgreSQL 16 (bundled container, or Supabase) |
| Language | JavaScript (ES modules) with shared enums, JSDoc-typed payloads and zod validation |

## Contents

1. [Run it](#1-run-it)
2. [Demo accounts](#2-demo-accounts)
3. [Tests](#3-tests)
4. [Project layout](#4-project-layout)
5. [Database schema](#5-database-schema)
6. [REST API](#6-rest-api)
7. [Socket events](#7-socket-events)
8. [How authorization works for sockets](#8-how-authorization-works-for-sockets)
9. [Authentication and tokens](#9-authentication-and-tokens)
10. [How each requirement is met](#10-how-each-requirement-is-met)
11. [Known limitations and trade-offs](#11-known-limitations-and-trade-offs)
12. [Deploying a live demo](#12-deploying-a-live-demo)

---

## 1. Run it

### Option A: Docker (one command)

Requires Docker Desktop. Nothing else needs to be installed.

```bash
docker compose up --build
```

Open **http://localhost:8080**. The first start creates the schema and inserts the demo data.

| Service | Address |
|---|---|
| App (nginx serving the client, proxying the API) | http://localhost:8080 |
| API | http://localhost:4000 |
| Postgres | `localhost:5433`, user / password / database `vegachat` |

Postgres is published on **5433** so it cannot clash with a Postgres already installed on 5432. Stop with `docker compose down`; add `-v` to also delete the data.

### Option B: Supabase as the database

The server talks to Postgres through a plain connection string, so Supabase needs no code changes.

1. Create a project at [supabase.com](https://supabase.com) (the free tier is enough).
2. In the dashboard choose **Connect** and copy the **Session pooler** connection string. Replace `[YOUR-PASSWORD]` with the database password.
3. Give it to the server, either way:

   **With Docker**: create `.env` next to `docker-compose.yml`:
   ```
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATABASE_SSL=true
   ```
   then `docker compose up --build`.

   **Without Docker**: put the same two lines in `server/.env` and follow Option C.

On first start the server creates its tables in the `public` schema and seeds them. Two things were done specifically for Supabase:

- **Row level security is enabled on every table, with no policies** ([002_row_level_security.sql](server/src/db/migrations/002_row_level_security.sql)). Supabase exposes `public` tables through an auto-generated API that anyone holding the project's anon key can call; without RLS that would publish password hashes and every message. The Node server connects as the table owner, which bypasses RLS.
- **Migrations use a transaction-scoped advisory lock**, so they also work through the transaction pooler (port 6543).

Supabase Auth is not used: authentication is implemented in this backend (bcrypt + JWT), as described in [section 9](#9-authentication-and-tokens).

> The live demo runs on Supabase through the Session pooler, so this path is in use. The automated test results below were produced on the bundled Postgres (Options A and C).

### Option C: Local development with hot reload

Requires Node.js 20+ and a Postgres database (the bundled one, or Supabase).

```bash
# 1. Database: just the Postgres container (skip if using Supabase)
docker compose up -d db

# 2. API on http://localhost:4000
cd server
cp .env.example .env        # Windows: copy .env.example .env
npm install
npm run dev                 # runs migrations and seeds on start

# 3. Client on http://localhost:5173 (new terminal)
cd client
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` and `/socket.io` to the server, so the browser deals with a single origin.

Useful server scripts: `npm run migrate`, `npm run seed`, `npm run seed:reset` (wipe and re-seed).

---

## 2. Demo accounts

All six use the password **`Password123!`**. The login page has a button for each.

| Email | In "Product Launch" | In "Weekend Trek" |
|---|---|---|
| rahul@example.com | Owner | Member |
| priya@example.com | Admin | |
| arjun@example.com | Member | Member |
| sneha@example.com | Member | Member |
| vikram@example.com | | Admin |
| ananya@example.com | | Owner |

Seeded: 6 users, 2 groups, 4 direct conversations and about 100 messages. "Product Launch" has 52 messages so the infinite scroll has something to page through, and several conversations start with unread messages.

To see the real-time behaviour, sign in as two users in two different browsers (or one normal and one private window).

---

## 3. Tests

```bash
cd server
npm install

# Unit tests for the group permission rules. No database needed.
npm test

# The same, plus end-to-end tests against a running server.
E2E_BASE_URL=http://localhost:8080 npm test          # PowerShell: $env:E2E_BASE_URL="http://localhost:8080"; npm test
```

**87 tests, all passing.**

- **[permissions.test.js](server/test/permissions.test.js)** (47 tests): the full role and action matrix written out explicitly, rank comparisons, remove / promote / demote / transfer rules, and rejection of unknown roles and actions.
- **[api.e2e.test.js](server/test/api.e2e.test.js)** (40 tests): real HTTP and real sockets. Covers, among others:
  - the refresh cookie is `HttpOnly`; tampered and `alg: none` tokens are rejected; logout kills the session; refresh is refused from a foreign origin;
  - sockets with no token or a bad token are refused at the handshake;
  - five simultaneous "start chat" requests from both sides produce exactly one direct conversation;
  - every group endpoint, tried as outsider, member, admin and owner;
  - sending to a conversation you are not in is rejected and nobody receives it;
  - a removed member's **still-connected** socket receives nothing further and can no longer send;
  - the same message id sent four times is stored and broadcast once;
  - cursor pagination returns every message once, in order;
  - offline delivery, unread counts, read receipts, edit / delete / reactions;
  - a user with two connections goes offline only when the second closes;
  - ten rapid `typing:start` events reach the room as one;
  - upload validation (type, disguised content, size) and attachment access control.

The UI was additionally exercised in a headless browser with two signed-in users (live delivery, ticks, typing, infinite scroll position, role-gated controls, instant removal, the reconnect banner with offline queueing, dark mode and a phone-sized viewport).

---

## 4. Project layout

```
shared/                 Imported by BOTH server and client
  constants.js          Role, ConversationType, ErrorCode, Limits ... (no magic strings)
  events.js             Every socket event name + a JSDoc typedef for every payload
  permissions.js        The group permission rules as pure functions

server/src/
  config.js             Environment, validated at start-up
  db/                   Pool, migrations (plain SQL), seed
  validation/           zod schemas: one per REST input, one per socket event
  middleware/           authenticate, validate, error handler
  services/             All business logic and all authorization decisions
    access.js           The two membership checks everything goes through
    groupService.js     Role-gated group management
    messageService.js   Send, history, edit, delete, reactions, receipts
  routes/               Thin REST handlers
  realtime/
    socketServer.js     Handshake auth, room joins, presence
    handlers.js         One wrapper for every client -> server event
    gateway.js          The only code that names rooms and emits

client/src/
  lib/                  API client (token refresh), socket client, formatting
  store/                Zustand stores: auth, chat, ui
  pages/ components/    React + Tailwind
```

How the JavaScript stays disciplined without TypeScript:

- **Enums, not strings.** `Role.OWNER`, `ServerEvent.MESSAGE_NEW`, `ErrorCode.FORBIDDEN` are frozen objects in `shared/`, used on both sides. The database `CHECK` constraints hold the same values.
- **Every socket payload has a documented shape.** [shared/events.js](shared/events.js) has a JSDoc typedef for each event in both directions.
- **One validation path.** REST input goes through `validate()` and handlers read only `req.valid`. Socket input goes through one wrapper in [handlers.js](server/src/realtime/handlers.js), which refuses to register an event that has no schema. Objects are `.strict()`, so unknown fields are rejected rather than ignored.
- **One error shape.** REST: `{ "error": { code, message, details? } }`. Socket ack: `{ ok: false, error: { code, message, details? } }`.

---

## 5. Database schema

Defined in [001_init.sql](server/src/db/migrations/001_init.sql).

```
users ──────────────< refresh_tokens
  │
  ├──< conversation_members >── conversations
  │                                  │
  ├──< messages >────────────────────┤
  │       │                          │
  │       ├──< message_reactions     │
  │       │                          │
  └──< attachments >─────────────────┘
          └── (0..1) message
```

### Tables

**`users`**: `id uuid PK`, `email citext UNIQUE`, `display_name`, `password_hash`, `avatar_url`, `last_seen_at`, `created_at`.
`citext` makes email comparison case-insensitive at the database level, so `Rahul@x.com` cannot register alongside `rahul@x.com`.

**`refresh_tokens`**: `id`, `user_id FK`, `family_id`, `token_hash UNIQUE`, `expires_at`, `rotated_at`, `revoked_at`.
Only a SHA-256 hash is stored, so a database leak does not yield usable sessions. `family_id` groups every token descended from one login so the whole chain can be revoked together. `rotated_at` (normal use) and `revoked_at` (logout or theft) are separate on purpose: only a recently *rotated* token gets the multi-tab grace period.

**`conversations`**: `id`, `type ('direct' | 'group')`, `name`, `avatar_url`, `direct_key UNIQUE`, `created_by`, `last_message_seq`, `last_activity_at`, `created_at`.
One table for both kinds, so messages, membership and receipts share a single code path. `direct_key` is `"<smaller user id>:<larger user id>"`; its `UNIQUE` constraint is what guarantees one direct conversation per pair. A `CHECK` ensures direct rows have a key and no name, and group rows the reverse. `last_message_seq` and `last_activity_at` are denormalised so the sidebar can sort and count without scanning messages.

**`conversation_members`**: `PK (conversation_id, user_id)`, `role ('owner' | 'admin' | 'member')`, `last_read_seq`, `last_delivered_seq`, `joined_at`.
Membership, role and receipts in one row. The two `*_seq` columns are **watermarks**: "this user has read / received every message up to N".

**`messages`**: `id uuid PK` (client-generated), `seq bigint identity`, `conversation_id FK`, `sender_id FK`, `type ('text' | 'system')`, `body`, `created_at`, `edited_at`, `deleted_at`.
The primary key is chosen by the sending client and doubles as the idempotency key. `seq` is the ordering, the pagination cursor and the unit of read receipts. Deletion is soft (a tombstone with an empty body) so history and cursors stay stable.

**`message_reactions`**: `PK (message_id, user_id, emoji)`. The key itself makes "add reaction" idempotent.

**`attachments`**: `id`, `conversation_id FK`, `uploader_id FK`, `message_id UNIQUE FK (nullable)`, `original_name`, `mime_type`, `size_bytes`, `storage_key UNIQUE`.
Uploaded first, then claimed by exactly one message.

Every foreign key is `ON DELETE CASCADE` (except `conversations.created_by`, which is `SET NULL`), so deleting a group removes its members, messages, reactions and attachment rows in one statement.

### Indexes and why each exists

| Index | Serves |
|---|---|
| `messages (conversation_id, seq)` UNIQUE | History pagination (`seq < cursor ORDER BY seq DESC LIMIT n`), the "latest message" lookup for the sidebar, and the unread count (`seq > last_read_seq`). The one index the hot paths depend on. |
| `conversation_members` PK `(conversation_id, user_id)` | "Is this user in this conversation?", the authorization check on almost every request, and "who is in this conversation?". |
| `conversation_members (user_id)` | "Which conversations is this user in?": the sidebar, and the room joins on every socket connection. |
| `conversation_members (conversation_id) WHERE role = 'owner'` UNIQUE | Not for speed: makes a second owner impossible, whatever the application does. |
| `conversations (direct_key)` UNIQUE | Direct-conversation uniqueness, and the lookup of an existing one. |
| `users (email)` UNIQUE | Login lookup; one account per email. |
| `users USING gin (display_name gin_trgm_ops)`, `gin ((email::text) gin_trgm_ops)` | User search uses `ILIKE '%term%'`, which a B-tree cannot serve. Trigram indexes keep it off a sequential scan as the table grows. |
| `refresh_tokens (token_hash)` UNIQUE | Refresh lookup. |
| `refresh_tokens (family_id)`, `(user_id)` | Revoking a session family; the FK cascade. |
| `attachments (message_id)` UNIQUE | "Attachment of this message" (joined into every message read), and one attachment per message. |
| `attachments (conversation_id)` | Collecting files to delete with a group; the FK cascade. |

### Three design decisions worth explaining

**Watermarks instead of a receipt row per message per reader.** A 50-person group with 10,000 messages would need up to 500,000 receipt rows; here it needs 50 integers. Unread count is `count(*) WHERE seq > last_read_seq AND sender <> me`; "seen by X of Y" is the number of members whose `last_read_seq >= message.seq`; a direct message is *read* when the peer's `last_read_seq` reaches it and *delivered* when `last_delivered_seq` does. The cost is that there is no per-message "read at" timestamp.

**`seq` is strictly ordered per conversation.** Identity columns hand out numbers at insert time, not commit time, so two concurrent inserts could commit out of order, and a client that had already read up to 11 would then never see 10. Every write to a conversation first takes `SELECT ... FOR UPDATE` on the conversation row ([access.js](server/src/services/access.js)), so inserts within one conversation are serialised and `seq` order equals commit order.

**That same lock closes the gap between checking and acting.** The role is read under the lock inside the transaction that performs the write, so a member cannot be demoted between "check they are an admin" and "let them remove someone".

---

## 6. REST API

All bodies are JSON. Everything except `/api/auth/*` and `/api/health` requires `Authorization: Bearer <access token>`.

| Method and path | Who | Purpose |
|---|---|---|
| `POST /api/auth/signup` | anyone | Create an account. Returns `{ user, accessToken, expiresIn }` and sets the refresh cookie. |
| `POST /api/auth/login` | anyone | Same response. |
| `POST /api/auth/refresh` | refresh cookie | Rotate the refresh token, return a new access token. |
| `POST /api/auth/logout` | refresh cookie | Revoke the session on every tab. |
| `GET /api/auth/me` | signed in | Current user. |
| `GET /api/users/search?q=` | signed in | Find people by name or email prefix. |
| `GET /api/conversations` | signed in | The caller's conversations with last message, unread count and peer presence. |
| `POST /api/conversations/direct` | signed in | Open the direct conversation with `userId`; `201` if created, `200` if it existed. |
| `POST /api/conversations/group` | signed in | Create a group; the caller becomes owner. |
| `GET /api/conversations/:id` | member | Conversation and member list. |
| `GET /api/conversations/:id/messages?before=&after=&limit=` | member | Cursor-paginated history. |
| `PATCH /api/conversations/:id` | admin, owner | Rename / change avatar. |
| `POST /api/conversations/:id/members` | admin, owner | Add members. |
| `DELETE /api/conversations/:id/members/:userId` | admin (members only), owner (anyone but self); any non-owner for themselves | Remove a member, or leave. |
| `PATCH /api/conversations/:id/members/:userId` | owner | Promote to admin / demote to member. |
| `POST /api/conversations/:id/transfer-ownership` | owner | Hand the group to another member. |
| `DELETE /api/conversations/:id` | owner | Delete the group. |
| `POST /api/conversations/:id/attachments` | member | Upload one file (multipart field `file`). |
| `GET /api/attachments/:id` | member of its conversation | Download. |

Non-members get `403` for every conversation route, whether or not the conversation exists, so the response cannot be used to probe for ids.

---

## 7. Socket events

Names are the enums in [shared/events.js](shared/events.js), where each payload also has a JSDoc typedef. Shapes are enforced by [socketSchemas.js](server/src/validation/socketSchemas.js).

**Connection**: `io(url, { auth: { token: <access token> } })`. There is no event for joining or leaving a room.

**Acknowledgements**: every client event takes a callback and is answered with
`{ ok: true, data }` or `{ ok: false, error: { code, message, details? } }`.

### Client → server

| Event | Payload | Who may emit | Ack `data` |
|---|---|---|---|
| `message:send` | `{ id: uuid, conversationId: uuid, body?: string(1..4000), attachmentId?: uuid }`. `body` may be omitted only with an attachment | A current member of `conversationId` | `{ message }` |
| `message:edit` | `{ messageId: uuid, body: string(1..4000) }` | The message's sender, while still a member | `{ message }` |
| `message:delete` | `{ messageId: uuid }` | The message's sender, within 10 minutes of sending | `{ conversationId, messageId, deletedAt }` |
| `message:react` | `{ messageId: uuid, emoji: one of 8 allowed, action: 'add' \| 'remove' }` | A current member of the message's conversation | `null` |
| `conversation:read` | `{ conversationId: uuid, seq: int }` | A current member | `{ conversationId, userId, lastReadSeq, lastDeliveredSeq }` |
| `conversation:delivered` | `{ conversationId: uuid, seq: int }` | A current member | same |
| `typing:start` | `{ conversationId: uuid }` | A current member | `null` |
| `typing:stop` | `{ conversationId: uuid }` | A current member | `null` |
| `auth:refresh` | `{ token: string }` | The socket's own user, with a newer access token | `{ expiresAt }` |

No payload carries a sender or user id: the server always uses the identity from the verified handshake token.

### Server → client

| Event | Payload | Sent to |
|---|---|---|
| `session:ready` | `{ userId, serverTime }` | The connecting socket, once it has joined all of its rooms |
| `auth:expired` | `{ message }` | A socket whose token ran out, immediately before it is disconnected |
| `message:new` | `{ message }` | Every member of the conversation (including the sender's other tabs) |
| `message:updated` | `{ message }` | Every member |
| `message:deleted` | `{ conversationId, messageId, deletedAt }` | Every member |
| `message:reaction` | `{ conversationId, messageId, userId, emoji, action }` | Every member |
| `receipt:update` | `{ conversationId, userId, lastReadSeq, lastDeliveredSeq }` | Every member |
| `typing:update` | `{ conversationId, userId, displayName, isTyping }` | Every member except the typist |
| `presence:update` | `{ userId, online, lastSeenAt }` | Everyone who shares at least one conversation with that user |
| `conversation:added` | `{ conversation }` | Only the user who gained the conversation, in their own per-user view |
| `conversation:updated` | `{ conversationId, name, avatarUrl }` | Every member |
| `conversation:removed` | `{ conversationId, reason: 'removed' \| 'left' \| 'deleted' }` | The removed / leaving user only; or every member when the group is deleted |
| `member:added` | `{ conversationId, members: Member[] }` | Every member |
| `member:removed` | `{ conversationId, userId }` | The remaining members |
| `member:role` | `{ conversationId, changes: [{ userId, role }] }` | Every member |

`Message`: `{ id, seq, conversationId, senderId, sender: { id, displayName, avatarUrl }, type, body, attachment: { id, name, mimeType, size } | null, reactions: [{ emoji, userIds }], createdAt, editedAt, deletedAt }`.

Group management (add, remove, roles, rename, delete) is done over REST; its *results* are pushed over the socket events above.

---

## 8. How authorization works for sockets

**1. The handshake.** `io.use()` middleware ([socketServer.js](server/src/realtime/socketServer.js)) verifies the access token (signature, expiry, pinned `HS256`, issuer) and loads the user before the connection exists. A socket that fails is refused there: it never reaches the `connection` handler, is never in a room, and cannot send or receive a single event.

**2. Identity comes only from that token.** `socket.data.userId` is set once, server-side. Payload schemas are strict, so a forged `senderId` field is a validation error, not something silently ignored.

**3. Rooms are assigned by the server, from the database.** On connect, the server reads the user's memberships and joins the socket to `user:<id>` and one `conv:<id>` per conversation. Clients have no join event, so "join a room you do not belong to" is not a request that can be made. The membership list is read a second time after joining, to catch a removal that committed while the first read was in flight.

**4. Every event is authorized again when it arrives.** One wrapper ([handlers.js](server/src/realtime/handlers.js)) handles every client event, in this order: token still valid → rate limit → schema validation → handler. The handler then checks the specific resource:
   - `message:send`, `conversation:read`, `conversation:delivered`: membership is checked **in the database**, in the same transaction as the write. Changing `conversationId` in the browser to one you are not in returns `FORBIDDEN` and nothing is stored or broadcast.
   - `message:edit`, `message:delete`, `message:react`: the message is loaded, membership of its conversation is checked, then ownership (edit/delete) and the 10-minute window (delete). A message in a conversation you cannot see returns `NOT_FOUND`, the same as one that does not exist.
   - `typing:*`: checked against the socket's room set, which mirrors the database (point 5), to avoid a query per keystroke.

**5. Removal takes effect immediately.** When a member is removed, the service commits, then calls `socketsLeave` on every socket of that user before notifying anyone ([groupService.js](server/src/services/groupService.js)). From that point their open connection receives nothing from the group, without a refresh or reconnect. Their next send fails the database check regardless.

**6. Long-lived connections and token expiry.** The server arms a timer for the moment the handshake token expires. The client refreshes its access token about a minute early and sends it with `auth:refresh`; the server verifies it, confirms it belongs to the same user, and re-arms the timer. If no valid token arrives, the socket gets `auth:expired` and is disconnected. Independently of the timer, the wrapper rejects any event arriving after expiry. The client reacts to a server-side disconnect by refreshing and reconnecting; if the refresh is refused, the user is signed out.

**7. The same rules for REST and sockets.** Both call the same service functions. The role rules themselves are pure functions in [shared/permissions.js](shared/permissions.js); the client imports them too, but only to decide which buttons to show.

**8. Abuse limits.** Per-socket token buckets (messages: burst 20, then 2/s; signals: burst 40, then 10/s) and a 64 KB frame limit.

---

## 9. Authentication and tokens

- **Passwords**: bcrypt, cost 11 (`bcryptjs`, a pure-JavaScript implementation of the same algorithm, chosen so the image needs no native build tools). Login compares against a dummy hash when the email is unknown, so both failures take the same time and return the same message.
- **Access token**: a JWT (HS256, 15 minutes), kept **in memory only** in the browser, sent as `Authorization: Bearer`. It is never in `localStorage`, so an injected script cannot lift a durable credential.
- **Refresh token**: an opaque 48-byte random string in an **`HttpOnly`, `SameSite=Lax` cookie scoped to `/api/auth`** (7 days). It is opaque rather than a JWT so that it can be revoked: the database holds its hash.
- **Rotation and reuse detection**: each refresh issues a new token and marks the old one rotated. Presenting a token that was rotated long ago means it was copied, and revokes the whole session family. A 20-second grace covers two tabs refreshing at once; the client also serialises refreshes across tabs with the Web Locks API.
- **CSRF**: the only cookie-authenticated endpoints are refresh and logout; `SameSite=Lax` keeps the cookie off cross-site POSTs, and the server additionally rejects those two calls when the `Origin` header is not an allowed origin.
- **Other hardening**: `helmet` headers on the API; a Content-Security-Policy on the app (no inline scripts, scripts only from its own origin); rate limiting on login and signup; CORS restricted to configured origins.

---

## 10. How each requirement is met

| Requirement | Where |
|---|---|
| Signup / login, bcrypt | [authService.js](server/src/services/authService.js) |
| JWT access + refresh in httpOnly cookie | [routes/auth.js](server/src/routes/auth.js), [tokens.js](server/src/lib/tokens.js) |
| Sockets authenticated at handshake | `authenticateSocket` in [socketServer.js](server/src/realtime/socketServer.js) |
| Token expiry on long-lived sockets | [tokenExpiry.js](server/src/realtime/tokenExpiry.js), `auth:refresh` in [handlers.js](server/src/realtime/handlers.js), [client/src/lib/socket.js](client/src/lib/socket.js) |
| User search, start a direct chat | `searchUsers`, `openDirectConversation` |
| Direct conversations are unique | `UNIQUE (direct_key)` + `INSERT ... ON CONFLICT DO NOTHING` in [conversationService.js](server/src/services/conversationService.js) |
| Owner / Admin / Member roles | [shared/permissions.js](shared/permissions.js), enforced in [groupService.js](server/src/services/groupService.js) |
| Removed member stops receiving instantly | `removeMember` → `gateway.removeUsersFromConversation` |
| Join only your own rooms; reject sends elsewhere | [Section 8](#8-how-authorization-works-for-sockets) |
| Messages persisted | `messages` table |
| Cursor pagination, infinite scroll up | `listMessages`; [MessageList.jsx](client/src/components/MessageList.jsx) |
| Messages while offline | Stored; fetched on connect; marked delivered on connect |
| No duplicates on retry | Client-generated `id` is the primary key; `sendMessage` returns the stored row for a repeat and does not re-broadcast |
| Online / offline, last seen | [presence.js](server/src/services/presence.js), `users.last_seen_at` |
| Offline only after all tabs close | Presence counts sockets per user |
| Typing indicators, throttled | Client: one `typing:start` per 2 s ([Composer.jsx](client/src/components/Composer.jsx)). Server: drops repeats and rate-limits. |
| Sent / delivered / read (1:1) | Watermarks; ticks in [MessageBubble.jsx](client/src/components/MessageBubble.jsx) |
| "Seen by X of Y" (groups) | Members whose `lastReadSeq >= message.seq` |
| Live unread counts | Computed in SQL for the list; adjusted from events in [chat.js](client/src/store/chat.js) |
| Edit (marked "edited") | `message:edit` |
| Delete for everyone within 10 minutes | `message:delete`; the window is checked with the database clock |
| Emoji reactions | `message:react` |
| Login and signup pages | [pages/](client/src/pages) |
| Sidebar sorted by latest message | [Sidebar.jsx](client/src/components/Sidebar.jsx) |
| Chat window, group info panel with role controls | [ChatWindow.jsx](client/src/components/ChatWindow.jsx), [InfoPanel.jsx](client/src/components/InfoPanel.jsx) |
| Responsive / mobile | List and chat are separate screens under 768 px; the info panel becomes a full-screen sheet |
| "Reconnecting..." banner, sync on reconnect | `ConnectionBanner`; `onReady` and `syncThread` in [chat.js](client/src/store/chat.js); unsent messages are queued and flushed |
| `docker-compose up` | [docker-compose.yml](docker-compose.yml) |
| Seed data | [seed.js](server/src/db/seed.js) |
| **Bonus:** file sharing with validation | [attachmentService.js](server/src/services/attachmentService.js): allow-list, 5 MB limit, content sniffing (the browser's declared type is not trusted) |
| **Bonus:** dark mode | Theme toggle, remembered, follows the OS setting by default |
| **Bonus:** permission tests | [Section 3](#3-tests) |

---

## 11. Known limitations and trade-offs

**Scaling**

- **Single server process.** Presence and the socket-to-room mapping are in memory. Running several instances needs the Socket.IO Redis adapter (for rooms and `socketsJoin` / `socketsLeave` across nodes) and presence moved to Redis. The code that would change is confined to `gateway.js` and `presence.js`.
- **Per-conversation write lock.** Serialising writes per conversation is what makes ordering and authorization simple and correct, and costs throughput only within a single very busy conversation.
- **Unread counts are computed with a `count(*)` per conversation** when the sidebar loads. It is an index range scan and fine at this scale; a very large account would want a maintained counter.
- **Rate limits are per socket**, so opening more connections raises a user's budget. A shared store would fix that.

**Product decisions**

- **No per-message read timestamps**, and for groups no list of *who* has seen a message, only how many. This is the price of the watermark design in section 5.
- **"Delivered" is tracked for direct chats only**, as the brief asks; groups show "seen by".
- **New group members can read earlier history; removed members lose access to all of it.**
- **Reactions are limited to 8 emoji**, an allow-list being the simplest way to validate them.
- **A group's avatar is an `https` URL**, not an upload. Loading it reveals each viewer's IP address to that host.
- **User search shows email addresses** to any signed-in user, so people with the same name can be told apart.
- **Edits have no time limit and keep no history.**
- **Starting a direct chat makes it appear for the other person immediately**, even before a message is sent.
- **No message search, replies/threads, push notifications or end-to-end encryption.**

**Security trade-offs**

- **The access token cannot be revoked before it expires** (up to 15 minutes), as with any stateless JWT. Logout revokes the refresh token and tells the user's other tabs to sign out.
- **The refresh-rotation grace window (20 s)** means a token stolen and replayed within 20 seconds of its legitimate use is not detected as theft. Without the window, two tabs refreshing together would log the user out.
- **Signup reveals whether an email is registered**; login does not.
- **Typing events are authorized against the socket's room set**, not the database. The room set is kept in step with the database, but it is a cache.
- **Uploaded files are stored on the server's local disk** (a Docker volume). Files uploaded but never attached to a message are not cleaned up. On hosts with ephemeral disks they disappear on redeploy; object storage would be the fix.
- **The Docker Compose file ships a default JWT secret** so that it runs with one command. Set `JWT_ACCESS_SECRET` for anything other than a local demo.

**Not verified**

- The automated test suites were run against the bundled Postgres, not against Supabase. On the Supabase-backed live demo, sign-in, token refresh, loading conversations and the socket connection were checked by hand.
- UI checks were automated in Chromium only. Firefox, Safari and real phones were not tested.

---

## 12. Deploying a live demo

The simplest shape keeps one origin, so the refresh cookie stays first-party. The root [Dockerfile](Dockerfile) builds a single image in which the Node server serves the API, the sockets and the built React client on one port.

**Render + Supabase** (both have free plans). This is how https://vegachat.onrender.com is deployed:

1. Create a Supabase project and copy its **Session pooler** connection string (Connect button), with the database password filled in.
2. Push this repository to GitHub.
3. In Render choose **New > Blueprint** and select the repository. [render.yaml](render.yaml) defines the service; Render asks only for `DATABASE_URL`. The JWT secret is generated, and the app's own URL is picked up from `RENDER_EXTERNAL_URL`.

The first start creates the tables and inserts the demo data. On the free plans the service sleeps after 15 minutes without traffic (the next visit takes about a minute), uploaded files do not survive a restart, and the Supabase project pauses after a week without activity.

To try the same image locally: `docker build -t vegachat .`, then run it with `DATABASE_URL`, `JWT_ACCESS_SECRET` and `CLIENT_ORIGIN` set.

If the client and the API end up on **different domains** (for example a static host plus a separate API host):

| Where | Setting |
|---|---|
| Client build | `VITE_API_URL=https://<api-host>` |
| Server | `CLIENT_ORIGIN=https://<client-host>` |
| Server | `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none` (the refresh cookie is then cross-site) |
| Server | `TRUST_PROXY=1`, `DATABASE_URL=<Supabase string>`, `DATABASE_SSL=true`, a real `JWT_ACCESS_SECRET` |

Both Dockerfiles build from the repository root (`docker build -f server/Dockerfile .`) because both import `shared/`. The host must allow WebSocket connections.
