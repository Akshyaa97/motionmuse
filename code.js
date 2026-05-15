// MotionMuse — Figma sandbox.
// Reads selection, sends to UI, and applies animations as Smart Animate
// prototype connections (Option A: clone + reaction + prototypeStartNode).

const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 720;
const FRAME_LIKE_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
const CLONE_OFFSET_X = 80;
const LOG = function () {
  // Always visible from `Plugins → Development → Open console` in Figma.
  const args = ['[MotionMuse]'];
  for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
  console.log.apply(console, args);
};
const ERR = function () {
  const args = ['[MotionMuse]'];
  for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
  console.error.apply(console, args);
};

// Heuristic mapping from a layer's name/type to one of MotionMuse's 6 element types.
function detectElementType(node) {
  const raw = (node && node.name ? node.name : '').toLowerCase();
  if (/\b(btn|button|cta)\b/.test(raw)) return 'Button';
  if (/\b(modal|dialog|popup|sheet|drawer)\b/.test(raw)) return 'Modal';
  if (/\b(input|field|textbox|text-?field|search)\b/.test(raw)) return 'Input field';
  if (/\b(icon|glyph)\b/.test(raw)) return 'Icon';
  if (/\b(hero|banner|cover|image|photo|picture|img)\b/.test(raw)) return 'Image / Hero';
  if (/\b(card|tile|item)\b/.test(raw)) return 'Card';
  if (node && node.type === 'TEXT') return 'Input field';
  if (node && (node.type === 'RECTANGLE' || node.type === 'ELLIPSE')) {
    if (node.width && node.height && node.width <= 64 && node.height <= 64) return 'Icon';
  }
  if (node && node.type === 'COMPONENT') return 'Button';
  return 'Card';
}

// Build a compact selection summary and post it to the UI.
function sendSelection() {
  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    figma.ui.postMessage({ type: 'selection', empty: true, count: 0 });
    return;
  }
  const node = selection[0];
  figma.ui.postMessage({
    type: 'selection',
    empty: false,
    name: node.name || 'Untitled',
    nodeType: node.type,
    detected: detectElementType(node),
    count: selection.length
  });
}

// Boot.
figma.showUI(__html__, { width: PANEL_WIDTH, height: PANEL_HEIGHT, themeColors: true });
figma.on('selectionchange', sendSelection);
sendSelection();

// Single-flight guard.
let isApplying = false;

// Handle all messages coming back from the UI.
figma.ui.onmessage = function (msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'close') {
    figma.closePlugin();
  } else if (msg.type === 'notify') {
    figma.notify(String(msg.text || 'MotionMuse'));
  } else if (msg.type === 'request-selection') {
    sendSelection();
  } else if (msg.type === 'apply-animation') {
    applyAnimation(msg).catch(function (err) {
      ERR('Apply unhandled error:', err);
      figma.ui.postMessage({
        type: 'apply-result',
        ok: false,
        reason: 'error',
        error: String(err && err.message || err)
      });
      isApplying = false;
    });
  }
};

