# Einschlafwörter (cognitive-shuffle): agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
Deviations are listed below, each with a reason.

## Two apps, one source
- `web/` is the app. GitHub Pages serves it as it is (`deploy.yml`), and the Android app bundles the same files (`android.yml`).
- `android/` is a Capacitor 8 shell (app ID `ch.brunodev.sleepwords`, never change it). `npx cap sync android` copies `web/` into it; the copy (`android/app/src/main/assets/public`) is gitignored.
- Native code is small and lives in `android/app/src/main/java/ch/brunodev/sleepwords/`:
  - `MainActivity`: registers the plugin, hides the system bars (like the PWA's `display: fullscreen`).
  - `PlaybackPlugin` + `PlaybackService`: a `mediaPlayback` foreground service while a session runs, so Android doesn't freeze the WebView with the screen locked. JS side: `web/js/native.js`, no-op in the browser.
- In the app, `web/js/native.js` → `isNative` switches off the service worker and the web fullscreen request. Anything else browser-only must check it too.
- Capacitor packages are pinned exactly; bump all `@capacitor/*` together, then `npx cap sync android` and commit the changes in `android/`.

## Releases (Android)
- `package.json` `version` is the only version. Bump it in a PR; when it lands on main, `android.yml` tags `v<version>` and publishes the signed APK as a GitHub release. Obtainium picks it up.
- `versionCode = major·10⁷ + minor·10⁵ + patch·10³` (`tools/android-version.mjs`, tested). minor and patch stay ≤ 99.
- Releases need the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` and the variable `ANDROID_CERT_SHA256`; the workflow refuses to publish an APK signed by anything else.
- Web deploys don't need a version bump.

## Deviations from the standard
- Vanilla JS ES modules, no Vite, no TypeScript, no React: the app predates the standard, runs without a build step, and is small (largest file `main.js`, ~550 lines). Port only if it grows.
- Hand-written `web/sw.js` instead of vite-plugin-pwa (no build step). Its `SHELL` list must name every file in `web/js` and `css`; a unit test checks it.
- Tests: `node:test` (`npm test`) and a hand-rolled Playwright script (`npm run e2e`) instead of Vitest and `@playwright/test`. No ESLint/Prettier yet.
- Android release ships an APK only, no AAB (not on Play).
- README and comments in `web/`, `tools/`, `tests/` are German; keep them German. Java in `android/` and workflows: English. Commits in English.

## Invariants
- Storage keys stay `ew-*` (see `KEYS` in `web/js/main.js`).
- No network calls at runtime except loading the app's own files.
- No user-facing string is hard-coded: add it to `TEXT` in `web/js/i18n.js` for every language.

## Merging
- Owner's standing rule: open a PR from your branch and squash-merge it into `main` yourself as soon as all checks are green. No need to ask.

## Done checklist (before every push)
1. `npm test && npm run e2e`
2. Touched `android/` or `web/js/native.js`: CI (`android.yml`) builds the APK and runs the emulator smoke test (`tools/android-smoke.sh`) on the PR.
3. If you fixed a bug, a test now covers it.
4. README is updated if you changed behaviour, scripts or services.
