/**
 * Event Guard — unified rate-limiting + schema-validation wrapper for
 * Socket.IO event handlers.
 *
 * Exports:
 *   - RateLimiter     class (per-socket, per-category token-bucket)
 *   - rateLimiter     shared singleton instance
 *   - validateSchema  pure validation function
 *   - on              wrapper that replaces bare `socket.on`
 *   - RATE_CATEGORIES category → { limit, windowMs } config
 *
 * Design goals (S3):
 *   ① Per-event-category rate limiting (movement 12/s, skill 10/s, economy 2/s,
 *     query 5/s, ping 10/s, auth 10/min).
 *   ② Lightweight schema validation (type / range / string-length / enum).
 *   ③ Validation failure → structured log + emit EVENTS.ERROR.
 *   ④ RateLimiter is a standalone class — Phase 4 can swap the in-memory Map
 *     for Redis without changing the interface.
 */

const logger = require('../utils/logger');
const { EVENTS } = require('../../shared/protocol');

// --- Rate-limit categories -------------------------------------------------

const RATE_CATEGORIES = {
  movement: { limit: 12, windowMs: 1000 },  // 12/s
  skill:    { limit: 10, windowMs: 1000 },  // 10/s
  economy:  { limit: 2,  windowMs: 1000 },  // 2/s
  query:    { limit: 5,  windowMs: 1000 },  // 5/s
  ping:     { limit: 10, windowMs: 1000 },  // 10/s
  auth:     { limit: 10, windowMs: 60000 }, // 10/min
};

// --- RateLimiter class ----------------------------------------------------

class RateLimiter {
  constructor() {
    /** @type {Map<string, Map<string, {count:number, resetTime:number, dropped:number}>>} */
    this.buckets = new Map();
  }

  /**
   * Attempt to consume one token from the bucket for (socketId, category).
   * @returns {boolean} true if allowed, false if rate-limited.
   */
  consume(socketId, category) {
    const cfg = RATE_CATEGORIES[category];
    if (!cfg) return true; // unknown category → unlimited

    let socketBuckets = this.buckets.get(socketId);
    if (!socketBuckets) {
      socketBuckets = new Map();
      this.buckets.set(socketId, socketBuckets);
    }

    const now = Date.now();
    let bucket = socketBuckets.get(category);
    if (!bucket || now > bucket.resetTime) {
      bucket = { count: 0, resetTime: now + cfg.windowMs, dropped: 0 };
      socketBuckets.set(category, bucket);
    }

    if (bucket.count >= cfg.limit) {
      bucket.dropped++;
      return false;
    }

    bucket.count++;
    return true;
  }

  /**
   * @returns {number} how many events were dropped for (socketId, category).
   */
  getDropped(socketId, category) {
    const sb = this.buckets.get(socketId);
    if (!sb) return 0;
    const b = sb.get(category);
    return b ? b.dropped : 0;
  }

  /** Remove all rate-limit state for a socket (call on disconnect). */
  cleanup(socketId) {
    this.buckets.delete(socketId);
  }

  /** Clear all state (useful for tests). */
  reset() {
    this.buckets.clear();
  }
}

// Shared singleton — all managers and index.js use this instance.
const rateLimiter = new RateLimiter();

// --- Schema validation -----------------------------------------------------

/**
 * Validate `data` against `schema`.
 *
 * schema format:
 *   null                         → no validation (any payload accepted)
 *   { field: { type, ...rules } }
 *
 * Supported types:
 *   'number'  — typeof === 'number', not NaN; optional min/max/integer
 *   'string'  — typeof === 'string'; optional maxLength/enum
 *   'enum'    — value ∈ rules.enum (works for any primitive)
 *   'any'     — no type check (just required presence if required:true)
 *
 * Each field supports: required (boolean, default false)
 *
 * @returns {{ valid:boolean, errors:string[], data:object|null }}
 *   On success, `data` is the original payload (extra fields preserved).
 *   On failure, `data` is null and `errors` lists the problems.
 */
function validateSchema(data, schema) {
  if (!schema) return { valid: true, errors: [], data };

  // Coerce null/undefined to empty object for field checks
  const payload = (data == null) ? {} : data;

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be an object'], data: null };
  }

  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = payload[field];
    const isPresent = value !== undefined && value !== null;

    if (!isPresent) {
      if (rules.required) {
        errors.push(`${field}: required`);
      }
      continue;
    }

    switch (rules.type) {
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`${field}: must be a number`);
        } else if (rules.integer !== undefined && rules.integer && !Number.isInteger(value)) {
          errors.push(`${field}: must be an integer`);
        } else if (rules.min !== undefined && value < rules.min) {
          errors.push(`${field}: must be >= ${rules.min}`);
        } else if (rules.max !== undefined && value > rules.max) {
          errors.push(`${field}: must be <= ${rules.max}`);
        }
        break;

      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${field}: must be a string`);
        } else if (rules.maxLength !== undefined && value.length > rules.maxLength) {
          errors.push(`${field}: length must be <= ${rules.maxLength} (got ${value.length})`);
        } else if (rules.enum !== undefined && !rules.enum.includes(value)) {
          errors.push(`${field}: must be one of [${rules.enum.join(', ')}]`);
        }
        break;

      case 'enum':
        if (!rules.enum || !rules.enum.includes(value)) {
          errors.push(`${field}: must be one of [${rules.enum ? rules.enum.join(', ') : ''}]`);
        }
        break;

      case 'any':
        // No type check — just presence (already verified above)
        break;

      default:
        // Unknown type — pass through silently
        break;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }
  return { valid: true, errors: [], data: payload };
}

// --- on() wrapper ----------------------------------------------------------

/**
 * Register a guarded socket event handler.
 *
 *   on(socket, event, schema, handler, category)
 *
 * 1. Rate-limit check (per category).  On failure → log + emit EVENTS.ERROR.
 * 2. Schema validation.                On failure → log + emit EVENTS.ERROR.
 * 3. Call handler with the original payload.
 *
 * @param {object}   socket    Socket.IO socket
 * @param {string}   event     Event name
 * @param {object|null} schema  Field rules or null for no validation
 * @param {function} handler   (payload) => void
 * @param {string}   category  Rate-limit category (default 'query')
 */
function on(socket, event, schema, handler, category = 'query') {
  socket.on(event, (rawData) => {
    // ① Rate limit
    if (!rateLimiter.consume(socket.id, category)) {
      logger.warn(
        { event, socketId: socket.id, category },
        '[EventGuard] Event rate-limited and dropped'
      );
      socket.emit(EVENTS.ERROR, {
        code: 'RATE_LIMITED',
        event,
        message: '请求过于频繁',
      });
      return;
    }

    // ② Schema validation
    if (schema) {
      const result = validateSchema(rawData, schema);
      if (!result.valid) {
        logger.warn(
          { event, socketId: socket.id, errors: result.errors },
          '[EventGuard] Schema validation failed'
        );
        socket.emit(EVENTS.ERROR, {
          code: 'VALIDATION_ERROR',
          event,
          errors: result.errors,
        });
        return;
      }
    }

    // ③ Call handler
    handler(rawData);
  });
}

module.exports = {
  RateLimiter,
  rateLimiter,
  validateSchema,
  on,
  RATE_CATEGORIES,
};
