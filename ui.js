// MotionMuse — UI script (source).
// Bundled into ui.html by build.py. The animation library is injected as
// window.__ANIMATIONS__ at the top of the inlined script.

const STATE = {
  selection: null,
  detected: null,
  selectionCount: 0,
  userOverroteElement: false,
  animations: [],
  lastQuery: null
};

// Track CSS animation loops so we can stop them when leaving the results view.
const PREVIEW_INTERVALS = new Set();

const EL = {};

// Boot.
function init() {
  cacheDom();
  STATE.animations = (typeof window !== 'undefined' && Array.isArray(window.__ANIMATIONS__))
    ? window.__ANIMATIONS__
    : [];
  renderEmptySelection();
  bindEvents();
  [EL.industry, EL.personality, EL.element].forEach(syncEmpty);
  validateForm();
}

function cacheDom() {
  EL.viewSearch     = document.getElementById('view-search');
  EL.viewResults    = document.getElementById('view-results');
  EL.industry       = document.getElementById('industry');
  EL.personality    = document.getElementById('personality');
  EL.element        = document.getElementById('element');
  EL.suggestBtn     = document.getElementById('suggestBtn');
  EL.formError      = document.getElementById('formError');
  EL.backBtn        = document.getElementById('backBtn');
  EL.resultsList    = document.getElementById('resultsList');
  EL.resultsContext = document.getElementById('resultsContext');
  EL.emptyResults   = document.getElementById('emptyResults');
  EL.alternatives   = document.getElementById('alternativesList');
  EL.selectionArea  = document.getElementById('selection-area');
  EL.toast          = document.getElementById('toast');
  EL.toastMsg       = document.getElementById('toastMsg');
}

function bindEvents() {
  EL.industry.addEventListener('change',    function () { syncEmpty(EL.industry);    validateForm(); });
  EL.personality.addEventListener('change', function () { syncEmpty(EL.personality); validateForm(); });
  EL.element.addEventListener('change',     function () {
    syncEmpty(EL.element);
    STATE.userOverroteElement = !!EL.element.value && EL.element.value !== STATE.detected;
    validateForm();
  });
  EL.suggestBtn.addEventListener('click', onSuggest);
  EL.backBtn.addEventListener('click', showSearchView);
  window.addEventListener('message', onFigmaMessage);
}

function syncEmpty(sel) {
  if (!sel) return;
  if (sel.value) sel.classList.remove('is-empty');
  else sel.classList.add('is-empty');
}

function onFigmaMessage(event) {
  const msg = event.data && event.data.pluginMessage;
  if (!msg) return;
  if (msg.type === 'selection') applySelection(msg);
  else if (msg.type === 'apply-result') onApplyResult(msg);
}

function applySelection(msg) {
  STATE.selectionCount = msg.count || 0;
  if (msg.empty) {
    STATE.selection = null;
    STATE.detected = null;
    renderEmptySelection();
    if (!STATE.userOverroteElement) { EL.element.value = ''; syncEmpty(EL.element); }
  } else {
    STATE.selection = msg;
    STATE.detected = msg.detected;
    renderSelectionPill(msg);
    if (!STATE.userOverroteElement) { EL.element.value = msg.detected; syncEmpty(EL.element); }
  }
  validateForm();
  // Keep already-rendered Apply buttons in sync with current selection state.
  refreshApplyButtons();
}

const PILL_EMOJI = {
  'Button': '🔘', 'Card': '🃏', 'Modal': '🪟',
  'Input field': '📝', 'Icon': '⭐', 'Image / Hero': '🖼️'
};

function renderSelectionPill(msg) {
  const emoji = PILL_EMOJI[msg.detected] || '🎯';
  const extra = (msg.count && msg.count > 1) ? (' (×' + msg.count + ')') : '';
  EL.selectionArea.innerHTML =
    '<span class="selection-pill" data-testid="selection-pill">' +
      '<span class="pill-emoji" aria-hidden="true">' + emoji + '</span>' +
      '<span>Detected a <strong>' + escapeHtml(msg.detected) + '</strong>' + escapeHtml(extra) + '</span>' +
    '</span>';
}

