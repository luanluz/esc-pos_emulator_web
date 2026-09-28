'use strict';

const { createPrinterStore } = require('./printer-store');
const { startTcpServer } = require('./tcp-server');
const { startHttpServer } = require('./http-server');
const { resolveAdvertiseHost } = require('./lan');

const HOST = process.env.HOST || '0.0.0.0';
const TCP_PORT = Number(process.env.TCP_PORT || 9100);
const TCP_HOST_PORT = Number(process.env.TCP_HOST_PORT || TCP_PORT);

const HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT || 3000);
const PAPER_WIDTH = Number(process.env.PAPER_WIDTH || 80);
const APP_ENV = String(process.env.APP_ENV || 'dev').toLowerCase() === 'prod' ? 'prod' : 'dev';

async function main() {
  const advertiseHost = await resolveAdvertiseHost({
    appEnv: APP_ENV,
    override: process.env.ADVERTISE_HOST,
  });

  if (APP_ENV === 'prod') {
    if (advertiseHost) console.log(`[net] advertise host → ${advertiseHost}`);
    else console.warn('[net] could not resolve public IP; set ADVERTISE_HOST or check outbound HTTPS');
  }

  const store = createPrinterStore({ paperWidthMm: PAPER_WIDTH });

  const tcp = startTcpServer({ host: HOST, port: TCP_PORT, store });
  const http = startHttpServer({
    host: HOST,
    port: HTTP_PORT,
    store,
    tcpPort: TCP_PORT,
    advertiseTcpPort: TCP_HOST_PORT,
    advertiseHost,
    appEnv: APP_ENV,
  });

  function shutdown(signal) {
    console.log(`\n${signal} received, shutting down…`);
    tcp.close();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 2000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
