// Pliki i katalogi, z których składa się rozszerzenie — JEDNO źródło dla
// paczki ZIP (build-zip.mjs) i testów (tests/lib.cjs ładuje dokładnie to,
// co trafia do ZIP-a). Nowy plik rozszerzenia → dopisz go tutaj.
export const EXTENSION_FILES = [
  'manifest.json',
  'content.js',
  'background.js',
  'bridge.js',
  'memcheck.js',
  'monitor.js',
  'popup.html',
  'popup.js',
  'diag.html',
  'rules',
  'fake-scripts',
  'icons'
];
