'use strict';

const FORCE = process.env.FORCE_CODEPAGE || null;
const DEFAULT_ENCODING = FORCE || process.env.DEFAULT_CODEPAGE || 'windows-1252';

const CODE_PAGES = {
  0: DEFAULT_ENCODING,
  1: 'cp932',
  2: DEFAULT_ENCODING,
  3: DEFAULT_ENCODING,
  4: 'cp863',
  5: DEFAULT_ENCODING,
  6: 'cp852',
  7: 'cp852',
  8: 'cp865',
  11: 'cp852',
  12: 'cp858',
  13: 'cp855',
  14: 'cp866',
  15: 'cp857',
  16: 'windows-1252',
  17: 'cp866',
  18: 'cp852',
  19: 'cp858',
  21: 'cp855',
  22: 'cp866',
  23: 'cp852',
  24: 'cp858',
  25: 'cp866',
  26: 'cp852',
  27: 'cp858',
  28: 'cp1251',
  29: 'windows-1252',
  30: 'cp865',
  31: 'cp1254',
  32: 'cp1255',
  33: 'cp1256',
  34: 'cp1257',
  35: 'cp1258',
  36: 'cp874',
  37: 'windows-1252',
  38: 'cp866',
  39: 'cp852',
  40: 'cp858',
  41: 'windows-1252',
  42: 'windows-1252',
  43: 'windows-1252',
  44: 'windows-1252',
  45: 'windows-1252',
  46: 'windows-1252',
  47: 'windows-1252',
  48: 'windows-1252',
  49: 'windows-1252',
  50: 'windows-1252',
  51: 'windows-1252',
  52: 'windows-1252',
  53: 'windows-1252',
  54: 'windows-1252',
  255: DEFAULT_ENCODING,
};

function resolveEncoding(codepage) {
  if (FORCE) return FORCE;
  if (codepage == null) return DEFAULT_ENCODING;
  return CODE_PAGES[codepage] || DEFAULT_ENCODING;
}

module.exports = { CODE_PAGES, DEFAULT_ENCODING, FORCE, resolveEncoding };
