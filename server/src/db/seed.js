/**
 * Demo data: 6 users, 2 groups and 4 direct conversations with history.
 *
 *   npm run seed         insert when the database has no users
 *   npm run seed:reset   wipe everything and insert again
 */
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { ConversationType, MessageType, Role } from '../shared.js';
import { runMigrations } from './migrate.js';
import { pool, withTransaction } from './pool.js';

export const DEMO_PASSWORD = 'Password123!';

const USERS = [
  { key: 'rahul', displayName: 'Rahul Sharma', email: 'rahul@example.com' },
  { key: 'priya', displayName: 'Priya Nair', email: 'priya@example.com' },
  { key: 'arjun', displayName: 'Arjun Mehta', email: 'arjun@example.com' },
  { key: 'sneha', displayName: 'Sneha Iyer', email: 'sneha@example.com' },
  { key: 'vikram', displayName: 'Vikram Rao', email: 'vikram@example.com' },
  { key: 'ananya', displayName: 'Ananya Das', email: 'ananya@example.com' },
];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Each conversation lists its messages oldest first as [sender, text].
 * `endsAgo` is how long ago the last message was sent and `gap` the spacing
 * between messages. `unread` leaves the newest N messages unread for a user.
 */
const CONVERSATIONS = [
  {
    type: ConversationType.GROUP,
    name: 'Product Launch',
    members: { rahul: Role.OWNER, priya: Role.ADMIN, arjun: Role.MEMBER, sneha: Role.MEMBER },
    endsAgo: 12 * MINUTE,
    gap: 95 * MINUTE,
    unread: { rahul: 3, priya: 1 },
    messages: [
      ['rahul', 'Kicking off the launch channel. Target date is the 24th.'],
      ['priya', 'Works for design. Do we have the final copy for the landing page?'],
      ['arjun', 'Copy is with marketing, should land by Wednesday.'],
      ['sneha', 'I can start the QA checklist in the meantime.'],
      ['rahul', 'Please do. Start with signup and checkout.'],
      ['sneha', 'On it. I will share the sheet by end of day.'],
      ['priya', 'First pass of the hero section is in Figma.'],
      ['arjun', 'Looks sharp. The headline wraps badly on small phones though.'],
      ['priya', 'Good catch, I will tighten it.'],
      ['rahul', 'Can we get a staging link for the stakeholders?'],
      ['arjun', 'Staging deploys from the release branch. I will cut it tonight.'],
      ['sneha', 'QA checklist is shared. 42 cases so far.'],
      ['rahul', 'Thanks Sneha. Anything blocked?'],
      ['sneha', 'Need test cards for the payment gateway.'],
      ['arjun', 'Sent them to you directly.'],
      ['priya', 'Updated hero is up. Headline is two lines max now.'],
      ['rahul', 'Much better.'],
      ['arjun', 'Staging is live. Link is pinned in the wiki.'],
      ['sneha', 'Starting the regression run now.'],
      ['sneha', 'Found a bug: the coupon field accepts expired codes.'],
      ['arjun', 'Reproduced. Fix is small, will push in an hour.'],
      ['rahul', 'Is that a launch blocker?'],
      ['arjun', 'Yes, but it is a one-line check on the server.'],
      ['priya', 'Pricing page illustrations are done.'],
      ['rahul', 'Nice. Can you export them as SVG?'],
      ['priya', 'Already in the assets folder.'],
      ['arjun', 'Coupon fix is on staging.'],
      ['sneha', 'Verified. Closing the ticket.'],
      ['rahul', 'Marketing wants a short demo video. Any volunteers?'],
      ['priya', 'I can record it once the UI freezes.'],
      ['rahul', 'UI freeze is Thursday noon.'],
      ['arjun', 'Performance numbers: landing page loads in 1.4s on 4G.'],
      ['sneha', 'Checkout is slower, about 3s. Mostly the address lookup.'],
      ['arjun', 'I will cache the pincode lookups.'],
      ['rahul', 'Good. Keep me posted.'],
      ['priya', 'Dark mode screenshots for the store listing are ready.'],
      ['sneha', 'Regression run: 40 passed, 2 failed. Both in the invoice PDF.'],
      ['arjun', 'Invoice template has a font issue. Looking.'],
      ['rahul', 'We have five days. Prioritise the invoice.'],
      ['arjun', 'Invoice fixed, it was a missing font file in the container.'],
      ['sneha', 'Confirmed. All 42 green now.'],
      ['priya', 'Demo video draft is uploaded. Two minutes.'],
      ['rahul', 'Watched it. Trim the intro and we are good.'],
      ['priya', 'Trimmed to 90 seconds.'],
      ['arjun', 'Pincode cache brought checkout down to 1.8s.'],
      ['rahul', 'Excellent work everyone.'],
      ['sneha', 'Do we need a rollback plan?'],
      ['arjun', 'Yes. The previous release stays warm for 48 hours.'],
      ['rahul', 'Go/no-go call is tomorrow at 10.'],
      ['priya', 'I will be there.'],
      ['sneha', 'Same. QA sign-off is ready.'],
      ['arjun', 'Release branch is frozen. See you all at 10.'],
    ],
  },
  {
    type: ConversationType.GROUP,
    name: 'Weekend Trek',
    members: {
      ananya: Role.OWNER,
      vikram: Role.ADMIN,
      rahul: Role.MEMBER,
      sneha: Role.MEMBER,
      arjun: Role.MEMBER,
    },
    endsAgo: 2 * HOUR,
    gap: 50 * MINUTE,
    unread: { sneha: 3 },
    messages: [
      ['ananya', 'Who is in for Rajmachi this Saturday?'],
      ['vikram', 'In. I can drive, four seats.'],
      ['rahul', 'Count me in.'],
      ['sneha', 'Yes! What time do we leave?'],
      ['ananya', '5:30 from my place. We want to start climbing before 8.'],
      ['arjun', 'That is brutal, but okay.'],
      ['vikram', 'Carry two litres of water each.'],
      ['sneha', 'I will bring the first-aid kit.'],
      ['rahul', 'I have got snacks covered.'],
      ['ananya', 'Weather says light rain in the afternoon.'],
      ['vikram', 'Ponchos then. And proper shoes, Arjun.'],
      ['arjun', 'One time I wore sandals. One time.'],
      ['sneha', 'Should we book the homestay for lunch?'],
      ['ananya', 'Booked. Lunch for five at 1pm.'],
      ['rahul', 'What is the split?'],
      ['ananya', 'About 900 each including fuel.'],
      ['vikram', 'Leaving at 5:30 sharp. Do not be late.'],
      ['rahul', 'Setting three alarms.'],
    ],
  },
  {
    type: ConversationType.DIRECT,
    members: { rahul: Role.MEMBER, priya: Role.MEMBER },
    endsAgo: 35 * MINUTE,
    gap: 18 * MINUTE,
    unread: { rahul: 1 },
    messages: [
      ['rahul', 'Hey Priya, got a minute?'],
      ['priya', 'Sure, what is up?'],
      ['rahul', 'Can you review the onboarding screens before the go/no-go?'],
      ['priya', 'Yes. Send me the link.'],
      ['rahul', 'It is the "Onboarding v3" page in Figma.'],
      ['priya', 'Found it. The second step feels long.'],
      ['rahul', 'Agreed. Could we split it in two?'],
      ['priya', 'I would rather cut the optional fields.'],
      ['rahul', 'Works for me. Fewer screens is better.'],
      ['priya', 'Done. Have a look when you can.'],
    ],
  },
  {
    type: ConversationType.DIRECT,
    members: { rahul: Role.MEMBER, arjun: Role.MEMBER },
    endsAgo: 5 * HOUR,
    gap: 40 * MINUTE,
    messages: [
      ['arjun', 'Did you see the pincode cache numbers?'],
      ['rahul', 'I did. 1.8s is great.'],
      ['arjun', 'There is a bit more to squeeze out if we preload the form.'],
      ['rahul', 'After launch. Let us not touch it now.'],
      ['arjun', 'Fair.'],
      ['rahul', 'Thanks for the quick invoice fix, by the way.'],
    ],
  },
  {
    type: ConversationType.DIRECT,
    members: { priya: Role.MEMBER, sneha: Role.MEMBER },
    endsAgo: 1 * DAY,
    gap: 25 * MINUTE,
    messages: [
      ['sneha', 'Priya, the empty state on the orders page has no illustration.'],
      ['priya', 'Oh, that one slipped. I will add it today.'],
      ['sneha', 'No rush, it is not in the launch scope.'],
      ['priya', 'It will bug me. Give me an hour.'],
      ['sneha', 'Ha, okay.'],
    ],
  },
  {
    type: ConversationType.DIRECT,
    members: { vikram: Role.MEMBER, ananya: Role.MEMBER },
    endsAgo: 3 * HOUR,
    gap: 12 * MINUTE,
    unread: { ananya: 2 },
    messages: [
      ['ananya', 'Is your car okay for the ghat road?'],
      ['vikram', 'Serviced last week. Tyres are new.'],
      ['ananya', 'Perfect. I will share the pickup order tonight.'],
      ['vikram', 'Pick up Sneha first, she is on the way.'],
      ['vikram', 'Also, should I bring the stove for chai?'],
    ],
  },
];

