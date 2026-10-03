# Antigravity PHP Extension - Claude Guidelines & Context

> Refer to [AGENTS.md](file:///d:/www/antigravity-php-extension/AGENTS.md) for detailed architectural specifications.

## Essential Commands
- Run Tests: `npm test` (or `node test-suite.js`)
- Install & Apply: `powershell -ExecutionPolicy Bypass -File .\install.ps1`
- Install with Restart: `.\install.ps1 -Restart`
- Rollback / Restore: `.\uninstall.ps1`
- Live Status Check: `node .\inject-live.js --status`

## Key Architecture & Guardrails
- **Target Application**: Antigravity 2.0 (`%LOCALAPPDATA%\Programs\antigravity`).
- **Sandbox Compliance**: Renderer is sandboxed (`contextIsolation: true`); grammar is fetched synchronously via IPC `antigravity:get-php-script`.
- **Preserve Unpacked Binaries**: ASAR repacking must keep `--unpack-dir "node_modules/chrome-devtools-mcp"`.
- **Pre-bundled Dependencies**: Keep `node_modules/@electron/asar` intact for offline deployment.
- **Idempotency Guard**: Gated on `window.__antigravity_php_syntax_installed`.
