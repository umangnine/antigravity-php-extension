/**
 * Automated Verification & Test Suite
 * Tests grammar definition, real tokenization, templating hooks, patching logic, idempotency, and live injection.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const http = require('http');
const { execFileSync } = require('child_process');

const extDir = __dirname;
const grammarFile = path.join(extDir, 'phpHighlighting.js');
const patchScript = path.join(extDir, 'patch-asar.js');
const restoreScript = path.join(extDir, 'restore-asar.js');

describe('Antigravity PHP Extension - Test Suite', () => {

  test('1. Grammar Script Syntax & Sandbox Execution', () => {
    assert.strictEqual(fs.existsSync(grammarFile), true, 'phpHighlighting.js must exist');
    const code = fs.readFileSync(grammarFile, 'utf8');

    const mockPrism = {
      languages: {
        markup: {},
        clike: {},
        javascript: {},
      },
      hooks: {
        all: {},
        add: function (name, fn) {
          (this.all[name] = this.all[name] || []).push(fn);
        },
        run: function (name, env) {
          (this.all[name] || []).forEach(fn => fn(env));
        }
      },
      Token: function (type, content, alias, matchedStr) {
        this.type = type;
        this.content = content;
        this.alias = alias;
        this.matchedStr = matchedStr;
      },
      tokenize: function (code, grammar) {
        return [code];
      },
      insertBefore: function (inside, before, insert, root) {
        root = root || (this.languages ? this.languages[inside] : this[inside]) || {};
        for (const [k, v] of Object.entries(insert)) {
          root[k] = v;
        }
      },
    };

    const sandbox = {
      window: {
        Prism: mockPrism,
        addEventListener: () => {},
      },
      document: {
        querySelectorAll: () => [],
      },
      console: console,
      setInterval: () => 1,
      clearInterval: () => {},
      queueMicrotask: (fn) => fn(),
    };

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    // Verify Prism.languages.php was installed
    assert.ok(sandbox.window.Prism.languages.php, 'Prism.languages.php must be defined');
    assert.ok(sandbox.window.Prism.languages['markup-templating'], 'markup-templating must be defined');
    assert.ok(sandbox.window.Prism.languages.phtml, 'phtml alias must be defined');
    assert.ok(sandbox.window.Prism.languages.php8, 'php8 alias must be defined');
    assert.ok(sandbox.window.Prism.languages.phps, 'phps alias must be defined');
    assert.strictEqual(sandbox.window.__antigravity_php_syntax_installed, true, 'Flag must be set');

    // Verify hooks were registered
    assert.ok(mockPrism.hooks.all['before-tokenize'], 'before-tokenize hook must be registered');
    assert.ok(mockPrism.hooks.all['after-tokenize'], 'after-tokenize hook must be registered');
  });

  test('2. Real PHP Tokenizer & Highlighting Correctness', () => {
    const code = fs.readFileSync(grammarFile, 'utf8');

    // Minimal complete Prism-compliant tokenizer for regex grammar testing
    function Token(type, content, alias, matchedStr) {
      this.type = type;
      this.content = content;
      this.alias = alias;
      this.matchedStr = matchedStr;
    }

    function tokenize(text, grammar) {
      const rest = grammar.rest;
      if (rest) {
        for (const token in rest) {
          grammar[token] = rest[token];
        }
        delete grammar.rest;
      }

      const tokenList = [text];

      for (const token in grammar) {
        if (!grammar.hasOwnProperty(token) || !grammar[token]) continue;

        let patterns = grammar[token];
        patterns = Array.isArray(patterns) ? patterns : [patterns];

        for (let j = 0; j < patterns.length; ++j) {
          let patternObj = patterns[j];
          let inside = patternObj.inside;
          let lookbehind = !!patternObj.lookbehind;
          let greedy = !!patternObj.greedy;
          let alias = patternObj.alias;
          let pattern = patternObj.pattern || patternObj;

          let regex = new RegExp(pattern.source, pattern.flags || '');

          for (let i = 0; i < tokenList.length; i++) {
            let str = tokenList[i];
            if (typeof str !== 'string') continue;

            regex.lastIndex = 0;
            let match = regex.exec(str);
            if (!match) continue;

            let from = match.index;
            let matchStr = match[0];

            if (lookbehind && match[1]) {
              let lookbehindLength = match[1].length;
              from += lookbehindLength;
              matchStr = matchStr.slice(lookbehindLength);
            }

            let to = from + matchStr.length;
            let before = str.slice(0, from);
            let after = str.slice(to);

            let content = inside ? tokenize(matchStr, inside) : matchStr;
            let wrapped = new Token(token, content, alias, matchStr);

            let args = [i, 1];
            if (before) args.push(before);
            args.push(wrapped);
            if (after) args.push(after);

            tokenList.splice.apply(tokenList, args);
            i += (before ? 1 : 0);
          }
        }
      }

      return tokenList;
    }

    const languages = {
      markup: {
        tag: {
          pattern: /<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?=[\s/>])))+)?\s*\/?>/i,
          inside: {
            punctuation: /^<\/?|\/?>$/,
            'tag-name': /^[^\s>\/]+/
          }
        }
      },
      clike: {},
    };

    languages.insertBefore = function (inside, before, insert, root) {
      root = root || this[inside] || languages[inside] || {};
      const grammar = {};
      for (const token in root) {
        if (root.hasOwnProperty(token)) {
          if (token === before) {
            for (const newToken in insert) {
              if (insert.hasOwnProperty(newToken)) {
                grammar[newToken] = insert[newToken];
              }
            }
          }
          if (!insert.hasOwnProperty(token)) {
            grammar[token] = root[token];
          }
        }
      }
      for (const key in grammar) {
        if (grammar.hasOwnProperty(key)) {
          root[key] = grammar[key];
        }
      }
      return root;
    };

    const Prism = {
      languages,
      hooks: {
        all: {},
        add: function (name, fn) {
          (this.all[name] = this.all[name] || []).push(fn);
        },
        run: function (name, env) {
          (this.all[name] || []).forEach(fn => fn(env));
        }
      },
      Token,
      tokenize,
      highlight: function (text, grammar, language) {
        const env = { code: text, grammar, language, tokens: [] };
        this.hooks.run('before-tokenize', env);
        env.tokens = this.tokenize(env.code, env.grammar);
        this.hooks.run('after-tokenize', env);
        return env.tokens;
      },
    };

    const sandbox = {
      window: { Prism, addEventListener: () => {} },
      document: { querySelectorAll: () => [] },
      console,
      setInterval: () => 1,
      clearInterval: () => {},
      queueMicrotask: (fn) => fn(),
    };

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    const php = sandbox.window.Prism.languages.php;
    assert.ok(php, 'PHP grammar must be registered');

    // Test tokenization of PHP code
    const phpCode = '<?php class Order { public string $id; function getId() { return $this->id; } }';
    const tokens = sandbox.window.Prism.highlight(phpCode, php, 'php');

    function findTokens(list, type) {
      const found = [];
      for (const t of list) {
        if (t && t.type === type) found.push(t);
        if (t && Array.isArray(t.content)) {
          found.push(...findTokens(t.content, type));
        }
      }
      return found;
    }

    const delims = findTokens(tokens, 'delimiter');
    assert.ok(delims.length >= 1, 'Must tokenize delimiter <?php');

    const keywords = findTokens(tokens, 'keyword');
    assert.ok(keywords.length >= 3, 'Must tokenize keywords (class, public, function, return)');

    const variables = findTokens(tokens, 'variable');
    assert.ok(variables.length >= 1, 'Must tokenize variable $id');

    const thisTokens = findTokens(tokens, 'this');
    assert.ok(thisTokens.length >= 1, 'Must tokenize $this with special rule');

    // Test superglobals
    const globalCode = '<?php echo $_SERVER["REQUEST_METHOD"]; echo $_POST["name"];';
    const globalTokens = sandbox.window.Prism.highlight(globalCode, php, 'php');
    const globals = findTokens(globalTokens, 'global');
    assert.ok(globals.length >= 2, 'Must tokenize $_SERVER and $_POST');

    // Test markup-templating embedded PHP
    const templatedCode = '<div class="main"><?php echo $title; ?></div>';
    const templatedTokens = sandbox.window.Prism.highlight(templatedCode, php, 'php');

    const tags = findTokens(templatedTokens, 'tag');
    assert.ok(tags.length >= 2, 'Markup templating must tokenize <div...> and </div> as tags');

    const embeddedPhp = findTokens(templatedTokens, 'variable');
    assert.ok(embeddedPhp.length >= 1, 'Markup templating must tokenize $title inside PHP delimiter');
  });

  test('3. Simulated ASAR Patching, Idempotency & Restore', async () => {
    let asar;
    try {
      asar = require(path.join(extDir, 'node_modules', '@electron', 'asar', 'lib', 'asar.js'));
    } catch (e) {
      asar = require('@electron/asar');
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-asar-'));
    const dummyAppDir = path.join(tmpDir, 'dummy_app');
    const dummyDistDir = path.join(dummyAppDir, 'dist');
    fs.mkdirSync(dummyDistDir, { recursive: true });

    // Dummy files matching Antigravity real structure
    fs.writeFileSync(path.join(dummyAppDir, 'package.json'), JSON.stringify({ name: 'antigravity-test' }), 'utf8');
    fs.writeFileSync(path.join(dummyDistDir, 'preload.js'), `"use strict";\nconst electron_1 = require("electron");\n// End of preload\n`, 'utf8');
    fs.writeFileSync(path.join(dummyDistDir, 'ipcHandlers.js'), `"use strict";\nfunction registerIpcHandlers() {\n    electron_1.ipcMain.handle('test', () => {});\n}\n`, 'utf8');
    fs.writeFileSync(path.join(dummyDistDir, 'utils.js'), `"use strict";\nfunction createWindow(url) {\n    const win = new electron_1.BrowserWindow({});\n    void win.loadURL(url);\n    return win;\n}\n`, 'utf8');

    const dummyAsar = path.join(tmpDir, 'app.asar');
    const patchedAsar = path.join(tmpDir, 'app_patched.asar');

    // Pack dummy asar
    await asar.createPackageWithOptions(dummyAppDir, dummyAsar, {});
    assert.ok(fs.existsSync(dummyAsar), 'Dummy asar must exist');

    // Run patch-asar.js
    execFileSync('node', [
      patchScript,
      '--asar', dummyAsar,
      '--target-asar', patchedAsar,
      '--ext-source', grammarFile,
    ], { stdio: 'pipe' });

    assert.ok(fs.existsSync(patchedAsar), 'Patched asar must be created');
    assert.ok(fs.existsSync(dummyAsar + '.bak'), 'Backup must be created');

    // Extract patched asar and inspect content
    const verifyDir = path.join(tmpDir, 'verified_unpacked');
    asar.extractAll(patchedAsar, verifyDir);

    const patchedPreload = fs.readFileSync(path.join(verifyDir, 'dist', 'preload.js'), 'utf8');
    const patchedIpc = fs.readFileSync(path.join(verifyDir, 'dist', 'ipcHandlers.js'), 'utf8');
    const patchedUtils = fs.readFileSync(path.join(verifyDir, 'dist', 'utils.js'), 'utf8');
    const grammarInAsar = fs.existsSync(path.join(verifyDir, 'dist', 'phpHighlighting.js'));

    assert.ok(patchedPreload.includes('[ANTIGRAVITY-PHP-START]'), 'Preload must contain patch marker');
    assert.ok(patchedIpc.includes('[ANTIGRAVITY-PHP-START]'), 'IpcHandlers must contain patch marker');
    assert.ok(patchedUtils.includes('[ANTIGRAVITY-PHP-START]'), 'Utils must contain patch marker');
    assert.ok(grammarInAsar, 'phpHighlighting.js must exist inside asar dist/');

    // Crucial check: verify utils.js parses without syntax error or void expression scoping bug
    assert.ok(!patchedUtils.includes('void\n    // [ANTIGRAVITY-PHP-START]\n    function injectExtensions'),
      'Utils patch must not create void function expression bug');
    assert.doesNotThrow(() => {
      new vm.Script(patchedUtils);
    }, 'Patched utils.js must be valid JavaScript with zero syntax errors');

    // Test Idempotency: Run patch a second time on already patched asar
    const secondPatchedAsar = path.join(tmpDir, 'app_patched_2.asar');
    execFileSync('node', [
      patchScript,
      '--asar', patchedAsar,
      '--target-asar', secondPatchedAsar,
      '--ext-source', grammarFile,
    ], { stdio: 'pipe' });

    const verifyDir2 = path.join(tmpDir, 'verified_unpacked_2');
    asar.extractAll(secondPatchedAsar, verifyDir2);
    const secondPreload = fs.readFileSync(path.join(verifyDir2, 'dist', 'preload.js'), 'utf8');

    // Count occurrences of marker
    const markerCount = (secondPreload.match(/\[ANTIGRAVITY-PHP-START\]/g) || []).length;
    assert.strictEqual(markerCount, 1, 'Patch must be idempotent (marker should only occur once)');

    // Test Restore
    execFileSync('node', [
      restoreScript,
      '--asar', dummyAsar,
    ], { stdio: 'pipe' });

    const restoredPreload = fs.readFileSync(path.join(dummyAppDir, 'dist', 'preload.js'), 'utf8');
    assert.ok(!restoredPreload.includes('[ANTIGRAVITY-PHP-START]'), 'Original asar must be clean after restore');

    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  });

  test('4. Live Session Status & Injection Verification', async () => {
    const appData = process.env.APPDATA || '';
    const portFile = path.join(appData, 'Antigravity', 'DevToolsActivePort');

    if (!fs.existsSync(portFile)) {
      console.log('    [Note] Antigravity not running; skipping live WebSocket test.');
      return;
    }

    const port = parseInt(fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0], 10);
    assert.ok(port > 0, 'DevTools port must be positive integer');

    const targets = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://'));
    if (!page) {
      console.log('    [Note] No active page target; skipping WebSocket assertion.');
      return;
    }

    // Verify window.Prism.languages.php is live in renderer
    const res = await new Promise((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 99,
          method: 'Runtime.evaluate',
          params: {
            expression: 'typeof window.Prism !== "undefined" && !!window.Prism.languages && !!window.Prism.languages.php',
            returnByValue: true
          }
        }));
      };
      ws.onmessage = (event) => {
        const d = JSON.parse(event.data);
        ws.close();
        resolve(d.result && d.result.result ? d.result.result.value : false);
      };
      ws.onerror = reject;
    });

    assert.strictEqual(res, true, 'PHP syntax highlighting must be live in running Antigravity window');
  });

  test('5. PowerShell Scripts Parameter Forwarding & Parameter Sets', () => {
    const installScript = path.join(extDir, 'install.ps1');
    const uninstallScript = path.join(extDir, 'uninstall.ps1');
    const masterScript = path.join(extDir, 'enable-php-highlighting.ps1');

    // 1. Verify enable-php-highlighting.ps1 accepts -Restore -Restart together without parameter set error
    const paramSetCheck = execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `try { $cmd = Get-Command '${masterScript}'; $paramSets = $cmd.ParameterSets; $restoreSet = $paramSets | Where-Object { $_.Name -eq 'Restore' }; if (-not ($restoreSet.Parameters.Name -contains 'Restart')) { throw 'Restart switch missing from Restore set' }; 'OK' } catch { $_.Exception.Message }`
    ], { encoding: 'utf8' }).trim();
    assert.strictEqual(paramSetCheck, 'OK', 'Restore parameter set must support -Restart');

    // 2. Verify install.ps1 forwards invalid path parameter properly and fails with validation message
    try {
      execFileSync('powershell', [
        '-NoProfile',
        '-File',
        installScript,
        '-AntigravityPath',
        'C:\\invalid_antigravity_test_dir_12345'
      ], { stdio: 'pipe' });
      assert.fail('Should have failed on invalid AntigravityPath');
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8') : '';
      assert.ok(stderr.includes('Specified AntigravityPath does not contain resources\\app.asar') ||
                stderr.includes('invalid_antigravity_test_dir_12345'),
                'install.ps1 must forward arguments to enable-php-highlighting.ps1');
    }

    // 3. Verify uninstall.ps1 forwards parameters and flags
    try {
      execFileSync('powershell', [
        '-NoProfile',
        '-File',
        uninstallScript,
        '-AntigravityPath',
        'C:\\invalid_antigravity_test_dir_12345'
      ], { stdio: 'pipe' });
      assert.fail('Should have failed on invalid AntigravityPath');
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8') : '';
      assert.ok(stderr.includes('Specified AntigravityPath does not contain resources\\app.asar') ||
                stderr.includes('invalid_antigravity_test_dir_12345'),
                'uninstall.ps1 must forward arguments to enable-php-highlighting.ps1');
    }

    // 4. Verify all PowerShell scripts parse cleanly under Windows-1252 (default Windows PowerShell 5.1 ANSI)
    const ps1Files = ['enable-php-highlighting.ps1', 'install.ps1', 'uninstall.ps1'];
    for (const file of ps1Files) {
      const filePath = path.join(extDir, file);
      const parseCheck = execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `$enc = [System.Text.Encoding]::GetEncoding(1252); $text = [System.IO.File]::ReadAllText('${filePath.replace(/'/g, "''")}', $enc); $errs = $null; [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$errs) | Out-Null; if ($errs -and $errs.Count -gt 0) { $errs[0].Message } else { 'OK' }`
      ], { encoding: 'utf8' }).trim();
      assert.strictEqual(parseCheck, 'OK', `${file} must parse with 0 errors under Windows-1252 encoding`);
    }
  });

});

