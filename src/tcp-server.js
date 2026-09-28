'use strict';

const net = require('net');
const { getLanAddresses } = require('./lan');

function statusByteFor(n) {

  switch (n) {
    case 1:
      return 0x16;
    case 2:
      return 0x12;
    case 3:
      return 0x12;
    case 4:
      return 0x12;
    default:
      return 0x16;
  }
}

function extractAndReplyStatus(socket, buf, remote) {
  const out = [];
  let i = 0;
  while (i < buf.length) {

    if (buf[i] === 0x10 && i + 2 < buf.length && buf[i + 1] === 0x04) {
      const n = buf[i + 2];
      const reply = Buffer.from([statusByteFor(n)]);
      try {
        socket.write(reply);
        console.log(`[tcp] DLE EOT ${n} → 0x${reply[0].toString(16)} (${remote})`);
      } catch (err) {
        console.warn(`[tcp] status reply failed (${remote}): ${err.message}`);
      }
      i += 3;
      continue;
    }

    if (buf[i] === 0x10 && i + 2 < buf.length && buf[i + 1] === 0x05) {
      try {
        socket.write(Buffer.from([0x16]));
        console.log(`[tcp] DLE ENQ ${buf[i + 2]} → 0x16 (${remote})`);
      } catch (_) {

      }
      i += 3;
      continue;
    }
    out.push(buf[i]);
    i += 1;
  }
  return Buffer.from(out);
}

function startTcpServer({ port, store, host = '0.0.0.0' }) {
  const idleMs = Number(process.env.JOB_IDLE_MS || 350);

  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    let chunks = [];
    let total = 0;
    let idleTimer = null;
    let everReceived = false;
    let printBytes = 0;

    socket.setNoDelay(true);

    console.log(`[tcp] connection from ${remote}`);

    function clearIdle() {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    }

    function bufferSoFar() {
      return chunks.length ? Buffer.concat(chunks, total) : Buffer.alloc(0);
    }

    function hasCutMarker(buf) {
      if (!buf.length) return false;
      const start = Math.max(0, buf.length - 24);
      for (let i = start; i < buf.length - 1; i++) {
        if (buf[i] === 0x1d && buf[i + 1] === 0x56) return true;
        if (buf[i] === 0x1b && (buf[i + 1] === 0x69 || buf[i + 1] === 0x6d)) return true;
      }
      return false;
    }

    function finalize(reason) {
      clearIdle();
      const buffer = bufferSoFar();
      chunks = [];
      total = 0;

      if (!buffer.length) {
        if ((reason === 'close' || reason === 'end') && !everReceived) {
          console.log(`[tcp] closed without data (${remote})`);
        }
        return;
      }

      try {
        const job = store.ingest(buffer, { source: 'tcp', remote });
        console.log(
          `[tcp] job ${job.id.slice(0, 8)}… ${buffer.length} bytes from ${remote} (${reason})`
        );
      } catch (err) {
        console.error(`[tcp] ingest failed (${remote}):`, err);

        try {
          store.ingest(
            Buffer.concat([
              Buffer.from([0x1b, 0x40]),
              Buffer.from(`[erro ao renderizar ${buffer.length} bytes]\n`),
              Buffer.from([0x0a]),
            ]),
            { source: 'tcp-error', remote }
          );
        } catch (_) {

        }
      }
    }

    function scheduleIdle() {
      clearIdle();
      idleTimer = setTimeout(() => finalize('idle'), idleMs);
      if (typeof idleTimer.unref === 'function') idleTimer.unref();
    }

    socket.on('data', (chunk) => {
      everReceived = true;
      console.log(
        `[tcp] +${chunk.length}B from ${remote}  head=${chunk.subarray(0, Math.min(12, chunk.length)).toString('hex')}`
      );

      const printable = extractAndReplyStatus(socket, chunk, remote);
      if (!printable.length) {

        if (printBytes > 0) scheduleIdle();
        return;
      }

      chunks.push(printable);
      total += printable.length;
      printBytes += printable.length;

      if (hasCutMarker(bufferSoFar())) {
        clearIdle();
        idleTimer = setTimeout(() => finalize('cut'), 60);
        if (typeof idleTimer.unref === 'function') idleTimer.unref();
        return;
      }

      scheduleIdle();
    });

    socket.on('end', () => finalize('end'));
    socket.on('close', () => {
      finalize('close');
      clearIdle();
    });

    socket.on('error', (err) => {
      console.warn(`[tcp] socket error (${remote}): ${err.message}`);
      clearIdle();
    });
  });

  server.on('error', (err) => {
    console.error(`[tcp] server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process or set TCP_PORT.`);
      process.exit(1);
    }
  });

  server.listen(port, host, () => {
    const lan = getLanAddresses();
    console.log(`[tcp] ESC/POS printer listening on ${host}:${port}`);
    if (lan.length) {
      for (const ip of lan) {
        console.log(`[tcp] LAN → ${ip}:${port}`);
      }
    } else {
      console.log('[tcp] no LAN IPv4 detected yet');
    }
    console.log(`[tcp] job idle ${idleMs}ms · responds to DLE EOT status probes`);
  });

  return server;
}

module.exports = { startTcpServer };
