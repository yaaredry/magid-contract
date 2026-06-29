/**
 * Sanity tests for the Magid contract DOCX tool.
 *
 * Run with:  node tests/contract.test.mjs
 * Requires:  python3 + unzip (standard on Linux/macOS)
 *
 * What we check:
 *   1. contract.docx is readable and is a valid ZIP/DOCX.
 *   2. All required {placeholder} tags are present.
 *   3. Generating a filled DOCX with sample data produces a valid DOCX blob.
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DOCX_PATH = join(__dir, '..', 'contract.docx');
const OUT_PATH  = join(__dir, 'output_sample.docx');

// ── expected placeholders ───────────────────────────────────────────────────
const REQUIRED_PLACEHOLDERS = new Set([
  'day', 'month', 'name', 'phone', 'fax',
  'room', 'type-of-rooms', 'purpose', 'activity',
  'startDate', 'days', 'startTime',
  'more-dates', 'num-hours-used', 'fee', 'fee-5.3',
]);

const SAMPLE_DATA = {
  day: '15', month: 'March', name: 'Israel Israelit',
  phone: '050-1234567', fax: '03-9999999',
  room: 'Hall A', 'type-of-rooms': 'Rooms', purpose: 'Event', activity: 'Lecture',
  startDate: '01/01/2026', days: 'Sun-Thu', startTime: '09:00-17:00',
  'more-dates': '', 'num-hours-used': '4', fee: '2000', 'fee-5.3': '150',
};

// ── helpers ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(condition, label, detail = '') {
  if (condition) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

function extractPlaceholders(xml) {
  return new Set((xml.match(/\{([^}]+)\}/g) || []).map(m => m.slice(1, -1)));
}

// ── test suite ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\nMagid Contract – DOCX sanity tests\n');

  // ── 1. Basic DOCX structure ──────────────────────────────────────────────
  console.log('1. DOCX structure');

  assert(readFileSync(DOCX_PATH).length > 1000, 'contract.docx exists and has content');

  const unzip = spawnSync('unzip', ['-p', DOCX_PATH, 'word/document.xml'], { encoding: 'utf8' });
  assert(unzip.status === 0, 'contract.docx is a valid ZIP');
  if (unzip.status !== 0) { console.error(unzip.stderr); process.exit(1); }

  const xmlText = unzip.stdout;
  assert(xmlText.length > 1000, `document.xml has content`, `${xmlText.length} chars`);

  // ── 2. Placeholder presence ──────────────────────────────────────────────
  console.log('\n2. Placeholder tags');
  const found = extractPlaceholders(xmlText);
  assert(found.size > 0, 'at least one {placeholder} found');

  for (const name of REQUIRED_PLACEHOLDERS) {
    assert(found.has(name), `{${name}} present`);
  }

  const unknown = [...found].filter(n => !REQUIRED_PLACEHOLDERS.has(n));
  if (unknown.length) console.log(`  ⚠  Unknown placeholders: ${unknown.join(', ')}`);

  // ── 3. DOCX generation with sample data ─────────────────────────────────
  console.log('\n3. DOCX generation with sample data');

  let filledXml = xmlText;
  for (const [key, value] of Object.entries(SAMPLE_DATA)) {
    filledXml = filledXml.replaceAll(`{${key}}`, value);
  }

  const unfilled = [...extractPlaceholders(filledXml)].filter(p => REQUIRED_PLACEHOLDERS.has(p));
  assert(unfilled.length === 0, 'all required placeholders replaced', unfilled.join(', '));

  // Use Python to swap word/document.xml inside the ZIP (no npm needed)
  const pyScript = `
import zipfile, shutil, sys
src, dst, xml_content = sys.argv[1], sys.argv[2], sys.stdin.read()
shutil.copy(src, dst)
with zipfile.ZipFile(dst, 'a') as z:
    z.writestr('word/document.xml', xml_content)
`.trim();

  const py = spawnSync('python3', ['-c', pyScript, DOCX_PATH, OUT_PATH],
    { input: filledXml, encoding: 'utf8' });
  assert(py.status === 0, 'output DOCX written successfully', py.stderr);

  const outSize = readFileSync(OUT_PATH).length;
  assert(outSize > 10_000, 'output DOCX is at least 10 KB', `${(outSize/1024).toFixed(0)} KB`);

  const check = spawnSync('unzip', ['-p', OUT_PATH, 'word/document.xml'], { encoding: 'utf8' });
  assert(check.status === 0, 'output DOCX re-loads and has document.xml');

  console.log(`\n  Output saved to tests/output_sample.docx for manual review`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed} passed  |  ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