function renderEmptySelection() {
  EL.selectionArea.innerHTML =
    '<div class="empty-selection" data-testid="empty-selection">' +
      '<span class="empty-emoji" aria-hidden="true">🎬</span>' +
      '<h3>Pick a layer to begin</h3>' +
      '<p>Select any layer in your file, then come back.</p>' +
    '</div>';
}

function validateForm() {
  const ok = !!EL.industry.value && !!EL.personality.value && !!EL.element.value;
  EL.suggestBtn.disabled = !ok;
  if (ok) EL.formError.hidden = true;
}

function scoreAnimation(anim, element, industry, personality) {
  const elementMatch  = (anim.elementTypes  || []).indexOf(element)  !== -1;
  const industryMatch = (anim.industries    || []).indexOf(industry) !== -1;
  if (!elementMatch || !industryMatch) return -1;
  let score = 10;
  if ((anim.personalities || []).indexOf(personality) !== -1) score += 5;
  return score;
}

function looseScore(anim, element, industry, personality) {
  let score = 0;
  if ((anim.elementTypes  || []).indexOf(element)     !== -1) score += 6;
  if ((anim.industries    || []).indexOf(industry)    !== -1) score += 4;
  if ((anim.personalities || []).indexOf(personality) !== -1) score += 3;
  return score;
}

