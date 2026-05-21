// content/bilingual.js
// Exports window.ttBilingual = { init, destroy, retryAll, setDisplayMode }
// Injects Chinese translation paragraphs below English paragraphs in-page.
// Improvements:
//   - Loading spinner shown per-paragraph while translation is pending
//   - Retry on failure (up to MAX_RETRIES times, with exponential backoff)
//   - Re-observe failed paragraphs so they get re-attempted automatically

'use strict';

(function () {
  // If the extension was reloaded mid-session and we're being re-injected on
  // top of an already-running content script, the old IIFE's observers and
  // batch queue are still alive in their original closure — but their
  // chrome.runtime is now invalidated, so every TRANSLATE message they
  // attempt fails, retries hit MAX_RETRIES, and the page fills up with
  // "[翻译失败]" badges. Calling the OLD ttBilingual.destroy() (the one
  // captured by `window.ttBilingual` BEFORE this IIFE overwrites it) tears
  // down those orphan observers cleanly. On a fresh page load there's no
  // previous instance and this is a no-op.
  try { window.ttBilingual?.destroy?.(); } catch (_) {}

  const BILINGUAL_CLASS  = 'tt-bilingual-line';
  const FAIL_CLASS       = 'tt-bilingual-fail';
  const SPINNER_CLASS    = 'tt-spinner-wrap';
  const SOURCE_HIDDEN    = 'tt-source-hidden';
  const DATA_ATTR        = 'data-tt-translated';
  const DATA_RETRY       = 'data-tt-retry';

  // 'bilingual' = 原文 + 译文同时显示（默认）
  // 'replace'   = 只显示译文，原文打 .tt-source-hidden 隐藏（CSS）
  let displayMode = 'bilingual';
  // No length minimum — short dialogue ("Yes.", "He turns around.") is real
  // novel content and should translate. shouldSkip() instead filters by
  // "must contain at least one letter" so we still skip pure-punctuation
  // separators (—, …, ***).
  const MAX_RETRIES      = 3;
  const RETRY_DELAY_MS   = 2500;

  // ─── Batched translation ─────────────────────────────────────────────
  // We bundle several adjacent paragraphs into ONE LLM call, marked with
  // [1] [2] [3] … so the model sees neighbouring context (better novel-
  // style coherence) and we make far fewer API requests (国内 LLM 限流
  // 友好得多).
  //
  // BATCH_SIZE  — paragraphs per LLM call. 5 keeps the prompt under ~1k
  //               tokens for typical AO3 paragraphs while still giving
  //               useful surrounding context.
  // BATCH_DEBOUNCE_MS — once the first paragraph is queued, wait this long
  //               for neighbours to join before flushing. Short enough that
  //               the user doesn't notice; long enough to let a viewport's
  //               worth of paragraphs land in the same batch.
  // MAX_IN_FLIGHT — how many batch requests to the desktop server may be
  //               in flight at once. 1 = strict serial (safest for limited
  //               LLM quotas). Bump to 2 if you have a fast/unlimited model.
  const BATCH_SIZE         = 12;
  const BATCH_DEBOUNCE_MS  = 600;
  const MAX_IN_FLIGHT      = 3;

  // AO3-specific selectors first, then generic fallbacks.
  // :not(.tt-bilingual-line) excludes our own injected translation paragraphs.
  // Headings (h1–h6) and definition list cells (dt/dd) are included so page
  // titles, section headers, and metadata blocks (e.g. AO3 tag rows) all
  // get translated — not just <p> body paragraphs.
  const SELECTORS = [
    'div#chapters p',
    'div.userstuff p',
    'article p',
    'main p',
    'p',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'dt', 'dd',
    'blockquote:not(:has(p))',
  ].map(s => s + ':not(.tt-bilingual-line)').join(', ');

  // ─── "Rogue text container" detection ────────────────────────────────
  // Modern marketing/blog pages frequently put paragraph-shaped content in a
  // bare <div class="callout"> / <aside> / <figcaption> / standalone <a>
  // button — never wrapping it in a real <p>. Those slip past SELECTORS and
  // stay untranslated. We catch them with a second pass that requires:
  //   1. The element holds a *direct* text-node child with letters (so it
  //      really is paragraph-like, not a layout wrapper).
  //   2. No descendant is itself a paragraph-like target — otherwise the
  //      child would translate and we'd double-up.
  //   3. No ancestor is a paragraph-like target — same anti-dup reason.
  //   4. Not inside <nav>/<header>/<footer> — avoids translating menu
  //      buttons/links and breaking horizontal nav layout.
  // <span>/<strong>/<em> are intentionally excluded: they're nearly always
  // mid-paragraph inline children whose text is already covered by the
  // enclosing <p>.
  const ROGUE_CANDIDATES_SELECTOR =
    'div, aside, section, figcaption, summary, li, td, th, a, button';
  const PARA_LIKE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, dt, dd, blockquote';
  const CHROME_ANCESTOR_SELECTOR = 'nav, header, footer, [role="navigation"]';

  function hasDirectTextChild(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && HAS_LETTER_RE.test(node.textContent)) {
        return true;
      }
    }
    return false;
  }

  function isRogueTextContainer(el) {
    if (el.classList.contains(BILINGUAL_CLASS)) return false;
    if (el.querySelector(PARA_LIKE_SELECTOR)) return false;
    if (!hasDirectTextChild(el)) return false;
    const parent = el.parentElement;
    if (parent && parent.closest(PARA_LIKE_SELECTOR)) return false;
    if (el.closest(CHROME_ANCESTOR_SELECTOR)) return false;
    return true;
  }

  let intersectionObs = null;
  let mutationObs     = null;

  // ─── Batched translation queue ───────────────────────────────────────
  // pendingBatch holds <p> elements waiting to be sent. flushBatch() takes
  // up to BATCH_SIZE of them, builds a single numbered prompt, and sends
  // one TRANSLATE message to the desktop server.
  let inFlight = 0;
  const pendingBatch = [];
  let batchTimer = null;

  function enqueueParagraph(el) {
    pendingBatch.push(el);
    scheduleFlush();
  }

  function scheduleFlush() {
    // Already at capacity → a future flush will retry.
    if (inFlight >= MAX_IN_FLIGHT) return;
    if (pendingBatch.length === 0) return;

    if (pendingBatch.length >= BATCH_SIZE) {
      flushBatch();
      return;
    }
    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        batchTimer = null;
        flushBatch();
      }, BATCH_DEBOUNCE_MS);
    }
  }

  function buildBatchPrompt(texts) {
    const numbered = texts
      .map((t, i) => `[${i + 1}] ${t}`)
      .join('\n\n');
    return (
      '请将下面的英文段落翻译为中文。这是连续的小说叙事，请保持上下文连贯。\n' +
      '严格要求：\n' +
      '1. 每段开头有 [编号] 标记，输出时必须保留同样的编号\n' +
      '2. 输出格式：每段译文以 "[N] " 开头，段与段之间空一行\n' +
      '3. 每个编号一段，不要合并、不要拆分、不要省略\n' +
      '4. **严格保留原文中所有标点符号**，特别是引号、单引号、省略号、破折号、' +
      '问号、感叹号、括号等 —— 它们用于区分对话、心理活动、引语、强调，丢了会导致语义混淆\n' +
      '5. 不要任何解释、前言、总结\n\n' +
      '英文原文：\n\n' +
      numbered
    );
  }

  // Strip common per-line decoration LLMs add around the number marker:
  // "**[1]**", "[1]：", "1. ", "1、", leading bullets, etc.
  function stripLeadingMarker(text) {
    return text
      .replace(/^[\s*_~`>·•◦・]+/, '')
      .replace(/^[\[【\(（]\s*\d+\s*[\]】\)）][\s.：:、,，-]*/, '')
      .replace(/^\d+\s*[.、:：)]\s*/, '')
      .replace(/^[\s*_~`]+/, '')
      .trim();
  }

  // Parse the LLM's batched response back into per-paragraph translations.
  // Tries several common numbering formats (LLMs are inconsistent):
  //   [1] xxx       (1) xxx       【1】xxx       1. xxx       1、xxx
  //   **[1]** xxx   ## 1. xxx
  // and finally falls back to splitting by blank lines if the count matches.
  // Returns array of length `expectedCount`; missing slots are null.
  function parseNumberedResponse(raw, expectedCount) {
    const result = new Array(expectedCount).fill(null);
    if (!raw) return result;

    // Each pattern captures: [1] = number, [2] = paragraph body (lazy
    // until next marker of the same family or end of string).
    const patterns = [
      // [1] body
      /\[\s*(\d+)\s*\]\s*([\s\S]*?)(?=(?:\n+\s*)?\[\s*\d+\s*\]|\s*$)/g,
      // 【1】body  (full-width brackets, common in zh LLMs)
      /【\s*(\d+)\s*】\s*([\s\S]*?)(?=(?:\n+\s*)?【\s*\d+\s*】|\s*$)/g,
      // (1) body  (round / full-width)
      /[\(（]\s*(\d+)\s*[\)）]\s*([\s\S]*?)(?=(?:\n+\s*)?[\(（]\s*\d+\s*[\)）]|\s*$)/g,
      // line-start "1. " or "1、" or "1)"
      /^\s*(\d+)\s*[.、)]\s+([\s\S]*?)(?=^\s*\d+\s*[.、)]\s|\Z)/gm,
    ];

    // Try every pattern and merge results — different paragraphs in the
    // same response might use different marker styles (rare but seen).
    for (const re of patterns) {
      const matches = [...raw.matchAll(re)];
      for (const m of matches) {
        const idx = parseInt(m[1], 10) - 1;
        const tx  = stripLeadingMarker(m[2] || '');
        if (idx >= 0 && idx < expectedCount && tx && !result[idx]) {
          result[idx] = tx;
        }
      }
    }

    // Fallback: any still-empty slots? If raw splits into exactly N chunks
    // by blank lines, fill the remaining slots in order. Handles the case
    // where the LLM strips the [N] markers entirely.
    if (result.includes(null)) {
      const parts = raw
        .split(/\n\s*\n+/)
        .map(s => stripLeadingMarker(s))
        .filter(s => s);
      if (parts.length === expectedCount) {
        parts.forEach((p, i) => {
          if (!result[i] && p) result[i] = p;
        });
      }
    }
    return result;
  }

  function flushBatch() {
    if (inFlight >= MAX_IN_FLIGHT) return;
    if (pendingBatch.length === 0) return;

    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }

    const batch = pendingBatch.splice(0, BATCH_SIZE);
    const texts = batch.map(el => (el.innerText || '').trim());
    const prompt = buildBatchPrompt(texts);

    // Page title as context — translate.js prepends it as "上下文：..." so
    // the LLM has the page's subject when disambiguating (novel about cooking
    // → 烹饪相关译法). Cheap to include, no per-genre prompt logic needed.
    const pageTitle = (document.title || '').trim().slice(0, 200);
    const pageContext = pageTitle ? `页面标题：${pageTitle}` : '';

    inFlight++;
    try {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', text: prompt, mode: 'paragraph', context: pageContext },
        resp => {
          inFlight--;
          handleBatchResponse(batch, resp);
          scheduleFlush();
        }
      );
    } catch (e) {
      inFlight--;
      handleBatchResponse(batch, { error: 'send-failed' });
      scheduleFlush();
    }
  }

  function handleBatchResponse(batch, resp) {
    const ok = resp && !resp.error && resp.translation;
    if (!ok) {
      const errMsg = (resp && resp.error) ? String(resp.error) : 'offline';
      try {
        console.warn('[tt-bilingual] batch failed', { size: batch.length, error: errMsg });
      } catch (_) {}
      batch.forEach(el => requeueOnFailure(el, errMsg));
      return;
    }

    const translations = parseNumberedResponse(resp.translation, batch.length);
    const missing = translations
      .map((t, i) => (t ? null : i + 1))
      .filter(x => x !== null);

    if (missing.length > 0) {
      // Print the FULL raw LLM output so we can see the format it actually used.
      // (Long strings will be truncated by DevTools but should be enough.)
      try {
        console.groupCollapsed(
          `[tt-bilingual] parse: ${batch.length - missing.length}/${batch.length} ok, missing slots ${missing.join(',')}`
        );
        console.log('--- LLM RAW OUTPUT ---');
        console.log(resp.translation);
        console.log('--- END ---');
        console.groupEnd();
      } catch (_) {}
    }

    batch.forEach((el, i) => {
      const tx = translations[i];
      if (tx) {
        insertTranslation(el, tx);
      } else {
        requeueOnFailure(el, 'parse-missing-slot');
      }
    });
  }

  // 'offline' / 'send-failed' come from the service worker when it can't
  // reach the desktop server, the SW itself is restarting, or the LLM API
  // returned a systemic error (rate limit, quota — see service-worker.js's
  // handleTranslate normalisation). They're environmental, not paragraph-
  // specific — the paragraph would translate fine if the underlying issue
  // were resolved. So we treat them differently: don't burn retry budget,
  // don't paint "[翻译失败]" marks (the popup already shows status), don't
  // flash a spinner per attempt (visual noise), and cap retries so a
  // permanently-broken config doesn't loop forever.
  const OFFLINE_ERRORS = new Set(['offline', 'send-failed']);
  const OFFLINE_RETRY_DELAY_MS = 8000;
  const OFFLINE_MAX_RETRIES = 6;
  const DATA_OFFLINE_RETRY = 'data-tt-offline';

  function requeueOnFailure(el, errMsg) {
    el.setAttribute('data-tt-error', errMsg);

    if (OFFLINE_ERRORS.has(errMsg)) {
      removeSpinner(el);
      el.removeAttribute(DATA_ATTR);

      const offlineCount = parseInt(el.getAttribute(DATA_OFFLINE_RETRY) || '0', 10) + 1;
      el.setAttribute(DATA_OFFLINE_RETRY, String(offlineCount));
      // After enough silent attempts, give up quietly — the user has open
      // popup feedback and a 重试翻译 button if they fix the underlying
      // issue. Keeps an idle tab from poking a permanently-broken endpoint.
      if (offlineCount >= OFFLINE_MAX_RETRIES) return;

      setTimeout(() => {
        if (!document.body.contains(el)) return;
        if (el.getAttribute(DATA_ATTR) === '1') return;
        el.setAttribute(DATA_ATTR, 'pending');
        // No spinner — for systemic errors, repeated spinner flashes are
        // just noise. The translation will simply appear if/when it works.
        enqueueParagraph(el);
      }, OFFLINE_RETRY_DELAY_MS);
      return;
    }

    const retryCount = parseInt(el.getAttribute(DATA_RETRY) || '0', 10);

    if (retryCount >= MAX_RETRIES) {
      removeSpinner(el);
      el.removeAttribute(DATA_ATTR);
      showFailureMark(el, errMsg);
      return;
    }

    removeSpinner(el);
    el.removeAttribute(DATA_ATTR);
    el.setAttribute(DATA_RETRY, String(retryCount + 1));

    const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
    setTimeout(() => {
      if (!document.body.contains(el)) return;
      if (el.getAttribute(DATA_ATTR) === '1') return;
      // Re-mark pending and re-enqueue
      el.setAttribute(DATA_ATTR, 'pending');
      clearFailureMark(el);
      insertSpinner(el);
      enqueueParagraph(el);
    }, delay);
  }

  // ─── Spinner ──────────────────────────────────────────────────────────
  function insertSpinner(el) {
    if (el.nextElementSibling && el.nextElementSibling.classList.contains(SPINNER_CLASS)) return;
    const wrap = document.createElement('span');
    wrap.className = SPINNER_CLASS;
    wrap.innerHTML = '<span class="tt-spinner" aria-label="翻译中"></span>';
    el.appendChild(wrap);
  }

  function removeSpinner(el) {
    const s = el.querySelector('.' + SPINNER_CLASS);
    if (s) s.remove();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────
  // Matches ANY Unicode letter (Latin, CJK, Cyrillic, …). Used to filter
  // pure-punctuation paragraphs like "—", "…", or "* * *" without dropping
  // legitimate short dialogue.
  const HAS_LETTER_RE = /\p{L}/u;
  // CJK Unified Ideographs (basic + Ext-A) + Hiragana + Katakana + Hangul.
  // Anything matching this we consider "already in the target language" for
  // the en→zh use-case and skip — otherwise the LLM ends up "translating"
  // Chinese to Chinese, giving a duplicate paragraph below the original.
  const CJK_RE = /[一-鿿㐀-䶿぀-ヿ가-힯]/g;
  const LATIN_LETTER_RE = /[A-Za-zÀ-ɏ]/g;

  function isAlreadyTargetLang(text) {
    const cjk   = text.match(CJK_RE);
    const latin = text.match(LATIN_LETTER_RE);
    const c = cjk ? cjk.length : 0;
    const l = latin ? latin.length : 0;
    // If there's any CJK and it dominates the letter mix, treat as Chinese
    // (or Japanese / Korean) — don't re-translate. Threshold tuned so that
    // a single English term inside a Chinese paragraph (e.g. quoted
    // proper noun) doesn't accidentally trigger a translate pass.
    return c > 0 && c >= l;
  }

  function shouldSkip(el) {
    const attr = el.getAttribute(DATA_ATTR);
    if (attr === '1' || attr === 'pending') return true;
    const text = (el.innerText || '').trim();
    if (!text) return true;
    if (!HAS_LETTER_RE.test(text)) return true;
    if (isAlreadyTargetLang(text)) return true;
    return false;
  }

  // Some elements break visually (or functionally) if we drop a sibling clone
  // next to them: a <button>'s click handler lives on the original id, so the
  // sibling clone is dead; flex/grid items add an extra cell and double the
  // grid; absolute/fixed elements stack on top of each other in the same
  // position. For those we instead append the translation INSIDE the original
  // as a <span class="tt-bilingual-line tt-inline-translation"> — the original
  // keeps its handlers, attributes, and layout slot; the translation flows
  // below it as a block-styled span.
  function shouldAppendInside(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a') return true;
    const cs = window.getComputedStyle(el);
    const pos = cs.position;
    if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return true;
    const parent = el.parentElement;
    if (parent) {
      const pd = window.getComputedStyle(parent).display;
      if (pd === 'flex' || pd === 'inline-flex' || pd === 'grid' || pd === 'inline-grid') {
        return true;
      }
    }
    return false;
  }

  // Apply defensive properties via inline style + !important. External CSS
  // !important rules from the host page can match our class with higher
  // specificity and force vertical writing-mode / RTL direction on us.
  // Inline style with !important wins over almost any author selector.
  //
  // We deliberately DO NOT touch `transform` here. Some sites (notably
  // Google search) wrap a heading row in a `transform`-ed parent and put
  // a counter-`transform` on the heading itself via inline style. If we
  // killed transform on our cloned element, we'd kill the counter and the
  // clone would render upside-down. Instead, insertTranslation copies
  // `el.style.cssText` so any such counter-transform comes along for free.
  function applyDefenseStyle(el) {
    const s = el.style;
    s.setProperty('writing-mode', 'horizontal-tb', 'important');
    s.setProperty('direction', 'ltr', 'important');
    s.setProperty('unicode-bidi', 'normal', 'important');
  }

  function insertTranslation(el, translatedText) {
    removeSpinner(el);

    if (shouldAppendInside(el)) {
      const span = document.createElement('span');
      span.className = BILINGUAL_CLASS + ' tt-inline-translation';
      span.textContent = translatedText;
      span.setAttribute(DATA_ATTR, '1');
      applyDefenseStyle(span);
      el.appendChild(span);
      el.setAttribute(DATA_ATTR, '1');
      el.removeAttribute(DATA_RETRY);
      return;
    }

    // Mirror the source element's tag, className AND inline style so the
    // translation inherits exactly the same host CSS:
    //   <h2 class="title heading"> (centered, big)        → same look
    //   <p>                       (normal paragraph)      → same look
    //   <h3 class="landmark">     (accessibility-hidden)  → also hidden
    //   <dt class="rating tags">  (metadata grid cell)    → fits the grid
    //   <h3 style="transform:rotate(180deg)"> (counter-rotated to undo a
    //                              parent transform)      → also undoes it
    // We add our own class on top for bookkeeping (the :not() selector
    // and the data-attr that prevents re-translation).
    const tag = el.tagName.toLowerCase();
    const line = document.createElement(tag);
    if (el.className)        line.className     = el.className;
    if (el.style && el.style.cssText) line.style.cssText = el.style.cssText;
    line.classList.add(BILINGUAL_CLASS);
    line.textContent = translatedText;
    line.setAttribute(DATA_ATTR, '1');
    applyDefenseStyle(line);
    el.after(line);
    el.setAttribute(DATA_ATTR, '1');
    el.removeAttribute(DATA_RETRY);

    // Replace mode: hide the original — the translation now sits in the
    // exact same layout slot (same tag + same className), giving identical
    // formatting. Toggling display mode just toggles this class.
    if (displayMode === 'replace') {
      el.classList.add(SOURCE_HIDDEN);
    }
  }

  // Toggle source visibility on already-translated paragraphs when display
  // mode changes (called by setDisplayMode below).
  function applyDisplayMode() {
    const sources = document.querySelectorAll('[' + DATA_ATTR + '="1"]:not(.' + BILINGUAL_CLASS + ')');
    try {
      console.log('[tt-bilingual] applyDisplayMode', {
        mode: displayMode,
        translatedSources: sources.length,
        action: displayMode === 'replace' ? 'add tt-source-hidden' : 'remove tt-source-hidden',
      });
    } catch (_) {}
    if (displayMode === 'replace') {
      sources.forEach(el => {
        // appendInside elements host the translation as a child span — hiding
        // the source would hide the translation too. Leave them alone.
        if (el.querySelector('.tt-inline-translation')) return;
        el.classList.add(SOURCE_HIDDEN);
      });
    } else {
      sources.forEach(el => el.classList.remove(SOURCE_HIDDEN));
    }
  }

  // Add a small inline indicator so failed paragraphs are visible and the
  // user can use 重试翻译 to try again.
  function showFailureMark(el, errMsg) {
    if (el.querySelector('.' + FAIL_CLASS)) return;
    const mark = document.createElement('span');
    mark.className = FAIL_CLASS;
    mark.textContent = ' [翻译失败]';
    mark.title = errMsg ? `错误: ${errMsg}` : '点击「重试翻译」可再次尝试';
    el.appendChild(mark);
  }

  function clearFailureMark(el) {
    const m = el.querySelector('.' + FAIL_CLASS);
    if (m) m.remove();
  }

  // ─── Translate one paragraph (just enqueues into the batch) ──────────
  function translateParagraph(el) {
    if (shouldSkip(el)) return;

    const retryCount = parseInt(el.getAttribute(DATA_RETRY) || '0', 10);
    if (retryCount >= MAX_RETRIES) {
      removeSpinner(el);
      el.removeAttribute(DATA_ATTR);
      el.removeAttribute(DATA_RETRY);
      showFailureMark(el, el.getAttribute('data-tt-error') || '');
      return;
    }

    el.setAttribute(DATA_ATTR, 'pending');
    clearFailureMark(el);
    insertSpinner(el);

    enqueueParagraph(el);
  }

  // ─── Pre-processing: explode <br><br>-separated text into real <p>s ──
  // Some sites (notably user-pasted AO3 fics) put an entire chapter into a
  // single <p> with <br><br> as paragraph breaks. That single <p> is too
  // big to translate in one shot — it'd hit token limits, lose coherence,
  // and the result is a giant blob with no segmentation. So before we start
  // observing, we look for any <p> containing 2+ consecutive <br>s and
  // split it into proper sibling <p> elements.
  //
  // Idempotent: skips <p>s already touched by us (DATA_ATTR set or
  // BILINGUAL_CLASS) and skips <p>s without <br><br>.
  const BR_BR_RE = /(?:<br\s*\/?>\s*){2,}/i;
  const BR_BR_RE_G = /(?:<br\s*\/?>\s*){2,}/gi;

  // We also crack <blockquote class="userstuff">...<br><br>...</blockquote>
  // and <dd>...<br><br>...</dd> (AO3 search results put summaries in
  // these, the same way fic chapters use a single <p> with <br><br> breaks).
  function explodeBrParagraphs(root) {
    if (!root || !root.querySelectorAll) return 0;
    const candidates = Array.from(root.querySelectorAll('p, blockquote, dd'));
    let count = 0;
    for (const el of candidates) {
      if (el.classList.contains(BILINGUAL_CLASS)) continue;
      if (el.hasAttribute(DATA_ATTR)) continue;
      const html = el.innerHTML;
      if (!BR_BR_RE.test(html)) continue;

      const pieces = html.split(BR_BR_RE_G);
      const newPs = [];
      for (const raw of pieces) {
        const trimmed = raw
          .replace(/^\s*(?:<br\s*\/?>)+\s*|\s*(?:<br\s*\/?>)+\s*$/gi, '')
          .trim();
        if (!trimmed) continue;
        const newP = document.createElement('p');
        newP.innerHTML = trimmed;
        if (!newP.textContent.trim()) continue;
        // Carry className only when source IS already a <p> (otherwise we'd
        // copy "userstuff" / metadata classes to all sub-paragraphs and hit
        // duplicate-style issues).
        if (el.tagName === 'P' && el.className) newP.className = el.className;
        newPs.push(newP);
      }
      if (newPs.length < 2) continue;

      if (el.tagName === 'P') {
        // Replace the single big <p> with N siblings.
        const frag = document.createDocumentFragment();
        newPs.forEach(p => frag.appendChild(p));
        el.replaceWith(frag);
      } else {
        // For <blockquote> / <dd>: keep the wrapper (preserves layout +
        // styling), just put the new <p>s inside it.
        el.innerHTML = '';
        newPs.forEach(p => el.appendChild(p));
      }
      count += newPs.length;
    }
    return count;
  }

  // ─── IntersectionObserver ─────────────────────────────────────────────
  function buildIntersectionObs() {
    return new IntersectionObserver(entries => {
      entries
        .filter(e => e.isIntersecting)
        .forEach(e => translateParagraph(e.target));
    }, { rootMargin: '300px 0px' });
  }

  function observeAll() {
    document.querySelectorAll(SELECTORS).forEach(p => {
      const attr = p.getAttribute(DATA_ATTR);
      if (attr !== '1' && attr !== 'pending') {
        intersectionObs.observe(p);
      }
    });
    // Second pass: rogue text containers (callout boxes, standalone CTAs).
    document.querySelectorAll(ROGUE_CANDIDATES_SELECTOR).forEach(el => {
      const attr = el.getAttribute(DATA_ATTR);
      if (attr === '1' || attr === 'pending') return;
      if (!isRogueTextContainer(el)) return;
      intersectionObs.observe(el);
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────
  function init() {
    if (intersectionObs) return;

    // First pass: split any <p> that hides multiple paragraphs behind
    // <br><br> separators. This is critical for AO3-style content where
    // a whole chapter sits in a single <p>.
    const exploded = explodeBrParagraphs(document.body);
    if (exploded > 0) {
      try { console.log('[tt-bilingual] split', exploded, 'paragraphs from <br><br> blocks'); } catch (_) {}
    }

    intersectionObs = buildIntersectionObs();
    observeAll();

    // On DOM changes, re-run the exploder (in case content loads late)
    // and re-observe new paragraphs.
    mutationObs = new MutationObserver(() => {
      explodeBrParagraphs(document.body);
      observeAll();
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });
  }

  function destroy() {
    if (intersectionObs) { intersectionObs.disconnect(); intersectionObs = null; }
    if (mutationObs)     { mutationObs.disconnect();     mutationObs     = null; }

    document.querySelectorAll('.' + BILINGUAL_CLASS).forEach(el => el.remove());
    document.querySelectorAll('.' + SPINNER_CLASS).forEach(el => el.remove());
    document.querySelectorAll('.' + FAIL_CLASS).forEach(el => el.remove());
    document.querySelectorAll('.' + SOURCE_HIDDEN).forEach(el => el.classList.remove(SOURCE_HIDDEN));
    document.querySelectorAll('[' + DATA_ATTR + ']').forEach(el => el.removeAttribute(DATA_ATTR));
    document.querySelectorAll('[' + DATA_RETRY + ']').forEach(el => el.removeAttribute(DATA_RETRY));
    document.querySelectorAll('[data-tt-error]').forEach(el => el.removeAttribute('data-tt-error'));

    // Drop any queued requests too
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    pendingBatch.length = 0;
  }

  function retryAll() {
    if (!intersectionObs) return;
    // Clear any previous failure marks so users see fresh state.
    document.querySelectorAll('.' + FAIL_CLASS).forEach(m => m.remove());
    const retryOne = el => {
      const attr = el.getAttribute(DATA_ATTR);
      if (attr === '1' || attr === 'pending') return;
      el.removeAttribute(DATA_RETRY);
      el.removeAttribute('data-tt-error');
      // Re-translate immediately rather than waiting for intersection.
      translateParagraph(el);
    };
    document.querySelectorAll(SELECTORS).forEach(retryOne);
    document.querySelectorAll(ROGUE_CANDIDATES_SELECTOR).forEach(el => {
      if (isRogueTextContainer(el)) retryOne(el);
    });
  }

  function setDisplayMode(mode) {
    const next = mode === 'replace' ? 'replace' : 'bilingual';
    try { console.log('[tt-bilingual] setDisplayMode', { from: displayMode, to: next, requested: mode }); } catch (_) {}
    if (next === displayMode) return;
    displayMode = next;
    applyDisplayMode();
  }

  window.ttBilingual = { init, destroy, retryAll, setDisplayMode };
})();
