// popup/popup.js
'use strict';

(function () {
  // ─── DOM refs ──────────────────────────────────────────────────────────
  const statusPill   = document.getElementById('statusPill');
  const statusText   = document.getElementById('statusText');
  const alertCard    = document.getElementById('alertCard');
  const toggleCard   = document.getElementById('toggleCard');
  const tExt         = document.getElementById('toggleExtension');
  const tEnabled     = document.getElementById('toggleEnabled');
  const tBi          = document.getElementById('toggleBilingual');
  const tSite        = document.getElementById('toggleSite');
  const retryBtn     = document.getElementById('retryBtn');
  const settingsBtn  = document.getElementById('openSettings');
  const siteLabel    = document.getElementById('siteLabel');

  // ─── Helpers ───────────────────────────────────────────────────────────
  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(resp);
        });
      } catch (e) { resolve(null); }
    });
  }

  function sendToTab(msg) {
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs[0]) return resolve(null);
        chrome.tabs.sendMessage(tabs[0].id, msg, resp => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(resp);
        });
      });
    });
  }

  // Broadcast to every open tab. Used for the master switch so a single OFF
  // click stops translation everywhere, not just the active tab. Tabs that
  // don't have our content script (chrome://, the web store) just error out
  // silently — we swallow chrome.runtime.lastError so the console stays clean.
  function broadcastToAllTabs(msg) {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        try {
          chrome.tabs.sendMessage(tab.id, msg, () => {
            void chrome.runtime.lastError;
          });
        } catch (_) {}
      });
    });
  }

  function getCurrentHostname() {
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs[0] || !tabs[0].url) return resolve('');
        try { resolve(new URL(tabs[0].url).hostname); }
        catch { resolve(''); }
      });
    });
  }

  function renderStatus(online) {
    statusPill.classList.toggle('offline', !online);
    statusText.textContent = online ? '已连接' : '未连接';
    alertCard.hidden  = online;
    toggleCard.hidden = !online;
  }

  function renderToggle(btn, on) {
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function applyMasterLock(masterOn) {
    toggleCard.classList.toggle('master-off', !masterOn);
  }

  // ─── Init ──────────────────────────────────────────────────────────────
  async function init() {
    const status = await sendMessage({ type: 'CHECK_STATUS' });
    const online = !!(status && status.online);
    renderStatus(online);

    // If the desktop is up now, wake any content scripts that didn't boot
    // earlier (e.g. user opened the page before launching the desktop app).
    // This is a best-effort poke — tabs that are already booted just no-op.
    if (online) {
      broadcastToAllTabs({ type: 'WAKE_UP' });
    }

    const hostname = await getCurrentHostname();
    if (siteLabel && hostname) {
      siteLabel.textContent = '仅对 ' + hostname + ' 生效 · 会被记住';
    }

    const prefs = await new Promise(resolve =>
      chrome.storage.local.get(
        ['extensionEnabled', 'bilingualEnabled'],
        resolve
      )
    );
    const extensionOn = prefs.extensionEnabled !== false;  // default ON
    renderToggle(tExt,   extensionOn);
    renderToggle(tBi,    prefs.bilingualEnabled ?? true);
    applyMasterLock(extensionOn);

    // Per-site toggle: undefined = default ON (translate by default).
    // Only false means "explicitly disabled here".
    let siteEnabled = true;
    if (hostname) {
      const sitePrefs = await new Promise(resolve =>
        chrome.storage.local.get(['site:' + hostname], resolve)
      );
      const siteVal = sitePrefs['site:' + hostname];
      siteEnabled = siteVal !== false;
      renderToggle(tSite, siteEnabled);
    }

    // 启用翻译 reflects the page's CURRENT state (one-shot, not persisted).
    // Ask the content script directly; if it isn't loaded (e.g. chrome://
    // pages, or popup opened before the page settles) fall back to the
    // persistent site preference so the toggle is at least sensible.
    const state = await sendToTab({ type: 'GET_STATE' });
    const currentEnabled = state ? !!state.enabled : siteEnabled;
    renderToggle(tEnabled, currentEnabled);
  }

  // ─── Wire toggles ──────────────────────────────────────────────────────
  // 扩展启用 — global kill switch. OFF = the extension is dormant on every
  // site, regardless of any per-site preference. Persistent. Broadcast to
  // every open tab so all of them stop/start at once, not just the active.
  tExt.addEventListener('click', async () => {
    const next = !tExt.classList.contains('on');
    renderToggle(tExt, next);
    applyMasterLock(next);
    await new Promise(r => chrome.storage.local.set({ extensionEnabled: next }, r));
    broadcastToAllTabs({ type: 'TOGGLE_EXTENSION', enabled: next });
  });

  // 启用翻译 — current page only. NOT persisted: closing the tab or reloading
  // resets it to whatever 翻译此网站 says. The user's intent is just "for now,
  // run/stop translation here".
  tEnabled.addEventListener('click', async () => {
    const next = !tEnabled.classList.contains('on');
    renderToggle(tEnabled, next);
    sendToTab({ type: 'TOGGLE_ENABLED', enabled: next });
  });

  tBi.addEventListener('click', async () => {
    const next = !tBi.classList.contains('on');
    renderToggle(tBi, next);
    await new Promise(r => chrome.storage.local.set({ bilingualEnabled: next }, r));
    sendToTab({ type: 'TOGGLE_BILINGUAL', enabled: next });
  });

  // 翻译此网站 — persistent per-host preference. Flipping it cascades into
  // current-page state (启用翻译 visually + content script's bilingualActive)
  // so "remember + apply now" is one click. The user's intuition is that
  // turning ON 翻译此网站 should immediately start translating, and turning
  // OFF should immediately stop.
  tSite.addEventListener('click', async () => {
    const next = !tSite.classList.contains('on');
    renderToggle(tSite, next);
    renderToggle(tEnabled, next);
    const hostname = await getCurrentHostname();
    if (!hostname) return;
    await new Promise(r => chrome.storage.local.set({ ['site:' + hostname]: next }, r));
    sendToTab({ type: 'TOGGLE_SITE', enabled: next });
  });

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      sendToTab({ type: 'RETRY_ALL' });
      // Brief visual feedback
      retryBtn.textContent = '重试中…';
      setTimeout(() => { retryBtn.textContent = '重试翻译'; }, 1500);
    });
  }

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  init();
})();
