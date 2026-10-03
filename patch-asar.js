/**
 * Antigravity ASAR Patcher
 * 
 * Safely extracts app.asar, applies PHP syntax highlighting hooks
 * to preload.js, ipcHandlers.js, utils.js, injects phpHighlighting.js,
 * and repacks the archive with exact unpack options.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Load asar module (local or global or dynamic import fallback)
let asar;
try {
  asar = require(path.join(__dirname, 'node_modules', '@electron', 'asar', 'lib', 'asar.js'));
} catch (e) {
  try {
    asar = require('@electron/asar');
  } catch (e2) {
    asar = null;
  }
}

async function getAsarModule() {
  if (asar) return asar;
  try {
    asar = require(path.join(__dirname, 'node_modules', '@electron', 'asar', 'lib', 'asar.js'));
    return asar;
  } catch (e) {}
  try {
    asar = require('@electron/asar');
    return asar;
  } catch (e) {}
  try {
    const imported = await import(path.join(__dirname, 'node_modules', '@electron', 'asar', 'lib', 'asar.js'));
    asar = imported.default || imported;
    return asar;
  } catch (e) {}
  try {
    const imported = await import('@electron/asar');
    asar = imported.default || imported;
    return asar;
  } catch (e) {}
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    asarPath: null,
    targetAsar: null,
    extSource: path.join(__dirname, 'phpHighlighting.js'),
    stagedPath: null,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--asar' && args[i + 1]) {
      result.asarPath = args[++i];
    } else if (args[i] === '--target-asar' && args[i + 1]) {
      result.targetAsar = args[++i];
    } else if (args[i] === '--ext-source' && args[i + 1]) {
      result.extSource = args[++i];
    } else if (args[i] === '--staged' && args[i + 1]) {
      result.stagedPath = args[++i];
    } else if (args[i] === '--force') {
      result.force = true;
    }
  }

  return result;
}

function findDefaultAsarPath() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'resources', 'app.asar'),
    'C:\\Program Files\\Antigravity\\resources\\app.asar',
    'C:\\Program Files (x86)\\Antigravity\\resources\\app.asar',
    path.join(process.env.ANTIGRAVITY_PATH || '', 'resources', 'app.asar'),
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function isFileLocked(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return false;
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
      return true;
    }
    return false;
  }
}

async function extractAsar(sourceAsar, destDir) {
  const mod = await getAsarModule();

  // If sourceAsar has unpacked files in a sibling folder (e.g. app.asar.bak looking for app.asar.bak.unpacked)
  const defaultUnpacked = sourceAsar + '.unpacked';
  const siblingUnpacked = path.join(path.dirname(sourceAsar), 'app.asar.unpacked');
  let createdTempUnpacked = false;
  if (!fs.existsSync(defaultUnpacked) && fs.existsSync(siblingUnpacked)) {
    try {
      fs.cpSync(siblingUnpacked, defaultUnpacked, { recursive: true });
      createdTempUnpacked = true;
    } catch (e) {}
  }

  try {
    if (mod && typeof mod.extractAll === 'function') {
      mod.extractAll(sourceAsar, destDir);
      return;
    }
    // Fallback to npx
    execSync(`npx --yes @electron/asar extract "${sourceAsar}" "${destDir}"`, {
      stdio: 'inherit',
      windowsHide: true,
    });
  } finally {
    if (createdTempUnpacked) {
      try { fs.rmSync(defaultUnpacked, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

async function packAsar(sourceDir, destAsar) {
  const mod = await getAsarModule();
  if (mod && typeof mod.createPackageWithOptions === 'function') {
    await mod.createPackageWithOptions(sourceDir, destAsar, {
      unpackDir: 'node_modules/chrome-devtools-mcp',
    });
    return;
  }
  // Fallback to npx
  execSync(`npx --yes @electron/asar pack "${sourceDir}" "${destAsar}" --unpack-dir "node_modules/chrome-devtools-mcp"`, {
    stdio: 'inherit',
    windowsHide: true,
  });
}

function patchPreload(preloadPath) {
  let content = fs.readFileSync(preloadPath, 'utf8');
  if (content.includes('[ANTIGRAVITY-PHP-START]')) {
    console.log('  [Preload] Already patched.');
    return false;
  }

  const snippet = `
// [ANTIGRAVITY-PHP-START]
try {
    const _electron = typeof electron_1 !== 'undefined' ? electron_1 : require('electron');
    const _phpCode = _electron.ipcRenderer.sendSync('antigravity:get-php-script');
    if (_phpCode) {
        _electron.webFrame.executeJavaScript(_phpCode);
    }
} catch (_e) {
    console.error('[Preload] Failed to load PHP script via IPC:', _e);
}
// [ANTIGRAVITY-PHP-END]
`;
  content += snippet;
  fs.writeFileSync(preloadPath, content, 'utf8');
  console.log('  [Preload] Patched successfully.');
  return true;
}

function patchIpcHandlers(ipcPath) {
  let content = fs.readFileSync(ipcPath, 'utf8');
  if (content.includes('[ANTIGRAVITY-PHP-START]')) {
    console.log('  [IpcHandlers] Already patched.');
    return false;
  }

  const snippet = `
    // [ANTIGRAVITY-PHP-START]
    const _electron = typeof electron_1 !== 'undefined' ? electron_1 : require('electron');
    _electron.ipcMain.on('antigravity:get-php-script', (event) => {
        try {
            const _fs = require('fs');
            const _path = require('path');
            let combined = '';
            const userExtDir = _path.join(process.env.APPDATA || '', 'Antigravity', 'extensions');
            if (_fs.existsSync(userExtDir)) {
                const files = _fs.readdirSync(userExtDir);
                for (const file of files) {
                    if (file.endsWith('.js')) {
                        try {
                            combined += '\\n' + _fs.readFileSync(_path.join(userExtDir, file), 'utf-8');
                        } catch (e) {}
                    }
                }
            }
            if (!combined) {
                const bundledPath = _path.join(__dirname, 'phpHighlighting.js');
                if (_fs.existsSync(bundledPath)) {
                    combined = _fs.readFileSync(bundledPath, 'utf-8');
                }
            }
            event.returnValue = combined;
        } catch (err) {
            console.error('[Main] Failed to get php script:', err);
            event.returnValue = '';
        }
    });
    // [ANTIGRAVITY-PHP-END]
`;

  // Insert before the last closing brace of registerIpcHandlers
  const lastBraceIndex = content.lastIndexOf('}');
  if (lastBraceIndex === -1) {
    throw new Error('Could not find closing brace in ipcHandlers.js');
  }

  content = content.slice(0, lastBraceIndex) + snippet + content.slice(lastBraceIndex);
  fs.writeFileSync(ipcPath, content, 'utf8');
  console.log('  [IpcHandlers] Patched successfully.');
  return true;
}

function patchUtils(utilsPath) {
  let content = fs.readFileSync(utilsPath, 'utf8');
  if (content.includes('[ANTIGRAVITY-PHP-START]')) {
    console.log('  [Utils] Already patched.');
    return false;
  }

  const snippet = `
    // [ANTIGRAVITY-PHP-START]
    const injectExtensions = (w) => {
        try {
            const _fs = require('fs');
            let combined = '';
            const userExtDir = path_1.default.join(process.env.APPDATA || '', 'Antigravity', 'extensions');
            if (_fs.existsSync(userExtDir)) {
                const files = _fs.readdirSync(userExtDir);
                for (const file of files) {
                    if (file.endsWith('.js')) {
                        try {
                            combined += '\\n' + _fs.readFileSync(path_1.default.join(userExtDir, file), 'utf-8');
                        } catch (e) {}
                    }
                }
            }
            if (!combined) {
                const bundledPath = path_1.default.join(__dirname, 'phpHighlighting.js');
                if (_fs.existsSync(bundledPath)) {
                    combined = _fs.readFileSync(bundledPath, 'utf-8');
                }
            }
            if (combined && w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
                void w.webContents.executeJavaScript(combined).catch((err) => {
                    console.error('[Window] executeJavaScript error:', err);
                });
            }
        } catch (err) {
            console.error('[Window] Failed to inject PHP highlighting:', err);
        }
    };
    win.webContents.on('dom-ready', () => {
        injectExtensions(win);
    });
    // [ANTIGRAVITY-PHP-END]
`;

  // Insert before `void win.loadURL(url);` or `win.loadURL(url);`
  const targetPattern = /(?:void\s+)?win\.loadURL\(url\);/;
  const match = content.match(targetPattern);
  if (!match) {
    throw new Error('Could not find win.loadURL(url) in utils.js');
  }

  const idx = match.index;
  content = content.slice(0, idx) + snippet + '\n    ' + content.slice(idx);
  fs.writeFileSync(utilsPath, content, 'utf8');
  console.log('  [Utils] Patched successfully.');
  return true;
}

function verifyArchive(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  const jsonLen = buf.readUInt32LE(12);
  const jsonBuf = Buffer.alloc(jsonLen);
  fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
  fs.closeSync(fd);
  const header = JSON.parse(jsonBuf.toString('utf8'));

  const distFiles = header.files && header.files.dist && header.files.dist.files;
  if (!distFiles) {
    throw new Error('Verification failed: dist/ directory not found in asar header');
  }
  if (!distFiles['phpHighlighting.js']) {
    throw new Error('Verification failed: dist/phpHighlighting.js missing from asar');
  }
  if (!distFiles['preload.js']) {
    throw new Error('Verification failed: dist/preload.js missing from asar');
  }
  return true;
}

async function main() {
  const config = parseArgs();
  const sourceAsar = config.asarPath || findDefaultAsarPath();

  if (!sourceAsar || !fs.existsSync(sourceAsar)) {
    console.error(`[Patcher] Error: app.asar not found at "${sourceAsar}".`);
    console.error('  Please provide the path using --asar <path-to-app.asar>');
    process.exit(1);
  }

  const targetAsar = config.targetAsar || sourceAsar;
  const backupPath = sourceAsar + '.bak';

  console.log(`[Patcher] Source ASAR: ${sourceAsar}`);
  console.log(`[Patcher] Target ASAR: ${targetAsar}`);

  // Create backup if not already present
  if (!fs.existsSync(backupPath)) {
    console.log(`[Patcher] Creating safe backup at: ${backupPath}`);
    fs.copyFileSync(sourceAsar, backupPath);
  } else {
    console.log(`[Patcher] Backup already exists at: ${backupPath}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-patch-'));
  const tmpUnpacked = path.join(tmpDir, 'unpacked');
  const tmpPackedAsar = path.join(tmpDir, 'patched.asar');

  try {
    console.log(`[Patcher] Extracting archive...`);
    await extractAsar(sourceAsar, tmpUnpacked);

    const distDir = path.join(tmpUnpacked, 'dist');
    if (!fs.existsSync(distDir)) {
      throw new Error(`Invalid ASAR structure: dist directory missing at ${distDir}`);
    }

    // 1. Copy phpHighlighting.js to dist/
    const targetPhpGrammar = path.join(distDir, 'phpHighlighting.js');
    console.log(`[Patcher] Installing PHP grammar into dist/phpHighlighting.js...`);
    fs.copyFileSync(config.extSource, targetPhpGrammar);

    // 2. Patch preload.js
    console.log(`[Patcher] Patching preload.js...`);
    patchPreload(path.join(distDir, 'preload.js'));

    // 3. Patch ipcHandlers.js
    console.log(`[Patcher] Patching ipcHandlers.js...`);
    patchIpcHandlers(path.join(distDir, 'ipcHandlers.js'));

    // 4. Patch utils.js
    console.log(`[Patcher] Patching utils.js...`);
    patchUtils(path.join(distDir, 'utils.js'));

    // 5. Repack archive
    console.log(`[Patcher] Repacking patched ASAR archive...`);
    await packAsar(tmpUnpacked, tmpPackedAsar);

    // 6. Verify integrity
    console.log(`[Patcher] Verifying archive integrity...`);
    verifyArchive(tmpPackedAsar);
    console.log(`[Patcher] Integrity check PASSED.`);

    // 7. Check if target file is locked
    const tmpUnpackedDir = tmpPackedAsar + '.unpacked';
    const isLocked = isFileLocked(targetAsar);
    if (isLocked) {
      const stagedDest = config.stagedPath || (targetAsar + '.patched');
      console.log(`[Patcher] Target file is locked by a running process.`);
      console.log(`[Patcher] Staging patched archive at: ${stagedDest}`);
      fs.copyFileSync(tmpPackedAsar, stagedDest);
      const stagedUnpacked = stagedDest + '.unpacked';
      if (fs.existsSync(tmpUnpackedDir)) {
        try { fs.cpSync(tmpUnpackedDir, stagedUnpacked, { recursive: true, force: true }); } catch (e) {}
      }
      console.log(JSON.stringify({
        status: 'staged',
        sourceAsar,
        targetAsar,
        stagedPath: stagedDest,
        backupPath
      }));
    } else {
      console.log(`[Patcher] Target file is writable. Replacing target ASAR...`);
      fs.copyFileSync(tmpPackedAsar, targetAsar);
      const targetUnpacked = targetAsar + '.unpacked';
      if (fs.existsSync(tmpUnpackedDir)) {
        try { fs.cpSync(tmpUnpackedDir, targetUnpacked, { recursive: true, force: true }); } catch (e) {}
      }
      console.log(`[Patcher] Successfully patched ${targetAsar}!`);
      console.log(JSON.stringify({
        status: 'applied',
        sourceAsar,
        targetAsar,
        backupPath
      }));
    }

    process.exit(0);
  } finally {
    // Cleanup temporary files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

main().catch(err => {
  console.error('[Patcher] Fatal error during patching:', err);
  process.exit(1);
});
