'use strict';
// Testy regresji rozszerzenia: npm test   (wybrane: npm test -- diagnoza)
// Inna wersja (np. rozpakowany stary ZIP): SPOOF_EXT=/ścieżka npm test
// Każdy przypadek pilnuje konkretnej poprawki z CHANGELOG.md (pole guards) —
// czerwony test = cofnięta albo zepsuta poprawka. Opis: tests/README.md.

const fs = require('fs');
const { VERSION, CheckError, buildExtension, startServer } = require('./lib.cjs');

const TEST_TIMEOUT_MS = 180000;
const GROUPS = ['spoof', 'popup', 'pamiec', 'diagnoza'];

(async () => {
  const filters = process.argv.slice(2).map((f) => f.toLowerCase());
  const all = GROUPS.flatMap((g) => require(`./cases/${g}.cjs`).map((t) => Object.assign({ group: g }, t)));
  const tests = filters.length
    ? all.filter((t) => filters.some((f) => (t.group + ' ' + t.name).toLowerCase().includes(f)))
    : all;
  if (!tests.length) {
    console.error('Brak testów pasujących do: ' + filters.join(', '));
    process.exit(2);
  }

  const ext = process.env.SPOOF_EXT || await buildExtension();
  const server = await startServer();
  console.log(`Universal Adblock Spoof v${VERSION}${process.env.SPOOF_EXT ? ' (testowana: ' + ext + ')' : ''} — ` +
    `${tests.length} test(ów), strony: ${server.url}\n`);

  const failed = [];
  for (const t of tests) {
    const t0 = Date.now();
    let timer;
    try {
      await Promise.race([
        t.run({ ext, site: server.url }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new CheckError(`przekroczony limit ${TEST_TIMEOUT_MS / 1000} s`)), TEST_TIMEOUT_MS); })
      ]);
      console.log(`✓ [${t.group}] ${t.name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) {
      failed.push(t);
      console.log(`✗ [${t.group}] ${t.name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      console.log(`    ${e instanceof CheckError ? e.message : (e && e.stack) || e}`);
      console.log(`    pilnuje: ${t.guards}`);
    } finally {
      clearTimeout(timer);
    }
  }

  server.close();
  if (!process.env.SPOOF_EXT) fs.rmSync(ext, { recursive: true, force: true });
  console.log(`\n${tests.length - failed.length}/${tests.length} OK` + (failed.length ? ` — NIEUDANE: ${failed.map((t) => t.name).join('; ')}` : ''));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
