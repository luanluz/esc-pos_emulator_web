'use strict';

const iconv = require('iconv-lite');

function tryDec(label, buf) {
  console.log(`\n=== ${label} ===`);
  for (const enc of ['cp850', 'cp860', 'cp437', 'cp858', 'windows-1252', 'latin1', 'utf8']) {
    console.log(enc.padEnd(14), JSON.stringify(iconv.decode(buf, enc)));
  }
}

tryDec('UTF-8 bytes for INFRAÇÃO', Buffer.from('INFRAÇÃO', 'utf8'));
tryDec('CP850 INFRAÇÃO', iconv.encode('INFRAÇÃO', 'cp850'));
tryDec('CP860 INFRAÇÃO', iconv.encode('INFRAÇÃO', 'cp860'));
tryDec('CP1252 INFRAÇÃO', iconv.encode('INFRAÇÃO', 'windows-1252'));

console.log('\n=== Search bytes that cp860-decode to INFRA╟├O ===');
const target = 'INFRA╟├O';
for (let a = 0x80; a <= 0xff; a++) {
  for (let b = 0x80; b <= 0xff; b++) {
    const buf = Buffer.from([0x49, 0x4e, 0x46, 0x52, 0x41, 0x43, a, b, 0x4f]);
    const s860 = iconv.decode(buf, 'cp860');
    if (s860 !== target) continue;
    console.log(
      'bytes',
      a.toString(16),
      b.toString(16),
      'cp850=',
      JSON.stringify(iconv.decode(buf, 'cp850')),
      '1252=',
      JSON.stringify(iconv.decode(buf, 'windows-1252')),
      'utf8=',
      JSON.stringify(iconv.decode(buf, 'utf8'))
    );
  }
}

console.log('\n=== Observed phrases with CP850 encode then CP860 decode ===');
for (const phrase of ['INFRAÇÃO', 'CAÇA', 'Município', 'infração', 'às', 'Localização', 'Descrição']) {
  const b850 = iconv.encode(phrase, 'cp850');
  console.log(
    phrase,
    'hex',
    b850.toString('hex'),
    '→cp860',
    JSON.stringify(iconv.decode(b850, 'cp860'))
  );
}

console.log('\n=== Observed phrases with UTF-8 then CP860 decode ===');
for (const phrase of ['INFRAÇÃO', 'CAÇA', 'Município', 'às']) {
  const bu = Buffer.from(phrase, 'utf8');
  console.log(
    phrase,
    'hex',
    bu.toString('hex'),
    '→cp860',
    JSON.stringify(iconv.decode(bu, 'cp860')),
    '→cp850',
    JSON.stringify(iconv.decode(bu, 'cp850'))
  );
}