function onSuggest() {
  const element     = EL.element.value;
  const industry    = EL.industry.value;
  const personality = EL.personality.value;
  if (!element || !industry || !personality) {
    EL.formError.hidden = false;
    EL.formError.textContent = 'Pick element type, industry, and vibe first.';
    return;
  }
  EL.suggestBtn.classList.add('is-shimmer');
  setTimeout(function () { EL.suggestBtn.classList.remove('is-shimmer'); }, 700);

  const top = STATE.animations
    .map(function (a) { return { anim: a, score: scoreAnimation(a, element, industry, personality) }; })
    .filter(function (s) { return s.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 3)
    .map(function (s) { return s.anim; });

  STATE.lastQuery = { element: element, industry: industry, personality: personality };
  showResultsView(top, STATE.lastQuery);
}

function showResultsView(results, ctx) {
  clearAllPreviewLoops();
  EL.viewSearch.hidden = true;
  EL.viewResults.hidden = false;
  EL.resultsContext.innerHTML =
    '<strong>' + escapeHtml(ctx.element) + '</strong> · ' +
    '<strong>' + escapeHtml(ctx.industry) + '</strong> · ' +
    '<strong>' + escapeHtml(ctx.personality) + '</strong>';

  EL.resultsList.innerHTML = '';
  if (results.length === 0) {
    renderEmptyState(ctx);
    return;
  }
  EL.emptyResults.hidden = true;
  results.forEach(function (anim, i) {
    const card = renderCard(anim, ctx.element);
    card.style.animationDelay = (i * 60) + 'ms';
    EL.resultsList.appendChild(card);
  });
}

function renderEmptyState(ctx) {
  EL.emptyResults.hidden = false;
  EL.alternatives.innerHTML = '';
  const alts = STATE.animations
    .map(function (a) { return { anim: a, score: looseScore(a, ctx.element, ctx.industry, ctx.personality) }; })
    .filter(function (s) { return s.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 3);
  alts.forEach(function (s, i) {
    const card = renderCard(s.anim, ctx.element);
    card.style.animationDelay = (i * 60) + 'ms';
    EL.alternatives.appendChild(card);
  });
}

// =====================================================================
// Result card with live preview + 3 action buttons
// =====================================================================
function renderCard(anim, elementType) {
  const motion = classifyMotion(anim);
  const easing = safeEasing(anim.easing);
  const duration = anim.duration || 300;

  const card = document.createElement('article');
  card.className = 'result-card';
  card.setAttribute('data-testid', 'result-card-' + anim.id);

  // Preview
  const preview = document.createElement('div');
  preview.className = 'card-preview';

  const stage = document.createElement('div');
  stage.className = 'preview-stage';
  const demo = makeDemo(elementType);
  demo.classList.add('mm-demo');
  stage.appendChild(demo);

  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'replay-btn';
  replay.title = 'Replay';
  replay.setAttribute('aria-label', 'Replay animation');
  replay.setAttribute('data-testid', 'replay-' + anim.id);
  replay.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="23 4 23 10 17 10"></polyline>' +
      '<path d="M20.49 15A9 9 0 1 1 18.36 6.64L23 10"></path>' +
    '</svg>';

  preview.appendChild(stage);
  preview.appendChild(replay);

  // Top: name
  const name = document.createElement('h3');
  name.className = 'card-name';
  name.textContent = anim.name;

  // Rationale
  const rationale = document.createElement('p');
  rationale.className = 'card-rationale';
  rationale.textContent = anim.rationale;

  // Meta chips
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const dur = document.createElement('span');
  dur.className = 'card-chip';
  dur.textContent = duration + 'ms';
  const ease = document.createElement('span');
  ease.className = 'card-chip';
  ease.textContent = anim.easing;
  meta.appendChild(dur);
  meta.appendChild(ease);
  if (anim.lottieHint) {
    const hint = document.createElement('span');
    hint.className = 'card-chip chip-hint';
    hint.textContent = anim.lottieHint;
    meta.appendChild(hint);
  }

  // Actions: 3 buttons stacked
  const actions = document.createElement('div');
  actions.className = 'card-actions card-actions-stack';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'btn-act btn-act-primary apply-btn';
  applyBtn.setAttribute('data-testid', 'apply-' + anim.id);
  applyBtn.innerHTML = '<span class="apply-spark" aria-hidden="true">✨</span><span>Apply to selection</span>';
  applyBtn.addEventListener('click', function () { onApplyClick(anim, motion, applyBtn); });
  syncApplyButton(applyBtn);

  const cssBtn = document.createElement('button');
  cssBtn.type = 'button';
  cssBtn.className = 'btn-act btn-act-secondary';
  cssBtn.textContent = 'Copy CSS';
  cssBtn.setAttribute('data-testid', 'copy-css-' + anim.id);
  cssBtn.addEventListener('click', function () { copy(anim.cssCode, 'Copied. Paste it wherever you need.'); });

  const fmBtn = document.createElement('button');
  fmBtn.type = 'button';
  fmBtn.className = 'btn-act btn-act-secondary';
  fmBtn.textContent = 'Copy Framer Motion';
  fmBtn.setAttribute('data-testid', 'copy-fm-' + anim.id);
  fmBtn.addEventListener('click', function () { copy(anim.framerMotionCode, 'Copied. Paste it wherever you need.'); });

  actions.appendChild(applyBtn);
  actions.appendChild(cssBtn);
  actions.appendChild(fmBtn);

  card.appendChild(preview);
  card.appendChild(name);
  card.appendChild(rationale);
  card.appendChild(meta);
  card.appendChild(actions);

  // Start the looping preview (and wire up replay).
  startPreviewLoop(demo, motion, duration, easing, replay);

  return card;
}

// Pick a demo element for a given element type.
function makeDemo(elementType) {
  const wrap = document.createElement('div');
  wrap.className = 'demo demo-' + slug(elementType);
  switch (elementType) {
    case 'Button':
      wrap.textContent = 'Tap me';
      break;
    case 'Card':
      wrap.innerHTML = '<span class="demo-card-bar"></span><span class="demo-card-bar short"></span><span class="demo-card-bar tiny"></span>';
      break;
    case 'Modal':
      wrap.innerHTML = '<span class="demo-modal-title"></span><span class="demo-modal-line"></span><span class="demo-modal-line short"></span><span class="demo-modal-actions"></span>';
      break;
    case 'Input field':
      wrap.innerHTML = '<span class="demo-input-text">Type here…</span><span class="demo-input-caret"></span>';
      break;
    case 'Icon':
      wrap.textContent = '⭐';
      break;
    case 'Image / Hero':
      wrap.innerHTML = '<span class="demo-image-pin"></span>';
      break;
  }
  return wrap;
}

// =====================================================================
// Live preview: classify -> CSS keyframe preset -> auto-loop + replay
// =====================================================================
function classifyMotion(anim) {
  const id = (anim.id || '').toLowerCase();
  if (id.indexOf('shake') !== -1) return 'shake';
  if (id.indexOf('shimmer') !== -1 || id.indexOf('glint') !== -1) return 'shimmer';
  if (id.indexOf('pulse') !== -1 || id.indexOf('heartbeat') !== -1) return 'pulse';
  if (id.indexOf('bounce') !== -1 || id.indexOf('pop') !== -1 || id.indexOf('burst') !== -1 || id.indexOf('cheer') !== -1) return 'bounce';
  if (id.indexOf('rotate') !== -1 || id.indexOf('spin') !== -1) return 'rotate';
  if (id.indexOf('tilt') !== -1 || id.indexOf('wiggle') !== -1) return 'rotate';
  if (id.indexOf('slide') !== -1) {
    if (id.indexOf('cart') !== -1 || id.indexOf('panel') !== -1) return 'slide-side';
    return 'slide-up';
  }
  if (id.indexOf('drawer') !== -1) return 'slide-up';
  if (id.indexOf('zoom') !== -1) return 'scale-up';
  if (id.indexOf('tap') !== -1 || id.indexOf('press') !== -1 || id.indexOf('click') !== -1) return 'scale-down';
  if (id.indexOf('lift') !== -1 || id.indexOf('hover') !== -1 || id.indexOf('magnetic') !== -1) return 'lift';
  if (id.indexOf('fade') !== -1 || id.indexOf('cross-fade') !== -1) return 'fade';
  if (id.indexOf('reveal') !== -1) return 'fade';
  if (id.indexOf('check') !== -1 || id.indexOf('verified') !== -1) return 'bounce';
  if (id.indexOf('xp-bar') !== -1 || id.indexOf('price-drop') !== -1 || id.indexOf('achievement') !== -1) return 'bounce';
  if (id.indexOf('toast') !== -1 || id.indexOf('toggle') !== -1 || id.indexOf('confirm') !== -1) return 'slide-up';
  if (id.indexOf('focus') !== -1 || id.indexOf('underline') !== -1 || id.indexOf('search-expand') !== -1) return 'pulse';
  if (id.indexOf('floating-label') !== -1 || id.indexOf('friendly') !== -1) return 'lift';
  if (id.indexOf('ken-burns') !== -1 || id.indexOf('parallax') !== -1) return 'scale-up';
  if (id.indexOf('balance') !== -1 || id.indexOf('sleek') !== -1) return 'fade';
  return 'scale-up';
}

// Some library entries use 'spring(...)' which isn't valid CSS — fall back.
function safeEasing(easing) {
  if (!easing) return 'cubic-bezier(0.4, 0, 0.2, 1)';
  if (/^\s*spring/i.test(easing)) return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  return easing;
}

// Drive the demo element with a CSS keyframe preset on a 2-second cycle.
function startPreviewLoop(demoEl, motionType, duration, easing, replayBtn) {
  const animValue = 'mm-' + motionType + ' ' + Math.max(duration, 320) + 'ms ' + easing + ' both';
  const cycleMs   = Math.max(duration + 1400, 2000);

  function play() {
    demoEl.style.animation = 'none';
    void demoEl.offsetWidth; // force reflow so the animation re-triggers
    demoEl.style.animation = animValue;
  }

  // Initial play after a small breath so the user sees the resting state first.
  const firstPlay = setTimeout(play, 500);
  const loopId = setInterval(play, cycleMs);
  PREVIEW_INTERVALS.add(loopId);
  PREVIEW_INTERVALS.add(firstPlay);

  if (replayBtn) {
    replayBtn.addEventListener('click', function () {
      play();
    });
  }
}

function clearAllPreviewLoops() {
  PREVIEW_INTERVALS.forEach(function (id) { clearTimeout(id); clearInterval(id); });
  PREVIEW_INTERVALS.clear();
}

// =====================================================================
// Apply to selection (Option B: tick animation on the canvas)
// =====================================================================
function onApplyClick(anim, motion, btn) {
  if (STATE.selectionCount === 0) return; // safety; button should be disabled
  if (btn.classList.contains('is-busy')) return;
  btn.classList.add('is-busy');
  parent.postMessage({
    pluginMessage: {
      type: 'apply-animation',
      animationId: anim.id,
      motionType: motion,
      duration: anim.duration,
      easing: anim.easing
    }
  }, '*');
  // Failsafe: clear busy state after 4s in case the sandbox never replies.
  setTimeout(function () { btn.classList.remove('is-busy'); }, 4000);
}

function onApplyResult(msg) {
  document.querySelectorAll('.apply-btn.is-busy').forEach(function (b) { b.classList.remove('is-busy'); });
  if (msg.ok) {
    showToast('Applied! Press Present (▶) and hover the frame to play.', 'success');
  } else if (msg.reason === 'no-selection') {
    showToast('Please select a layer first.', 'error');
  } else if (msg.reason === 'busy') {
    showToast('Hold on — still applying.', 'error');
  } else if (msg.error) {
    showToast('Could not apply: ' + String(msg.error).slice(0, 140), 'error');
  } else {
    showToast('Could not apply animation.', 'error');
  }
}

// Reflect current selection state on every Apply button.
function refreshApplyButtons() {
  document.querySelectorAll('.apply-btn').forEach(syncApplyButton);
}

function syncApplyButton(btn) {
  const ok = STATE.selectionCount > 0;
  btn.disabled = !ok;
  if (ok) btn.removeAttribute('title');
  else btn.title = 'Select a layer in Figma first';
}

// =====================================================================
// Clipboard + toast + view switching + helpers
// =====================================================================
function copy(text, toastMsg) {
  const value = String(text || '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(
      function () { showToast(toastMsg || 'Copied.'); },
      function () { fallbackCopy(value, toastMsg); }
    );
  } else {
    fallbackCopy(value, toastMsg);
  }
}

function fallbackCopy(value, toastMsg) {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast(toastMsg || 'Copied.'); }
  catch (e) { showToast('Copy failed.'); }
  document.body.removeChild(ta);
}

// SVG icons used by the two toast variants. Inlined so we can hot-swap on demand.
const TOAST_SUCCESS_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const TOAST_ERROR_SVG   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="13"></line><line x1="12" y1="16.5" x2="12.01" y2="16.5"></line></svg>';

let toastTimer = null;
function showToast(msg, variant) {
  const isError = variant === 'error';
  EL.toastMsg.textContent = msg;
  EL.toast.classList.toggle('is-error', isError);
  const iconEl = document.getElementById('toastIcon');
  if (iconEl) iconEl.innerHTML = isError ? TOAST_ERROR_SVG : TOAST_SUCCESS_SVG;
  EL.toast.removeAttribute('hidden');
  void EL.toast.offsetWidth;
  EL.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { EL.toast.classList.remove('show'); }, isError ? 3200 : 2200);
}

function showSearchView() {
  clearAllPreviewLoops();
  EL.viewResults.hidden = true;
  EL.viewSearch.hidden = false;
  EL.emptyResults.hidden = true;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