// =====================================================================
// Apply animation — Smart Animate prototype (Option A)
// =====================================================================
async function applyAnimation(msg) {
  if (isApplying) {
    figma.ui.postMessage({ type: 'apply-result', ok: false, reason: 'busy' });
    return;
  }
  const sel = figma.currentPage.selection.slice();
  if (sel.length === 0) {
    LOG('Apply aborted: no selection');
    figma.ui.postMessage({ type: 'apply-result', ok: false, reason: 'no-selection' });
    return;
  }

  isApplying = true;
  LOG('Apply start →', {
    motion: msg.motionType,
    duration: msg.duration,
    easing: msg.easing,
    selectionCount: sel.length
  });

  try {
    let firstSourceFrame = null;
    let wrappedAny = false;

    let lastErr = null;
    for (let i = 0; i < sel.length; i++) {
      const node = sel[i];
      LOG('Node', i + 1, '→', node.name, '(' + node.type + ')');

      try {
        // Step (a): get a frame-like source. Wrap shapes in a Frame if needed.
        let source;
        if (FRAME_LIKE_TYPES.indexOf(node.type) !== -1) {
          source = node;
          LOG('  using existing frame-like node:', source.id);
        } else {
          source = wrapInFrame(node);
          wrappedAny = true;
          LOG('  wrapped node into new frame:', source.name, source.id);
        }

        // Step (b): clone the frame and place it as a sibling, offset to the right.
        const clone = source.clone();
        try { clone.name = source.name + ' — after'; } catch (e) {}
        const parent = source.parent;
        const idx = parent.children.indexOf(source);
        parent.insertChild(idx + 1, clone);
        clone.x = source.x + source.width + CLONE_OFFSET_X;
        clone.y = source.y;
        LOG('  cloned to:', { id: clone.id, x: clone.x, y: clone.y });

        // Step (c): mutate the clone so the prototype has something to animate.
        modifyCloneForMotion(clone, msg.motionType);
        LOG('  mutated clone for motion:', msg.motionType);

        // Step (d): wire up the Smart Animate reaction on the source.
        await setNodeReactions(source, [buildSmartAnimateReaction(clone.id, msg.duration, msg.easing)]);
        LOG('  reaction set successfully');

        if (!firstSourceFrame) firstSourceFrame = source;
      } catch (perNodeErr) {
        ERR('Node failed:', node.name, perNodeErr && (perNodeErr.message || perNodeErr));
        lastErr = perNodeErr;
        // Continue with the next node — partial success is better than total fail.
      }
    }
    if (!firstSourceFrame && lastErr) {
      // Nothing succeeded — propagate the most recent error so the UI can show it.
      throw lastErr;
    }

    // Step (e): make this frame the prototype start AND register it as a flow
    // starting point so pressing Present on the page picks it up.
    if (firstSourceFrame) {
      try {
        figma.currentPage.prototypeStartNode = firstSourceFrame;
        LOG('prototypeStartNode →', firstSourceFrame.id, firstSourceFrame.name);
      } catch (e) {
        ERR('prototypeStartNode failed:', e && e.message);
      }
      try {
        const existing = figma.currentPage.flowStartingPoints || [];
        const arr = Array.prototype.slice.call(existing);
        const already = arr.find(function (p) { return p && p.nodeId === firstSourceFrame.id; });
        if (!already) {
          const next = arr.concat([{ nodeId: firstSourceFrame.id, name: 'MotionMuse Preview' }]);
          if (typeof figma.currentPage.setFlowStartingPointsAsync === 'function') {
            await figma.currentPage.setFlowStartingPointsAsync(next);
            LOG('flowStartingPoints set via setFlowStartingPointsAsync ✓');
          } else {
            figma.currentPage.flowStartingPoints = next;
            LOG('flowStartingPoints set via direct assignment ✓');
          }
        } else {
          LOG('flowStartingPoints already contained this frame');
        }
      } catch (e) {
        ERR('flowStartingPoints failed:', e && e.message);
      }
      // Reselect + reveal so the user lands exactly on the source frame.
      try {
        figma.currentPage.selection = [firstSourceFrame];
        figma.viewport.scrollAndZoomIntoView([firstSourceFrame]);
      } catch (e) { /* non-fatal */ }
    }

    figma.ui.postMessage({
      type: 'apply-result',
      ok: true,
      count: sel.length,
      wrapped: wrappedAny
    });
    LOG('Apply complete ✓');
  } catch (err) {
    ERR('Apply failed:', err);
    figma.ui.postMessage({
      type: 'apply-result',
      ok: false,
      reason: 'error',
      error: String(err && err.message || err)
    });
  } finally {
    isApplying = false;
  }
}

// Wrap a non-frame node inside a brand-new Frame at the same parent + position.
// Works for shapes, text, vectors, lines, booleans, instances of components, etc.
function wrapInFrame(node) {
  const w = Math.max(Math.round(node.width  || 1), 1);
  const h = Math.max(Math.round(node.height || 1), 1);
  const frame = figma.createFrame();
  try { frame.name = (node.name || 'Element') + ' (MotionMuse)'; } catch (e) {}
  try { frame.x = node.x; frame.y = node.y; } catch (e) {}
  try { frame.resize(w, h); } catch (e) { ERR('  frame.resize failed:', e && e.message); }
  // Transparent shell — wrapped in try/catch because some Figma plugin API
  // versions throw on direct array assignment to readonly Paint[] properties.
  try { frame.fills = []; }   catch (e) { ERR('  fills clear failed:', e && e.message); }
  try { frame.strokes = []; } catch (e) { ERR('  strokes clear failed:', e && e.message); }
  try { frame.clipsContent = false; } catch (e) {}

  const parent = node.parent;
  if (!parent || typeof parent.insertChild !== 'function') {
    throw new Error('Parent (' + (parent && parent.type) + ') does not support insertChild — cannot wrap this layer.');
  }
  const idx = parent.children.indexOf(node);
  parent.insertChild(idx >= 0 ? idx : 0, frame);
  // Move the original node into the new frame, reset its local position.
  try { frame.appendChild(node); } catch (e) { ERR('  appendChild failed:', e && e.message); throw e; }
  try { node.x = 0; node.y = 0; } catch (e) {}
  return frame;
}