async function insertUsers(client) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, config.bcryptRounds);
  const ids = {};
  for (const user of USERS) {
    const { rows } = await client.query(
      `INSERT INTO users (email, display_name, password_hash, last_seen_at)
       VALUES ($1, $2, $3, now() - interval '3 hours')
       RETURNING id`,
      [user.email, user.displayName, passwordHash],
    );
    ids[user.key] = rows[0].id;
  }
  return ids;
}

async function insertConversation(client, userIds, spec) {
  const memberKeys = Object.keys(spec.members);
  const isGroup = spec.type === ConversationType.GROUP;
  const ownerKey = memberKeys.find((key) => spec.members[key] === Role.OWNER) ?? memberKeys[0];
  const directKey = isGroup ? null : memberKeys.map((key) => userIds[key]).sort().join(':');

  const { rows } = await client.query(
    `INSERT INTO conversations (type, name, direct_key, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [spec.type, isGroup ? spec.name : null, directKey, userIds[ownerKey]],
  );
  const conversationId = rows[0].id;

  // Inserted oldest first, so seq order matches time order.
  const firstSentAt = Date.now() - spec.endsAgo - spec.gap * (spec.messages.length - 1);
  const seqs = [];
  for (const [index, [senderKey, body]] of spec.messages.entries()) {
    const inserted = await client.query(
      `INSERT INTO messages (id, conversation_id, sender_id, type, body, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING seq`,
      [conversationId, userIds[senderKey], MessageType.TEXT, body, new Date(firstSentAt + spec.gap * index)],
    );
    seqs.push(inserted.rows[0].seq);
  }

  const lastSeq = seqs.at(-1);
  const lastSentAt = new Date(Date.now() - spec.endsAgo);
  await client.query(
    'UPDATE conversations SET last_message_seq = $2, last_activity_at = $3, created_at = $4 WHERE id = $1',
    [conversationId, lastSeq, lastSentAt, new Date(firstSentAt - HOUR)],
  );

  for (const key of memberKeys) {
    const unread = spec.unread?.[key] ?? 0;
    const lastReadSeq = unread > 0 ? seqs.at(-1 - unread) : lastSeq;
    await client.query(
      `INSERT INTO conversation_members
         (conversation_id, user_id, role, last_read_seq, last_delivered_seq, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [conversationId, userIds[key], spec.members[key], lastReadSeq, lastSeq, new Date(firstSentAt - HOUR)],
    );
  }
}

async function insertDemoData(client) {
  const userIds = await insertUsers(client);
  for (const spec of CONVERSATIONS) {
    await insertConversation(client, userIds, spec);
  }
}

/** Seeds only when there are no users, so restarting never duplicates data. */
export async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT count(*) AS count FROM users');
  if (rows[0].count > 0) return false;
  await withTransaction(insertDemoData);
  console.log(`Seeded ${USERS.length} demo users (password: ${DEMO_PASSWORD})`);
  return true;
}

/** Deletes all application data and seeds again. */
export async function reseed() {
  await withTransaction(async (client) => {
    // Everything else references one of these two tables with ON DELETE CASCADE.
    await client.query('TRUNCATE users, conversations CASCADE');
    await insertDemoData(client);
  });
  console.log(`Database reset and seeded with ${USERS.length} demo users (password: ${DEMO_PASSWORD})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const force = process.argv.includes('--force');
  runMigrations()
    .then(async () => {
      if (force) return reseed();
      if (!(await seedIfEmpty())) console.log('Database already has users; run "npm run seed:reset" to start over.');
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
