---
name: testing-evals-web
description: Run and visually test the Ask Gina Evals React frontend, including static artifact pages and hash navigation.
---

# Evals frontend runtime testing

- App source is `apps/evals`; inspect its package scripts and route handling in
  `src/App.tsx` before testing.
- Check `http://localhost:5173/` first and reuse the existing Vite server.
  If absent, start `bun run --cwd apps/evals dev` from the repo root.
- Static results routes use bundled artifacts and require no API login.
  Do not launch live evaluations to test these read-only frontend pages.
- If Chrome cannot initialize after an environment restart, check the X display.
  On this Linux image, `Xvfb :0 -screen 0 1440x1000x24 -ac` supplies the display.
  Maximize the Chrome window before recording; without a window manager, native
  CDP `Browser.setWindowBounds` can size it to the display.
- Verify both nav clicks and direct hash loads. Document titles and
  `nav [aria-current="page"]` should match the route.
- Inspect disclosures in both closed/open states and distinguish illustrative
  results from measured conformance counts.
- For responsive checks, verify `innerWidth`, root `scrollWidth`, and each
  table wrapper's `clientWidth`/`scrollWidth`. Tables may wrap rather than
  overflow; do not assume a scrollbar must appear.
- Browser automation may strip external-link `target` attributes. If new-tab
  behavior differs from source, reload through native CDP and inspect/click
  the freshly rendered link before concluding that the app is broken.
- If viewport overrides do not appear in browser-tool screenshots, capture
  `Page.captureScreenshot` from the same CDP target and inspect that PNG.
- Verify downloads from the browser's actual Downloads directory rather than
  assuming a temporary CDP session's download override persists after disconnect.
- Separate JavaScript exceptions from browser asset/network errors in reports.
  CDP `Runtime.enable` replays cached console messages, while `Log.enable` can
  expose network errors such as missing favicon requests.

## Devin Secrets Needed

None for public/static frontend pages.