// Mutate the cloned frame to express the "after" state. Changes are intentionally
// pronounced so Smart Animate has plenty to interpolate.
function modifyCloneForMotion(clone, motion) {
  const m = String(motion || '').toLowerCase();
  try {
    switch (m) {
      case 'scale-up':
      case 'pulse':
        if (typeof clone.rescale === 'function') clone.rescale(1.15);
        break;
      case 'bounce':
        if (typeof clone.rescale === 'function') clone.rescale(1.20);
        break;
      case 'scale-down':
        if (typeof clone.rescale === 'function') clone.rescale(0.85);
        break;
      case 'fade':
        if ('opacity' in clone) clone.opacity = 0.20;
        break;
      case 'slide-up':
        clone.y -= 32;
        break;
      case 'slide-side':
        clone.x += 32; // additional horizontal travel beyond the layout offset
        break;
      case 'rotate':
        if ('rotation' in clone) clone.rotation = (clone.rotation || 0) + 20;
        break;
      case 'shake':
        clone.x += 24;
        break;
      case 'lift':
        clone.y -= 14;
        break;
      case 'shimmer':
        if (typeof clone.rescale === 'function') clone.rescale(1.06);
        if ('opacity' in clone) clone.opacity = Math.max(0.1, Math.min(1, (clone.opacity || 1) * 0.85));
        break;
      default:
        if (typeof clone.rescale === 'function') clone.rescale(1.10);
        break;
    }
  } catch (e) {
    ERR('modifyCloneForMotion failed:', m, e);
  }
}

// Build a Reaction in the modern Figma shape: { trigger, actions: [action] }.
// Smart Animate only accepts Figma's named easings — no CUSTOM_CUBIC_BEZIER.
function buildSmartAnimateReaction(destinationId, durationMs, easingStr) {
  const durationSec = clamp((Number(durationMs) || 240) / 1000, 0.05, 4.0);
  const easing = mapEasingToFigma(easingStr);
  const reaction = {
    trigger: { type: 'ON_HOVER' },
    actions: [{
      type: 'NODE',
      destinationId: destinationId,
      navigation: 'NAVIGATE',
      transition: {
        type: 'SMART_ANIMATE',
        easing: easing,
        duration: durationSec
      }
    }]
  };
  LOG('  reaction →', JSON.stringify(reaction));
  return reaction;
}

// Tolerate both the modern setReactionsAsync API and the older property setter.
async function setNodeReactions(node, reactions) {
  if (typeof node.setReactionsAsync === 'function') {
    await node.setReactionsAsync(reactions);
  } else {
    node.reactions = reactions;
  }
}

// Translate a CSS-style easing string into one of Figma's named Smart Animate
// easings. Figma's prototype API only accepts these names — no cubic-bezier
// objects. Default to EASE_OUT.
//   Allowed: EASE_IN, EASE_OUT, EASE_IN_AND_OUT, LINEAR, GENTLE, QUICK, BOUNCY, SLOW
function mapEasingToFigma(easing) {
  if (!easing) return { type: 'EASE_OUT' };
  const e = String(easing).toLowerCase().trim();

  // Named CSS keywords
  if (e === 'linear') return { type: 'LINEAR' };
  if (e === 'ease-out'    || e === 'easeout')    return { type: 'EASE_OUT' };
  if (e === 'ease-in'     || e === 'easein')     return { type: 'EASE_IN' };
  if (e === 'ease-in-out' || e === 'easeinout' || e === 'ease') return { type: 'EASE_IN_AND_OUT' };

  // Springs and explicit "back" easings → BOUNCY (overshoot character).
  if (/^spring/.test(e) || e.indexOf('back') !== -1) return { type: 'BOUNCY' };

  // cubic-bezier(x1, y1, x2, y2) → map to the closest named easing.
  const m = e.match(/cubic-bezier\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/);
  if (m) {
    const y1 = parseFloat(m[2]);
    const y2 = parseFloat(m[4]);
    // Overshoot or undershoot at either control point → bouncy
    if (isFinite(y1) && isFinite(y2) && (y1 > 1.05 || y2 > 1.05 || y1 < -0.05 || y2 < -0.05)) {
      return { type: 'BOUNCY' };
    }
    // Otherwise EASE_OUT is the safest default for the rest of our library.
    return { type: 'EASE_OUT' };
  }

  return { type: 'EASE_OUT' };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
