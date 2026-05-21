// options/options.js
'use strict';

(function () {
  const DEFAULTS = {
    port: 27463,
  };

  const $port = document.getElementById('port');
  const $test = document.getElementById('test-conn');
  const $cs   = document.getElementById('conn-status');
  const $save = document.getElementById('save-btn');
  const $ss   = document.getElementById('save-status');
  const $ssText = $ss.querySelector('.text');

  function clamp(n, lo, hi) { return Math.min(Math.max(n, lo), hi); }

  function setStatus(text, saved) {
    $ssText.textContent = text;
    $ss.classList.toggle('is-saved', !!saved);
  }

  function showConnStatus(text, kind) {
    $cs.textContent = text;
    $cs.classList.add('is-shown');
    $cs.classList.remove('is-ok', 'is-fail', 'is-pending');
    if (kind) $cs.classList.add('is-' + kind);
  }

  // ── Load ────────────────────────────────────────────────────────────────
  chrome.storage.local.get(Object.keys(DEFAULTS), (got) => {
    const v = { ...DEFAULTS, ...(got || {}) };
    $port.value  = v.port;
    setStatus('已保存', true);
  });

  // ── Track changes ───────────────────────────────────────────────────────
  ['input', 'change'].forEach(evt => {
    [$port].forEach(el =>
      el.addEventListener(evt, () => setStatus('未保存的更改', false))
    );
  });

  // ── Save ────────────────────────────────────────────────────────────────
  $save.addEventListener('click', () => {
    const port = clamp(parseInt($port.value, 10) || DEFAULTS.port, 1, 65535);
    $port.value = port;
    const payload = {
      port,
    };
    $save.disabled = true;
    chrome.storage.local.set(payload, () => {
      $save.disabled = false;
      setStatus('已保存', true);
    });
  });

  // ── Test connection ─────────────────────────────────────────────────────
  $test.addEventListener('click', async () => {
    const port = clamp(parseInt($port.value, 10) || DEFAULTS.port, 1, 65535);
    showConnStatus('测试中…', 'pending');
    $test.disabled = true;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch('http://127.0.0.1:' + port + '/status', {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        showConnStatus('连接成功 · ' + port, 'ok');
      } else {
        showConnStatus('HTTP ' + res.status, 'fail');
      }
    } catch (e) {
      showConnStatus('无法连接', 'fail');
    } finally {
      $test.disabled = false;
    }
  });
})();
