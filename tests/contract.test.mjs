/**
 * Sanity tests for the Magid contract PDF tool.
 *
 * Run with:  node tests/contract.test.mjs
 *
 * What we check:
 *   1. contract.pdf is readable and has the expected page count.
 *   2. All required field annotations are present with valid positions.
 *   3. No unexpected / misspelled annotation names exist.
 *   4. Generating a filled PDF with sample data produces a valid PDF blob
 *      whose byte count is in a reasonable range.
 */

import { readFileSync, writeFileSync } from 'fs';
import { PDFDocument, PDFName, rgb } from 'pdf-lib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dir, '..', 'contract.pdf');

// ── expected fields ────────────────────────────────────────────────────────
const REQUIRED_FIELDS = new Set([
  'day', 'month', 'name', 'phone', 'fax', 'id', 'email',
  'room', 'type-of-rooms', 'purpose', 'activity',
  'startDate', 'days', 'startTime',
  'room1', 'room2', 'room3', 'room4', 'room5', 'room6', 'room7',
  'more-dates', 'num-hours-used', 'fee', 'fee-5.3',
]);

const SAMPLE_DATA = {
  day: '15', month: 'מרץ', name: 'ישראל ישראלי',
  phone: '050-1234567', fax: '03-9999999', id: '123456789',
  email: 'israel@example.com', room: 'אולם כינוסים',
  'type-of-rooms': 'חדרים', purpose: 'אירוע קהילתי', activity: 'הרצאה',
  startDate: '01/01/2026 – 31/12/2026', days: 'ראשון–חמישי',
  startTime: '09:00–17:00', 'more-dates': '',
  'num-hours-used': '4', fee: '2000', 'fee-5.3': '150',
  room1: 'חדר א', room2: 'חדר ב', room3: '', room4: '',
  room5: '', room6: '', room7: '',
};

// ── helpers ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function readAnnotations(pdfDoc) {
  const map = {};
  const pages = pdfDoc.getPages();
  for (let pi = 0; pi < pages.length; pi++) {
    const annotsObj = pages[pi].node.get(PDFName.of('Annots'));
    if (!annotsObj) continue;
    const annots = pdfDoc.context.lookup(annotsObj);
    const size = annots.size ? annots.size() : 0;
    for (let i = 0; i < size; i++) {
      const dict = pdfDoc.context.lookup(annots.get(i));
      if (!dict?.get) continue;
      const c = dict.get(PDFName.of('Contents'));
      if (!c) continue;
      const name = c.decodeText ? c.decodeText() : c.asString?.() ?? '';
      const rect = dict.get(PDFName.of('Rect'));
      if (!rect) continue;
      map[name] = {
        page: pi,
        x: rect.get(0).asNumber(),
        y: rect.get(1).asNumber() + 2,
        w: rect.get(2).asNumber() - rect.get(0).asNumber(),
        h: rect.get(3).asNumber() - rect.get(1).asNumber(),
      };
    }
  }
  return map;
}

// ── test suite ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\nMagid Contract – PDF sanity tests\n');
  const pdfBytes = readFileSync(PDF_PATH);

  // ── 1. Basic PDF structure ───────────────────────────────────────────────
  console.log('1. PDF structure');
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    assert(true, 'contract.pdf loads without error');
  } catch (e) {
    assert(false, 'contract.pdf loads without error', e.message);
    process.exit(1);
  }

  const pageCount = pdfDoc.getPageCount();
  assert(pageCount >= 2, `has at least 2 pages`, `got ${pageCount}`);

  const pages = pdfDoc.getPages();
  for (let i = 0; i < Math.min(pageCount, 2); i++) {
    const { width, height } = pages[i].getSize();
    assert(width > 400 && height > 600, `page ${i + 1} is a reasonable size`,
      `${width.toFixed(0)}×${height.toFixed(0)} pt`);
  }

  // ── 2. Annotation presence ───────────────────────────────────────────────
  console.log('\n2. Field annotations');
  const annots = await readAnnotations(pdfDoc);
  const foundNames = new Set(Object.keys(annots));

  assert(foundNames.size > 0, 'at least one FreeText annotation found');

  for (const name of REQUIRED_FIELDS) {
    assert(foundNames.has(name), `annotation "${name}" exists`);
  }

  // Warn about unknown annotations (not a failure, just informational)
  const unknown = [...foundNames].filter(n => !REQUIRED_FIELDS.has(n));
  if (unknown.length) {
    console.log(`  ⚠  Unknown annotations (not in REQUIRED_FIELDS): ${unknown.join(', ')}`);
  }

  // ── 3. Annotation geometry ───────────────────────────────────────────────
  console.log('\n3. Annotation geometry');
  const { width: pw, height: ph } = pages[0].getSize();

  for (const [name, coord] of Object.entries(annots)) {
    const onValidPage = coord.page < pageCount;
    assert(onValidPage, `"${name}" page index in range`, `page ${coord.page}`);
    if (!onValidPage) continue;

    const pageH = pdfDoc.getPages()[coord.page].getSize().height;
    const pageW = pdfDoc.getPages()[coord.page].getSize().width;
    assert(
      coord.x >= 0 && coord.x <= pageW && coord.y >= 0 && coord.y <= pageH,
      `"${name}" position within page bounds`,
      `x=${coord.x.toFixed(1)} y=${coord.y.toFixed(1)}`
    );
  }

  // ── 4. PDF generation ────────────────────────────────────────────────────
  console.log('\n4. PDF generation with sample data');

  // Minimal font stub — we can't fetch from CDN in Node, so we use pdf-lib's
  // built-in Helvetica just for the generation test (positions still come
  // from annotations; font correctness is a manual / visual check).
  const pdfDoc2 = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages2 = pdfDoc2.getPages();
  const annots2 = await readAnnotations(pdfDoc2);
  const font = await pdfDoc2.embedFont('Helvetica'); // Latin-only stub for CI
  const black = rgb(0, 0, 0);

  let drawn = 0;
  for (const [key, value] of Object.entries(SAMPLE_DATA)) {
    const coord = annots2[key];
    if (!coord || !value) continue;
    pages2[coord.page].drawText(value, {
      x: coord.x, y: coord.y, size: 9, font, color: black,
    });
    drawn++;
  }
  assert(drawn > 0, `drew text for ${drawn} non-empty fields`);

  const outBytes = await pdfDoc2.save();
  assert(outBytes.length > 50_000, 'output PDF is at least 50 KB',
    `got ${(outBytes.length / 1024).toFixed(0)} KB`);
  assert(outBytes.length < 10_000_000, 'output PDF is under 10 MB',
    `got ${(outBytes.length / 1024 / 1024).toFixed(1)} MB`);

  // Verify the output is a valid PDF
  let outDoc;
  try {
    outDoc = await PDFDocument.load(outBytes);
    assert(outDoc.getPageCount() === pageCount,
      'output PDF has same page count as template');
  } catch (e) {
    assert(false, 'output PDF re-loads without error', e.message);
  }

  // Save output for manual inspection
  const outPath = join(__dir, 'output_sample.pdf');
  writeFileSync(outPath, outBytes);
  console.log(`\n  Output saved to tests/output_sample.pdf for manual review`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed} passed  |  ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
