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

module.exports = { getLanAddresses };
