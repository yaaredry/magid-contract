/**
 * Sanity tests for the Magid contract PDF tool.
 *
 * Run with:  node tests/contract.test.mjs
 * Requires:  python3 + pypdf (pip install pypdf)
 *
 * What we check:
 *   1. contract.pdf exists, is a valid PDF, and has an AcroForm.
 *   2. Every field referenced by PDF_FIELD_MAP in index.html actually
 *      exists in contract.pdf (catches template/code drift).
 *   3. The Hebrew font file used for filling is present and loads.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dir, '..', 'contract.pdf');
const FONT_PATH = join(__dir, '..', 'fonts', 'NotoSansHebrew-Regular.ttf');
const HTML_PATH = join(__dir, '..', 'index.html');

let passed = 0, failed = 0;

function assert(condition, label, detail = '') {
  if (condition) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

function extractFieldMap(html) {
  const m = html.match(/const PDF_FIELD_MAP = \{([\s\S]*?)\n\};/);
  if (!m) return {};
  const map = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*(?:'([^']+)'|([\w.-]+)):\s*'([^']+)'/);
    if (kv) map[kv[1] || kv[2]] = kv[3];
  }
  return map;
}

async function main() {
  console.log('\nMagid Contract – PDF sanity tests\n');

  // ── 1. Basic PDF structure ────────────────────────────────────────────────
  console.log('1. PDF structure');

  const pdfBytes = readFileSync(PDF_PATH);
  assert(pdfBytes.length > 10_000, 'contract.pdf exists and has content', `${(pdfBytes.length/1024).toFixed(0)} KB`);
  assert(pdfBytes.subarray(0, 5).toString() === '%PDF-', 'contract.pdf has a valid PDF header');

  const py = spawnSync('python3', ['-c', `
import sys, json
try:
    from pypdf import PdfReader
except ImportError:
    print(json.dumps({'error': 'pypdf not installed — run: pip install pypdf'}))
    sys.exit(1)

r = PdfReader(sys.argv[1])
fields = r.get_fields() or {}
print(json.dumps({
    'pageCount': len(r.pages),
    'fieldNames': list(fields.keys()),
}))
`, PDF_PATH], { encoding: 'utf8' });

  assert(py.status === 0, 'contract.pdf parses with pypdf', py.stderr || py.stdout);
  if (py.status !== 0) { console.error(py.stdout, py.stderr); process.exit(1); }

  const { pageCount, fieldNames } = JSON.parse(py.stdout);
  assert(pageCount === 4, 'contract.pdf has 4 pages', `found ${pageCount}`);
  assert(fieldNames.length >= 22, 'contract.pdf has at least 22 AcroForm fields', `found ${fieldNames.length}`);

  // ── 2. index.html's field map matches the actual template ───────────────
  console.log('\n2. Field map ↔ template consistency');

  const html = readFileSync(HTML_PATH, 'utf8');
  const fieldMap = extractFieldMap(html);
  assert(Object.keys(fieldMap).length > 0, 'PDF_FIELD_MAP found in index.html');

  const fieldNameSet = new Set(fieldNames);
  for (const [key, pdfField] of Object.entries(fieldMap)) {
    assert(fieldNameSet.has(pdfField), `mapped field "${key}" → "${pdfField}" exists in contract.pdf`);
  }

  // ── 3. Hebrew font present ────────────────────────────────────────────────
  console.log('\n3. Hebrew font');

  const fontBytes = readFileSync(FONT_PATH);
  assert(fontBytes.length > 10_000, 'NotoSansHebrew-Regular.ttf exists and has content', `${(fontBytes.length/1024).toFixed(0)} KB`);
  assert(fontBytes.subarray(0, 4).toString('hex') === '00010000' || fontBytes.subarray(0,4).toString() === 'true' || fontBytes.subarray(0,4).toString() === 'OTTO',
    'font file has a valid TrueType/OpenType header');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed} passed  |  ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
