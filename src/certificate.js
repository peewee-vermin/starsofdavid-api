// src/certificate.js
// Stars of David — certificate of dedication generator
//
// Generates a one-page PDF certificate for a completed donation,
// uploads it to storage, and returns the public URL.
//
// Uses pdf-lib (pure JS, no native dependencies) so it runs
// cleanly on Railway/Render without extra build steps.

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const GOLD = rgb(0.788, 0.659, 0.298);       // #c9a84c
const CREAM = rgb(0.941, 0.929, 0.902);      // #f0ede6
const NIGHT = rgb(0.027, 0.031, 0.059);      // #07080f
const MUTED = rgb(0.66, 0.62, 0.54);         // soft gold-gray

const PAGE_WIDTH = 792;   // 11in landscape
const PAGE_HEIGHT = 612;  // 8.5in landscape

/**
 * Generates a certificate PDF for a single donation.
 *
 * @param {Object} params
 * @param {string} params.donorName
 * @param {string[]} params.starIds          - catalogue IDs, e.g. ["SOD-271302"]
 * @param {string[]} params.victimNames       - one per star, parallel array
 * @param {string} [params.message]           - optional dedication message
 * @param {Date}   [params.date]              - defaults to now
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateCertificatePdf({
  donorName,
  starIds,
  victimNames,
  message,
  date = new Date(),
}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Certificate of Dedication — Stars of David');
  pdfDoc.setAuthor('stars-of-david.org');
  pdfDoc.setSubject('Holocaust memorial star dedication certificate');

  const serif = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const serifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const serifRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const sans = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // One page per star keeps each name dignified and individually
  // presentable/printable, rather than crowding multiple names
  // onto a single sheet.
  for (let i = 0; i < starIds.length; i++) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawCertificatePage(page, {
      fonts: { serif, serifBold, serifRegular, sans },
      donorName,
      starId: starIds[i],
      victimName: victimNames[i] || 'In memory of those whose names are not yet known',
      starIndex: i + 1,
      starTotal: starIds.length,
      message,
      date,
    });
  }

  return pdfDoc.save();
}

function drawCertificatePage(page, opts) {
  const { fonts, donorName, starId, victimName, starIndex, starTotal, message, date } = opts;
  const { serif, serifBold, serifRegular, sans } = fonts;
  const cx = PAGE_WIDTH / 2;

  // Background
  page.drawRectangle({
    x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: NIGHT,
  });

  // Decorative border
  const margin = 28;
  page.drawRectangle({
    x: margin, y: margin,
    width: PAGE_WIDTH - margin * 2,
    height: PAGE_HEIGHT - margin * 2,
    borderColor: GOLD,
    borderWidth: 1,
  });
  const innerMargin = 34;
  page.drawRectangle({
    x: innerMargin, y: innerMargin,
    width: PAGE_WIDTH - innerMargin * 2,
    height: PAGE_HEIGHT - innerMargin * 2,
    borderColor: GOLD,
    borderWidth: 0.5,
    borderOpacity: 0.5,
  });

  // Star of David emblem (two overlapping triangles)
  drawMagenDavid(page, cx, PAGE_HEIGHT - 95, 26, GOLD);

  // Eyebrow
  drawCenteredText(page, 'IN ETERNAL MEMORY', cx, PAGE_HEIGHT - 138, {
    font: sans, size: 9, color: MUTED, charSpacing: 2.5,
  });

  // Title
  drawCenteredText(page, 'Certificate of Dedication', cx, PAGE_HEIGHT - 175, {
    font: serifBold, size: 28, color: CREAM,
  });

  // Subtitle
  drawCenteredText(page, 'Stars of David  ·  stars-of-david.org', cx, PAGE_HEIGHT - 198, {
    font: serif, size: 12, color: MUTED,
  });

  // Body intro
  drawCenteredText(page, 'A star has been named in eternal memory of', cx, PAGE_HEIGHT - 250, {
    font: serifRegular, size: 13, color: rgb(0.66, 0.62, 0.55),
  });

  // Victim name — the centerpiece
  drawCenteredText(page, victimName, cx, PAGE_HEIGHT - 290, {
    font: serifBold, size: 26, color: GOLD,
  });

  // Star catalogue ID
  drawCenteredText(page, `Star Catalogue No. ${starId}`, cx, PAGE_HEIGHT - 318, {
    font: sans, size: 10, color: MUTED, charSpacing: 1,
  });

  // Dedication message, if present
  let messageY = PAGE_HEIGHT - 360;
  if (message && message.trim()) {
    drawCenteredText(page, `"${message.trim()}"`, cx, messageY, {
      font: serif, size: 13, color: rgb(0.78, 0.74, 0.66), maxWidth: 560,
    });
    messageY -= 36;
  }

  // Dedicated-by line
  drawCenteredText(page, `Dedicated by ${donorName}`, cx, messageY - 10, {
    font: serifRegular, size: 13, color: rgb(0.66, 0.62, 0.55),
  });

  // Star index, if multiple
  if (starTotal > 1) {
    drawCenteredText(page, `Star ${starIndex} of ${starTotal}`, cx, messageY - 32, {
      font: sans, size: 9, color: MUTED, charSpacing: 1,
    });
  }

  // Footer — date + Hebrew blessing
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  drawCenteredText(page, dateStr, cx, 70, {
    font: sans, size: 9, color: MUTED, charSpacing: 1,
  });
  drawCenteredText(page, 'ZICHRONO LIVRACHA  ·  MAY THEIR MEMORY BE A BLESSING', cx, 52, {
    font: sans, size: 8, color: MUTED, charSpacing: 1.5,
  });
}

// ── DRAWING HELPERS ─────────────────────────────────────────

function drawCenteredText(page, text, cx, y, { font, size, color, charSpacing = 0, maxWidth }) {
  if (maxWidth) {
    const lines = wrapText(text, font, size, maxWidth);
    let lineY = y;
    for (const line of lines) {
      drawSingleCenteredLine(page, line, cx, lineY, { font, size, color, charSpacing });
      lineY -= size * 1.4;
    }
    return;
  }
  drawSingleCenteredLine(page, text, cx, y, { font, size, color, charSpacing });
}

function drawSingleCenteredLine(page, text, cx, y, { font, size, color, charSpacing }) {
  const width = measureSpacedText(text, font, size, charSpacing);
  const x = cx - width / 2;
  if (charSpacing > 0) {
    let cursorX = x;
    for (const ch of text) {
      page.drawText(ch, { x: cursorX, y, size, font, color });
      cursorX += font.widthOfTextAtSize(ch, size) + charSpacing;
    }
  } else {
    page.drawText(text, { x, y, size, font, color });
  }
}

function measureSpacedText(text, font, size, charSpacing) {
  if (!charSpacing) return font.widthOfTextAtSize(text, size);
  let w = 0;
  for (const ch of text) w += font.widthOfTextAtSize(ch, size) + charSpacing;
  return w - charSpacing;
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawMagenDavid(page, cx, cy, size, color) {
  // Two overlapping equilateral triangles forming a Star of David,
  // drawn as six straight lines (more reliable across pdf-lib
  // versions than drawSvgPath, which treats path coordinates as
  // relative to a translated origin rather than absolute page space).
  const h = size * Math.sqrt(3);

  const up = [
    { x: cx, y: cy + h * 0.58 },
    { x: cx - size, y: cy - h * 0.42 },
    { x: cx + size, y: cy - h * 0.42 },
  ];
  const down = [
    { x: cx, y: cy - h * 0.58 },
    { x: cx - size, y: cy + h * 0.42 },
    { x: cx + size, y: cy + h * 0.42 },
  ];

  drawTriangleOutline(page, up, color);
  drawTriangleOutline(page, down, color);
}

function drawTriangleOutline(page, points, color) {
  const [a, b, c] = points;
  const opts = { thickness: 1.2, color };
  page.drawLine({ start: a, end: b, ...opts });
  page.drawLine({ start: b, end: c, ...opts });
  page.drawLine({ start: c, end: a, ...opts });
}
