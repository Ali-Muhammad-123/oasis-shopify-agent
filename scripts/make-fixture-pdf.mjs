// Writes fixtures/supplier-invoice.pdf: a one-page text PDF built by hand (no dependencies).
import { writeFileSync } from 'node:fs';

const lines = [
  ['F2', 18, 'Northwind Outdoor Supply Co.'],
  ['F1', 10, '400 Harbor Way, Portland OR 97209'],
  ['F2', 14, 'INVOICE  #NW-20417'],
  ['F1', 10, 'Date: 2026-10-20     Terms: Net 30     Currency: USD'],
  ['F1', 10, 'Bill to: Oasis Test Store'],
  ['F2', 10, 'Item code        Description                          Qty    Unit cost     Amount'],
  ['F1', 10, 'BEANIE-CHARCOAL  Alpine Wool Beanie, Charcoal          24      12.50     300.00'],
  ['F1', 10, 'BEANIE-FOREST    Alpine Wool Beanie, Forest            18      12.50     225.00'],
  ['F1', 10, '-                Clearview Snow Goggles Rose lens       8      54.00     432.00'],
  ['F1', 10, 'WAXKIT           Board Wax Tune-Up Kit                 30       8.75     262.50'],
  ['F1', 10, 'TL-990           Trail Thermos 750ml                   12      11.00     132.00'],
  ['F2', 10, 'Subtotal 1,351.50     Freight 45.00     Total due 1,396.50'],
  ['F1', 9, 'Thank you for your business. Please reference NW-20417 with payment.'],
];
const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
let y = 760;
const content = lines.map(([font, size, text], i) => {
  y -= i === 0 ? 0 : i === 2 || i === 5 || i === 11 ? 28 : 18;
  return `BT /${font} ${size} Tf 50 ${y} Td (${esc(text)}) Tj ET`;
}).join('\n');

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = objects.map((body, i) => {
  const offset = Buffer.byteLength(pdf);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return offset;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(new URL('../fixtures/supplier-invoice.pdf', import.meta.url), pdf);
console.log('wrote fixtures/supplier-invoice.pdf');
