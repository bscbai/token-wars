/**
 * S3 — Event Guard tests
 *
 * Covers:
 *   ① RateLimiter class (consume / getDropped / cleanup)
 *   ② validateSchema (type / range / string-length / enum / required)
 *   ③ on() wrapper integration (rate-limit drop + schema reject + normal pass)
 */
const { RateLimiter, rateLimiter, validateSchema, on, RATE_CATEGORIES } =
  require('../server/middleware/eventGuard');
const { EVENTS } = require('../shared/constants');

// --- mock socket ----------------------------------------------------------

let _seq = 0;
function mockSocket() {
  const id = `mock-${++_seq}`;
  const listeners = new Map();
  const emitted = [];
  return {
    id,
    on(event, fn) { listeners.set(event, fn); },
    emit(event, data) { emitted.push({ event, data }); },
    /** Simulate the server receiving a client event. */
    _receive(event, data) { const fn = listeners.get(event); if (fn) fn(data); },
    emitted,
  };
}

// ==========================================================================
// ① RateLimiter class
// ==========================================================================

describe('RateLimiter', () => {
  let rl;

  beforeEach(() => { rl = new RateLimiter(); });

  it('allows events up to the configured limit', () => {
    const cfg = RATE_CATEGORIES.economy; // 2/s
    let allowed = 0;
    for (let i = 0; i < cfg.limit; i++) {
      if (rl.consume('s1', 'economy')) allowed++;
    }
    expect(allowed).toBe(cfg.limit);
  });

  it('drops events that exceed the limit', () => {
    const cfg = RATE_CATEGORIES.economy; // 2/s
    for (let i = 0; i < cfg.limit; i++) rl.consume('s1', 'economy');
    const allowed = rl.consume('s1', 'economy');
    expect(allowed).toBe(false);
  });

  it('counts dropped events via getDropped', () => {
    const cfg = RATE_CATEGORIES.economy; // 2/s
    for (let i = 0; i < cfg.limit; i++) rl.consume('s1', 'economy');
    rl.consume('s1', 'economy'); // dropped #1
    rl.consume('s1', 'economy'); // dropped #2
    rl.consume('s1', 'economy'); // dropped #3
    expect(rl.getDropped('s1', 'economy')).toBe(3);
  });

  it('isolates categories — economy limit does not affect query', () => {
    const cfg = RATE_CATEGORIES.economy; // 2/s
    for (let i = 0; i < cfg.limit; i++) rl.consume('s1', 'economy');
    expect(rl.consume('s1', 'economy')).toBe(false);
    // query category should still be allowed
    expect(rl.consume('s1', 'query')).toBe(true);
  });

  it('isolates sockets — s1 limit does not affect s2', () => {
    const cfg = RATE_CATEGORIES.economy;
    for (let i = 0; i < cfg.limit; i++) rl.consume('s1', 'economy');
    expect(rl.consume('s1', 'economy')).toBe(false);
    expect(rl.consume('s2', 'economy')).toBe(true);
  });

  it('cleanup removes all state for a socket', () => {
    rl.consume('s1', 'economy');
    rl.consume('s1', 'query');
    rl.cleanup('s1');
    expect(rl.getDropped('s1', 'economy')).toBe(0);
    // After cleanup, the socket gets a fresh bucket
    expect(rl.consume('s1', 'economy')).toBe(true);
  });

  it('returns true for unknown category (unlimited)', () => {
    expect(rl.consume('s1', 'nonexistent')).toBe(true);
  });
});

// ==========================================================================
// ② validateSchema
// ==========================================================================

