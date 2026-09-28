'use strict';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pixelsToDataUrl(width, height, pixels) {
  const rowBytes = Math.ceil(width / 32) * 4;
  const pixelSize = rowBytes * height;
  const fileSize = 62 + pixelSize;
  const buf = Buffer.alloc(fileSize, 0);

  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(62, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(1, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelSize, 34);
  buf.writeUInt32LE(2 * 4, 46);

  buf.writeUInt32LE(0x00ffffff, 54);
  buf.writeUInt32LE(0x00000000, 58);

  for (let y = 0; y < height; y++) {
    const destRow = 62 + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      if (!pixels[y * width + x]) continue;
      const byteIndex = destRow + (x >> 3);
      buf[byteIndex] |= 0x80 >> (x & 7);
    }
  }

  return 'data:image/bmp;base64,' + buf.toString('base64');
}

function qrPlaceholderSvg(text) {
  const size = 120;
  const modules = 21;
  const cell = size / modules;
  let hash = 0;
  for (let i = 0; i < (text || '').length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  const rects = [];
  function finder(ox, oy) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const edge = x === 0 || y === 0 || x === 6 || y === 6;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (edge || inner) {
          rects.push(
            '<rect x="' +
              (ox + x) * cell +
              '" y="' +
              (oy + y) * cell +
              '" width="' +
              cell +
              '" height="' +
              cell +
              '"/>'
          );
        }
      }
    }
  }
  finder(0, 0);
  finder(modules - 7, 0);
  finder(0, modules - 7);
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (x < 8 && y < 8) continue;
      if (x >= modules - 8 && y < 8) continue;
      if (x < 8 && y >= modules - 8) continue;
      const bit = (hash ^ (x * 73856093) ^ (y * 19349663)) & 1;
      if (bit) {
        rects.push(
          '<rect x="' + x * cell + '" y="' + y * cell + '" width="' + cell + '" height="' + cell + '"/>'
        );
      }
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 ' +
    size +
    ' ' +
    size +
    '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#111">' +
    rects.join('') +
    '</g></svg>'
  );
}

function barcodeSvg(text, height = 64) {
  const data = String(text || '');
  let pattern = '';
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    const bits = ((c * 17) & 0xff).toString(2).padStart(8, '0');
    pattern += '1' + bits + '0';
  }
  if (!pattern) pattern = '1010101010101010';
  pattern = '110100101' + pattern + '110100101';
  const moduleW = 2;
  const width = pattern.length * moduleW;
  const rects = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      rects.push(
        '<rect x="' + i * moduleW + '" y="0" width="' + moduleW + '" height="' + height + '"/>'
      );
    }
  }
  const labelY = height + 14;
  const svgH = height + 20;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    svgH +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    svgH +
    '" shape-rendering="crispEdges"><g fill="#111">' +
    rects.join('') +
    '</g><text x="50%" y="' +
    labelY +
    '" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#111">' +
    escapeHtml(data) +
    '</text></svg>'
  );
}

function runToHtml(run) {
  const s = run.style || {};
  const classes = ['run'];
  if (s.bold) classes.push('bold');
  if (s.underline) classes.push('underline');
  if (s.doubleWidth || (s.widthMult && s.widthMult >= 2)) classes.push('dw');
  if (s.doubleHeight || (s.heightMult && s.heightMult >= 2)) classes.push('dh');
  if (s.font === 'B') classes.push('font-b');
  if (s.invert) classes.push('invert');
  return '<span class="' + classes.join(' ') + '">' + escapeHtml(run.text) + '</span>';
}

function renderToHtml(parsed, options = {}) {
  const paperWidthMm = options.paperWidthMm || parsed.paperWidthMm || 80;
  const parts = [];

  parts.push('<div class="receipt-paper" data-width="' + paperWidthMm + '">');
  parts.push('<div class="receipt-body">');

  for (const line of parsed.lines) {
    if (line.type === 'text') {
      const empty = !line.runs || line.runs.every((r) => !String(r.text).replace(/\s/g, '').length);
      const content = (line.runs || []).map(runToHtml).join('');
      parts.push(
        '<div class="line align-' +
          (line.align || 'left') +
          (empty ? ' blank' : '') +
          '">' +
          (content || '&nbsp;') +
          '</div>'
      );
      continue;
    }

    if (line.type === 'feed') {
      const h = line.dots != null ? Math.max(8, Math.round(line.dots * 0.5)) : (line.lines || 1) * 18;
      parts.push('<div class="feed" style="height:' + h + 'px"></div>');
      continue;
    }

    if (line.type === 'image') {
      const url = pixelsToDataUrl(line.width, line.height, line.pixels);
      parts.push(
        '<div class="line align-' +
          (line.align || 'left') +
          ' media"><img class="raster" src="' +
          url +
          '" alt="image" width="' +
          line.width +
          '" height="' +
          line.height +
          '"/></div>'
      );
      continue;
    }

    if (line.type === 'qr') {
      const svg = qrPlaceholderSvg(line.data);
      parts.push(
        '<div class="line align-' +
          (line.align || 'left') +
          ' media"><div class="qr">' +
          svg +
          '</div><div class="qr-caption">' +
          escapeHtml(line.data || '') +
          '</div></div>'
      );
      continue;
    }

    if (line.type === 'barcode') {
      const svg = barcodeSvg(line.data, line.height || 64);
      parts.push(
        '<div class="line align-' +
          (line.align || 'left') +
          ' media"><div class="barcode">' +
          svg +
          '</div></div>'
      );
      continue;
    }

    if (line.type === 'cut') {
      parts.push('<div class="cut" data-mode="' + (line.mode || 'full') + '"><span>✂ cut</span></div>');
      continue;
    }
  }

  parts.push('</div>');
  parts.push('</div>');
  return parts.join('');
}

module.exports = { renderToHtml, escapeHtml };
