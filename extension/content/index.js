// content/index.js
// Boots bilingual.js and routes popup toggle messages.
//
// Pref semantics:
//   extensionEnabled (bool, default true)
//     Global kill switch (扩展启用 in popup). false = the extension is
//     dormant on every site, regardless of every other pref. Beats site:<host>
//     and 启用翻译.
//   site:<hostname> (bool, default true)
//     Persistent per-host preference. ON or undefined = "translate this site
//     by default on every visit"; false = "don't auto-translate". The popup's
//     默认翻译此网站 toggle controls this.
//   bilingualEnabled (bool, default true)
//     Display mode when translation runs.
//       true  → 双语对照 (source + translation both visible)
//       false → 仅显示译文 (replace mode — source hidden via CSS)
//
// Note: 启用翻译 (the popup's per-page toggle) is intentionally NOT persisted —
// it represents "is this page actively translating right now". Initialised
// from extensionEnabled + site:<host> on load, then user-controlled in-session
// via GET_STATE / TOGGLE_ENABLED messages. Closing the tab or reloading drops it.

'use strict';

(function () {
  // First thing on every load: nuke any leftover translation DOM from a
  // previous content script run. This matters in two cases —
  //   1. The extension was reloaded mid-session, the old content script's
  //      runtime is dead but its injected <span class="tt-bilingual-line">
  //      etc. are still sitting in the page. Without this cleanup the user
  //      sees stale translations even after master OFF.
  //   2. Defensive — if anything ever leaves orphaned spinners/fail marks.
  // On a fresh page load there's nothing to clean and destroy() is a no-op.
  try { window.ttBilingual?.destroy?.(); } catch (_) {}

  let bilingualActive = false;

  function getSiteKey() {
    return 'site:' + location.hostname;
  }

  function modeFromBool(boolish) {
    return boolish === false ? 'replace' : 'bilingual';
  }

  function bootBilingual(displayMode) {
    if (!bilingualActive) {
      window.ttBilingual.init();
      bilingualActive = true;
    }
    window.ttBilingual.setDisplayMode?.(displayMode);
  }

  function shutdownBilingual() {
    if (bilingualActive) {
      window.ttBilingual.destroy();
      bilingualActive = false;
    }
  }

  function bootFromStoredMode() {
    chrome.storage.local.get({ bilingualEnabled: true }, prefs => {
      bootBilingual(modeFromBool(prefs.bilingualEnabled));
    });
  }

  // ─── Init from saved prefs ──────────────────────────────────────────
  // Order of veto: extensionEnabled (global kill) → desktop online status
  // → site:<host> (per-host). If any blocks, do nothing — the page should
  // look exactly like the extension wasn't installed.
  //
  // Wrapped in a function so the WAKE_UP message (sent by the popup when it
  // detects the desktop coming online) can re-run the same gate sequence
  // and boot without requiring a page reload.
  function tryBoot() {
    chrome.storage.local.get(
      { extensionEnabled: true, bilingualEnabled: true },
      prefs => {
        if (prefs.extensionEnabled === false) return;
        // Check desktop server is up before booting — otherwise the
        // bilingual queue would just rack up "[翻译失败]" marks while the
        // user has no idea what's wrong.
        chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, status => {
          if (chrome.runtime.lastError || !status?.online) return;
          chrome.storage.local.get([getSiteKey()], sitePrefs => {
            const siteVal = sitePrefs[getSiteKey()];
            if (siteVal !== false && !bilingualActive) {
              bootBilingual(modeFromBool(prefs.bilingualEnabled));
            }
          });
        });
      }
    );
  }
  tryBoot();

  // ─── Toggle messages from popup ────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_STATE') {
      // Popup uses this to render the 启用翻译 toggle to match what's
      // actually happening on the page right now.
      sendResponse({ enabled: bilingualActive });
      return;
    }

    if (msg.type === 'WAKE_UP') {
      // Popup detected the desktop server came online — give boot another
      // shot. tryBoot() is idempotent (checks bilingualActive and re-pings
      // CHECK_STATUS) so calling it on tabs that are already running is
      // harmless.
      tryBoot();
      return;
    }

    if (msg.type === 'TOGGLE_EXTENSION') {
      // Global kill switch. OFF: stop unconditionally. ON: re-evaluate
      // site:<host> just like a fresh init — if site is explicitly OFF
      // we still don't boot.
      if (msg.enabled === false) {
        shutdownBilingual();
      } else {
        chrome.storage.local.get([getSiteKey()], sitePrefs => {
          if (sitePrefs[getSiteKey()] === false) return;
          bootFromStoredMode();
        });
      }
      return;
    }

    if (msg.type === 'TOGGLE_ENABLED') {
      // 启用翻译 — current-page only, no storage write. The popup's job
      // is to send the user's intent; we just honour it directly.
      if (msg.enabled === false) {
        shutdownBilingual();
      } else {
        bootFromStoredMode();
      }
      return;
    }

    if (msg.type === 'TOGGLE_BILINGUAL') {
      // Display mode only — doesn't enable/disable.
      const mode = modeFromBool(msg.enabled);
      if (bilingualActive) {
        window.ttBilingual.setDisplayMode?.(mode);
      }
    }

    if (msg.type === 'TOGGLE_SITE') {
      // 翻译此网站 cascades into 启用翻译: flipping the persistent
      // preference also brings current-page state into line, so the user
      // sees "remember + apply now" without two clicks.
      if (msg.enabled === false) {
        shutdownBilingual();
      } else {
        bootFromStoredMode();
      }
    }

    if (msg.type === 'RETRY_ALL') {
      if (bilingualActive && window.ttBilingual.retryAll) {
        window.ttBilingual.retryAll();
      }
    }
  });
})();
