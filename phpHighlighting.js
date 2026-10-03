/**
 * Antigravity PHP Syntax Highlighting Extension
 * 
 * Provides complete PrismJS syntax highlighting grammar for PHP,
 * including markup-templating dependency, PHP 8.x language features,
 * superglobals, scope resolution, and common PHP file aliases.
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__antigravity_php_syntax_installed && window.Prism && window.Prism.languages && window.Prism.languages.php) {
    return;
  }

  function highlightExistingPhpBlocks() {
    try {
      if (!window.Prism) return;
      if (typeof window.Prism.highlightAll === 'function') {
        window.Prism.highlightAll();
        return;
      }
      if (typeof window.Prism.highlightElement === 'function') {
        var blocks = document.querySelectorAll('code.language-php, code[class*="language-php"], pre code');
        for (var b = 0; b < blocks.length; b++) {
          var block = blocks[b];
          var className = block.className || '';
          if (className.indexOf('php') !== -1 || (block.parentElement && (block.parentElement.className || '').indexOf('php') !== -1)) {
            window.Prism.highlightElement(block);
          }
        }
      }
    } catch (e) {
      // Non-critical: ignore DOM highlighting errors
    }
  }

  function installPhpGrammar(Prism) {
    if (!Prism || !Prism.languages) return false;
    if (Prism.languages.php && window.__antigravity_php_syntax_installed) {
      highlightExistingPhpBlocks();
      return true;
    }

    try {
      // 1. Install markup-templating if missing
      if (!Prism.languages['markup-templating']) {
        (function (Prism) {
          function getPlaceholder(language, index) {
            return '___' + language.toUpperCase() + index + '___';
          }
          Object.defineProperties((Prism.languages['markup-templating'] = {}), {
            buildPlaceholders: {
              value: function (env, language, placeholderPattern) {
                if (env.language !== language) return;
                var tokenStack = (env.tokenStack = []);
                env.code = env.code.replace(placeholderPattern, function (match) {
                  var i = tokenStack.length;
                  while (env.code.indexOf(getPlaceholder(language, i)) !== -1) ++i;
                  tokenStack[i] = match;
                  return getPlaceholder(language, i);
                });
                env.grammar = Prism.languages.markup;
              },
            },
            tokenizePlaceholders: {
              value: function (env, language) {
                if (env.language !== language || !env.tokenStack) return;
                env.grammar = Prism.languages[language];
                var j = 0;
                var keys = Object.keys(env.tokenStack);
                function walkTokens(tokens) {
                  for (var i = 0; i < tokens.length; i++) {
                    if (j >= keys.length) break;
                    var token = tokens[i];
                    if (
                      typeof token === 'string' ||
                      (token.content && typeof token.content === 'string')
                    ) {
                      var k = keys[j];
                      var t = env.tokenStack[k];
                      var s = typeof token === 'string' ? token : token.content;
                      var placeholder = getPlaceholder(language, k);
                      var index = s.indexOf(placeholder);
                      if (index > -1) {
                        ++j;
                        var before = s.substring(0, index);
                        var middle = new Prism.Token(
                          language,
                          Prism.tokenize(t, env.grammar),
                          'language-' + language,
                          t
                        );
                        var after = s.substring(index + placeholder.length);
                        var newTokens = [];
                        if (before) newTokens.push(before);
                        newTokens.push(middle);
                        if (after) {
                          var walk = walkTokens([after]);
                          newTokens.push.apply(newTokens, walk);
                        }
                        if (typeof token === 'string') {
                          tokens.splice.apply(tokens, [i, 1].concat(newTokens));
                          i += newTokens.length - 1;
                        } else {
                          token.content = newTokens;
                        }
                      }
                    } else if (token.content && typeof token.content !== 'string') {
                      walkTokens(token.content);
                    }
                  }
                  return tokens;
                }
                walkTokens(env.tokens);
              },
            },
          });
        })(Prism);
      }

      // 2. Install PHP language definition
      (function (Prism) {
        var comment = /\/\*[\s\S]*?\*\/|\/\/.*|#(?!\[).*/;
        var constant = [
          { pattern: /\b[A-Z_][A-Z0-9_]*\b(?!\s*\()/, alias: 'constant' },
          { pattern: /\b(?:false|true)\b/i, alias: 'boolean' },
        ];
        var number =
          /\b0b[01]+(?:_[01]+)*\b|\b0o[0-7]+(?:_[0-7]+)*\b|\b0x[\da-f]+(?:_[\da-f]+)*\b|(?:\b\d+(?:_\d+)*\.?|\B\.\d+)(?:[e_]\d+)*(?![\w.])/i;
        var operator =
          /<?=>|\?\?=?|\.{3}|\??->|[!=]=?=?|::|\*\*=?|--|\+\+|&&|\|\||<<|>>|[?~]|[/^|%*&<>.+-]=?/;
        var punctuation = /[{}\[\](),.:;]/;

        Prism.languages.php = {
          delimiter: {
            pattern: /\?>|<\?(?:php(?=[\s\r\n])|=)?/i,
            alias: 'important',
          },
          comment: comment,
          this: {
            pattern: /\$this\b/,
            alias: 'keyword',
          },
          global:
            /\$(?:GLOBALS|HTTP_RAW_POST_DATA|_(?:COOKIE|ENV|FILES|GET|POST|REQUEST|SERVER|SESSION)|argc|argv|http_response_header|php_errormsg)\b/,
          scope: {
            pattern: /\b[\w\\]+::/,
            inside: {
              keyword: /static|self|parent/,
              punctuation: /::|\\/,
            },
          },
          variable: /\$+(?:\w+\b|(?=\{))/,
          package: {
            pattern:
              /(namespace\s+|use\s+(?:function\s+)?)(?:\\?\b[a-z_]\w*)+\b(?!\\)/i,
            lookbehind: true,
            inside: { punctuation: /\\/ },
          },
          'class-name-definition': {
            pattern:
              /(\b(?:class|enum|interface|trait)\s+)\b[a-z_]\w*(?!\\)\b/i,
            lookbehind: true,
            alias: 'class-name',
          },
          'function-definition': {
            pattern: /(\bfunction\s+)[a-z_]\w*(?=\s*\()/i,
            lookbehind: true,
            alias: 'function',
          },
          keyword: [
            {
              pattern:
                /(\(\s*)\b(?:array|bool|boolean|float|int|integer|object|string)\b(?=\s*\))/i,
              alias: 'type-casting',
              lookbehind: true,
            },
            {
              pattern:
                /([(,?]\s*)\b(?:array(?!\s*\()|bool|callable|(?:false|null)(?=\s*\|)|float|int|iterable|mixed|never|object|self|static|string|true|void)\b(?=\s*[$])/i,
              alias: 'type-hint',
              lookbehind: true,
            },
            {
              pattern:
                /(\)\s*:\s*(?:\?\s*)?)\b(?:array(?!\s*\()|bool|callable|(?:false|null)(?=\s*\|)|float|int|iterable|mixed|never|object|self|static|string|true|void)\b/i,
              alias: 'return-type',
              lookbehind: true,
            },
            {
              pattern:
                /\b(?:array(?!\s*\()|bool|float|int|iterable|mixed|never|object|string|void)\b/i,
              alias: 'type-declaration',
            },
            {
              pattern: /\b[a-z_]\w*(?=\s*(?:\\|\s*\$))/i,
              alias: 'type-declaration',
            },
            {
              pattern:
                /\b(?:__halt_compiler|abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|die|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|enum|eval|exit|extends|final|finally|fn|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|match|namespace|never|new|or|parent|print|private|protected|public|readonly|require|require_once|return|self|static|switch|throw|trait|try|unset|use|var|while|xor|yield)\b/i,
            },
          ],
          'argument-name': {
            pattern: /([(,]\s+)\b[a-z_]\w*(?=\s*:(?!:))/i,
            lookbehind: true,
          },
          'class-name': [
            {
              pattern:
                /(\b(?:extends|implements|instanceof|new(?!\s+class\b)|use)\s+|\bcatch\s*\()\b[a-z_]\w*(?!\\)\b/i,
              lookbehind: true,
              inside: { punctuation: /\\/ },
            },
            {
              pattern: /(\|\s*)\b[a-z_]\w*(?!\\)\b/i,
              lookbehind: true,
              inside: { punctuation: /\\/ },
            },
            {
              pattern: /\b[a-z_]\w*(?!\\)\b(?=\s*\|)/i,
              inside: { punctuation: /\\/ },
            },
            {
              pattern: /(\()\b[a-z_]\w*(?!\\)\b(?=\s+[$])/i,
              lookbehind: true,
              inside: { punctuation: /\\/ },
            },
            {
              pattern:
                /(\)\s*:\s*(?:\?\s*)?)\b[a-z_]\w*(?!\\)\b/i,
              lookbehind: true,
              inside: { punctuation: /\\/ },
            },
            {
              pattern: /\b[a-z_]\w*(?!\\)\b(?=\s*::)/i,
              inside: { punctuation: /\\/ },
            },
          ],
          constant: constant,
          function: {
            pattern: /(^|[^\\\w])\\?[a-z_](?:[\w\\]*\w)?(?=\s*\()/i,
            lookbehind: true,
            inside: { punctuation: /\\/ },
          },
          property: {
            pattern: /(->\s*)\$?[a-z_]\w*/i,
            lookbehind: true,
          },
          number: number,
          operator: operator,
          punctuation: punctuation,
          string: {
            pattern:
              /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,
            greedy: true,
          },
        };

        // 3. Install PHP Extras (this, superglobals, scope)
        var extras = {
          this: {
            pattern: /\$this\b/,
            alias: 'keyword',
          },
          global:
            /\$(?:GLOBALS|HTTP_RAW_POST_DATA|_(?:COOKIE|ENV|FILES|GET|POST|REQUEST|SERVER|SESSION)|argc|argv|http_response_header|php_errormsg)\b/,
          scope: {
            pattern: /\b[\w\\]+::/,
            inside: {
              keyword: /static|self|parent/,
              punctuation: /::|\\/,
            },
          },
        };

        var insertBeforeFn = (Prism.languages && typeof Prism.languages.insertBefore === 'function')
          ? Prism.languages.insertBefore
          : (typeof Prism.insertBefore === 'function' ? Prism.insertBefore : null);

        var inserted = false;
        if (insertBeforeFn) {
          try {
            insertBeforeFn.call(Prism.languages, 'php', 'variable', extras, Prism.languages.php);
            inserted = true;
          } catch (e) {}
        }
        if (!inserted) {
          Object.assign(Prism.languages.php, extras);
        }

        // 4. Register language aliases
        var aliases = ['phtml', 'php3', 'php4', 'php5', 'php6', 'php7', 'php8', 'phps'];
        for (var i = 0; i < aliases.length; i++) {
          Prism.languages[aliases[i]] = Prism.languages.php;
        }

        // 5. Register markup-templating hooks for PHP and aliases
        if (Prism.hooks && typeof Prism.hooks.add === 'function') {
          var beforeHooks = (Prism.hooks.all && Prism.hooks.all['before-tokenize']) || [];
          var alreadyHasBefore = false;
          for (var h = 0; h < beforeHooks.length; h++) {
            if (beforeHooks[h].__antigravity_php) {
              alreadyHasBefore = true;
              break;
            }
          }

          if (!alreadyHasBefore) {
            var phpPattern = /<\?(?:[^"'/#]|\/(?![*/])|("|')(?:\\[\s\S]|(?!\1)[^\\])*\1|(?:\/\/|#(?!\[))(?:[^\n\r]|\r(?!\n))*(?:\r?\n|$)|\/\*(?:[^*]|\*(?!\/))*(?:\*\/|$))*?(?:\?>|$)/gi;

            var beforeHook = function (env) {
              if (!env || !env.code) return;
              if (env.language !== 'php' && aliases.indexOf(env.language) === -1) return;
              if (!/<\?/.test(env.code)) return;
              if (Prism.languages['markup-templating']) {
                Prism.languages['markup-templating'].buildPlaceholders(env, 'php', phpPattern);
              }
            };
            beforeHook.__antigravity_php = true;
            Prism.hooks.add('before-tokenize', beforeHook);

            var afterHook = function (env) {
              if (!env) return;
              if (env.language !== 'php' && aliases.indexOf(env.language) === -1) return;
              if (Prism.languages['markup-templating']) {
                Prism.languages['markup-templating'].tokenizePlaceholders(env, 'php');
              }
            };
            afterHook.__antigravity_php = true;
            Prism.hooks.add('after-tokenize', afterHook);
          }
        }

        window.__antigravity_php_syntax_installed = true;
        console.log('[Antigravity] PHP syntax highlighting installed successfully.');
        highlightExistingPhpBlocks();
        return true;
      })(Prism);

      return true;
    } catch (err) {
      console.error('[Antigravity] Failed to register PHP grammar:', err);
      return false;
    }
  }

  // If window.Prism is already loaded, install immediately
  if (window.Prism && window.Prism.languages) {
    installPhpGrammar(window.Prism);
  }

  // Intercept Prism initialization via setter
  var _currentPrism = window.Prism;
  try {
    Object.defineProperty(window, 'Prism', {
      configurable: true,
      enumerable: true,
      get: function () {
        return _currentPrism;
      },
      set: function (val) {
        _currentPrism = val;
        if (val) {
          queueMicrotask(function () {
            installPhpGrammar(val);
          });
        }
      },
    });
  } catch (e) {}

  // Safety net handlers
  window.addEventListener('DOMContentLoaded', function () {
    if (window.Prism) installPhpGrammar(window.Prism);
  });
  window.addEventListener('load', function () {
    if (window.Prism) installPhpGrammar(window.Prism);
  });

  var pollCount = 0;
  var pollId = setInterval(function () {
    pollCount++;
    if (window.Prism && window.Prism.languages) {
      if (installPhpGrammar(window.Prism)) {
        clearInterval(pollId);
      }
    }
    if (pollCount > 100) clearInterval(pollId);
  }, 50);
})();