describe('validateSchema', () => {
  it('passes when schema is null (no validation)', () => {
    const r = validateSchema({ anything: 1 }, null);
    expect(r.valid).toBe(true);
  });

  // number
  it('validates number type', () => {
    const schema = { x: { type: 'number', required: true } };
    expect(validateSchema({ x: 5 }, schema).valid).toBe(true);
    expect(validateSchema({ x: '5' }, schema).valid).toBe(false);
    expect(validateSchema({ x: NaN }, schema).valid).toBe(false);
  });

  it('validates number range (min/max)', () => {
    const schema = { x: { type: 'number', min: 0, max: 10, required: true } };
    expect(validateSchema({ x: 0 }, schema).valid).toBe(true);
    expect(validateSchema({ x: 10 }, schema).valid).toBe(true);
    expect(validateSchema({ x: -1 }, schema).valid).toBe(false);
    expect(validateSchema({ x: 11 }, schema).valid).toBe(false);
  });

  it('validates integer constraint', () => {
    const schema = { x: { type: 'number', integer: true, required: true } };
    expect(validateSchema({ x: 3 }, schema).valid).toBe(true);
    expect(validateSchema({ x: 3.5 }, schema).valid).toBe(false);
  });

  // string
  it('validates string type', () => {
    const schema = { name: { type: 'string', required: true } };
    expect(validateSchema({ name: 'ok' }, schema).valid).toBe(true);
    expect(validateSchema({ name: 42 }, schema).valid).toBe(false);
  });

  it('validates string maxLength', () => {
    const schema = { name: { type: 'string', maxLength: 5, required: true } };
    expect(validateSchema({ name: 'abc' }, schema).valid).toBe(true);
    expect(validateSchema({ name: 'abcdef' }, schema).valid).toBe(false);
  });

  it('rejects string exceeding maxLength with detail', () => {
    const schema = { name: { type: 'string', maxLength: 64, required: true } };
    const r = validateSchema({ name: 'x'.repeat(10000) }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/length must be <= 64 \(got 10000\)/);
  });

  it('validates string enum', () => {
    const schema = { mode: { type: 'string', enum: ['1v1', '3v3'], required: true } };
    expect(validateSchema({ mode: '1v1' }, schema).valid).toBe(true);
    expect(validateSchema({ mode: '5v5' }, schema).valid).toBe(false);
  });

  // enum (generic)
  it('validates generic enum', () => {
    const schema = { status: { type: 'enum', enum: ['idle', 'active'], required: true } };
    expect(validateSchema({ status: 'idle' }, schema).valid).toBe(true);
    expect(validateSchema({ status: 'busy' }, schema).valid).toBe(false);
  });

  // any
  it('"any" type accepts any value when present', () => {
    const schema = { data: { type: 'any', required: true } };
    expect(validateSchema({ data: {} }, schema).valid).toBe(true);
    expect(validateSchema({ data: [1, 2] }, schema).valid).toBe(true);
    expect(validateSchema({ data: 'str' }, schema).valid).toBe(true);
    expect(validateSchema({ data: 42 }, schema).valid).toBe(true);
  });

  // required
  it('rejects missing required field', () => {
    const schema = { x: { type: 'number', required: true } };
    expect(validateSchema({ x: 1 }, schema).valid).toBe(true);
    expect(validateSchema({}, schema).valid).toBe(false);
    expect(validateSchema(null, schema).valid).toBe(false);
    expect(validateSchema(undefined, schema).valid).toBe(false);
  });

  it('allows missing optional field', () => {
    const schema = { x: { type: 'number' } };
    expect(validateSchema({}, schema).valid).toBe(true);
  });

  // payload structure
  it('rejects non-object payload', () => {
    const schema = { x: { type: 'number', required: true } };
    expect(validateSchema(42, schema).valid).toBe(false);
    expect(validateSchema('str', schema).valid).toBe(false);
    expect(validateSchema([1, 2], schema).valid).toBe(false);
  });

  it('accumulates multiple errors', () => {
    const schema = {
      a: { type: 'number', required: true },
      b: { type: 'string', maxLength: 3, required: true },
    };
    const r = validateSchema({ a: 'x', b: 'abcd' }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
  });
});

// ==========================================================================
// ③ on() wrapper integration
// ==========================================================================

describe('on() wrapper', () => {
  afterEach(() => {
    rateLimiter.reset();
  });

  it('calls handler for valid data', () => {
    const sock = mockSocket();
    let received = null;
    const schema = { x: { type: 'number', min: 0, max: 10, required: true } };
    on(sock, 'test:valid', schema, (data) => { received = data; }, 'query');
    sock._receive('test:valid', { x: 5 });
    expect(received).not.toBeNull();
    expect(received.x).toBe(5);
  });

  it('emits EVENTS.ERROR and skips handler on schema failure', () => {
    const sock = mockSocket();
    let called = false;
    const schema = { x: { type: 'number', min: 0, max: 10, required: true } };
    on(sock, 'test:invalid', schema, () => { called = true; }, 'query');
    sock._receive('test:invalid', { x: 999 });
    expect(called).toBe(false);
    const err = sock.emitted.find((e) => e.event === EVENTS.ERROR);
    expect(err).toBeDefined();
    expect(err.data.code).toBe('VALIDATION_ERROR');
    expect(err.data.event).toBe('test:invalid');
  });

  it('emits EVENTS.ERROR and skips handler on missing required field', () => {
    const sock = mockSocket();
    let called = false;
    const schema = { name: { type: 'string', maxLength: 10, required: true } };
    on(sock, 'test:missing', schema, () => { called = true; }, 'query');
    sock._receive('test:missing', {});
    expect(called).toBe(false);
    const err = sock.emitted.find((e) => e.event === EVENTS.ERROR);
    expect(err.data.code).toBe('VALIDATION_ERROR');
  });

  it('passes through when schema is null', () => {
    const sock = mockSocket();
    let called = false;
    on(sock, 'test:null', null, () => { called = true; }, 'query');
    sock._receive('test:null', { anything: true });
    expect(called).toBe(true);
  });

  it('rate-limits: drops events above the limit and emits ERROR', () => {
    const sock = mockSocket();
    let callCount = 0;
    // economy = 2/s
    on(sock, 'test:ratelimit', null, () => { callCount++; }, 'economy');

    // Fire 10 events — only 2 should pass
    for (let i = 0; i < 10; i++) {
      sock._receive('test:ratelimit', {});
    }

    expect(callCount).toBe(2);
    const rateErrors = sock.emitted.filter(
      (e) => e.event === EVENTS.ERROR && e.data.code === 'RATE_LIMITED'
    );
    expect(rateErrors).toHaveLength(8);
  });

  it('rate-limits: dropped count is tracked', () => {
    const sock = mockSocket();
    on(sock, 'test:dropped', null, () => {}, 'economy');
    for (let i = 0; i < 10; i++) {
      sock._receive('test:dropped', {});
    }
    expect(rateLimiter.getDropped(sock.id, 'economy')).toBe(8);
  });

  it('rate-limits: schema validation runs before handler only when under limit', () => {
    const sock = mockSocket();
    let callCount = 0;
    const schema = { x: { type: 'number', min: 0, max: 5, required: true } };
    on(sock, 'test:combined', schema, () => { callCount++; }, 'economy');

    // First 2 are valid → handler called
    sock._receive('test:combined', { x: 1 });
    sock._receive('test:combined', { x: 2 });
    // 3rd is rate-limited → no handler, RATE_LIMITED error
    sock._receive('test:combined', { x: 3 });
    // 4th is also rate-limited but with bad data → still RATE_LIMITED (rate check first)
    sock._receive('test:combined', { x: 999 });

    expect(callCount).toBe(2);
    const rateErrs = sock.emitted.filter((e) => e.data && e.data.code === 'RATE_LIMITED');
    expect(rateErrs).toHaveLength(2);
    const valErrs = sock.emitted.filter((e) => e.data && e.data.code === 'VALIDATION_ERROR');
    expect(valErrs).toHaveLength(0); // rate limit takes priority
  });
});
