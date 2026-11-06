/**
 * Token Wars — Electron Build Script
 *
 * Usage:
 *   node scripts/build-electron.js        # Build for current platform
 *   node scripts/build-electron.js --win   # Build for Windows
 *   node scripts/build-electron.js --mac   # Build for macOS
 *   node scripts/build-electron.js --all   # Build for all platforms
 *
 * Output: dist/Token Wars-{platform}-{arch}/
 */

const path = require('path');
const packager = require('electron-packager');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

const args = process.argv.slice(2);
const buildWin = args.includes('--win') || args.includes('--all') || args.length === 0;
const buildMac = args.includes('--mac') || args.includes('--all');
const buildLinux = args.includes('--linux') || args.includes('--all');

const platforms = [];
if (buildWin) platforms.push({ platform: 'win32', arch: 'x64' });
if (buildMac) platforms.push({ platform: 'darwin', arch: 'x64' });
if (buildLinux) platforms.push({ platform: 'linux', arch: 'x64' });

async function build() {
  console.log(`[Build] Token Wars v${require('../package.json').version}`);
  console.log(`[Build] Platforms: ${platforms.map(p => p.platform).join(', ')}`);
  console.log('');

  for (const { platform, arch } of platforms) {
    console.log(`[Build] Packaging for ${platform} ${arch}...`);
    try {
      const appPaths = await packager({
        dir: ROOT,
        name: 'Token Wars',
        platform,
        arch,
        electronDist: ELECTRON_DIST,
        out: DIST,
        overwrite: true,
        asar: true,
        prune: true,
        icon: path.join(ROOT, 'build', 'icon.png'),
        appBundleId: 'com.tokenwars.game',
        appVersion: require('../package.json').version,
        buildVersion: require('../package.json').version,
        win32metadata: {
          CompanyName: 'Token Wars Studio',
          FileDescription: 'Token Wars: 算力征途',
          ProductName: 'Token Wars',
          InternalName: 'Token Wars',
          OriginalFilename: 'Token-Wars.exe',
        },
      });
      console.log(`  ✓ ${path.basename(appPaths[0])}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('');
  console.log('[Build] Done!');
  console.log(`[Build] Output: ${DIST}`);
}

build();
