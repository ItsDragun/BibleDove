const { build } = require('electron-builder');
const { Jimp, JimpMime } = require('jimp');
const path = require('path');
const fs = require('fs');

// ─── Helper ──────────────────────────────────────────────────────────────────
function log(stage, msg) {
  const stages = ['', '1/4', '2/4', '3/4', '4/4'];
  const prefix = stages[stage] ? `[${stages[stage]}]` : '[   ]';
  console.log(`${prefix} ${msg}`);
}

// ─── Main Build ──────────────────────────────────────────────────────────────
async function buildInstaller() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        BIBLEDOVE — NSIS INSTALLER BUILD                      ║');
  console.log('║        Author : Lucid Tech.                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const pngIcon = path.join(__dirname, 'logo.png');
  const icoIcon = path.join(__dirname, 'logo.ico');

  // ── Stage 0: Convert image → ICO (NSIS requires .ico) ─────────────────────
  // logo.png may actually be a JPEG — jimp handles both formats.
  log(0, 'Converting logo image → logo.ico for NSIS compatibility...');
  const img = await Jimp.read(pngIcon);
  // Resize to 256x256 (main size NSIS uses)
  img.resize({ w: 256, h: 256 });
  const pngBuf = await img.getBuffer(JimpMime.png);

  // Write a minimal single-image ICO file (256x256 PNG-in-ICO format)
  // ICO header: 6 bytes; directory entry: 16 bytes; image data follows
  const headerSize = 6;
  const dirEntrySize = 16;
  const offset = headerSize + dirEntrySize;
  const icoHeader = Buffer.alloc(headerSize);
  icoHeader.writeUInt16LE(0, 0);       // Reserved
  icoHeader.writeUInt16LE(1, 2);       // Type: 1 = ICO
  icoHeader.writeUInt16LE(1, 4);       // Number of images
  const dirEntry = Buffer.alloc(dirEntrySize);
  dirEntry.writeUInt8(0, 0);           // Width: 0 means 256
  dirEntry.writeUInt8(0, 1);           // Height: 0 means 256
  dirEntry.writeUInt8(0, 2);           // Color palette count
  dirEntry.writeUInt8(0, 3);           // Reserved
  dirEntry.writeUInt16LE(1, 4);        // Color planes
  dirEntry.writeUInt16LE(32, 6);       // Bits per pixel
  dirEntry.writeUInt32LE(pngBuf.length, 8);  // Size of image data
  dirEntry.writeUInt32LE(offset, 12);  // Offset of image data
  const icoBuf = Buffer.concat([icoHeader, dirEntry, pngBuf]);
  fs.writeFileSync(icoIcon, icoBuf);
  console.log(`      \u2714 logo.ico created (${(icoBuf.length / 1024).toFixed(1)} KB, 256x256).`);

  // ── Stage 1: Clean previous output ────────────────────────────────────────
  log(1, 'Cleaning previous distribution output...');
  const distDir = path.join(__dirname, 'dist');
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log('      ✔ Old dist directory removed.');
  } else {
    console.log('      ✔ No previous dist found — skipping.');
  }

  // ── Stage 2: Validate assets ───────────────────────────────────────────────
  log(2, 'Validating required build assets...');
  const required = ['main.js', 'preload.js', 'logo.png', 'renderer'];
  for (const asset of required) {
    const assetPath = path.join(__dirname, asset);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Missing required asset: ${asset} (expected at ${assetPath})`);
    }
    console.log(`      ✔ Found: ${asset}`);
  }

  // ── Stage 3: Run electron-builder (NSIS) ──────────────────────────────────
  log(3, 'Compiling NSIS wizard installer via electron-builder...');
  console.log('      Publisher  : Lucid Tech.');
  console.log('      Author     : Lucid Tech.');
  console.log(`      Version    : ${require('./package.json').version}`);
  console.log('      Arch       : x64');
  console.log('      Target     : NSIS (multi-stage wizard)\n');

  await build({
    config: {
      appId: 'com.lucidtech.bibledove',
      productName: 'BibleDove',
      copyright: '© 2026 Lucid Tech.',

      // ── Windows ────────────────────────────────────────────────────────────
      win: {
        target: [{ target: 'nsis', arch: ['x64'] }],
        icon: icoIcon,
        publisherName: 'Lucid Tech.',
        legalTrademarks: 'Lucid Tech.',
      },

      // ── NSIS Wizard Stages ─────────────────────────────────────────────────
      // Produces a multi-page installer:
      //   Page 1 → Welcome
      //   Page 2 → License / Copyright notice
      //   Page 3 → Choose install directory
      //   Page 4 → Shortcut options
      //   Page 5 → Installing (progress bar)
      //   Page 6 → Finish (optionally launch app)
      nsis: {
        oneClick: false,                          // Show full wizard, not silent
        allowElevation: true,                     // Request admin if per-machine
        allowToChangeInstallationDirectory: true, // Page 3: directory picker
        installerIcon: icoIcon,
        uninstallerIcon: icoIcon,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'BibleDove',
        perMachine: false,                        // Install for current user by default
        deleteAppDataOnUninstall: false,
        displayLanguageSelector: false,
        installerLanguages: ['en_US'],
        multiLanguageInstaller: false,
        // Custom finish page — offer to launch after install
        runAfterFinish: true,
        // NSIS script header injected verbatim
        include: undefined,                       // No custom .nsh override needed
        script: undefined,
      },

      // ── Files to bundle ────────────────────────────────────────────────────
      files: [
        '**/*',
        '!dist/**/*',
        '!ddg_output.html',
        '!yahoo_output.html',
        '!ask_output.html',
        '!scratch_ddg.js',
        '!test-packager.js',
        '!build-installer.js',
      ],

      directories: {
        output: 'dist',
      },
    },
  });

  // ── Stage 4: Verify output ─────────────────────────────────────────────────
  log(4, 'Verifying installer output...');
  const installerDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(installerDir)) {
    throw new Error('dist/ directory was not created. Build may have silently failed.');
  }

  // Find the generated Setup exe
  function findExe(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findExe(full);
        if (found) return found;
      } else if (entry.name.toLowerCase().endsWith('setup.exe') || entry.name.toLowerCase().includes('setup')) {
        return full;
      }
    }
    return null;
  }

  const setupExe = findExe(installerDir);
  if (setupExe) {
    const sizeMB = (fs.statSync(setupExe).size / 1024 / 1024).toFixed(1);
    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  🏆  BUILD SUCCESSFUL                                        ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║  Installer : ${path.basename(setupExe).padEnd(47)}║`);
    console.log(`║  Size      : ${(sizeMB + ' MB').padEnd(47)}║`);
    console.log(`║  Location  : dist/                                           ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  } else {
    console.log('\n⚠  Build completed but no Setup.exe was found in dist/. Check electron-builder output above.');
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────────
buildInstaller().catch((err) => {
  console.error('\n❌ NSIS Build Failed:', err.message || err);
  process.exit(1);
});
