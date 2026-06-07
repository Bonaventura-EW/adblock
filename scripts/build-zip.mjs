#!/usr/bin/env node
// Buduje paczkę ZIP do manualnej instalacji w Vivaldi/Chromium.
// Nazwa: adblock-vivaldi-v<wersja>.zip (wersja z manifest.json).
// Pakuje TYLKO pliki potrzebne do działania rozszerzenia — bez scripts/,
// README.md, package.json, CLAUDE.md, CHANGELOG.md, _metadata/, .git itd.
//
// Użycie: npm run build

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const zipName = `adblock-vivaldi-v${version}.zip`;

// Pliki/katalogi wchodzące do paczki.
const INCLUDE = [
  'manifest.json',
  'content.js',
  'background.js',
  'bridge.js',
  'popup.html',
  'popup.js',
  'rules',
  'fake-scripts',
  'icons'
];

for (const entry of INCLUDE) {
  if (!existsSync(join(root, entry))) {
    console.error(`✗ brak wymaganego pliku: ${entry}`);
    process.exit(1);
  }
}

// Usuń stare paczki adblock-vivaldi-*.zip (trzymamy tylko bieżącą wersję).
for (const f of readdirSync(root)) {
  if (/^adblock-vivaldi-v.*\.zip$/.test(f)) rmSync(join(root, f));
}

// -r rekurencyjnie, -X bez atrybutów extra, -q cicho.
execFileSync('zip', ['-r', '-X', '-q', zipName, ...INCLUDE], { cwd: root, stdio: 'inherit' });

const { size } = await import('node:fs').then(m => m.statSync(join(root, zipName)));
console.log(`✓ zbudowano ${zipName} (${(size / 1024).toFixed(0)} KB)`);
