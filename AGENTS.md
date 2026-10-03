# Antigravity PHP Extension - Agent Guidelines & Persistent Memory

## 1. Essential Commands
- **Run Test Suite**: `npm test` (or `node test-suite.js`)
- **Install / Patch**: `powershell -ExecutionPolicy Bypass -File .\install.ps1`
- **Install & Relaunch**: `.\install.ps1 -Restart`
- **Uninstall / Restore**: `.\uninstall.ps1` (or `.\enable-php-highlighting.ps1 -Restore`)
- **Live Status Check**: `node .\inject-live.js --status`

## 2. Architecture & Injection Lifecycle
- **Electron Target**: Target is **Antigravity 2.0** (`%LOCALAPPDATA%\Programs\antigravity`), *not* Antigravity IDE (the VS Code fork).
- **Three-Tier Injection Strategy**:
  1. *Live Injection*: Uses Chrome DevTools Protocol (`inject-live.js`) via `DevToolsActivePort` WebSocket for instant hot-reload without closing the app.
  2. *ASAR Permanent Patch*: `patch-asar.js` unpacks `app.asar`, injects `dist/phpHighlighting.js`, and hooks `preload.js`, `ipcHandlers.js`, and `utils.js`.
  3. *App Data Extension*: Copies `phpHighlighting.js` to `%APPDATA%\Antigravity\extensions\`.
- **Chromium Sandbox Bridge**:
  - Renderer runs with `contextIsolation: true` where Node `fs` is disabled.
  - Preload fetches grammar synchronously via IPC channel `antigravity:get-php-script` from `ipcHandlers.js`.
  - Fallback injection hooks into `win.webContents.on('dom-ready')` in `utils.js`.

## 3. Non-Discoverable Quirks & Conventions
- **Offline Self-Containment**: `node_modules/` is pre-bundled with `@electron/asar`. Do not run destructive `npm prune` or require internet access for core operations.
- **Unpacked Native Binary Preservation**: When patching/repacking `app.asar`, `node_modules/chrome-devtools-mcp` MUST remain unpacked (`--unpack-dir "node_modules/chrome-devtools-mcp"`) to avoid breaking native MCP tools.
- **Strict Idempotency**: All injection points gate execution behind `window.__antigravity_php_syntax_installed`. Never bypass this guard.
- **Backup Invariant**: `app.asar.bak` in Antigravity's `resources` directory is sacred; never overwrite or delete an existing `.bak` during reinstall.

## 4. Landmines & Prohibited Actions
- **DO NOT** use asynchronous IPC for the initial grammar load in preload—Prism must register before the first render loop.
- **DO NOT** require elevated admin privileges; Antigravity installs to `%LOCALAPPDATA%` under user scope.
- **DO NOT** remove PowerShell parameter set validation or `-ExecutionPolicy Bypass` wrappers.
