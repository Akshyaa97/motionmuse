#!/usr/bin/env python3
"""MotionMuse build step.

Figma plugins load ui.html via srcdoc. Relative URLs (<link>, <script src>,
fetch) do not resolve in srcdoc, so ui.html must be self-contained.

This script bundles ui.css, ui.js, and data/animations.json into a single
ui.html that Figma can load directly. Re-run after editing any source file.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent

MARKUP = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MotionMuse</title>
<style>
__CSS__
</style>
</head>
<body>
  <main class="app" data-testid="motionmuse-app">

    <!-- HEADER -->
    <header class="header">
      <div class="brand">
        <span class="logo" aria-hidden="true">M</span>
        <h1 class="wordmark">MotionMuse</h1>
      </div>
      <p class="tagline">Motion that fits your product, not the trend.</p>
    </header>

    <!-- SEARCH VIEW -->
    <section id="view-search" class="view view-search" data-testid="search-view">

      <div id="selection-area" class="selection-area" data-testid="selection-state"></div>

      <div class="divider"></div>

      <div class="intro">
        <h2 class="intro-title">Let's find your motion.</h2>
        <p class="intro-helper">Tell us about your product &mdash; we'll suggest animations that actually belong.</p>
      </div>

      <div class="controls">
        <div class="field">
          <label class="field-label" for="industry">What kind of product is this?</label>
          <select id="industry" class="field-select is-empty" required data-testid="industry-select">
            <option value="" disabled selected hidden>Choose an industry</option>
            <option value="Fintech">&#128179;&nbsp;&nbsp;Fintech</option>
            <option value="Healthcare">&#127973;&nbsp;&nbsp;Healthcare</option>
            <option value="E-commerce">&#128717;&nbsp;&nbsp;E-commerce</option>
            <option value="SaaS / Productivity">&#9889;&nbsp;&nbsp;SaaS / Productivity</option>
            <option value="Gaming">&#127918;&nbsp;&nbsp;Gaming</option>
            <option value="Education / Kids">&#127912;&nbsp;&nbsp;Education / Kids</option>
            <option value="Luxury">&#128142;&nbsp;&nbsp;Luxury</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="personality">What's the vibe?</label>
          <select id="personality" class="field-select is-empty" required data-testid="personality-select">
            <option value="" disabled selected hidden>Choose a vibe</option>
            <option value="Playful">&#127880;&nbsp;&nbsp;Playful</option>
            <option value="Trustworthy">&#129309;&nbsp;&nbsp;Trustworthy</option>
            <option value="Luxurious">&#128081;&nbsp;&nbsp;Luxurious</option>
            <option value="Minimal">&#9725;&nbsp;&nbsp;Minimal</option>
            <option value="Bold">&#10024;&nbsp;&nbsp;Bold</option>
          </select>
        </div>

        <div class="field field-subtle">
          <label class="field-label" for="element">What are we animating?</label>
          <select id="element" class="field-select is-empty" required data-testid="element-select">
            <option value="" disabled selected hidden>Auto-detect from selection</option>
            <option value="Button">&#128280;&nbsp;&nbsp;Button</option>
            <option value="Card">&#127183;&nbsp;&nbsp;Card</option>
            <option value="Modal">&#129002;&nbsp;&nbsp;Modal</option>
            <option value="Input field">&#128221;&nbsp;&nbsp;Input field</option>
            <option value="Icon">&#11088;&nbsp;&nbsp;Icon</option>
            <option value="Image / Hero">&#128444;&nbsp;&nbsp;Image / Hero</option>
          </select>
        </div>
      </div>

      <button id="suggestBtn" class="btn-suggest" data-testid="suggest-button" disabled>
        <span class="btn-suggest-label">Show me animations</span>
        <span class="btn-suggest-shimmer" aria-hidden="true"></span>
      </button>
      <p id="formError" class="form-error" hidden></p>
    </section>

    <!-- RESULTS VIEW -->
    <section id="view-results" class="view view-results" data-testid="results-view" hidden>
      <button id="backBtn" class="btn-back" data-testid="back-button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
        <span>Back</span>
      </button>
      <div class="results-intro">
        <h2 class="intro-title" id="resultsTitle">Here are your best matches:</h2>
        <p id="resultsContext" class="intro-helper"></p>
      </div>
      <div id="resultsList" class="results-list" data-testid="results-list"></div>
      <div id="emptyResults" class="empty-results" hidden data-testid="empty-results">
        <h3>Hmm, nothing felt like a perfect match.</h3>
        <p>Try a different vibe? Here are the closest alternatives:</p>
        <div id="alternativesList" class="results-list"></div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="footer">
      <svg class="footer-heart" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 21s-7-4.5-9.5-9C0.8 8.6 2.6 5 6 5c2 0 3.5 1.2 4.4 2.6h.2C11.5 6.2 13 5 15 5c3.4 0 5.2 3.6 3.5 7-2.5 4.5-9.5 9-9.5 9z"/>
      </svg>
      <span>Made for designers who care about motion.</span>
    </footer>

    <!-- TOAST -->
    <div id="toast" class="toast" role="status" aria-live="polite" data-testid="toast" hidden>
      <span class="toast-icon" id="toastIcon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>
      <span id="toastMsg">Copied.</span>
    </div>
  </main>

  <script>
window.__ANIMATIONS__ = __DATA__;
__JS__
  </script>
</body>
</html>
"""


def main() -> int:
    css  = (ROOT / 'ui.css').read_text(encoding='utf-8')
    js   = (ROOT / 'ui.js').read_text(encoding='utf-8')
    data = (ROOT / 'data' / 'animations.json').read_text(encoding='utf-8').strip()

    # Sanity: nothing inside the inlined assets should close the script tag.
    for name, body in (('ui.css', css), ('ui.js', js), ('animations.json', data)):
        if '</script' in body.lower():
            print(f'ERROR: {name} contains </script — would break inlining', file=sys.stderr)
            return 1

    html = (
        MARKUP
        .replace('__CSS__', css)
        .replace('__DATA__', data)
        .replace('__JS__', js)
    )
    out = ROOT / 'ui.html'
    out.write_text(html, encoding='utf-8')
    print(f'Wrote {out} ({len(html):,} bytes)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
