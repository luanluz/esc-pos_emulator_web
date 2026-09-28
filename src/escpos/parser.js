'use strict';

const iconv = require('iconv-lite');
const { CODE_PAGES, DEFAULT_ENCODING, resolveEncoding } = require('./codepages');

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const DLE = 0x10;
const LF = 0x0a;
const CR = 0x0d;
const HT = 0x09;
const FF = 0x0c;
const CAN = 0x18;
const BEL = 0x07;
const BS = 0x08;

function alignName(n) {
  if (n === 1) return 'center';
  if (n === 2) return 'right';
  return 'left';
}

function decodeText(bytes, encoding) {
  try {
    if (iconv.encodingExists(encoding)) {
      return iconv.decode(Buffer.from(bytes), encoding);
    }
  } catch {

  }
  return Buffer.from(bytes).toString('latin1');
}

function isVisuallyBlank(line) {
  if (!line) return false;
  if (line.type === 'feed') return true;
  if (line.type !== 'text') return false;
  return !line.runs || line.runs.every((r) => !String(r.text).replace(/\s/g, '').length);
}

function coalesceImageBands(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type !== 'image') {
      out.push(line);
      continue;
    }

    const chunks = [line];
    let k = i + 1;
    while (k < lines.length) {
      let look = k;
      while (look < lines.length && isVisuallyBlank(lines[look])) look += 1;
      if (look >= lines.length) break;
      const next = lines[look];
      if (
        next.type === 'image' &&
        next.width === line.width &&
        (next.align || 'left') === (line.align || 'left')
      ) {
        chunks.push(next);
        k = look + 1;
        continue;
      }
      break;
    }

    if (chunks.length === 1) {
      out.push(line);
      continue;
    }

    const height = chunks.reduce((sum, c) => sum + c.height, 0);
    const pixels = new Uint8Array(line.width * height);
    let yOff = 0;
    for (const c of chunks) {
      pixels.set(c.pixels, line.width * yOff);
      yOff += c.height;
    }
    out.push({
      type: 'image',
      width: line.width,
      height,
      pixels,
      align: line.align,
    });
    i = k - 1;
  }
  return out;
}

