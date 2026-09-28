'use strict';

const net = require('net');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.TCP_PORT || 9100);

function encode(str) {
  return Buffer.from(str, 'utf8');
}

const chunks = [
  Buffer.from([0x1b, 0x40]),
  Buffer.from([0x1b, 0x61, 0x01]),
  Buffer.from([0x1d, 0x21, 0x11]),
  encode('VIRTUAL PRINTER\n'),
  Buffer.from([0x1d, 0x21, 0x00]),
  encode('npm run sample\n'),
  Buffer.from([0x1b, 0x61, 0x00]),
  encode('--------------------------------\n'),
  encode('Item A                   10.00\n'),
  encode('Item B                    5.50\n'),
  Buffer.from([0x1b, 0x45, 0x01]),
  encode('TOTAL                    15.50\n'),
  Buffer.from([0x1b, 0x45, 0x00]),
  encode('--------------------------------\n'),
  Buffer.from([0x1b, 0x61, 0x01]),
  encode('Thank you\n\n'),
  Buffer.from([0x1d, 0x56, 0x00]),
];

const payload = Buffer.concat(chunks);

const socket = net.connect({ host, port }, () => {
  console.log(`Sending ${payload.length} bytes to ${host}:${port}`);
  socket.end(payload);
});

socket.on('error', (err) => {
  console.error(`Failed: ${err.message}`);
  console.error('Is the emulator running? (npm start)');
  process.exit(1);
});

socket.on('close', () => {
  console.log('Done — check the web UI preview.');
});
