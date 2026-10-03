/**
 * Antigravity Live Session Injector
 * 
 * Injects phpHighlighting.js into currently running Antigravity Electron windows
 * using Chrome DevTools Protocol (CDP) via the dynamic DevToolsActivePort.
 * Works across all Node.js versions (including Node 18/20/22/24) with zero external packages.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

class SimpleWebSocketClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.socket = null;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.buffer = Buffer.alloc(0);
    this._connect();
  }

  _connect() {
    try {
      const parsed = new url.URL(this.wsUrl);
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        }
      });

      req.on('upgrade', (res, socket, head) => {
        this.socket = socket;
        if (head && head.length) {
          this.buffer = Buffer.concat([this.buffer, head]);
        }
        this.socket.on('data', (chunk) => this._onData(chunk));
        this.socket.on('close', () => { if (this.onclose) this.onclose(); });
        this.socket.on('error', (err) => { if (this.onerror) this.onerror(err); });
        if (this.onopen) this.onopen();
      });

      req.on('error', (err) => {
        if (this.onerror) this.onerror(err);
      });

      req.end();
    } catch (err) {
      if (this.onerror) this.onerror(err);
    }
  }

  send(data) {
    if (!this.socket || !this.socket.writable) return;
    const payload = Buffer.from(data, 'utf8');
    const len = payload.length;
    let header;
    const maskKey = crypto.randomBytes(4);

    if (len < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = 0x80 | len;
      maskKey.copy(header, 2);
    } else if (len < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
      maskKey.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
      maskKey.copy(header, 10);
    }

    const maskedPayload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      maskedPayload[i] = payload[i] ^ maskKey[i % 4];
    }

    this.socket.write(Buffer.concat([header, maskedPayload]));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let mask = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + len) return;

      let payload = this.buffer.slice(offset, offset + len);
      if (masked && mask) {
        const unmasked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      this.buffer = this.buffer.slice(offset + len);

      const opcode = b0 & 0x0f;
      if (opcode === 1) {
        if (this.onmessage) {
          this.onmessage({ data: payload.toString('utf8') });
        }
      } else if (opcode === 8) {
        this.close();
      }
    }
  }

  close() {
    if (this.socket) {
      try { this.socket.end(); } catch (e) {}
      this.socket = null;
    }
  }
}

function createWebSocket(url) {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return new globalThis.WebSocket(url);
  }
  return new SimpleWebSocketClient(url);
}

function getDevToolsPort() {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    return parseInt(process.argv[portArgIdx + 1], 10);
  }

  const appData = process.env.APPDATA || '';
  const portFile = path.join(appData, 'Antigravity', 'DevToolsActivePort');
  if (fs.existsSync(portFile)) {
    try {
      const content = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      const port = parseInt(content[0], 10);
      if (port > 0 && port < 65536) return port;
    } catch (e) {}
  }

  return null;
}

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    http.get(urlStr, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse JSON response: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

function evaluateInTarget(wsUrl, scriptToRun) {
  return new Promise((resolve, reject) => {
    const ws = createWebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      reject(new Error('WebSocket connection timed out (5s)'));
    }, 5000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: scriptToRun,
          returnByValue: true
        }
      }));
    };

    ws.onmessage = (event) => {
      clearTimeout(timeout);
      try {
        const resp = JSON.parse(event.data);
        // Step 2: verify PHP grammar
        ws.send(JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            expression: `({
              installed: typeof window !== 'undefined' && typeof window.Prism !== 'undefined' && !!(window.Prism.languages && window.Prism.languages.php),
              highlightSample: typeof window !== 'undefined' && typeof window.Prism !== 'undefined' && !!(window.Prism.languages && window.Prism.languages.php)
                ? window.Prism.highlight('<?php echo "ok";', window.Prism.languages.php, 'php')
                : null
            })`,
            returnByValue: true
          }
        }));

        ws.onmessage = (verEvent) => {
          try {
            const verResp = JSON.parse(verEvent.data);
            ws.close();
            resolve({
              evalResult: resp,
              verification: verResp.result && verResp.result.result ? verResp.result.result.value : null
            });
          } catch (e) {
            ws.close();
            resolve({ evalResult: resp, verification: null });
          }
        };
      } catch (err) {
        ws.close();
        reject(err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });
}

async function main() {
  const port = getDevToolsPort();
  if (!port) {
    console.log('[Live Injector] No active Antigravity DevTools port found. (Antigravity might not be running).');
    process.exit(2);
  }

  const grammarPath = path.join(__dirname, 'phpHighlighting.js');
  if (!fs.existsSync(grammarPath)) {
    console.error(`[Live Injector] Error: Grammar script not found at ${grammarPath}`);
    process.exit(1);
  }
  const grammarCode = fs.readFileSync(grammarPath, 'utf8');

  let targets;
  try {
    targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  } catch (err) {
    console.log(`[Live Injector] Could not connect to DevTools at 127.0.0.1:${port} (${err.message}).`);
    process.exit(2);
  }

  const pageTargets = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://'));
  if (pageTargets.length === 0) {
    console.log('[Live Injector] No open window targets found to inject.');
    process.exit(0);
  }

  console.log(`[Live Injector] Found ${pageTargets.length} active window(s). Injecting PHP syntax highlighting...`);

  let injectedCount = 0;
  for (const target of pageTargets) {
    try {
      const title = target.title || 'Untitled Window';
      const result = await evaluateInTarget(target.webSocketDebuggerUrl, grammarCode);
      const isVerified = result.verification && result.verification.installed;
      if (isVerified) {
        console.log(`  [+] Successfully activated in "${title}"`);
        injectedCount++;
      } else {
        console.log(`  [*] Injected into "${title}", awaiting Prism initialization.`);
      }
    } catch (err) {
      console.warn(`  [!] Failed to inject into window: ${err.message}`);
    }
  }

  if (injectedCount > 0) {
    console.log(`[Live Injector] Done! Activated in ${injectedCount} window(s).`);
    process.exit(0);
  } else {
    console.log('[Live Injector] Injection finished with warnings.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[Live Injector] Unexpected error:', err);
  process.exit(1);
});
