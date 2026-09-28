'use strict';

const { createPrinterStore } = require('./printer-store');
const { startTcpServer } = require('./tcp-server');
const { startHttpServer } = require('./http-server');

const HOST = process.env.HOST || '0.0.0.0';
const TCP_PORT = Number(process.env.TCP_PORT || 9100);

const HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT || 3000);
const PAPER_WIDTH = Number(process.env.PAPER_WIDTH || 80);

const store = createPrinterStore({ paperWidthMm: PAPER_WIDTH });

const tcp = startTcpServer({ host: HOST, port: TCP_PORT, store });
const http = startHttpServer({ host: HOST, port: HTTP_PORT, store, tcpPort: TCP_PORT });

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down…`);
  tcp.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