function parseEscPos(input, options = {}) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const paperWidthMm = options.paperWidthMm === 58 ? 58 : 80;
  const cols = paperWidthMm === 58 ? 32 : 48;

  const commands = [];
  const lines = [];

  let i = 0;
  let style = {
    align: 'left',
    bold: false,
    underline: 0,
    doubleWidth: false,
    doubleHeight: false,
    font: 'A',
    invert: false,
    upsideDown: false,
    codepage: 0,
    encoding: DEFAULT_ENCODING,
    charSpacing: 0,
    lineSpacing: 30,
  };

  let currentRuns = [];
  let cut = false;
  let truncated = false;

  function pushCommand(type, offset, length, summary, extra = {}) {
    commands.push({ type, offset, length, summary, ...extra });
  }

  function lastContentLine() {
    for (let n = lines.length - 1; n >= 0; n--) {
      if (!isVisuallyBlank(lines[n])) return lines[n];
    }
    return null;
  }

  function flushLine(forceEmpty = false) {
    if (!currentRuns.length && !forceEmpty) return;

    if (!currentRuns.length && forceEmpty) {
      const last = lastContentLine();
      if (last && last.type === 'image') {
        currentRuns = [];
        return;
      }
    }
    lines.push({
      type: 'text',
      align: style.align,
      runs: currentRuns.length ? currentRuns : [{ text: ' ', style: { ...style } }],
    });
    currentRuns = [];
  }

  function appendText(text) {
    if (!text) return;
    const parts = text.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (parts[p].length) {
        const last = currentRuns[currentRuns.length - 1];
        const s = { ...style };
        if (last && sameStyle(last.style, s)) {
          last.text += parts[p];
        } else {
          currentRuns.push({ text: parts[p], style: s });
        }
      }
      if (p < parts.length - 1) flushLine(true);
    }
  }

  function sameStyle(a, b) {
    return (
      a.bold === b.bold &&
      a.underline === b.underline &&
      a.doubleWidth === b.doubleWidth &&
      a.doubleHeight === b.doubleHeight &&
      a.font === b.font &&
      a.invert === b.invert
    );
  }

  function applyPrintMode(n) {
    style.font = n & 0x01 ? 'B' : 'A';
    style.bold = !!(n & 0x08);
    style.doubleHeight = !!(n & 0x10);
    style.doubleWidth = !!(n & 0x20);
    style.underline = n & 0x80 ? 1 : 0;
  }

  function applyGsSize(n) {
    const w = ((n >> 4) & 0x0f) + 1;
    const h = (n & 0x0f) + 1;
    style.doubleWidth = w >= 2;
    style.doubleHeight = h >= 2;
    style.widthMult = w;
    style.heightMult = h;
  }

  function readRasterBits(widthBytes, height, payload) {
    const width = widthBytes * 8;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let xb = 0; xb < widthBytes; xb++) {
        const byte = payload[y * widthBytes + xb] || 0;
        for (let bit = 0; bit < 8; bit++) {
          const on = (byte >> (7 - bit)) & 1;
          pixels[y * width + xb * 8 + bit] = on ? 1 : 0;
        }
      }
    }
    return { width, height, pixels };
  }

  while (i < data.length) {
    const b = data[i];
    const start = i;

    if (b === LF) {
      flushLine(true);
      pushCommand('LF', start, 1, 'Line feed');
      i += 1;
      continue;
    }

    if (b === CR) {
      pushCommand('CR', start, 1, 'Carriage return');
      i += 1;
      continue;
    }

    if (b === HT) {
      appendText('    ');
      pushCommand('HT', start, 1, 'Horizontal tab');
      i += 1;
      continue;
    }

    if (b === FF) {
      flushLine();
      lines.push({ type: 'feed', lines: 3 });
      pushCommand('FF', start, 1, 'Form feed');
      i += 1;
      continue;
    }

    if (b === BEL || b === CAN || b === BS) {
      pushCommand('ctrl', start, 1, `Control 0x${b.toString(16)}`);
      i += 1;
      continue;
    }

    if (b === ESC) {
      if (i + 1 >= data.length) {
        truncated = true;
        break;
      }
      const cmd = data[i + 1];

      if (cmd === 0x40) {
        flushLine();
        style = {
          align: 'left',
          bold: false,
          underline: 0,
          doubleWidth: false,
          doubleHeight: false,
          font: 'A',
          invert: false,
          upsideDown: false,
          codepage: 0,
          encoding: DEFAULT_ENCODING,
          charSpacing: 0,
          lineSpacing: 30,
          widthMult: 1,
          heightMult: 1,
        };
        pushCommand('init', start, 2, 'Initialize printer');
        i += 2;
        continue;
      }

      if (cmd === 0x61 && i + 2 < data.length) {
        style.align = alignName(data[i + 2] & 0x03);
        pushCommand('align', start, 3, `Align ${style.align}`);
        i += 3;
        continue;
      }

      if (cmd === 0x45 && i + 2 < data.length) {
        style.bold = !!(data[i + 2] & 0x01);
        pushCommand('bold', start, 3, `Bold ${style.bold ? 'on' : 'off'}`);
        i += 3;
        continue;
      }

      if (cmd === 0x2d && i + 2 < data.length) {
        style.underline = data[i + 2] & 0x03;
        pushCommand('underline', start, 3, `Underline ${style.underline}`);
        i += 3;
        continue;
      }

      if (cmd === 0x21 && i + 2 < data.length) {
        applyPrintMode(data[i + 2]);
        pushCommand('printMode', start, 3, `Print mode 0x${data[i + 2].toString(16)}`);
        i += 3;
        continue;
      }

      if (cmd === 0x4d && i + 2 < data.length) {
        style.font = data[i + 2] === 1 || data[i + 2] === 49 ? 'B' : 'A';
        pushCommand('font', start, 3, `Font ${style.font}`);
        i += 3;
        continue;
      }

      if (cmd === 0x7b && i + 2 < data.length) {
        style.upsideDown = !!(data[i + 2] & 0x01);
        pushCommand('upsideDown', start, 3, `Upside-down ${style.upsideDown}`);
        i += 3;
        continue;
      }

      if (cmd === 0x64 && i + 2 < data.length) {
        const n = data[i + 2];
        flushLine();
        for (let k = 0; k < n; k++) lines.push({ type: 'text', align: style.align, runs: [{ text: ' ', style: { ...style } }] });
        pushCommand('feedLines', start, 3, `Feed ${n} lines`);
        i += 3;
        continue;
      }

      if (cmd === 0x4a && i + 2 < data.length) {
        const n = data[i + 2];
        flushLine();
        lines.push({ type: 'feed', dots: n });
        pushCommand('feedDots', start, 3, `Feed ${n} dots`);
        i += 3;
        continue;
      }

      if (cmd === 0x32) {
        style.lineSpacing = 30;
        pushCommand('lineSpacing', start, 2, 'Default line spacing');
        i += 2;
        continue;
      }
      if (cmd === 0x33 && i + 2 < data.length) {
        style.lineSpacing = data[i + 2];
        pushCommand('lineSpacing', start, 3, `Line spacing ${style.lineSpacing}`);
        i += 3;
        continue;
      }

      if (cmd === 0x20 && i + 2 < data.length) {
        style.charSpacing = data[i + 2];
        pushCommand('charSpacing', start, 3, `Char spacing ${style.charSpacing}`);
        i += 3;
        continue;
      }

      if (cmd === 0x74 && i + 2 < data.length) {
        style.codepage = data[i + 2];
        style.encoding = resolveEncoding(style.codepage);
        pushCommand('codepage', start, 3, `Code page ${style.codepage} (${style.encoding})`);
        i += 3;
        continue;
      }

      if (cmd === 0x52 && i + 2 < data.length) {
        pushCommand('intl', start, 3, `International charset ${data[i + 2]}`);
        i += 3;
        continue;
      }

      if (cmd === 0x69 || cmd === 0x6d) {
        flushLine();
        cut = true;
        lines.push({ type: 'cut', mode: cmd === 0x69 ? 'partial' : 'full' });
        pushCommand('cut', start, 2, `Cut (${cmd === 0x69 ? 'partial' : 'full'})`);
        i += 2;
        continue;
      }

      if (cmd === 0x24 && i + 3 < data.length) {
        pushCommand('absPos', start, 4, `Absolute position ${data[i + 2] + data[i + 3] * 256}`);
        i += 4;
        continue;
      }

      if (cmd === 0x5c && i + 3 < data.length) {
        pushCommand('relPos', start, 4, 'Relative position');
        i += 4;
        continue;
      }

      if (cmd === 0x44) {
        let j = i + 2;
        while (j < data.length && data[j] !== 0x00) j += 1;
        const len = j - start + (j < data.length ? 1 : 0);
        pushCommand('tabs', start, len, 'Set horizontal tabs');
        i = j < data.length ? j + 1 : data.length;
        continue;
      }

      if (cmd === 0x2a && i + 4 < data.length) {
        const m = data[i + 2];
        const nL = data[i + 3];
        const nH = data[i + 4];
        const width = nL + nH * 256;
        let height = 8;
        let bytesPerCol = 1;
        if (m === 32 || m === 33) {
          height = 24;
          bytesPerCol = 3;
        }
        const payloadLen = width * bytesPerCol;
        const payloadStart = i + 5;
        if (payloadStart + payloadLen > data.length) {
          truncated = true;
          pushCommand('bitImage', start, data.length - start, `Bit image truncated (${width}x${height})`, { truncated: true });
          break;
        }
        const payload = data.subarray(payloadStart, payloadStart + payloadLen);

        const pixels = new Uint8Array(width * height);
        for (let x = 0; x < width; x++) {
          for (let by = 0; by < bytesPerCol; by++) {
            const byte = payload[x * bytesPerCol + by];
            for (let bit = 0; bit < 8; bit++) {
              const y = by * 8 + bit;
              if (y < height) {
                pixels[y * width + x] = (byte >> (7 - bit)) & 1;
              }
            }
          }
        }
        flushLine();
        lines.push({ type: 'image', width, height, pixels, align: style.align });
        pushCommand('bitImage', start, 5 + payloadLen, `Bit image ${width}x${height}`);
        i = payloadStart + payloadLen;
        continue;
      }

      if (cmd === 0x70 && i + 4 < data.length) {
        pushCommand('pulse', start, 5, 'Cash drawer pulse');
        i += 5;
        continue;
      }

      if (cmd === 0x63 && i + 2 < data.length) {
        const sub = data[i + 2];

        if ((sub === 0x33 || sub === 0x34 || sub === 0x35) && i + 3 < data.length) {
          pushCommand('config', start, 4, `ESC c ${String.fromCharCode(sub)}`);
          i += 4;
          continue;
        }
      }

      pushCommand('unknownEsc', start, 2, `ESC 0x${cmd.toString(16)}`);
      i += 2;
      continue;
    }

    if (b === GS) {
      if (i + 1 >= data.length) {
        truncated = true;
        break;
      }
      const cmd = data[i + 1];

      if (cmd === 0x21 && i + 2 < data.length) {
        applyGsSize(data[i + 2]);
        pushCommand('charSize', start, 3, `Char size w=${style.widthMult || 1} h=${style.heightMult || 1}`);
        i += 3;
        continue;
      }

      if (cmd === 0x42 && i + 2 < data.length) {
        style.invert = !!(data[i + 2] & 0x01);
        pushCommand('invert', start, 3, `Invert ${style.invert}`);
        i += 3;
        continue;
      }

      if (cmd === 0x56 && i + 2 < data.length) {
        const m = data[i + 2];
        let len = 3;
        let mode = 'full';
        if (m === 65 || m === 66 || m === 97 || m === 98) {
          if (i + 3 >= data.length) {
            truncated = true;
            break;
          }
          len = 4;
          mode = m === 66 || m === 98 ? 'partial' : 'full';
        } else if (m === 1 || m === 49) {
          mode = 'partial';
        }
        flushLine();
        cut = true;
        lines.push({ type: 'cut', mode });
        pushCommand('cut', start, len, `Cut (${mode})`);
        i += len;
        continue;
      }

      if (cmd === 0x28 && i + 4 < data.length) {
        const pL = data[i + 3];
        const pH = data[i + 4];
        const p = pL + pH * 256;
        const total = 5 + p;

        const fn = data[i + 2];
        if (i + total > data.length) {

          truncated = true;
          pushCommand('gsParen', start, data.length - start, `GS ( truncated`, { truncated: true });
          break;
        }

        if (fn === 0x6b) {

          const cn = data[i + 5];
          const fnCode = data[i + 6];
          if (cn === 49 && fnCode === 80 && p >= 4) {

            const qrData = decodeText(data.subarray(i + 8, i + 5 + p), 'utf8');
            style._qrPending = qrData;
            pushCommand('qrStore', start, total, `QR store (${qrData.slice(0, 40)}${qrData.length > 40 ? '…' : ''})`);
          } else if (cn === 49 && fnCode === 81) {
            flushLine();
            const text = style._qrPending || '';
            lines.push({ type: 'qr', data: text, align: style.align });
            pushCommand('qrPrint', start, total, `QR print`);
          } else {
            pushCommand('gsK', start, total, `GS ( k cn=${cn} fn=${fnCode}`);
          }
          i += total;
          continue;
        }

        pushCommand('gsParen', start, total, `GS ( 0x${fn.toString(16)} p=${p}`);
        i += total;
        continue;
      }

      if (cmd === 0x76 && i + 2 < data.length && data[i + 2] === 0x30) {
        if (i + 7 >= data.length) {
          truncated = true;
          break;
        }
        const xL = data[i + 4];
        const xH = data[i + 5];
        const yL = data[i + 6];
        const yH = data[i + 7];
        const widthBytes = xL + xH * 256;
        const height = yL + yH * 256;
        const payloadLen = widthBytes * height;
        const payloadStart = i + 8;
        if (payloadStart + payloadLen > data.length) {
          truncated = true;
          pushCommand('raster', start, data.length - start, `Raster truncated ${widthBytes * 8}x${height}`, { truncated: true });
          break;
        }
        const payload = data.subarray(payloadStart, payloadStart + payloadLen);
        const img = readRasterBits(widthBytes, height, payload);
        flushLine();
        lines.push({ type: 'image', ...img, align: style.align });
        pushCommand('raster', start, 8 + payloadLen, `Raster image ${img.width}x${img.height}`);
        i = payloadStart + payloadLen;
        continue;
      }

      if (cmd === 0x2f && i + 2 < data.length) {
        pushCommand('printNV', start, 3, 'Print NV bit image');
        i += 3;
        continue;
      }

      if (cmd === 0x68 && i + 2 < data.length) {
        style._bcHeight = data[i + 2];
        pushCommand('bcHeight', start, 3, `Barcode height ${data[i + 2]}`);
        i += 3;
        continue;
      }

      if (cmd === 0x77 && i + 2 < data.length) {
        style._bcWidth = data[i + 2];
        pushCommand('bcWidth', start, 3, `Barcode module width ${data[i + 2]}`);
        i += 3;
        continue;
      }

      if (cmd === 0x48 && i + 2 < data.length) {
        pushCommand('hri', start, 3, `HRI position ${data[i + 2]}`);
        i += 3;
        continue;
      }

      if (cmd === 0x66 && i + 2 < data.length) {
        pushCommand('hriFont', start, 3, `HRI font ${data[i + 2]}`);
        i += 3;
        continue;
      }

      if (cmd === 0x6b && i + 2 < data.length) {
        const m = data[i + 2];
        if (m <= 6) {

          let j = i + 3;
          while (j < data.length && data[j] !== 0x00) j += 1;
          const content = decodeText(data.subarray(i + 3, j), 'ascii');
          flushLine();
          lines.push({ type: 'barcode', data: content, symbology: m, align: style.align, height: style._bcHeight || 64 });
          const len = j - start + (j < data.length ? 1 : 0);
          pushCommand('barcode', start, len, `Barcode m=${m} "${content}"`);
          i = j < data.length ? j + 1 : data.length;
          continue;
        }

        if (i + 3 < data.length) {
          const n = data[i + 3];
          if (i + 4 + n > data.length) {
            truncated = true;
            break;
          }
          const content = decodeText(data.subarray(i + 4, i + 4 + n), 'ascii');
          flushLine();
          lines.push({ type: 'barcode', data: content, symbology: m, align: style.align, height: style._bcHeight || 64 });
          pushCommand('barcode', start, 4 + n, `Barcode m=${m} "${content}"`);
          i += 4 + n;
          continue;
        }
      }

      if (cmd === 0x61 && i + 2 < data.length) {
        pushCommand('autoStatus', start, 3, `Auto status ${data[i + 2]}`);
        i += 3;
        continue;
      }

      pushCommand('unknownGs', start, 2, `GS 0x${cmd.toString(16)}`);
      i += 2;
      continue;
    }

    if (b === FS) {
      if (i + 1 >= data.length) {
        truncated = true;
        break;
      }
      const cmd = data[i + 1];
      if ((cmd === 0x21 || cmd === 0x2d || cmd === 0x43 || cmd === 0x53 || cmd === 0x57) && i + 2 < data.length) {
        pushCommand('fs', start, 3, `FS 0x${cmd.toString(16)}`);
        i += 3;
        continue;
      }
      if (cmd === 0x2e) {

        pushCommand('fs', start, 2, 'FS .');
        i += 2;
        continue;
      }
      if (cmd === 0x26) {
        pushCommand('fs', start, 2, 'FS &');
        i += 2;
        continue;
      }
      pushCommand('fs', start, 2, `FS 0x${cmd.toString(16)}`);
      i += 2;
      continue;
    }

    if (b === DLE) {
      if (i + 2 < data.length && data[i + 1] === 0x04) {
        pushCommand('dle', start, 3, 'DLE EOT real-time status');
        i += 3;
        continue;
      }
      if (i + 3 < data.length && data[i + 1] === 0x14) {
        pushCommand('dle', start, 4, 'DLE DC4');
        i += 4;
        continue;
      }
      pushCommand('dle', start, 2, 'DLE');
      i += 2;
      continue;
    }

    if (b >= 0x20 || b >= 0x80) {
      const textBytes = [];
      while (i < data.length) {
        const c = data[i];
        if (
          c === ESC ||
          c === GS ||
          c === FS ||
          c === DLE ||
          c === LF ||
          c === CR ||
          c === HT ||
          c === FF ||
          c === CAN ||
          c === BEL
        ) {
          break;
        }

        if (c < 0x20) break;
        textBytes.push(c);
        i += 1;
      }
      if (textBytes.length) {
        const text = decodeText(textBytes, style.encoding);
        appendText(text);
        pushCommand('text', start, textBytes.length, `Text "${text.replace(/\s+/g, ' ').slice(0, 48)}"`);
      } else {

        pushCommand('byte', start, 1, `0x${b.toString(16)}`);
        i += 1;
      }
      continue;
    }

    pushCommand('byte', start, 1, `0x${b.toString(16)}`);
    i += 1;
  }

  flushLine();

  return {
    commands,
    lines: coalesceImageBands(lines),
    cut,
    truncated,
    paperWidthMm,
    cols,
  };
}

module.exports = { parseEscPos, coalesceImageBands };
