// Dev server: Starts the game server on port 3000
// Usage: node scripts/dev-server.js
// The game server (server/index.js) serves both API and static files.

const path = require('path');
require(path.join(__dirname, '..', 'server', 'index.js'));

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
