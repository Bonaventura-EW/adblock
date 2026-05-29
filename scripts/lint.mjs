#!/usr/bin/env node
// Lekka walidacja repozytorium (bez zależności).
//  • składnia wszystkich plików .js (node --check),
//  • poprawność JSON: manifest.json, rules/rules.json,
//  • zakres uniwersalny: host_permissions i web_accessible_resources = *://*/*.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0;
const fail = (m) => { console.error('✗ ' + m); errors++; };
const ok = (m) => console.log('✓ ' + m);

// 1. Składnia JS — pomijamy fake-scripts (zminifikowany kod Google) i node_modules.
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '_metadata' || name === '.git') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue;
    if (p.includes(`${'fake-scripts'}`)) continue; // pomiń kod Google
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
      ok(`składnia: ${p.replace(root + '/', '')}`);
    } catch (e) {
      fail(`składnia: ${p.replace(root + '/', '')}\n${e.stderr?.toString() || e.message}`);
    }
  }
}
walk(root);

// 2. Poprawność JSON.
function readJson(rel) {
  try {
    const data = JSON.parse(readFileSync(join(root, rel), 'utf8'));
    ok(`JSON poprawny: ${rel}`);
    return data;
  } catch (e) {
    fail(`JSON niepoprawny: ${rel} — ${e.message}`);
    return null;
  }
}
const manifest = readJson('manifest.json');
readJson('rules/rules.json');

// 3. Zakres uniwersalny.
if (manifest) {
  const hp = manifest.host_permissions || [];
  if (hp.length === 1 && hp[0] === '*://*/*') ok('host_permissions = *://*/*');
  else fail(`host_permissions powinno być ["*://*/*"], jest: ${JSON.stringify(hp)}`);

  const war = (manifest.web_accessible_resources || [])[0]?.matches || [];
  if (war.length === 1 && war[0] === '*://*/*') ok('web_accessible_resources.matches = *://*/*');
  else fail(`web_accessible_resources.matches powinno być ["*://*/*"], jest: ${JSON.stringify(war)}`);

  if (manifest.background?.service_worker === 'background.js') ok('service_worker = background.js');
  else fail('brak background.service_worker = background.js');

  if (manifest.action?.default_popup === 'popup.html') ok('action.default_popup = popup.html');
  else fail('brak action.default_popup = popup.html');
}

if (errors) { console.error(`\n${errors} błąd(ów).`); process.exit(1); }
console.log('\nWszystko OK.');
