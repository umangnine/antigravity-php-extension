/**
 * Antigravity ASAR Restorer / Uninstaller
 * 
 * Restores original app.asar from backup, cleans up staged patch files,
 * and removes user extension files.
 */
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    asarPath: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--asar' && args[i + 1]) {
      result.asarPath = args[++i];
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

function removeUserExtension() {
  const extFile = path.join(process.env.APPDATA || '', 'Antigravity', 'extensions', 'phpHighlighting.js');
  if (fs.existsSync(extFile)) {
    try {
      fs.unlinkSync(extFile);
      console.log(`[Restorer] Removed user extension at: ${extFile}`);
    } catch (e) {
      console.warn(`[Restorer] Warning: Could not remove user extension: ${e.message}`);
    }
  }
}

function cleanupStagedFiles(asarPath) {
  const stagedAsar = asarPath + '.patched';
  const stagedUnpacked = asarPath + '.patched.unpacked';
  if (fs.existsSync(stagedAsar)) {
    try {
      fs.unlinkSync(stagedAsar);
      console.log(`[Restorer] Removed staged patch file: ${stagedAsar}`);
    } catch (e) {}
  }
  if (fs.existsSync(stagedUnpacked)) {
    try {
      fs.rmSync(stagedUnpacked, { recursive: true, force: true });
      console.log(`[Restorer] Removed staged unpacked folder: ${stagedUnpacked}`);
    } catch (e) {}
  }
}

async function main() {
  const config = parseArgs();
  const asarPath = config.asarPath || findDefaultAsarPath();

  if (!asarPath) {
    console.error('[Restorer] Error: Could not locate Antigravity app.asar.');
    process.exit(1);
  }

  console.log(`[Restorer] Target ASAR: ${asarPath}`);
  const backupPath = asarPath + '.bak';

  if (!fs.existsSync(backupPath)) {
    console.error(`[Restorer] Error: Backup not found at ${backupPath}.`);
    process.exit(1);
  }

  // Clean up user extension file and any staged files
  removeUserExtension();
  cleanupStagedFiles(asarPath);

  // Check if target file is locked
  if (isFileLocked(asarPath)) {
    console.log(`[Restorer] Target file is locked because Antigravity is running.`);
    console.log(JSON.stringify({
      status: 'locked',
      asarPath,
      backupPath
    }));
    process.exit(2);
  }

  // Restore backup
  try {
    fs.copyFileSync(backupPath, asarPath);
    const backupUnpacked = backupPath + '.unpacked';
    const targetUnpacked = asarPath + '.unpacked';
    if (fs.existsSync(backupUnpacked)) {
      try {
        fs.cpSync(backupUnpacked, targetUnpacked, { recursive: true, force: true });
      } catch (e) {}
    }
    console.log(`[Restorer] Successfully restored original app.asar from backup.`);
    console.log(JSON.stringify({
      status: 'restored',
      asarPath,
      backupPath
    }));
    process.exit(0);
  } catch (err) {
    console.error(`[Restorer] Failed to restore backup: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Restorer] Fatal error:', err);
  process.exit(1);
});
