/**
 * End-to-end checks against a running server, over real HTTP and real sockets.
 *
 *   E2E_BASE_URL=http://localhost:4000 npm test
 *
 * Skipped when E2E_BASE_URL is not set. Every run creates its own users, so it
 * is safe to run repeatedly against a seeded database.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { io } from 'socket.io-client';
import { ErrorCode, Role } from '../../shared/constants.js';
import { ClientEvent, ServerEvent } from '../../shared/events.js';

const BASE_URL = process.env.E2E_BASE_URL;
const PASSWORD = 'Password123!';

const sockets = [];

async function http(method, path, { token, body, cookie } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

async function createUser(name) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@e2e.test`;
  const res = await http('POST', '/api/auth/signup', { body: { email, displayName: name, password: PASSWORD } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const setCookie = res.headers.get('set-cookie');
  return {
    id: res.body.user.id,
    name,
    email,
    token: res.body.accessToken,
    setCookie,
    cookie: setCookie.split(';')[0],
  };
}

/** Resolves once the server has put the socket in its rooms. */
function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    socket.once(ServerEvent.SESSION_READY, () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function connectError(auth) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { auth, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    socket.once('connect', () => reject(new Error('socket connected but should have been refused')));
    socket.once('connect_error', resolve);
  });
}

const emit = (socket, event, payload) => socket.timeout(5000).emitWithAck(event, payload);

function waitFor(socket, event, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    function listener(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    }
    socket.on(event, listener);
  });
}

