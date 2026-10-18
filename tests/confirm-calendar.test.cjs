const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the real route with isolated in-memory adapters: no network or credentials.
async function confirm(options = {}) {
  let handler;
  let booking = {
    id: 'synthetic-booking', booking_number: 'TEST-CALENDAR',
    confirm_token: 'synthetic-token', status: 'pending',
    customer_email: 'customer@example.test', booking_date: '2026-12-01',
    booking_time: '12:00', price: 80, original_price: 80,
    google_event_outbound_id: 'existing-outbound',
    google_event_return_id: 'existing-return'
  };
  const writes = [], emails = [], errors = [], synced = [];
  const supabase = { from(table) {
    assert.equal(table, 'bookings');
    let patch;
    const filters = [];
    async function execute() {
      assert.ok(filters.every(([key, value]) => booking[key] === value));
      if (patch) {
        writes.push({ ...patch });
        if ('google_event_outbound_id' in patch && options.saveError) {
          return { data: null, error: options.saveError };
        }
        booking = { ...booking, ...patch };
      }
      return { data: { ...booking }, error: null };
    }
    const query = {
      select() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      update(value) { patch = value; return this; },
      single: execute,
      then(resolve, reject) { return execute().then(resolve, reject); }
    };
    return query;
  } };
  const context = vm.createContext({
    express: { Router: () => ({ post(...args) { handler = args.at(-1); } }) },
    supabase, emailRateLimits: () => [], preventDuplicateEmails: () => () => {},
    syncBookingCalendarEvents: async value => {
      synced.push({ ...value });
      if (options.syncError) throw options.syncError;
      return { outboundEventId: 'new-outbound', returnEventId: 'new-return', ...options.ids };
    },
    sendEmail: async (...args) => { emails.push(args); },
    FROM_EMAIL: 'sender@example.test', REPLY_TO: 'reply@example.test',
    process: { env: { RESEND_TEMPLATE_CONFIRMED: 'synthetic-template',
      ADMIN_EMAIL: 'admin@example.test', CLIENT_URL: 'https://example.test' } },
    console: { log() {}, error(...args) { errors.push(args); } }
  });
  const source = fs.readFileSync(path.join(__dirname, '../routes/confirm.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default router;', '');
  vm.runInContext(source, context);
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
  await handler({ body: { token: 'synthetic-token' }, emailOperationKey: 'synthetic-operation',
    runEmailOperation: fn => fn(res) }, res);
  // Calendar failures must not change the existing confirmation/email contract.
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.email_confirmed, true);
  assert.equal(booking.confirm_token, null);
  assert.equal(booking.price, 80);
  assert.equal(booking.original_price, 80);
  assert.equal(synced.length, 1);
  assert.equal(emails.length, 2);
  assert.deepEqual(emails.map(call => call[0]), ['confirm-client', 'confirm-admin']);
  assert.ok(emails.every(call => call[1].template.id === 'synthetic-template'));
  return { booking, writes, emails, errors };
}

test('confirmation saves identifiers after successful Calendar synchronization', async () => {
  const f = await confirm();
  assert.equal(f.booking.google_event_outbound_id, 'new-outbound');
  assert.equal(f.booking.google_event_return_id, 'new-return');
  assert.equal(f.errors.length, 0);
});

test('failed Calendar synchronization preserves existing identifiers without an ID write', async () => {
  const f = await confirm({ syncError: new Error('Simulated synchronization failure') });
  assert.equal(f.booking.google_event_outbound_id, 'existing-outbound');
  assert.equal(f.booking.google_event_return_id, 'existing-return');
  assert.ok(!f.writes.some(write => 'google_event_outbound_id' in write));
  assert.ok(f.errors.some(error => error[0] === 'GOOGLE CALENDAR ERROR:'));
});

test('successful return removal clears only the return identifier', async () => {
  const f = await confirm({ ids: { outboundEventId: 'existing-outbound', returnEventId: null } });
  assert.equal(f.booking.google_event_outbound_id, 'existing-outbound');
  assert.equal(f.booking.google_event_return_id, null);
});

test('failed return removal does not clear either stored identifier', async () => {
  const f = await confirm({ syncError: new Error('Simulated return deletion failure') });
  assert.equal(f.booking.google_event_outbound_id, 'existing-outbound');
  assert.equal(f.booking.google_event_return_id, 'existing-return');
  assert.ok(!f.writes.some(write => 'google_event_return_id' in write));
});

test('Supabase ID save error is detected while confirmation and emails continue', async () => {
  const saveError = { code: 'SIMULATED_WRITE_FAILURE' };
  const f = await confirm({ saveError });
  assert.equal(f.booking.google_event_outbound_id, 'existing-outbound');
  assert.equal(f.booking.google_event_return_id, 'existing-return');
  assert.ok(f.writes.some(write => write.google_event_outbound_id === 'new-outbound'));
  assert.ok(f.errors.some(error => error[0] === 'GOOGLE CALENDAR IDS SAVE ERROR:' && error[1] === saveError));
});
