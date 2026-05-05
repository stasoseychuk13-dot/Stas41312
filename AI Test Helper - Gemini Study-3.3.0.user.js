// ==UserScript==
// @name         AI Test Helper - Gemini Study
// @namespace    https://github.com/ai-test-helper
// @version      3.3.0
// @description  Study helper using Gemini API. Auto-selects answers, caches results, shows confidence. Works on mobile.
// @author       AI Test Helper
// @match        *://docs.google.com/forms/*
// @match        *://naurok.com.ua/*
// @match        *://*.naurok.com.ua/*
// @match        *://naurok.ua/*
// @match        *://*.naurok.ua/*
// @include      /^https?:\/\/([^/]+\.)?naurok\.(com\.ua|ua)\/.*$/
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      generativelanguage.googleapis.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'ath_gf_gemini_config';
  const CACHE_KEY = 'ath_answer_cache';
  const DEFAULT_CONFIG = {
    apiKey: '',
    model: 'gemini-2.5-flash-lite',
    language: 'auto',
    autoSelect: false,
    autoMode: false,
  };
  const FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
  const CACHE_MAX = 500;

  let config = loadConfig();
  let answerCache = loadCache();
  let lastQuestions = [];
  let autoModeObserver = null;
  let autoModeTimer = null;
  let autoModeBusy = false;
  let lastQuestionFingerprint = '';

  function loadConfig() {
    try {
      return Object.assign({}, DEFAULT_CONFIG, JSON.parse(GM_getValue(STORE_KEY, '{}') || '{}'));
    } catch (_) {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig() {
    GM_setValue(STORE_KEY, JSON.stringify(config));
  }

  function loadCache() {
    try {
      return JSON.parse(GM_getValue(CACHE_KEY, '{}') || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveCache() {
    const keys = Object.keys(answerCache);
    if (keys.length > CACHE_MAX) {
      const trimmed = {};
      keys.slice(-CACHE_MAX).forEach(k => { trimmed[k] = answerCache[k]; });
      answerCache = trimmed;
    }
    GM_setValue(CACHE_KEY, JSON.stringify(answerCache));
  }

  function cacheKey(questionText) {
    return questionText.trim().toLowerCase().slice(0, 120);
  }

  function getCached(questionText) {
    return answerCache[cacheKey(questionText)] || null;
  }

  function setCached(questionText, answer) {
    answerCache[cacheKey(questionText)] = answer;
    saveCache();
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  GM_addStyle(`
    #ath-fab {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: 54px;
      height: 54px;
      border: 0;
      border-radius: 50%;
      color: white;
      background: linear-gradient(135deg, #4f46e5, #8b5cf6);
      box-shadow: 0 8px 24px rgba(79,70,229,.5);
      cursor: pointer;
      font: 800 18px/1 system-ui, sans-serif;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    #ath-panel {
      position: fixed;
      right: 12px;
      bottom: 82px;
      z-index: 2147483647;
      display: none;
      width: min(400px, calc(100vw - 24px));
      max-height: min(75vh, 700px);
      overflow: hidden;
      color: #f8fafc;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 14px;
      box-shadow: 0 24px 70px rgba(0,0,0,.6);
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    #ath-panel.visible { display: flex; flex-direction: column; }
    .ath-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 13px 14px;
      background: linear-gradient(135deg, #4f46e5, #8b5cf6);
      flex-shrink: 0;
    }
    .ath-title { flex: 1; font-weight: 800; font-size: 15px; }
    .ath-icon {
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 8px;
      color: #fff;
      background: rgba(255,255,255,.18);
      cursor: pointer;
      font-weight: 800;
      font-size: 15px;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .ath-tabs {
      display: flex;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      flex-shrink: 0;
    }
    .ath-tab {
      flex: 1;
      padding: 10px 5px;
      color: #94a3b8;
      text-align: center;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      border-bottom: 2px solid transparent;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .ath-tab.active { color: #c4b5fd; border-color: #c4b5fd; }
    .ath-body {
      display: none;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 14px;
      -webkit-overflow-scrolling: touch;
    }
    .ath-body.active { display: flex; }
    .ath-btn {
      min-height: 44px;
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 10px 12px;
      color: #fff;
      background: #4f46e5;
      cursor: pointer;
      font-weight: 800;
      font-size: 14px;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .ath-btn.secondary { color: #f8fafc; background: #1e293b; border: 1px solid #334155; }
    .ath-btn.danger { background: #dc2626; }
    .ath-btn.success { background: #16a34a; }
    .ath-btn:disabled { opacity: .5; cursor: wait; }
    .ath-btn-row { display: flex; gap: 8px; }
    .ath-btn-row .ath-btn { flex: 1; }
    .ath-card {
      padding: 12px;
      border: 1px solid #334155;
      border-radius: 10px;
      background: #1e293b;
    }
    .ath-status {
      display: none;
      padding: 9px 11px;
      border-radius: 8px;
      font-size: 12px;
      text-align: center;
      overflow-wrap: anywhere;
      line-height: 1.4;
    }
    .ath-status.show { display: block; }
    .ath-status.info { color: #bfdbfe; background: rgba(59,130,246,.14); }
    .ath-status.ok { color: #bbf7d0; background: rgba(34,197,94,.14); }
    .ath-status.err { color: #fecaca; background: rgba(239,68,68,.14); }
    .ath-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .ath-muted { color: #94a3b8; font-size: 12px; }
    .ath-count { color: #fff; font-size: 22px; font-weight: 900; }
    .ath-input, .ath-select {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 11px;
      color: #f8fafc;
      background: #1e293b;
      outline: 0;
      font-size: 14px;
    }
    .ath-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
    }
    .ath-toggle-label { color: #f8fafc; font-size: 13px; font-weight: 600; }
    .ath-toggle {
      position: relative;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }
    .ath-toggle input { opacity: 0; width: 0; height: 0; }
    .ath-slider {
      position: absolute;
      inset: 0;
      background: #334155;
      border-radius: 24px;
      cursor: pointer;
      transition: background .2s;
    }
    .ath-slider:before {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      top: 3px;
      background: white;
      border-radius: 50%;
      transition: transform .2s;
    }
    .ath-toggle input:checked + .ath-slider { background: #4f46e5; }
    .ath-toggle input:checked + .ath-slider:before { transform: translateX(20px); }
    .ath-label { color: #94a3b8; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 5px; }
    .ath-answer {
      margin-top: 8px;
      padding: 9px 11px;
      border-radius: 8px;
      color: #bbf7d0;
      background: rgba(34,197,94,.12);
      border: 1px solid rgba(34,197,94,.25);
      overflow-wrap: anywhere;
      font-weight: 700;
    }
    .ath-option { margin-top: 6px; color: #cbd5e1; overflow-wrap: anywhere; font-size: 13px; }
    .ath-option.correct { color: #86efac; font-weight: 700; }
    .ath-explain { margin-top: 8px; color: #94a3b8; font-size: 12px; overflow-wrap: anywhere; line-height: 1.5; }
    .ath-confidence {
      display: inline-block;
      margin-top: 7px;
      padding: 3px 8px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 800;
    }
    .ath-conf-high { background: rgba(34,197,94,.18); color: #86efac; }
    .ath-conf-mid  { background: rgba(234,179,8,.18);  color: #fde047; }
    .ath-conf-low  { background: rgba(239,68,68,.18);  color: #fca5a5; }
    .ath-cached-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 800;
      background: rgba(139,92,246,.25);
      color: #c4b5fd;
      vertical-align: middle;
    }
    .ath-auto-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 11px;
      border-radius: 8px;
      background: rgba(79,70,229,.12);
      border: 1px solid rgba(79,70,229,.3);
      font-size: 12px;
      color: #a5b4fc;
    }
    .ath-automode-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(16,185,129,.1);
      border: 1px solid rgba(16,185,129,.35);
      font-size: 13px;
      font-weight: 700;
      color: #6ee7b7;
      transition: background .2s, border-color .2s;
    }
    .ath-automode-row.active {
      background: rgba(16,185,129,.2);
      border-color: rgba(16,185,129,.6);
      animation: ath-pulse 2s infinite;
    }
    .ath-automode-row .ath-automode-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #6ee7b7;
      flex-shrink: 0;
    }
    .ath-automode-row.active .ath-automode-dot {
      background: #34d399;
      box-shadow: 0 0 6px #34d399;
    }
    @keyframes ath-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,.35); }
      50% { box-shadow: 0 0 0 6px rgba(52,211,153,0); }
    }
    @media (max-width: 480px) {
      #ath-panel {
        right: 8px;
        left: 8px;
        width: auto;
        bottom: 76px;
        max-height: 72vh;
        border-radius: 12px;
      }
      #ath-fab {
        right: 12px;
        bottom: 12px;
        width: 50px;
        height: 50px;
      }
    }
  `);

  // ─── DOM helpers ──────────────────────────────────────────────────────────
  function make(tag, attrs, text) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === 'className') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style') Object.assign(node.style, value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function visibleText(node) {
    let t = (node && (node.innerText || node.textContent) || '').trim();
    // Normalize unicode minus/dash variants to ASCII minus
    t = t.replace(/[−–—]/g, '-');
    // Collapse whitespace but preserve "- 7" → "-7" for math expressions
    t = t.replace(/(\-|\+|\×|\÷|\*|\/)\s+(\d)/g, '$1$2');
    t = t.replace(/(\d)\s+(\-|\+|\×|\÷|\*|\/)/g, '$1$2');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  function collectImageSources(root) {
    const sources = [];
    Array.from(root.querySelectorAll('img')).forEach(img => {
      const src = img.currentSrc || img.src || img.getAttribute('src') || '';
      if (!src || src.startsWith('data:image/svg') || src.includes('favicon')) return;
      const rect = img.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) return;
      if (!sources.includes(src)) sources.push(src);
    });
    return sources.slice(0, 3);
  }

  function isVisibleElement(el) {
    if (!el || el.closest('#ath-panel')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || 1) > 0.05;
  }

  function visibleTextBlocks() {
    const ignored = new Set([
      'AI', 'AI Test Helper', 'Main', 'Answers', 'Settings', 'Scan', 'Analyze', 'Debug',
      'Questions found', 'Works as a study helper for visible questions. Images inside questions are attached automatically when possible.',
    ]);
    const blocks = [];
    Array.from(document.body.querySelectorAll('body *')).forEach(el => {
      if (!isVisibleElement(el)) return;
      const text = visibleText(el);
      if (!text || ignored.has(text) || text.length > 500) return;
      const childText = Array.from(el.children || [])
        .filter(isVisibleElement)
        .map(c => visibleText(c))
        .filter(Boolean)
        .join(' ');
      if (childText && childText.trim() === text.trim()) return;
      const rect = el.getBoundingClientRect();
      blocks.push({ element: el, text, rect });
    });
    return blocks;
  }

  // ─── Status ───────────────────────────────────────────────────────────────
  function setStatus(msg, type) {
    const st = document.getElementById('ath-status');
    if (!st) return;
    st.textContent = msg;
    st.className = 'ath-status show ' + (type || 'info');
    console.info('[AI Test Helper]', msg);
  }

  function openPanel(tab) {
    document.getElementById('ath-panel').classList.add('visible');
    switchTab(tab || 'main');
  }

  function switchTab(name) {
    document.querySelectorAll('#ath-panel .ath-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#ath-panel .ath-body').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  }

  function addLabeled(parent, labelText, control) {
    const wrap = make('div', {});
    wrap.append(make('div', { className: 'ath-label' }, labelText), control);
    parent.appendChild(wrap);
  }

  // ─── UI Build ─────────────────────────────────────────────────────────────
  function buildUI() {
    if (document.getElementById('ath-panel')) return;

    const fab = make('button', { id: 'ath-fab', type: 'button', title: 'AI Test Helper' }, 'AI');
    document.body.appendChild(fab);

    const panel = make('div', { id: 'ath-panel' });

    // Head
    const head = make('div', { className: 'ath-head' });
    head.append(
      make('div', { className: 'ath-title' }, '🤖 AI Test Helper'),
      make('button', { id: 'ath-close', className: 'ath-icon', type: 'button' }, '✕')
    );

    // Tabs
    const tabs = make('div', { className: 'ath-tabs' });
    [['main', '🏠 Main'], ['answers', '✅ Answers'], ['settings', '⚙️ Setup']].forEach(([id, label], i) => {
      tabs.appendChild(make('div', { className: 'ath-tab' + (i === 0 ? ' active' : ''), dataset: { tab: id } }, label));
    });

    // Main tab
    const main = make('div', { className: 'ath-body active', dataset: { tab: 'main' } });
    const countCard = make('div', { className: 'ath-card ath-row' });
    countCard.append(make('div', { className: 'ath-muted' }, 'Questions found'), make('div', { id: 'ath-count', className: 'ath-count' }, '0'));
    const cacheCard = make('div', { className: 'ath-card ath-row' });
    cacheCard.append(make('div', { className: 'ath-muted' }, 'Cached answers'), make('div', { id: 'ath-cache-count', className: 'ath-count', style: { fontSize: '16px', color: '#c4b5fd' } }, String(Object.keys(answerCache).length)));

    const autoRow = make('div', { className: 'ath-auto-row' });
    autoRow.appendChild(make('span', {}, '⚡ Auto-select answers after analysis'));

    const toggleWrap = make('label', { className: 'ath-toggle' });
    const toggleInput = make('input', { id: 'ath-auto-toggle', type: 'checkbox' });
    toggleInput.checked = Boolean(config.autoSelect);
    toggleWrap.append(toggleInput, make('span', { className: 'ath-slider' }));
    autoRow.appendChild(toggleWrap);

    // Auto-mode row
    const autoModeRow = make('div', { id: 'ath-automode-row', className: 'ath-automode-row' });
    const autoModeDot = make('div', { className: 'ath-automode-dot' });
    const autoModeLabel = make('span', { id: 'ath-automode-label', style: { flex: '1' } }, '🤖 Auto-mode: OFF');
    const autoModeToggleWrap = make('label', { className: 'ath-toggle' });
    const autoModeToggleInput = make('input', { id: 'ath-automode-toggle', type: 'checkbox' });
    autoModeToggleInput.checked = Boolean(config.autoMode);
    autoModeToggleWrap.append(autoModeToggleInput, make('span', { className: 'ath-slider' }));
    autoModeRow.append(autoModeDot, autoModeLabel, autoModeToggleWrap);

    const btnRow = make('div', { className: 'ath-btn-row' });
    btnRow.append(
      make('button', { id: 'ath-scan', className: 'ath-btn secondary', type: 'button' }, '🔍 Scan'),
      make('button', { id: 'ath-analyze', className: 'ath-btn', type: 'button' }, '✨ Analyze')
    );
    const btnRow2 = make('div', { className: 'ath-btn-row' });
    btnRow2.append(
      make('button', { id: 'ath-autoselect-btn', className: 'ath-btn success', type: 'button' }, '⚡ Auto-select now'),
      make('button', { id: 'ath-clear-cache', className: 'ath-btn danger', type: 'button' }, '🗑 Clear cache')
    );

    main.append(countCard, cacheCard, make('div', { id: 'ath-status', className: 'ath-status' }), autoModeRow, autoRow, btnRow, btnRow2,
      make('div', { className: 'ath-muted' }, 'Scans visible questions. Images attached automatically.')
    );

    // Answers tab
    const answers = make('div', { className: 'ath-body', dataset: { tab: 'answers' } });
    answers.appendChild(make('div', { id: 'ath-results' }));

    // Settings tab
    const settings = make('div', { className: 'ath-body', dataset: { tab: 'settings' } });
    const keyInput = make('input', { id: 'ath-key', className: 'ath-input', type: 'password', placeholder: 'Gemini API key...', autocomplete: 'off', value: config.apiKey || '' });
    const modelInput = make('input', { id: 'ath-model', className: 'ath-input', type: 'text', value: config.model || 'gemini-2.5-flash-lite' });
    const langSelect = make('select', { id: 'ath-lang', className: 'ath-select' });
    [['auto', 'Same as question'], ['uk', 'Ukrainian'], ['ru', 'Russian'], ['en', 'English']].forEach(([v, l]) => {
      langSelect.appendChild(make('option', { value: v }, l));
    });
    langSelect.value = config.language || 'auto';
    addLabeled(settings, 'Gemini API key', keyInput);
    addLabeled(settings, 'Model', modelInput);
    addLabeled(settings, 'Response language', langSelect);
    settings.appendChild(make('button', { id: 'ath-save', className: 'ath-btn', type: 'button' }, '💾 Save settings'));

    panel.append(head, tabs, main, answers, settings);
    document.body.appendChild(panel);

    // Events
    fab.addEventListener('pointerdown', e => {
      e.preventDefault();
      panel.classList.toggle('visible');
      if (panel.classList.contains('visible')) switchTab('main');
    });
    document.getElementById('ath-close').addEventListener('click', () => panel.classList.remove('visible'));
    panel.querySelectorAll('.ath-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    document.getElementById('ath-save').addEventListener('click', () => {
      config.apiKey = document.getElementById('ath-key').value.trim();
      config.model = document.getElementById('ath-model').value.trim() || 'gemini-2.5-flash-lite';
      config.language = document.getElementById('ath-lang').value || 'auto';
      saveConfig();
      setStatus('Settings saved.', 'ok');
      switchTab('main');
    });

    document.getElementById('ath-auto-toggle').addEventListener('change', e => {
      config.autoSelect = e.target.checked;
      saveConfig();
    });

    document.getElementById('ath-automode-toggle').addEventListener('change', e => {
      config.autoMode = e.target.checked;
      saveConfig();
      if (config.autoMode) startAutoMode();
      else stopAutoMode();
    });

    document.getElementById('ath-scan').addEventListener('click', scan);
    document.getElementById('ath-analyze').addEventListener('click', analyze);
    document.getElementById('ath-autoselect-btn').addEventListener('click', () => {
      if (!lastQuestions.length) { setStatus('Run Scan + Analyze first.', 'err'); return; }
      const results = document.getElementById('ath-results');
      const cards = results ? results.querySelectorAll('.ath-card') : [];
      if (!cards.length) { setStatus('No answers to auto-select yet.', 'err'); return; }
      doAutoSelect();
    });
    document.getElementById('ath-clear-cache').addEventListener('click', () => {
      answerCache = {};
      saveCache();
      document.getElementById('ath-cache-count').textContent = '0';
      setStatus('Cache cleared.', 'ok');
    });
  }

  // ─── Question extraction (unchanged logic) ────────────────────────────────
  function scan() {
    lastQuestions = getPageQuestions();
    document.getElementById('ath-count').textContent = String(lastQuestions.length);
    setStatus(lastQuestions.length
      ? 'Questions detected: ' + lastQuestions.length
      : 'No questions detected. Scroll the form and try again.',
      lastQuestions.length ? 'ok' : 'err');
    renderDetectedQuestions(lastQuestions);
    return lastQuestions;
  }

  function getPageQuestions() {
    const gf = getGoogleFormQuestions();
    if (gf.length) return gf;
    const nk = getNaurokQuestions();
    if (nk.length) return nk;
    return getGenericQuestions();
  }

  function getGoogleFormQuestions() {
    const questions = [];
    document.querySelectorAll('[role="listitem"]').forEach(item => {
      if (item.closest('#ath-panel')) return;
      const qNode = item.querySelector('[role="heading"], .M7eMe, .geS5n');
      const qText = visibleText(qNode);
      if (!qText || qText.length < 8) return;
      const options = [];
      item.querySelectorAll('[role="radio"], [role="checkbox"]').forEach(ctrl => {
        const box = ctrl.closest('[data-value]') || ctrl.closest('label') || ctrl.parentElement;
        let text = visibleText(box) || ctrl.getAttribute('aria-label') || ctrl.getAttribute('data-value') || '';
        text = text.replace(qText, '').replace(/^[*•\s]+/, '').trim();
        if (text && !options.some(o => o.text === text)) options.push({ text, element: ctrl });
      });
      item.querySelectorAll('textarea, input[type="text"]').forEach(() => {
        if (!options.length) options.push({ text: 'Open-ended answer' });
      });
      if (!questions.some(q => q.text === qText)) {
        questions.push({ text: qText, options, imageSources: collectImageSources(item), container: item });
      }
    });
    return questions;
  }

  function getNaurokQuestions() {
    const questions = [];
    const containers = Array.from(document.querySelectorAll(
      '.question, [class*="question"], .test-question, .quiz-question, [data-question], form, main, section'
    )).filter(el => !el.closest('#ath-panel'));

    containers.forEach(item => {
      const controls = Array.from(item.querySelectorAll('input[type="radio"], input[type="checkbox"], button, label'));
      const hasChoices = controls.some(c => visibleText(c).length > 0 || c.getAttribute('aria-label'));
      if (!hasChoices) return;
      const heading = item.querySelector('h1, h2, h3, h4, .title, [class*="title"], [class*="text"], [class*="question"]');
      let qText = visibleText(heading);
      if (!qText || qText.length < 8) {
        qText = visibleText(item).split(/\n/).map(p => p.trim()).find(p => p.length > 8) || '';
      }
      if (!qText || qText.length < 8 || qText.length > 500) return;
      const options = [];
      Array.from(item.querySelectorAll('label, button, .answer, [class*="answer"], [class*="option"]')).forEach(optNode => {
        let text = visibleText(optNode);
        text = text.replace(qText, '').replace(/^[A-DА-Г][).:\s-]*/i, '').trim();
        if (text && text.length < 260 && !options.some(o => o.text === text)) {
          options.push({ text, element: optNode });
        }
      });
      if (options.length >= 2 && !questions.some(q => q.text === qText)) {
        questions.push({ text: qText, options, imageSources: collectImageSources(item), container: item });
      }
    });

    if (questions.length) return questions.slice(0, 60);
    return getNaurokScreenQuestion();
  }

  function getNaurokScreenQuestion() {
    const blocks = visibleTextBlocks()
      .filter(b => !/Tampermonkey|AI Test Helper|Скрипт|QR|штрих-код|Подробнее/i.test(b.text));

    const qCandidates = blocks.filter(b => {
      const t = b.text;
      if (t.length < 6 || t.length > 260) return false;
      if (/^\d+\s*\/\s*\d+$/.test(t)) return false;
      if (/^(всього|всего|бал|score|next|skip)$/i.test(t)) return false;
      return b.rect.top < window.innerHeight * 0.75;
    }).map(b => {
      let score = Math.min(b.text.length, 80);
      if (/[?=]/.test(b.text)) score += 80;
      if (/[+\-−*/÷]/.test(b.text)) score += 35;
      if (/(виконай|обчисли|укажи|знайди|скільки|який|яка|яке|що|де|коли)/i.test(b.text)) score += 35;
      if (b.rect.width > 200) score += 15;
      return Object.assign({ score }, b);
    }).sort((a, b) => b.score - a.score);

    const qBlock = qCandidates[0];
    if (!qBlock) return [];

    const optBlocks = blocks.filter(b => {
      const t = b.text.trim();
      if (!t || t === qBlock.text) return false;
      if (t.length > 120) return false;
      if (/^\d+\s*\/\s*\d+$/.test(t)) return false;
      if (b.rect.top < qBlock.rect.bottom + 20) return false;
      if (/(увімк|включ|подробнее|tampermonkey|helper|scan|analyze|debug)/i.test(t)) return false;
      return true;
    }).map(b => {
      let score = 0;
      if (/^[-−]?\d+([,.]\d+)?$/.test(b.text.trim())) score += 80;
      if (/^[A-DА-Г][).:\s-]/i.test(b.text.trim())) score += 50;
      if (b.rect.width > 60 && b.rect.height > 20) score += 20;
      score -= Math.abs(b.rect.top - qBlock.rect.top) / 100;
      return Object.assign({ score }, b);
    }).sort((a, b) => b.score - a.score);

    const options = [];
    optBlocks.forEach(b => {
      let text = b.text.trim().replace(/^[A-DА-Г][).:\s-]*/i, '').trim();
      if (!text || options.some(o => o.text === text)) return;
      options.push({ text, element: b.element });
    });

    if (options.length < 2) return [];
    return [{ text: qBlock.text, options: options.slice(0, 6), imageSources: collectImageSources(document.body) }];
  }

  function getGenericQuestions() {
    const questions = [];
    Array.from(document.querySelectorAll('fieldset, article, section, li, div')).forEach(item => {
      if (item.closest('#ath-panel')) return;
      const inputs = item.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (!inputs.length) return;
      const text = visibleText(item);
      if (text.length < 12 || text.length > 1200) return;
      const qText = text.split(/\n/).map(p => p.trim()).find(p => p.length > 8) || text.slice(0, 220);
      const options = [];
      inputs.forEach(inp => {
        const label = (inp.labels && inp.labels[0]) || inp.closest('label') || inp.parentElement;
        const optText = visibleText(label).replace(qText, '').trim();
        if (optText && !options.some(o => o.text === optText)) options.push({ text: optText, element: inp });
      });
      if (options.length >= 2 && !questions.some(q => q.text === qText)) {
        questions.push({ text: qText, options, imageSources: collectImageSources(item), container: item });
      }
    });
    return questions.slice(0, 60);
  }

  function renderDetectedQuestions(questions) {
    const results = document.getElementById('ath-results');
    clear(results);
    if (!questions.length) {
      results.appendChild(make('div', { className: 'ath-card ath-muted' }, 'No detected questions yet.'));
      return;
    }
    questions.forEach((q, i) => {
      const card = make('div', { className: 'ath-card' });
      card.appendChild(make('div', {}, (i + 1) + '. ' + q.text));
      q.options.forEach((opt, oi) => {
        card.appendChild(make('div', { className: 'ath-option' }, String.fromCharCode(65 + oi) + ') ' + opt.text));
      });
      results.appendChild(card);
    });
  }

  // ─── Prompt & API ─────────────────────────────────────────────────────────
  function buildPrompt(questions, offset) {
    const lang = { auto: 'the same language as the question', uk: 'Ukrainian', ru: 'Russian', en: 'English' }[config.language || 'auto'];
    const startIndex = Number(offset) || 0;
    const list = questions.map((q, i) => {
      const opts = q.options.length
        ? q.options.map((o, oi) => String.fromCharCode(65 + oi) + ') ' + o.text).join('\n')
        : 'Open-ended question';
      return 'Q' + (startIndex + i + 1) + ': ' + q.text + '\n' + opts;
    }).join('\n\n');

    const exampleArr = '[{"qIndex":1,"correctOptions":["A"],"answerText":"","explanation":"reason","confidence":0.9}]';
    return [
      'You are a study assistant. Answer in ' + lang + '.',
      '',
      'OUTPUT ONLY a raw JSON array (no markdown, no code fences, no extra text):',
      exampleArr,
      '',
      'JSON object fields:',
      '  "qIndex": integer (must match Q number exactly)',
      '  "correctOptions": array of letter strings like ["A"] or ["B","C"]; use [] for open-ended',
      '  "answerText": string with answer for open-ended questions, else ""',
      '  "explanation": 1-2 sentence explanation in ' + lang,
      '  "confidence": float from 0.0 to 1.0',
      '',
      'IMPORTANT: treat all math symbols literally. Do NOT ignore minus signs or negative numbers.',
      'Use only double quotes in JSON. Escape inner double quotes as \\". No trailing commas.',
      '',
      'Questions:',
      list,
    ].join('\n');
  }

  function parseJson(text) {
    // Strip markdown fences
    let clean = String(text || '')
      .replace(/```json[\s\S]*?```/gi, s => s.replace(/```json/gi, '').replace(/```/g, ''))
      .replace(/```/g, '')
      .trim();

    // Try direct parse first
    try { return JSON.parse(clean); } catch (_) {}

    // Try extracting array
    const arrStart = clean.indexOf('[');
    const arrEnd = clean.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      try { return JSON.parse(clean.slice(arrStart, arrEnd + 1)); } catch (_) {}
    }

    // Extract individual JSON objects using brace-counting (handles broken arrays)
    const objects = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (clean[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            const obj = JSON.parse(clean.slice(start, i + 1));
            if (obj && typeof obj.qIndex !== 'undefined') objects.push(obj);
          } catch (_) {
            // Try to salvage with basic key extraction
            const fragment = clean.slice(start, i + 1);
            const salvaged = salvageObject(fragment);
            if (salvaged) objects.push(salvaged);
          }
          start = -1;
        }
      }
    }
    if (objects.length > 0) return objects;

    throw new Error('Gemini returned invalid JSON. Preview: ' + clean.slice(0, 200));
  }

  // Last-resort: extract known keys from a broken JSON object string
  function salvageObject(fragment) {
    try {
      const get = (key, isArray) => {
        if (isArray) {
          const m = fragment.match(new RegExp('"' + key + '"\\s*:\\s*(\\[[^\\]]*\\])'));
          if (m) { try { return JSON.parse(m[1]); } catch (_) {} }
          return [];
        }
        const m = fragment.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
        return m ? m[1] : '';
      };
      const getNum = key => {
        const m = fragment.match(new RegExp('"' + key + '"\\s*:\\s*([0-9.]+)'));
        return m ? parseFloat(m[1]) : undefined;
      };
      const qIndex = getNum('qIndex');
      if (!qIndex) return null;
      return {
        qIndex,
        correctOptions: get('correctOptions', true),
        answerText: get('answerText'),
        explanation: get('explanation'),
        confidence: getNum('confidence') || 0.5,
      };
    } catch (_) { return null; }
  }

  function callGeminiParts(parts) {
    if (!config.apiKey) throw new Error('API key missing. Open ⚙️ Setup and save it.');
    const preferred = config.model || 'gemini-2.5-flash-lite';
    const models = [preferred].concat(FALLBACK_MODELS.filter(m => m !== preferred));
    return callGeminiWithFallback(parts, models, []);
  }

  function callGeminiWithFallback(parts, models, errors) {
    const current = models[0];
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(current) + ':generateContent?key=' + encodeURIComponent(config.apiKey),
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
        }),
        timeout: 60000,
        onload(res) {
          try {
            const data = JSON.parse(res.responseText || '{}');
            if (res.status < 200 || res.status >= 300) {
              const msg = (data.error && data.error.message) ? data.error.message : 'HTTP ' + res.status;
              const retry = res.status === 429 || res.status === 503 || /quota|overload|try again/i.test(msg);
              if (retry && models.length > 1) {
                setStatus(current + ' busy → trying ' + models[1] + '…', 'info');
                callGeminiWithFallback(parts, models.slice(1), errors.concat(current + ': ' + msg)).then(resolve, reject);
                return;
              }
              reject(new Error(errors.concat(current + ': ' + msg).join(' | ')));
              return;
            }
            const rParts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
            const text = Array.isArray(rParts) ? rParts.map(p => p.text || '').join('\n') : '';
            if (!text) { reject(new Error('Gemini returned empty response.')); return; }
            const parsed = parseJson(text);
            resolve(Array.isArray(parsed) ? parsed : [parsed]);
          } catch (err) { reject(err); }
        },
        onerror() {
          if (models.length > 1) {
            setStatus(current + ' network error → trying ' + models[1] + '…', 'info');
            callGeminiWithFallback(parts, models.slice(1), errors.concat(current + ': network error')).then(resolve, reject);
            return;
          }
          reject(new Error(errors.concat(current + ': network error').join(' | ')));
        },
        ontimeout() { reject(new Error('Request timed out.')); },
      });
    });
  }

  function fetchImageInlineData(url) {
    if (url.startsWith('data:image/')) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return Promise.reject(new Error('Bad data image URL'));
      return Promise.resolve({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob', timeout: 20000,
        onload(res) {
          if (res.status < 200 || res.status >= 300 || !res.response) { reject(new Error('Image HTTP ' + res.status)); return; }
          const reader = new FileReader();
          reader.onload = () => {
            const du = String(reader.result || ''); const comma = du.indexOf(',');
            if (comma === -1) { reject(new Error('Bad image data')); return; }
            resolve({ inlineData: { mimeType: res.response.type || 'image/png', data: du.slice(comma + 1) } });
          };
          reader.onerror = () => reject(new Error('Could not read image'));
          reader.readAsDataURL(res.response);
        },
        onerror() { reject(new Error('Image download failed')); },
        ontimeout() { reject(new Error('Image timeout')); },
      });
    });
  }

  async function buildBatchParts(chunk, start) {
    const parts = [{ text: buildPrompt(chunk, start) }];
    const jobs = [];
    chunk.forEach((q, qi) => {
      (q.imageSources || []).slice(0, 2).forEach(src => {
        if (jobs.length < 8) jobs.push({ src, qNum: start + qi + 1 });
      });
    });
    for (const job of jobs) {
      try {
        parts.push({ text: 'Image for Q' + job.qNum + ':' });
        parts.push(await fetchImageInlineData(job.src));
      } catch (err) { console.warn('[AI Test Helper image skipped]', job.src, err); }
    }
    return parts;
  }

  // ─── Caching-aware batch analysis ─────────────────────────────────────────
  async function analyzeQuestionBatches(questions) {
    const allAnswers = [];
    const toFetch = []; // { question, originalIndex }

    // Serve from cache first
    questions.forEach((q, i) => {
      const cached = getCached(q.text);
      if (cached) {
        allAnswers.push(Object.assign({}, cached, { qIndex: i + 1, _cached: true }));
      } else {
        toFetch.push({ question: q, originalIndex: i });
      }
    });

    if (toFetch.length) {
      const chunkSize = 5;
      const qs = toFetch.map(t => t.question);
      for (let i = 0; i < qs.length; i += chunkSize) {
        const chunk = qs.slice(i, i + chunkSize);
        const total = Math.ceil(qs.length / chunkSize);
        const cur = Math.floor(i / chunkSize) + 1;
        setStatus('Analyzing batch ' + cur + '/' + total + ' (' + (allAnswers.filter(a => a._cached).length) + ' from cache)…', 'info');
        const parts = await buildBatchParts(chunk, i);
        const chunkAnswers = await callGeminiParts(parts);
        chunkAnswers.forEach((ans, ci) => {
          const origIdx = toFetch[i + ci] ? toFetch[i + ci].originalIndex : i + ci;
          const correctedAns = Object.assign({}, ans, { qIndex: origIdx + 1 });
          allAnswers.push(correctedAns);
          // Save to cache
          const qText = qs[i + ci] && qs[i + ci].text;
          if (qText) setCached(qText, { correctOptions: ans.correctOptions, answerText: ans.answerText, explanation: ans.explanation, confidence: ans.confidence });
        });
      }
    }

    // Update cache count badge
    document.getElementById('ath-cache-count').textContent = String(Object.keys(answerCache).length);

    return allAnswers.sort((a, b) => (Number(a.qIndex) || 0) - (Number(b.qIndex) || 0));
  }

  // ─── Auto-select ──────────────────────────────────────────────────────────
  function doAutoSelect() {
    if (!lastQuestions.length) return;

    // Collect answers we have (from rendered cards)
    const results = document.getElementById('ath-results');
    if (!results) return;
    const cards = Array.from(results.querySelectorAll('.ath-card'));
    let selected = 0;

    cards.forEach((card, ci) => {
      const q = lastQuestions[ci];
      if (!q) return;
      const correctOptions = Array.from(card.querySelectorAll('.ath-option.correct'))
        .map(el => {
          const match = el.textContent.match(/^([A-Z])\)/);
          return match ? match[1] : null;
        }).filter(Boolean);
      if (!correctOptions.length) return;

      correctOptions.forEach(letter => {
        const optIdx = letter.charCodeAt(0) - 65;
        const opt = q.options[optIdx];
        if (!opt) return;

        // Try clicking the element stored in option
        if (opt.element) {
          try {
            opt.element.click();
            selected++;
            return;
          } catch (_) {}
        }

        // Fallback: find by text
        const allInputs = Array.from(document.querySelectorAll(
          'input[type="radio"], input[type="checkbox"], label, button, [role="radio"], [role="checkbox"]'
        )).filter(el => !el.closest('#ath-panel'));
        const match = allInputs.find(el => visibleText(el).includes(opt.text));
        if (match) { match.click(); selected++; }
      });
    });

    setStatus(selected ? '⚡ Auto-selected ' + selected + ' answer(s)!' : 'Could not auto-select (no clickable elements found).', selected ? 'ok' : 'err');
  }

  // ─── Analyze ──────────────────────────────────────────────────────────────
  async function analyze() {
    openPanel('main');
    const btn = document.getElementById('ath-analyze');
    const questions = lastQuestions.length ? lastQuestions : scan();
    if (!questions.length) {
      setStatus('No questions found. Scroll the form so questions are visible, then Scan.', 'err');
      return;
    }
    btn.disabled = true;
    setStatus('Sending ' + questions.length + ' question(s) to Gemini…', 'info');
    try {
      const answers = await analyzeQuestionBatches(questions);
      renderAnswers(questions, answers);
      const cachedCount = answers.filter(a => a._cached).length;
      setStatus('✅ Done! ' + answers.length + ' answers (' + cachedCount + ' from cache)', 'ok');
      switchTab('answers');
      if (config.autoSelect) doAutoSelect();
    } catch (err) {
      setStatus(err.message, 'err');
      console.error('[AI Test Helper analyze error]', err);
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Render answers ───────────────────────────────────────────────────────
  function normalizeLetters(ans) {
    return (ans.correctOptions || []).map(v => String(v || '').trim().charAt(0).toUpperCase()).filter(Boolean);
  }

  function confidenceBadge(val) {
    const pct = Math.round((Number(val) || 0) * 100);
    if (!pct) return null;
    const cls = pct >= 80 ? 'ath-conf-high' : pct >= 55 ? 'ath-conf-mid' : 'ath-conf-low';
    const emoji = pct >= 80 ? '🟢' : pct >= 55 ? '🟡' : '🔴';
    return make('span', { className: 'ath-confidence ' + cls }, emoji + ' ' + pct + '% confident');
  }

  function renderAnswers(questions, answers) {
    const results = document.getElementById('ath-results');
    clear(results);
    answers.forEach(ans => {
      const q = questions[(Number(ans.qIndex) || 1) - 1];
      if (!q) return;
      const letters = normalizeLetters(ans);
      const card = make('div', { className: 'ath-card' });

      const titleRow = make('div', {});
      titleRow.appendChild(document.createTextNode((ans.qIndex || '?') + '. ' + q.text));
      if (ans._cached) titleRow.appendChild(make('span', { className: 'ath-cached-badge' }, '📦 cached'));
      card.appendChild(titleRow);

      const summary = ans.answerText || letters.join(', ') || (ans.correctOptions || []).join(', ');
      if (summary) card.appendChild(make('div', { className: 'ath-answer' }, '✅ ' + summary));

      q.options.forEach((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        card.appendChild(make('div', { className: 'ath-option' + (letters.includes(letter) ? ' correct' : '') }, letter + ') ' + opt.text));
      });

      const badge = confidenceBadge(ans.confidence);
      if (badge) card.appendChild(badge);
      if (ans.explanation) card.appendChild(make('div', { className: 'ath-explain' }, '💡 ' + ans.explanation));
      results.appendChild(card);
    });
    if (!answers.length) results.appendChild(make('div', { className: 'ath-card ath-muted' }, 'No answers returned.'));
  }

  // ─── Auto-mode engine ─────────────────────────────────────────────────────

  function questionFingerprint(questions) {
    return questions.map(q => q.text.slice(0, 60)).join('|');
  }

  function setAutoModeUI(active, statusText) {
    const row = document.getElementById('ath-automode-row');
    const label = document.getElementById('ath-automode-label');
    if (row) row.classList.toggle('active', active);
    if (label) label.textContent = active ? '🤖 Auto-mode: ON — ' + (statusText || 'watching…') : '🤖 Auto-mode: OFF';
  }

  async function autoModeTick() {
    if (autoModeBusy) return;
    if (!config.apiKey) { setAutoModeUI(true, '⚠️ No API key!'); return; }

    const questions = getPageQuestions();
    if (!questions.length) return;

    const fp = questionFingerprint(questions);
    if (fp === lastQuestionFingerprint) return; // same page, nothing new

    lastQuestionFingerprint = fp;
    lastQuestions = questions;
    document.getElementById('ath-count').textContent = String(questions.length);

    autoModeBusy = true;
    setAutoModeUI(true, 'analyzing…');

    try {
      const answers = await analyzeQuestionBatches(questions);
      renderAnswers(questions, answers);
      const cachedCount = answers.filter(a => a._cached).length;
      setStatus('🤖 Auto: ' + answers.length + ' answers (' + cachedCount + ' cached)', 'ok');
      setAutoModeUI(true, 'done ✓');
      // Always auto-select in auto-mode
      doAutoSelectFromAnswers(questions, answers);
    } catch (err) {
      setStatus('Auto-mode error: ' + err.message, 'err');
      setAutoModeUI(true, '⚠️ error');
      console.error('[AI Test Helper auto-mode error]', err);
    } finally {
      autoModeBusy = false;
      // Reset label back to watching after a few seconds
      setTimeout(() => { if (config.autoMode) setAutoModeUI(true, 'watching…'); }, 4000);
    }
  }

  function startAutoMode() {
    stopAutoMode(); // clear any existing
    setAutoModeUI(true, 'watching…');

    // Run immediately on first start
    setTimeout(autoModeTick, 800);

    // Watch DOM for new questions appearing (Naurok loads next question dynamically)
    autoModeObserver = new MutationObserver(() => {
      clearTimeout(autoModeTimer);
      // Debounce: wait 600ms after last DOM change before triggering
      autoModeTimer = setTimeout(autoModeTick, 600);
    });

    autoModeObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false,
      attributes: false,
    });

    console.info('[AI Test Helper] Auto-mode started');
  }

  function stopAutoMode() {
    if (autoModeObserver) { autoModeObserver.disconnect(); autoModeObserver = null; }
    clearTimeout(autoModeTimer);
    autoModeBusy = false;
    lastQuestionFingerprint = '';
    setAutoModeUI(false);
    console.info('[AI Test Helper] Auto-mode stopped');
  }

  // Variant of doAutoSelect that works directly from answers array (no DOM card parsing needed)
  function doAutoSelectFromAnswers(questions, answers) {
    let selected = 0;
    answers.forEach(ans => {
      const q = questions[(Number(ans.qIndex) || 1) - 1];
      if (!q) return;
      const letters = normalizeLetters(ans);
      if (!letters.length) return;

      letters.forEach(letter => {
        const optIdx = letter.charCodeAt(0) - 65;
        const opt = q.options[optIdx];
        if (!opt) return;

        // Try stored element reference first
        if (opt.element) {
          try { opt.element.click(); selected++; return; } catch (_) {}
        }

        // Fallback: search DOM by text
        const allInputs = Array.from(document.querySelectorAll(
          'input[type="radio"], input[type="checkbox"], label, button, [role="radio"], [role="checkbox"]'
        )).filter(el => !el.closest('#ath-panel'));
        const match = allInputs.find(el => visibleText(el).includes(opt.text));
        if (match) { match.click(); selected++; }
      });
    });
    if (selected) setStatus('⚡ Auto-selected ' + selected + ' answer(s)', 'ok');
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  try {
    buildUI();
    setTimeout(scan, 1500);
    if (config.autoMode) setTimeout(startAutoMode, 2000);
  } catch (err) {
    console.error('[AI Test Helper init error]', err);
    alert('AI Test Helper init error: ' + err.message);
  }
})();