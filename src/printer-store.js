'use strict';

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { parseEscPos } = require('./escpos/parser');
const { renderToHtml } = require('./escpos/renderer');

function createPrinterStore(options = {}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const state = {
    paperWidthMm: options.paperWidthMm === 58 ? 58 : 80,
    jobs: [],
    maxJobs: 50,
    status: {
      online: true,
      paperOut: false,
      coverOpen: false,
      nearEnd: false,
    },
    stats: {
      totalJobs: 0,
      bytesReceived: 0,
    },
  };

  function snapshot() {
    return {
      paperWidthMm: state.paperWidthMm,
      status: { ...state.status },
      stats: { ...state.stats },
      jobs: state.jobs.map(publicJob),
    };
  }

  function publicJob(job) {
    return {
      id: job.id,
      createdAt: job.createdAt,
      byteLength: job.byteLength,
      source: job.source,
      remote: job.remote,
      paperWidthMm: job.paperWidthMm,
      html: job.html,
      commands: job.commands,
      cut: job.cut,
      truncated: job.truncated,
    };
  }

  function ingest(buffer, meta = {}) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (!buf.length) return null;

    const parsed = parseEscPos(buf, { paperWidthMm: state.paperWidthMm });
    const html = renderToHtml(parsed, { paperWidthMm: state.paperWidthMm });

    const job = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      byteLength: buf.length,
      source: meta.source || 'tcp',
      remote: meta.remote || null,
      paperWidthMm: state.paperWidthMm,
      raw: buf,
      commands: parsed.commands.map((c) => ({
        type: c.type,
        offset: c.offset,
        length: c.length,
        summary: c.summary,
      })),
      html,
      cut: parsed.cut,
      truncated: parsed.truncated,
    };

    state.jobs.unshift(job);
    if (state.jobs.length > state.maxJobs) {
      state.jobs.length = state.maxJobs;
    }

    state.stats.totalJobs += 1;
    state.stats.bytesReceived += buf.length;

    const pub = publicJob(job);
    emitter.emit('job', pub);
    emitter.emit('change', snapshot());
    return pub;
  }

  function clearJobs() {
    state.jobs = [];
    state.stats.totalJobs = 0;
    state.stats.bytesReceived = 0;
    emitter.emit('change', snapshot());
  }

  function setPaperWidth(mm) {
    state.paperWidthMm = mm === 58 ? 58 : 80;
    emitter.emit('change', snapshot());
  }

  function setStatus(partial) {
    Object.assign(state.status, partial);
    emitter.emit('change', snapshot());
  }

  function getJob(id) {
    const job = state.jobs.find((j) => j.id === id);
    return job ? publicJob(job) : null;
  }

  function getJobRaw(id) {
    const job = state.jobs.find((j) => j.id === id);
    return job ? job.raw : null;
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
    ingest,
    clearJobs,
    setPaperWidth,
    setStatus,
    getJob,
    getJobRaw,
    snapshot,
  };
}

module.exports = { createPrinterStore };
