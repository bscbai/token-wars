// Token Wars: 算力征途 — Protocol Definitions
// Re-exports from constants.js for backward compatibility
/* eslint-env browser, node */

if (typeof module !== 'undefined' && module.exports) {
  // Node.js: re-export from constants.js
  const c = require('./constants');
  module.exports = { EVENTS: c.EVENTS, REST: c.REST };
}
