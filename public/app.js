(() => {
  const $ = (sel) => document.querySelector(sel);
  const connStatus = $('#connStatus');
  const tcpAddr = $('#tcpAddr');
  const httpAddr = $('#httpAddr');
  const jobCount = $('#jobCount');
  const byteCount = $('#byteCount');
  const jobsEl = $('#jobs');
  const emptyState = $('#emptyState');
  const cmdList = $('#cmdList');
  const inspectorHint = $('#inspectorHint');
  const previewHint = $('#previewHint');

  let selectedId = null;
  let jobs = [];
  let paperWidthMm = 80;

  function setConn(state, label) {
    connStatus.dataset.state = state;
    connStatus.textContent = label;
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function applySnapshot(snap) {
    if (!snap) return;
    jobs = snap.jobs || [];
    paperWidthMm = snap.paperWidthMm || 80;
    jobCount.textContent = String(snap.stats?.totalJobs ?? jobs.length);
    byteCount.textContent = formatBytes(snap.stats?.bytesReceived || 0);
    document.querySelectorAll('.seg [data-width]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.width) === paperWidthMm);
    });
    renderJobs();
  }

  function renderJobs() {
    emptyState.style.display = jobs.length ? 'none' : 'flex';
    jobsEl.innerHTML = '';
    if (!jobs.length) {
      previewHint.textContent = 'Aguardando impressões na porta 9100…';
      if (!selectedId) {
        cmdList.innerHTML = '';
        inspectorHint.textContent = 'nenhum';
      }
      return;
    }
    previewHint.textContent = `${jobs.length} documento${jobs.length > 1 ? 's' : ''} · mais recente no topo`;

    for (const job of jobs) {
      const el = document.createElement('article');
      el.className = 'job' + (job.id === selectedId ? ' selected' : '');
      el.dataset.id = job.id;
      el.dataset.width = String(job.paperWidthMm || paperWidthMm || 80);
      const when = new Date(job.createdAt);
      const time = when.toLocaleTimeString();
      el.innerHTML = `
        <div class="job-meta">
          <span>${job.source} · ${job.byteLength} bytes · ${job.paperWidthMm || paperWidthMm || 80} mm</span>
          <span>${time}</span>
        </div>
        <div class="receipt-shell">${job.html}</div>
      `;
      el.addEventListener('click', () => selectJob(job.id));
      jobsEl.appendChild(el);
    }

    if (selectedId && !jobs.find((j) => j.id === selectedId)) {
      selectJob(jobs[0]?.id || null);
    } else if (!selectedId && jobs[0]) {
      selectJob(jobs[0].id);
    } else if (selectedId) {
      renderCommands(jobs.find((j) => j.id === selectedId));
    }
  }

  function selectJob(id) {
    selectedId = id;
    document.querySelectorAll('.job').forEach((el) => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
    const job = jobs.find((j) => j.id === id);
    renderCommands(job);
  }

  function renderCommands(job) {
    cmdList.innerHTML = '';
    if (!job) {
      inspectorHint.textContent = 'nenhum';
      return;
    }
    inspectorHint.textContent = `${job.commands.length}`;
    for (const c of job.commands) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="type">${c.type}</span><span class="off">@${c.offset}</span> ${escapeText(c.summary)}`;
      cmdList.appendChild(li);
    }
  }

  function escapeText(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function fetchPublicIp() {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.ip === 'string' ? data.ip : null;
    } catch {
      return null;
    }
  }

  async function resolveDisplayAddresses(msg) {
    const tcpPort = msg.advertiseTcpPort || msg.tcpPort;
    const lan = (msg.lanAddresses && msg.lanAddresses[0]) || null;
    const isProd = msg.appEnv === 'prod';

    if (!isProd) {
      return {
        tcp: lan ? `${lan}:${tcpPort}` : `0.0.0.0:${tcpPort}`,
        http: lan ? `${lan}:${msg.httpPort}` : location.host,
      };
    }

    const publicIp = await fetchPublicIp();
    return {
      tcp: publicIp ? `${publicIp}:${tcpPort}` : `${location.hostname}:${tcpPort}`,
      http: location.host,
    };
  }

  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener('open', () => setConn('live', 'Online'));
    ws.addEventListener('close', () => {
      setConn('offline', 'Reconectando…');
      setTimeout(connectWs, 1500);
    });
    ws.addEventListener('error', () => ws.close());

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'hello') {
        resolveDisplayAddresses(msg).then((addrs) => {
          tcpAddr.textContent = addrs.tcp;
          httpAddr.textContent = addrs.http;
        });
        applySnapshot(msg.snapshot);
      } else if (msg.type === 'snapshot') {
        applySnapshot(msg.snapshot);
      } else if (msg.type === 'job') {

        selectedId = msg.job.id;
      }
    });
  }

  document.querySelectorAll('.seg [data-width]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mm = Number(btn.dataset.width);
      await fetch('/api/printer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperWidthMm: mm }),
      });
    });
  });

  $('#btnClear').addEventListener('click', async () => {
    selectedId = null;
    await fetch('/api/jobs', { method: 'DELETE' });
  });

  $('#btnSample').addEventListener('click', async () => {
    const sample = buildSampleHex();
    const res = await fetch('/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hex: sample }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Falha ao gerar exemplo');
      return;
    }
    const job = await res.json();
    selectedId = job.id;
  });

  function buildSampleHex() {
    const enc = new TextEncoder();
    const parts = [];
    const push = (...bytes) => parts.push(...bytes);
    const text = (s) => parts.push(...enc.encode(s));

    push(0x1b, 0x40);
    push(0x1b, 0x61, 0x01);
    push(0x1d, 0x21, 0x11);
    text('LOJA DEMO');
    push(0x0a);
    push(0x1d, 0x21, 0x00);
    text('ESC/POS Emulator');
    push(0x0a);
    push(0x1b, 0x61, 0x00);
    text('--------------------------------');
    push(0x0a);
    text('Cafe expresso          R$ 8,00');
    push(0x0a);
    text('Pao de queijo          R$ 6,50');
    push(0x0a);
    push(0x1b, 0x45, 0x01);
    text('TOTAL                 R$ 14,50');
    push(0x0a);
    push(0x1b, 0x45, 0x00);
    text('--------------------------------');
    push(0x0a);
    push(0x1b, 0x61, 0x01);
    text('Obrigado!');
    push(0x0a, 0x0a);
    push(0x1d, 0x56, 0x00);

    return parts.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  httpAddr.textContent = location.host;

  fetch('/api/jobs', { method: 'DELETE' })
    .catch(() => {})
    .finally(() => connectWs());
})();
