'use strict';

const os = require('os');

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      addrs.push(net.address);
    }
  }
  return addrs;
}

async function fetchPublicIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.ip === 'string' && data.ip ? data.ip : null;
  } catch (err) {
    console.warn(`[net] public IP lookup failed: ${err.message}`);
    return null;
  }
}

async function resolveAdvertiseHost({ appEnv = 'dev', override = '' } = {}) {
  const forced = String(override || '').trim();
  if (forced) return forced;
  if (appEnv !== 'prod') return null;
  return fetchPublicIp();
}

module.exports = { getLanAddresses, fetchPublicIp, resolveAdvertiseHost };
