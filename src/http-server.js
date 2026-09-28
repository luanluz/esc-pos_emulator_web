'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { getLanAddresses } = require('./lan');

function startHttpServer({
  port,
  store,
  tcpPort,
  advertiseTcpPort,
  appEnv = 'dev',
  host = '0.0.0.0',
}) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '8mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const publicTcpPort = advertiseTcpPort || tcpPort;

  function networkInfo() {
    return {
      host,
      appEnv,
      tcpPort,
      advertiseTcpPort: publicTcpPort,
      httpPort: port,
      lanAddresses: getLanAddresses(),
    };
  }

  app.get('/api/status', (_req, res) => {
    res.json({
      ...networkInfo(),
      ...store.snapshot(),
    });
  });

  app.get('/api/jobs', (_req, res) => {
    res.json(store.snapshot().jobs);
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  app.get('/api/jobs/:id/raw', (req, res) => {
    const raw = store.getJobRaw(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Job not found' });
    res.type('application/octet-stream').send(raw);
  });

  app.delete('/api/jobs', (_req, res) => {
    store.clearJobs();
    res.json({ ok: true });
  });

  app.patch('/api/printer', (req, res) => {
    const body = req.body || {};
    if (body.paperWidthMm != null) store.setPaperWidth(Number(body.paperWidthMm));
    if (body.status) store.setStatus(body.status);
    res.json(store.snapshot());
  });

  app.post('/api/print', (req, res) => {
    try {
      let buffer;
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/octet-stream') && Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else if (req.body && req.body.hex) {
        const hex = String(req.body.hex).replace(/[^0-9a-fA-F]/g, '');
        if (hex.length % 2 !== 0) {
          return res.status(400).json({ error: 'Odd hex length' });
        }
        buffer = Buffer.from(hex, 'hex');
      } else if (req.body && req.body.base64) {
        buffer = Buffer.from(String(req.body.base64), 'base64');
      } else if (req.body && req.body.text != null) {
        const text = String(req.body.text);
        buffer = Buffer.concat([
          Buffer.from([0x1b, 0x40]),
          Buffer.from(text, 'utf8'),
          Buffer.from([0x0a, 0x1d, 0x56, 0x00]),
        ]);
      } else {
        return res.status(400).json({ error: 'Provide hex, base64, text, or raw octet-stream' });
      }

      const job = store.ingest(buffer, { source: 'http', remote: req.ip });
      res.status(201).json(job);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Invalid payload' });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  }

  store.on('job', (job) => broadcast({ type: 'job', job }));
  store.on('change', (snapshot) => broadcast({ type: 'snapshot', snapshot }));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'hello',
      ...networkInfo(),
      snapshot: store.snapshot(),
    }));
  });

  server.on('error', (err) => {
    console.error(`[http] server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process or set HTTP_PORT.`);
      process.exit(1);
    }
  });

  server.listen(port, host, () => {
    const lan = getLanAddresses();
    console.log(`[http] web UI listening on ${host}:${port}`);
    console.log(`[http] local → http://localhost:${port}`);
    for (const ip of lan) {
      console.log(`[http] LAN   → http://${ip}:${port}`);
      console.log(`[hint] print to ${ip}:${publicTcpPort}`);
    }
  });

  return server;
}

module.exports = { startHttpServer };
