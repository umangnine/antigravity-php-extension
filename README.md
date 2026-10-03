# Antigravity PHP Syntax Highlighting Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078D6.svg?logo=windows)](https://microsoft.com/windows)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0-339933.svg?logo=node.js)](https://nodejs.org)
[![Antigravity](https://img.shields.io/badge/Target-Antigravity%202.0-8A2BE2.svg)](https://antigravity.google)

A portable, self-contained extension bundle to enable and maintain **PHP Syntax Highlighting** (including PHP 8.x features, superglobals, scope resolution, and HTML/PHP template markup) in **Google Antigravity 2.0** on Windows.

---

## ⚡ Quick Start

### Method 1: Git Clone (Quickest)

```powershell
git clone https://github.com/umangkathiyara/antigravity-php-extension.git
cd antigravity-php-extension
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
*(Dependencies are automatically installed if not already present).*

### Method 2: Download Portable Release (Zero npm / Offline)

1. Download the latest `antigravity-php-extension-portable.zip` from [Releases](https://github.com/umangkathiyara/antigravity-php-extension/releases).
2. Extract the ZIP anywhere on your system.
3. Right-click `install.ps1` -> **Run with PowerShell** (or run `.\install.ps1` from a terminal).
4. No internet connection or npm downloads required—everything is self-contained.

---

## 🎯 What the Installer Does

When you run `.\install.ps1`:
1. **Auto-Detects Antigravity**: Discovers the installation in `$env:LOCALAPPDATA\Programs\antigravity` (or checks running processes and registry).
2. **Safe Backup Invariant**: Automatically preserves an untouched backup at `app.asar.bak` in the `resources` directory before touching any files.
3. **Permanent ASAR Patch**: Safely injects the grammar into `app.asar` with Chromium sandbox compliance (`contextIsolation: true`) so syntax highlighting persists across restarts and new window tabs.
4. **Instant Hot-Reload**: Connects to active Antigravity windows via Chrome DevTools Protocol (`inject-live.js`) and activates highlighting immediately—no restart required!

---

## 🚀 Command Options & Switches

The installer supports several optional switches:

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `(default)` | - | Installs extension, activates live session, and patches `app.asar` permanently. |
| `-Restart` | Switch | Closes Antigravity gracefully, applies disk patch, and relaunches Antigravity immediately. |
| `-Restore` / `-Uninstall` | Switch | Restores original unpatched `app.asar.bak` and removes user extension files. |
| `-AntigravityPath <Path>` | String | Explicitly specify the Antigravity installation folder if installed in a custom path. |
| `-SkipLive` | Switch | Skips live session injection (only patches `app.asar` on disk). |
| `-Force` | Switch | Suppresses confirmation prompts during operations. |

### Command Examples

```powershell
# Standard install with live activation
.\enable-php-highlighting.ps1

# Install and automatically restart Antigravity
.\enable-php-highlighting.ps1 -Restart

# Install targeting a custom Antigravity directory
.\enable-php-highlighting.ps1 -AntigravityPath "D:\Tools\Antigravity"

# Revert to official stock Antigravity (Rollback)
.\uninstall.ps1
# OR
.\enable-php-highlighting.ps1 -Restore
```

---

## 🔄 When Antigravity Updates (Re-Activation)

When Antigravity downloads an official auto-update, its internal updater replaces `app.asar` with a new stock build.

To reactivate PHP syntax highlighting after an update:
1. Open PowerShell in this folder.
2. Run:
   ```powershell
   .\install.ps1
   ```
Your installation is immediately re-patched and active.

---

## 📌 Important Notes

> [!IMPORTANT]
> **Antigravity 2.0 vs Antigravity IDE**:
> This extension is specifically built for **Antigravity 2.0** (the Electron desktop application providing the Agent Chat, Diff viewers, and Artifact Canvas).
> If you are using the separate **Antigravity IDE** (the VS Code fork), you can install standard PHP language extensions directly through the Extensions panel (`Ctrl+Shift+X`).

> [!NOTE]
> **No Administrator Privileges Required**:
> Antigravity installs to the current user's local directory (`%LOCALAPPDATA%\Programs\antigravity`). You do **not** need an elevated administrator command prompt—run all scripts as a regular user.

> [!TIP]
> **Execution Policy Bypass**:
> If Windows PowerShell restricts script execution with `running scripts is disabled on this system`, use the `-ExecutionPolicy Bypass` flag:
> ```powershell
> powershell -ExecutionPolicy Bypass -File ".\install.ps1"
> ```

> [!NOTE]
> **Safe, Idempotent, and Reversible**:
> - Running `install.ps1` multiple times is safe; existing patch markers are recognized to avoid duplicate modifications.
> - An unpatched backup is automatically preserved at `app.asar.bak` in Antigravity's `resources` directory before any file modification.

---

## 🔍 How to Verify Installation

### 1. In Antigravity Chat or Artifacts
Render or view any PHP snippet (with or without `<?php` tags). Keywords, types, variables (`$this`), scope operators (`::`), and functions will display in syntax-highlighted colors:

```php
<?php

namespace App\Services;

class HealthService
{
    public function check(): array
    {
        return ['status' => 'ok', 'php_version' => PHP_VERSION];
    }
}
```

### 2. Via Command Line
You can test the live window status at any time:

```powershell
node .\inject-live.js --status
```

### 3. Run Automated Tests
Execute the comprehensive test suite:

```powershell
npm test
```

---

## 🛠️ Technical Architecture

Antigravity 2.0 uses Electron with a sandboxed Chromium renderer. The extension uses a multi-layer strategy to guarantee syntax highlighting across all contexts:

```
+-----------------------------------------------------------------------------------+
|                            enable-php-highlighting.ps1                            |
+-----------------------------------------------------------------------------------+
                                         |
         +-------------------------------+-------------------------------+
         |                               |                               |
         v                               v                               v
[1. User Extension]             [2. Live CDP Inject]             [3. ASAR Permanent Patch]
Copies phpHighlighting.js       Reads DevToolsActivePort;        Extracts app.asar;
to %APPDATA%\Antigravity\       Connects to open windows via     Injects dist/phpHighlighting.js;
extensions\                     CDP WebSocket;                   Hooks dist/preload.js (IPC sync),
                                Injects grammar immediately      Hooks dist/ipcHandlers.js,
                                without closing Antigravity.     Hooks dist/utils.js (dom-ready & load);
                                                                 Repacks with unpacked binaries;
                                                                 Atomically replaces app.asar.
```

1. **Chromium Sandbox Bridge**:
   Renderer processes run with `contextIsolation: true` in Electron's Chromium sandbox where Node `fs` is disabled. `dist/preload.js` queries `dist/ipcHandlers.js` via synchronous IPC (`antigravity:get-php-script`) to receive the grammar without triggering sandbox security errors.
2. **Dual-Layer Lifecycle Hooks**:
   In addition to preload execution, `dist/utils.js` registers `win.webContents.on('dom-ready')` and `did-finish-load` fallback injections. All injection paths check `window.__antigravity_php_syntax_installed` to remain strictly idempotent.
3. **Unpacked Native Binary Preservation**:
   Antigravity packages native tool binaries (such as `node_modules/chrome-devtools-mcp`) into `app.asar.unpacked`. The patcher repacks using `@electron/asar` with `--unpack-dir "node_modules/chrome-devtools-mcp"`, maintaining 100% binary compatibility.

---

## 📁 Package Contents

| File | Purpose |
| :--- | :--- |
| **`install.ps1`** | Quick 1-click installer and activator. |
| **`uninstall.ps1`** | Quick 1-click uninstaller / rollback script. |
| **`enable-php-highlighting.ps1`** | Core PowerShell installer with advanced options (`-Restart`, `-Restore`, etc.). |
| **`phpHighlighting.js`** | Complete PrismJS grammar for PHP 5.3–8.4, template markup, and superglobals. |
| **`inject-live.js`** | Chrome DevTools Protocol (CDP) live session injector for running windows. |
| **`patch-asar.js`** | ASAR archive extractor, injector, and repacker. |
| **`restore-asar.js`** | ASAR backup restorer and rollback utility. |
| **`test-suite.js`** | Automated unit and integration test suite. |
| **`package.json`** | Package manifest and scripts. |
| **`LICENSE`** | MIT License terms. |

---

## 📄 License & Attribution

- **Author**: **Umang Kathiyara** (<umangnine@gmail.com>)
- **Repository**: [https://github.com/umangkathiyara/antigravity-php-extension](https://github.com/umangkathiyara/antigravity-php-extension)
- **License**: Released under the [MIT License](LICENSE).