/** Collects every `event` the socket receives until `stop()` is called. */
function record(socket, event) {
  const received = [];
  const listener = (payload) => received.push(payload);
  socket.on(event, listener);
  return { received, stop: () => socket.off(event, listener) };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendPayload = (conversationId, body) => ({ id: randomUUID(), conversationId, body });

/**
 * Sends like the real client: on RATE_LIMITED it waits and retries with the
 * same message id, which is safe because sends are idempotent.
 */
async function sendWithBackoff(socket, payload) {
  for (;;) {
    const ack = await emit(socket, ClientEvent.MESSAGE_SEND, payload);
    if (ack.ok || ack.error.code !== ErrorCode.RATE_LIMITED) return ack;
    await pause(600);
  }
}

describe('VegaChat API', { skip: BASE_URL ? false : 'set E2E_BASE_URL to run' }, () => {
  let owner;
  let admin;
  let member;
  let outsider;
  let groupId;

  before(async () => {
    [owner, admin, member, outsider] = await Promise.all(['Owner', 'Admin', 'Member', 'Outsider'].map(createUser));

    const created = await http('POST', '/api/conversations/group', {
      token: owner.token,
      body: { name: 'E2E group', memberIds: [admin.id, member.id] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    groupId = created.body.conversation.id;

    const promoted = await http('PATCH', `/api/conversations/${groupId}/members/${admin.id}`, {
      token: owner.token,
      body: { role: Role.ADMIN },
    });
    assert.equal(promoted.status, 204);
  });

  after(() => {
    for (const socket of sockets) socket.disconnect();
  });

  describe('authentication', () => {
    it('sets the refresh token as an httpOnly cookie and keeps it out of the body', () => {
      assert.match(owner.setCookie, /HttpOnly/i);
      assert.match(owner.setCookie, /Path=\/api\/auth/i);
      assert.match(owner.setCookie, /SameSite=/i);
    });

    it('rejects requests without a token', async () => {
      const res = await http('GET', '/api/conversations');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, ErrorCode.UNAUTHENTICATED);
    });

    it('rejects a tampered token', async () => {
      const res = await http('GET', '/api/conversations', { token: `${owner.token.slice(0, -3)}abc` });
      assert.equal(res.status, 401);
    });

    it('rejects an unsigned "alg: none" token', async () => {
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const forged = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
        sub: owner.id,
        typ: 'access',
        iss: 'vegachat',
        exp: Math.floor(Date.now() / 1000) + 600,
      })}.`;
      const res = await http('GET', '/api/conversations', { token: forged });
      assert.equal(res.status, 401);
    });

    it('rejects a wrong password with the same message as an unknown email', async () => {
      const wrong = await http('POST', '/api/auth/login', { body: { email: owner.email, password: 'nope-nope' } });
      const unknown = await http('POST', '/api/auth/login', {
        body: { email: 'nobody@e2e.test', password: 'nope-nope' },
      });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.equal(wrong.body.error.message, unknown.body.error.message);
    });

    it('rotates the refresh token and revokes the session when an old one is replayed', async () => {
      const user = await createUser('Rotator');

      const first = await http('POST', '/api/auth/refresh', { cookie: user.cookie });
      assert.equal(first.status, 200);
      assert.ok(first.body.accessToken);
      const rotated = first.headers.get('set-cookie').split(';')[0];
      assert.notEqual(rotated, user.cookie);

      // Logging out revokes the family; neither cookie works afterwards, even
      // inside the short window that tolerates two tabs refreshing at once.
      const out = await http('POST', '/api/auth/logout', { cookie: rotated });
      assert.equal(out.status, 204);
      assert.equal((await http('POST', '/api/auth/refresh', { cookie: rotated })).status, 401);
      assert.equal((await http('POST', '/api/auth/refresh', { cookie: user.cookie })).status, 401);
    });

    it('refuses cookie-authenticated calls from an untrusted origin', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { cookie: member.cookie, origin: 'https://evil.example' },
      });
      assert.equal(response.status, 403);
    });

    it('validates signup input', async () => {
      const res = await http('POST', '/api/auth/signup', {
        body: { email: 'not-an-email', displayName: 'x', password: 'short' },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ErrorCode.VALIDATION);
      assert.deepEqual(res.body.error.details.map((d) => d.path).sort(), ['displayName', 'email', 'password']);
    });
  });

  describe('socket handshake', () => {
    it('refuses a socket with no token', async () => {
      const err = await connectError({});
      assert.equal(err.data.code, ErrorCode.UNAUTHENTICATED);
    });

    it('refuses a socket with an invalid token', async () => {
      const err = await connectError({ token: 'not.a.jwt' });
      assert.equal(err.data.code, ErrorCode.UNAUTHENTICATED);
    });

    it('accepts a valid token', async () => {
      const socket = await connect(owner.token);
      assert.equal(socket.connected, true);
      socket.disconnect();
    });

    it("refuses to re-arm a socket with another user's token and disconnects it", async () => {
      const socket = await connect(member.token);
      const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
      const ack = await emit(socket, ClientEvent.AUTH_REFRESH, { token: outsider.token });
      assert.equal(ack.ok, false);
      assert.equal(ack.error.code, ErrorCode.UNAUTHENTICATED);
      await disconnected;
    });
  });

  describe('direct conversations', () => {
    it('are unique per pair, whoever starts them and however many times', async () => {
      const a = await createUser('PairA');
      const b = await createUser('PairB');

      // Five simultaneous attempts from both sides.
      const results = await Promise.all([
        http('POST', '/api/conversations/direct', { token: a.token, body: { userId: b.id } }),
        http('POST', '/api/conversations/direct', { token: b.token, body: { userId: a.id } }),
        http('POST', '/api/conversations/direct', { token: a.token, body: { userId: b.id } }),
        http('POST', '/api/conversations/direct', { token: b.token, body: { userId: a.id } }),
        http('POST', '/api/conversations/direct', { token: a.token, body: { userId: b.id } }),
      ]);
      for (const res of results) assert.ok([200, 201].includes(res.status), JSON.stringify(res.body));

      const ids = new Set(results.map((res) => res.body.conversation.id));
      assert.equal(ids.size, 1);
      assert.equal(results.filter((res) => res.status === 201).length, 1);

      const list = await http('GET', '/api/conversations', { token: a.token });
      assert.equal(list.body.conversations.length, 1);
      assert.equal(list.body.conversations[0].peer.id, b.id);
    });

    it('cannot be started with yourself', async () => {
      const res = await http('POST', '/api/conversations/direct', { token: owner.token, body: { userId: owner.id } });
      assert.equal(res.status, 400);
    });

    it('do not accept group actions', async () => {
      const a = await createUser('SoloA');
      const b = await createUser('SoloB');
      const direct = await http('POST', '/api/conversations/direct', { token: a.token, body: { userId: b.id } });
      const id = direct.body.conversation.id;

      assert.equal(
        (await http('POST', `/api/conversations/${id}/members`, { token: a.token, body: { userIds: [owner.id] } }))
          .status,
        400,
      );
      assert.equal((await http('DELETE', `/api/conversations/${id}`, { token: a.token })).status, 400);
    });
  });

  describe('group permissions over REST', () => {
    const path = (suffix = '') => `/api/conversations/${groupId}${suffix}`;

    it('hides the group from non-members', async () => {
      for (const res of [
        await http('GET', path(), { token: outsider.token }),
        await http('GET', path('/messages'), { token: outsider.token }),
        await http('PATCH', path(), { token: outsider.token, body: { name: 'Hijacked' } }),
        await http('POST', path('/members'), { token: outsider.token, body: { userIds: [outsider.id] } }),
        await http('DELETE', path(), { token: outsider.token }),
      ]) {
        assert.equal(res.status, 403);
        assert.equal(res.body.error.code, ErrorCode.FORBIDDEN);
      }
    });

    it('lets a member read but not manage', async () => {
      assert.equal((await http('GET', path(), { token: member.token })).status, 200);
      assert.equal((await http('GET', path('/messages'), { token: member.token })).status, 200);

      for (const res of [
        await http('PATCH', path(), { token: member.token, body: { name: 'Nope' } }),
        await http('POST', path('/members'), { token: member.token, body: { userIds: [outsider.id] } }),
        await http('DELETE', path(`/members/${admin.id}`), { token: member.token }),
        await http('PATCH', path(`/members/${member.id}`), { token: member.token, body: { role: Role.ADMIN } }),
        await http('POST', path('/transfer-ownership'), { token: member.token, body: { userId: member.id } }),
        await http('DELETE', path(), { token: member.token }),
      ]) {
        assert.equal(res.status, 403, JSON.stringify(res.body));
      }
    });

    it('lets an admin rename the group and add or remove members', async () => {
      const guest = await createUser('Guest');

      const renamed = await http('PATCH', path(), { token: admin.token, body: { name: 'E2E group renamed' } });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.name, 'E2E group renamed');

      const added = await http('POST', path('/members'), { token: admin.token, body: { userIds: [guest.id] } });
      assert.equal(added.status, 201);
      assert.equal(added.body.members[0].role, Role.MEMBER);

      const again = await http('POST', path('/members'), { token: admin.token, body: { userIds: [guest.id] } });
      assert.equal(again.status, 409);

      assert.equal((await http('DELETE', path(`/members/${guest.id}`), { token: admin.token })).status, 204);
      assert.equal((await http('GET', path(), { token: guest.token })).status, 403);
    });

    it('stops an admin from owner-only actions and from removing the owner', async () => {
      for (const res of [
        await http('DELETE', path(`/members/${owner.id}`), { token: admin.token }),
        await http('PATCH', path(`/members/${member.id}`), { token: admin.token, body: { role: Role.ADMIN } }),
        await http('POST', path('/transfer-ownership'), { token: admin.token, body: { userId: admin.id } }),
        await http('DELETE', path(), { token: admin.token }),
      ]) {
        assert.equal(res.status, 403, JSON.stringify(res.body));
      }
    });

    it('does not accept "owner" as a role to assign', async () => {
      const res = await http('PATCH', path(`/members/${member.id}`), { token: owner.token, body: { role: Role.OWNER } });
      assert.equal(res.status, 400);
    });

    it('does not let the owner leave without transferring', async () => {
      const res = await http('DELETE', path(`/members/${owner.id}`), { token: owner.token });
      assert.equal(res.status, 403);
    });

    it('lets the owner promote, demote, transfer ownership and delete', async () => {
      const founder = await createUser('Founder');
      const heir = await createUser('Heir');
      const created = await http('POST', '/api/conversations/group', {
        token: founder.token,
        body: { name: 'Succession', memberIds: [heir.id] },
      });
      const id = created.body.conversation.id;
      const roles = async () => {
        const detail = await http('GET', `/api/conversations/${id}`, { token: founder.token });
        return Object.fromEntries(detail.body.members.map((m) => [m.id, m.role]));
      };

      const promote = { token: founder.token, body: { role: Role.ADMIN } };
      assert.equal((await http('PATCH', `/api/conversations/${id}/members/${heir.id}`, promote)).status, 204);
      assert.equal((await roles())[heir.id], Role.ADMIN);
      assert.equal((await http('PATCH', `/api/conversations/${id}/members/${heir.id}`, promote)).status, 409);

      const demote = { token: founder.token, body: { role: Role.MEMBER } };
      assert.equal((await http('PATCH', `/api/conversations/${id}/members/${heir.id}`, demote)).status, 204);
      assert.equal((await roles())[heir.id], Role.MEMBER);

      const transfer = await http('POST', `/api/conversations/${id}/transfer-ownership`, {
        token: founder.token,
        body: { userId: heir.id },
      });
      assert.equal(transfer.status, 204);
      assert.deepEqual(await roles(), { [heir.id]: Role.OWNER, [founder.id]: Role.ADMIN });

      // The previous owner has lost the owner's powers...
      assert.equal((await http('DELETE', `/api/conversations/${id}`, { token: founder.token })).status, 403);
      // ...and the new owner has them.
      assert.equal((await http('DELETE', `/api/conversations/${id}`, { token: heir.token })).status, 204);
      assert.equal((await http('GET', `/api/conversations/${id}`, { token: heir.token })).status, 403);
    });
  });

  describe('socket authorization', () => {
    it('rejects sending to a conversation the user is not in', async () => {
      const socket = await connect(outsider.token);
      const spy = await connect(member.token);
      const seen = record(spy, ServerEvent.MESSAGE_NEW);

      const ack = await emit(socket, ClientEvent.MESSAGE_SEND, sendPayload(groupId, 'let me in'));
      assert.equal(ack.ok, false);
      assert.equal(ack.error.code, ErrorCode.FORBIDDEN);

      await pause(300);
      seen.stop();
      assert.equal(seen.received.length, 0);
    });

    it('rejects every other event for a conversation the user is not in', async () => {
      const socket = await connect(outsider.token);
      for (const [event, payload] of [
        [ClientEvent.TYPING_START, { conversationId: groupId }],
        [ClientEvent.TYPING_STOP, { conversationId: groupId }],
        [ClientEvent.CONVERSATION_READ, { conversationId: groupId, seq: 1 }],
        [ClientEvent.CONVERSATION_DELIVERED, { conversationId: groupId, seq: 1 }],
      ]) {
        const ack = await emit(socket, event, payload);
        assert.equal(ack.ok, false, event);
        assert.equal(ack.error.code, ErrorCode.FORBIDDEN, event);
      }
    });

    it("rejects acting on a message in someone else's conversation", async () => {
      const insider = await connect(owner.token);
      const sent = await emit(insider, ClientEvent.MESSAGE_SEND, sendPayload(groupId, 'members only'));
      assert.equal(sent.ok, true);
      const messageId = sent.data.message.id;

      const socket = await connect(outsider.token);
      for (const [event, payload] of [
        [ClientEvent.MESSAGE_EDIT, { messageId, body: 'defaced' }],
        [ClientEvent.MESSAGE_DELETE, { messageId }],
        [ClientEvent.MESSAGE_REACT, { messageId, emoji: '👍', action: 'add' }],
      ]) {
        const ack = await emit(socket, event, payload);
        assert.equal(ack.ok, false, event);
        // Indistinguishable from a message that does not exist.
        assert.equal(ack.error.code, ErrorCode.NOT_FOUND, event);
      }
    });

    it('validates payloads and ignores extra fields that try to spoof the sender', async () => {
      const socket = await connect(member.token);

      const spoofed = await emit(socket, ClientEvent.MESSAGE_SEND, {
        ...sendPayload(groupId, 'as the owner'),
        senderId: owner.id,
      });
      assert.equal(spoofed.ok, false);
      assert.equal(spoofed.error.code, ErrorCode.VALIDATION);

      for (const payload of [
        null,
        'a string',
        {},
        { id: 'not-a-uuid', conversationId: groupId, body: 'hi' },
        { id: randomUUID(), conversationId: groupId, body: '   ' },
        { id: randomUUID(), conversationId: groupId, body: 'x'.repeat(4001) },
      ]) {
        const ack = await emit(socket, ClientEvent.MESSAGE_SEND, payload);
        assert.equal(ack.ok, false, JSON.stringify(payload)?.slice(0, 60));
        assert.equal(ack.error.code, ErrorCode.VALIDATION);
      }

      const badEmoji = await emit(socket, ClientEvent.MESSAGE_REACT, {
        messageId: randomUUID(),
        emoji: '<script>',
        action: 'add',
      });
      assert.equal(badEmoji.error.code, ErrorCode.VALIDATION);
    });

    it('cuts a removed member off immediately, without a reconnect', async () => {
      const removed = await createUser('Removed');
      await http('POST', `/api/conversations/${groupId}/members`, {
        token: owner.token,
        body: { userIds: [removed.id] },
      });

      const ownerSocket = await connect(owner.token);
      const removedSocket = await connect(removed.token);

      // While a member, they receive the group's messages.
      const first = waitFor(removedSocket, ServerEvent.MESSAGE_NEW, (p) => p.message.body === 'before removal');
      await emit(ownerSocket, ClientEvent.MESSAGE_SEND, sendPayload(groupId, 'before removal'));
      await first;

      const notice = waitFor(removedSocket, ServerEvent.CONVERSATION_REMOVED, (p) => p.conversationId === groupId);
      const res = await http('DELETE', `/api/conversations/${groupId}/members/${removed.id}`, { token: owner.token });
      assert.equal(res.status, 204);
      assert.equal((await notice).reason, 'removed');

      // Same socket, still connected: nothing from the group reaches it any more.
      const messages = record(removedSocket, ServerEvent.MESSAGE_NEW);
      const typing = record(removedSocket, ServerEvent.TYPING_UPDATE);
      const sent = await emit(ownerSocket, ClientEvent.MESSAGE_SEND, sendPayload(groupId, 'after removal'));
      assert.equal(sent.ok, true);
      await emit(ownerSocket, ClientEvent.TYPING_START, { conversationId: groupId });
      await pause(400);
      messages.stop();
      typing.stop();
      assert.equal(removedSocket.connected, true);
      assert.deepEqual(messages.received, []);
      assert.deepEqual(typing.received, []);

      // And it can no longer write or read.
      const attempt = await emit(removedSocket, ClientEvent.MESSAGE_SEND, sendPayload(groupId, 'still here?'));
      assert.equal(attempt.error.code, ErrorCode.FORBIDDEN);
      const typingAttempt = await emit(removedSocket, ClientEvent.TYPING_START, { conversationId: groupId });
      assert.equal(typingAttempt.error.code, ErrorCode.FORBIDDEN);
      assert.equal((await http('GET', `/api/conversations/${groupId}/messages`, { token: removed.token })).status, 403);
    });

    it('subscribes a newly added member immediately, without a reconnect', async () => {
      const newcomer = await createUser('Newcomer');
      const newcomerSocket = await connect(newcomer.token);
      const ownerSocket = await connect(owner.token);

      const added = waitFor(newcomerSocket, ServerEvent.CONVERSATION_ADDED, (p) => p.conversation.id === groupId);
      await http('POST', `/api/conversations/${groupId}/members`, {
        token: owner.token,
        body: { userIds: [newcomer.id] },
      });
      assert.equal((await added).conversation.role, Role.MEMBER);

      const received = waitFor(newcomerSocket, ServerEvent.MESSAGE_NEW, (p) => p.message.body === 'welcome');
      await emit(ownerSocket, ClientEvent.MESSAGE_SEND, sendPayload(groupId, 'welcome'));
      await received;
    });
  });

  describe('messaging', () => {
    it('stores a retried message only once', async () => {
      const sender = await connect(owner.token);
      const receiver = await connect(member.token);
      const seen = record(receiver, ServerEvent.MESSAGE_NEW);

      const payload = sendPayload(groupId, 'sent on a bad network');
      const acks = await Promise.all([
        emit(sender, ClientEvent.MESSAGE_SEND, payload),
        emit(sender, ClientEvent.MESSAGE_SEND, payload),
        emit(sender, ClientEvent.MESSAGE_SEND, payload),
      ]);
      const late = await emit(sender, ClientEvent.MESSAGE_SEND, payload);

      for (const ack of [...acks, late]) {
        assert.equal(ack.ok, true);
        assert.equal(ack.data.message.id, payload.id);
        assert.equal(ack.data.message.seq, acks[0].data.message.seq);
      }

      await pause(300);
      seen.stop();
      assert.equal(seen.received.filter((p) => p.message.id === payload.id).length, 1);

      const history = await http('GET', `/api/conversations/${groupId}/messages?limit=100`, { token: owner.token });
      assert.equal(history.body.messages.filter((m) => m.id === payload.id).length, 1);
    });

    it("does not let one user reuse another user's message id", async () => {
      const a = await connect(owner.token);
      const b = await connect(member.token);
      const payload = sendPayload(groupId, 'original');
      assert.equal((await emit(a, ClientEvent.MESSAGE_SEND, payload)).ok, true);

      const ack = await emit(b, ClientEvent.MESSAGE_SEND, { ...payload, body: 'overwritten' });
      assert.equal(ack.ok, false);
      assert.equal(ack.error.code, ErrorCode.CONFLICT);
    });

    it('pages backwards through history with a cursor, without gaps or repeats', async () => {
      const author = await createUser('Author');
      const reader = await createUser('Reader');
      const direct = await http('POST', '/api/conversations/direct', { token: author.token, body: { userId: reader.id } });
      const id = direct.body.conversation.id;

      const socket = await connect(author.token);
      for (let i = 1; i <= 25; i += 1) {
        const ack = await sendWithBackoff(socket, sendPayload(id, `message ${i}`));
        assert.equal(ack.ok, true, JSON.stringify(ack));
      }

      const collected = [];
      let before;
      let pages = 0;
      for (;;) {
        const query = before ? `?limit=10&before=${before}` : '?limit=10';
        const page = await http('GET', `/api/conversations/${id}/messages${query}`, { token: reader.token });
        assert.equal(page.status, 200);
        pages += 1;
        collected.unshift(...page.body.messages);
        if (!page.body.hasMore) break;
        before = page.body.messages[0].seq;
      }

      assert.equal(pages, 3);
      assert.deepEqual(
        collected.map((m) => m.body),
        Array.from({ length: 25 }, (_, i) => `message ${i + 1}`),
      );

      // "after" is what a reconnecting client uses to catch up.
      const tail = await http('GET', `/api/conversations/${id}/messages?after=${collected[19].seq}`, {
        token: reader.token,
      });
      assert.deepEqual(
        tail.body.messages.map((m) => m.body),
        ['message 21', 'message 22', 'message 23', 'message 24', 'message 25'],
      );
    });

    it('keeps messages for an offline user and counts them as unread', async () => {
      const online = await createUser('Online');
      const offline = await createUser('Offline');
      const direct = await http('POST', '/api/conversations/direct', { token: online.token, body: { userId: offline.id } });
      const id = direct.body.conversation.id;

      const socket = await connect(online.token);
      for (const body of ['one', 'two', 'three']) {
        await emit(socket, ClientEvent.MESSAGE_SEND, sendPayload(id, body));
      }

      const list = await http('GET', '/api/conversations', { token: offline.token });
      const conversation = list.body.conversations.find((c) => c.id === id);
      assert.equal(conversation.unreadCount, 3);
      assert.equal(conversation.lastMessage.body, 'three');

      // Coming online marks them delivered, and the sender is told.
      const delivered = waitFor(socket, ServerEvent.RECEIPT_UPDATE, (p) => p.userId === offline.id);
      const offlineSocket = await connect(offline.token);
      const receipt = await delivered;
      assert.equal(receipt.lastDeliveredSeq, conversation.lastMessageSeq);
      assert.ok(receipt.lastReadSeq < conversation.lastMessageSeq);

      // Reading them clears the count and tells the sender.
      const read = waitFor(socket, ServerEvent.RECEIPT_UPDATE, (p) => p.lastReadSeq === conversation.lastMessageSeq);
      const ack = await emit(offlineSocket, ClientEvent.CONVERSATION_READ, {
        conversationId: id,
        // Claiming to have read far beyond the newest message is clamped.
        seq: conversation.lastMessageSeq + 1_000_000,
      });
      assert.equal(ack.data.lastReadSeq, conversation.lastMessageSeq);
      await read;

      const after = await http('GET', '/api/conversations', { token: offline.token });
      assert.equal(after.body.conversations.find((c) => c.id === id).unreadCount, 0);
    });

    it('lets only the sender edit or delete, and syncs both to the room', async () => {
      const author = await connect(owner.token);
      const other = await connect(member.token);

      const sent = await emit(author, ClientEvent.MESSAGE_SEND, sendPayload(groupId, 'tpyo'));
      const messageId = sent.data.message.id;

      assert.equal(
        (await emit(other, ClientEvent.MESSAGE_EDIT, { messageId, body: 'hacked' })).error.code,
        ErrorCode.FORBIDDEN,
      );
      assert.equal((await emit(other, ClientEvent.MESSAGE_DELETE, { messageId })).error.code, ErrorCode.FORBIDDEN);

      const updated = waitFor(other, ServerEvent.MESSAGE_UPDATED, (p) => p.message.id === messageId);
      const edit = await emit(author, ClientEvent.MESSAGE_EDIT, { messageId, body: 'typo' });
      assert.equal(edit.ok, true);
      assert.equal((await updated).message.body, 'typo');
      assert.ok(edit.data.message.editedAt);

      const reacted = waitFor(author, ServerEvent.MESSAGE_REACTION, (p) => p.messageId === messageId);
      await emit(other, ClientEvent.MESSAGE_REACT, { messageId, emoji: '🎉', action: 'add' });
      await emit(other, ClientEvent.MESSAGE_REACT, { messageId, emoji: '🎉', action: 'add' });
      assert.equal((await reacted).userId, member.id);

      const history = await http('GET', `/api/conversations/${groupId}/messages?limit=100`, { token: owner.token });
      assert.deepEqual(history.body.messages.find((m) => m.id === messageId).reactions, [
        { emoji: '🎉', userIds: [member.id] },
      ]);

      const deleted = waitFor(other, ServerEvent.MESSAGE_DELETED, (p) => p.messageId === messageId);
      assert.equal((await emit(author, ClientEvent.MESSAGE_DELETE, { messageId })).ok, true);
      await deleted;

      const afterDelete = await http('GET', `/api/conversations/${groupId}/messages?limit=100`, { token: owner.token });
      const tombstone = afterDelete.body.messages.find((m) => m.id === messageId);
      assert.equal(tombstone.body, '');
      assert.ok(tombstone.deletedAt);
      assert.deepEqual(tombstone.reactions, []);

      assert.equal(
        (await emit(author, ClientEvent.MESSAGE_EDIT, { messageId, body: 'undelete' })).error.code,
        ErrorCode.CONFLICT,
      );
    });
  });

  describe('rate limiting', () => {
    it('rejects a flood of messages from one socket', async () => {
      const flooder = await createUser('Flooder');
      const target = await createUser('Target');
      const direct = await http('POST', '/api/conversations/direct', {
        token: flooder.token,
        body: { userId: target.id },
      });
      const socket = await connect(flooder.token);
      const acks = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          emit(socket, ClientEvent.MESSAGE_SEND, sendPayload(direct.body.conversation.id, `flood ${i}`)),
        ),
      );
      const limited = acks.filter((ack) => !ack.ok);
      assert.ok(limited.length >= 15, `only ${limited.length} of 40 were rejected`);
      for (const ack of limited) assert.equal(ack.error.code, ErrorCode.RATE_LIMITED);
    });
  });

  describe('attachments', () => {
    // A complete 1x1 PNG.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );

    async function upload(user, conversationId, bytes, name, type) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type }), name);
      const response = await fetch(`${BASE_URL}/api/conversations/${conversationId}/attachments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${user.token}` },
        body: form,
      });
      return { status: response.status, body: await response.json() };
    }

    const download = (user, id) =>
      fetch(`${BASE_URL}/api/attachments/${id}`, { headers: { authorization: `Bearer ${user.token}` } });

    it('stores an allowed file, attaches it to exactly one message and serves it to members only', async () => {
      const uploaded = await upload(owner, groupId, PNG, '../../etc/pass"wd.png', 'image/png');
      assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
      const { attachment } = uploaded.body;
      assert.equal(attachment.mimeType, 'image/png');
      assert.equal(attachment.size, PNG.length);
      // Path separators and quotes never survive into the stored name.
      assert.equal(attachment.name, 'passwd.png');

      const socket = await connect(owner.token);
      const sent = await emit(socket, ClientEvent.MESSAGE_SEND, {
        id: randomUUID(),
        conversationId: groupId,
        attachmentId: attachment.id,
      });
      assert.equal(sent.ok, true, JSON.stringify(sent));
      assert.deepEqual(sent.data.message.attachment, attachment);

      const reused = await emit(socket, ClientEvent.MESSAGE_SEND, {
        id: randomUUID(),
        conversationId: groupId,
        attachmentId: attachment.id,
      });
      assert.equal(reused.ok, false);
      assert.equal(reused.error.code, ErrorCode.VALIDATION);

      const forMember = await download(member, attachment.id);
      assert.equal(forMember.status, 200);
      assert.equal(forMember.headers.get('content-type'), 'image/png');
      assert.equal(forMember.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await forMember.arrayBuffer()), PNG);

      assert.equal((await download(outsider, attachment.id)).status, 404);
      assert.equal((await fetch(`${BASE_URL}/api/attachments/${attachment.id}`)).status, 401);

      // Deleting the message destroys the file.
      const removed = await emit(socket, ClientEvent.MESSAGE_DELETE, { messageId: sent.data.message.id });
      assert.equal(removed.ok, true);
      assert.equal((await download(member, attachment.id)).status, 404);
    });

    it("does not let someone attach another member's upload", async () => {
      const uploaded = await upload(owner, groupId, PNG, 'mine.png', 'image/png');
      const socket = await connect(member.token);
      const ack = await emit(socket, ClientEvent.MESSAGE_SEND, {
        id: randomUUID(),
        conversationId: groupId,
        attachmentId: uploaded.body.attachment.id,
      });
      assert.equal(ack.ok, false);
      assert.equal(ack.error.code, ErrorCode.VALIDATION);
      // Not yet part of a message, so only the uploader can fetch it.
      assert.equal((await download(member, uploaded.body.attachment.id)).status, 404);
      assert.equal((await download(owner, uploaded.body.attachment.id)).status, 200);
    });

    it('rejects disallowed types, disguised content and oversized files', async () => {
      const html = Buffer.from('<script>alert(1)</script>');
      const executable = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

      const cases = [
        ['an HTML page', html, 'page.html', 'text/html', 400],
        ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml', 400],
        ['a binary named .png', executable, 'photo.png', 'image/png', 400],
        ['text claiming to be a PNG', html, 'photo.png', 'image/png', 400],
        ['an empty file', Buffer.alloc(0), 'empty.txt', 'text/plain', 400],
        ['a file over the size limit', Buffer.alloc(5 * 1024 * 1024 + 1, 'a'), 'big.txt', 'text/plain', 413],
      ];
      for (const [label, bytes, name, type, expected] of cases) {
        const res = await upload(owner, groupId, bytes, name, type);
        assert.equal(res.status, expected, `${label}: ${JSON.stringify(res.body)}`);
      }

      const ok = await upload(owner, groupId, Buffer.from('plain notes'), 'notes.txt', 'text/plain');
      assert.equal(ok.status, 201);
    });

    it('rejects uploads from non-members', async () => {
      const res = await upload(outsider, groupId, PNG, 'sneaky.png', 'image/png');
      assert.equal(res.status, 403);
    });
  });

  describe('presence and typing', () => {
    it('reports a user offline only after their last connection closes', async () => {
      const watcher = await createUser('Watcher');
      const subject = await createUser('Subject');
      await http('POST', '/api/conversations/direct', { token: watcher.token, body: { userId: subject.id } });

      const watcherSocket = await connect(watcher.token);
      const online = waitFor(watcherSocket, ServerEvent.PRESENCE_UPDATE, (p) => p.userId === subject.id && p.online);
      const tabOne = await connect(subject.token);
      await online;
      const tabTwo = await connect(subject.token);

      const updates = record(watcherSocket, ServerEvent.PRESENCE_UPDATE);
      tabOne.disconnect();
      // Longer than the server's offline grace period.
      await pause(3500);
      assert.deepEqual(updates.received, [], 'still online through the second tab');

      tabTwo.disconnect();
      const offline = await waitFor(
        watcherSocket,
        ServerEvent.PRESENCE_UPDATE,
        (p) => p.userId === subject.id && !p.online,
        6000,
      );
      updates.stop();
      assert.ok(offline.lastSeenAt);

      const list = await http('GET', '/api/conversations', { token: watcher.token });
      assert.equal(list.body.conversations[0].peer.online, false);
      assert.ok(list.body.conversations[0].peer.lastSeenAt);
    });

    it('relays typing to the other members, throttled, and never back to the typist', async () => {
      const typist = await connect(owner.token);
      const listener = await connect(member.token);
      const echoes = record(typist, ServerEvent.TYPING_UPDATE);
      const heard = record(listener, ServerEvent.TYPING_UPDATE);

      for (let i = 0; i < 10; i += 1) {
        await emit(typist, ClientEvent.TYPING_START, { conversationId: groupId });
      }
      await emit(typist, ClientEvent.TYPING_STOP, { conversationId: groupId });
      await pause(300);
      echoes.stop();
      heard.stop();

      const mine = heard.received.filter((p) => p.userId === owner.id);
      assert.deepEqual(
        mine.map((p) => p.isTyping),
        [true, false],
        'ten rapid starts collapse into one',
      );
      assert.equal(mine[0].displayName, 'Owner');
      assert.equal(echoes.received.filter((p) => p.userId === owner.id).length, 0);
    });
  });
});
