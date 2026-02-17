const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');
const { AdbManager } = require('./src/adb-manager');
const { ScreenCapture } = require('./src/screen-capture');
const { ContentControl } = require('./src/content-control');
const { DeviceStore } = require('./src/device-store');
const { StreamManager } = require('./src/stream-manager');

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// --- Auto-generate HTTPS certificate for WebCodecs support ---
function getOrCreateCert() {
  const certDir = path.join(__dirname, '.certs');
  const certFile = path.join(certDir, 'cert.pem');
  const keyFile = path.join(certDir, 'key.pem');

  // Try to read existing certificates
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const cert = fs.readFileSync(certFile, 'utf8');
    const key = fs.readFileSync(keyFile, 'utf8');
    if (cert && key && cert.includes('BEGIN')) {
      return { cert, key };
    }
    // Corrupt cert files - delete and regenerate
    console.log('[HTTPS] Existing certificate files are invalid, regenerating...');
  }

  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

  // Method 1: Try selfsigned package
  try {
    console.log('[HTTPS] Generating certificate with selfsigned...');
    const selfsigned = require('selfsigned');
    const attrs = [{ name: 'commonName', value: 'PICO VR Manager' }];
    const pems = selfsigned.generate(attrs, { days: 365 });

    const cert = pems.cert;
    const key = pems.private || pems.key;

    if (!cert || !key) {
      console.warn('[HTTPS] selfsigned returned keys:', Object.keys(pems));
      throw new Error('Incomplete certificate data');
    }

    fs.writeFileSync(certFile, cert);
    fs.writeFileSync(keyFile, key);
    console.log('[HTTPS] Certificate generated with selfsigned');
    return { cert, key };
  } catch (err) {
    console.warn(`[HTTPS] selfsigned failed: ${err.message}`);
  }

  // Method 2: Try OpenSSL command (often available via Git for Windows)
  try {
    console.log('[HTTPS] Trying OpenSSL fallback...');
    const { execSync } = require('child_process');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 365 -nodes -subj "/CN=PICO VR Manager"`,
      { timeout: 15000, stdio: 'pipe' }
    );
    const cert = fs.readFileSync(certFile, 'utf8');
    const key = fs.readFileSync(keyFile, 'utf8');
    if (cert && key) {
      console.log('[HTTPS] Certificate generated with OpenSSL');
      return { cert, key };
    }
  } catch (err) {
    console.warn(`[HTTPS] OpenSSL fallback failed: ${err.message}`);
  }

  // Method 3: Generate using Node.js crypto (no dependencies)
  try {
    console.log('[HTTPS] Trying Node.js crypto fallback...');
    const crypto = require('crypto');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Create a minimal self-signed certificate using OpenSSL-style command
    // via Node's crypto sign capabilities
    const { X509Certificate } = crypto;

    // Use createSign to make a self-signed cert
    // Build a simple PEM certificate
    const certPem = generateSelfSignedCert(privateKey, publicKey);
    if (certPem) {
      fs.writeFileSync(certFile, certPem);
      fs.writeFileSync(keyFile, privateKey);
      console.log('[HTTPS] Certificate generated with Node.js crypto');
      return { cert: certPem, key: privateKey };
    }
  } catch (err) {
    console.warn(`[HTTPS] Node.js crypto fallback failed: ${err.message}`);
  }

  throw new Error('All certificate generation methods failed');
}

// Generate a minimal self-signed X.509 certificate using Node.js crypto
function generateSelfSignedCert(privateKeyPem, publicKeyPem) {
  const crypto = require('crypto');

  // Helper: encode length in ASN.1 DER
  function derLen(len) {
    if (len < 128) return Buffer.from([len]);
    if (len < 256) return Buffer.from([0x81, len]);
    return Buffer.from([0x82, (len >> 8) & 0xFF, len & 0xFF]);
  }
  // Helper: wrap data in ASN.1 tag
  function derWrap(tag, data) {
    const len = derLen(data.length);
    return Buffer.concat([Buffer.from([tag]), len, data]);
  }

  // Parse the public key from PEM to get the raw SPKI
  const pubKeyDer = Buffer.from(
    publicKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64'
  );

  // Serial number
  const serial = derWrap(0x02, Buffer.from([0x01]));

  // Signature algorithm: sha256WithRSAEncryption
  const sha256Oid = Buffer.from('300d06092a864886f70d01010b0500', 'hex');

  // Issuer and Subject: CN=PICO VR Manager
  const cnOid = Buffer.from('0603550403', 'hex'); // OID 2.5.4.3
  const cnVal = derWrap(0x0C, Buffer.from('PICO VR Manager')); // UTF8String
  const cnSeq = derWrap(0x30, Buffer.concat([cnOid, cnVal]));
  const cnSet = derWrap(0x31, cnSeq);
  const name = derWrap(0x30, cnSet);

  // Validity: now to now+365 days
  const now = new Date();
  const later = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const fmtDate = (d) => {
    const s = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
    return derWrap(0x17, Buffer.from(s)); // UTCTime
  };
  const validity = derWrap(0x30, Buffer.concat([fmtDate(now), fmtDate(later)]));

  // Version: v3
  const version = derWrap(0xA0, derWrap(0x02, Buffer.from([0x02])));

  // TBS Certificate
  const tbs = derWrap(0x30, Buffer.concat([
    version, serial, sha256Oid, name, validity, name, pubKeyDer
  ]));

  // Sign the TBS certificate
  const sign = crypto.createSign('SHA256');
  sign.update(tbs);
  const signature = sign.sign(privateKeyPem);

  // Bit string wrapper for signature
  const sigBits = derWrap(0x03, Buffer.concat([Buffer.from([0x00]), signature]));

  // Full certificate
  const cert = derWrap(0x30, Buffer.concat([tbs, sha256Oid, sigBits]));

  // Convert to PEM
  const b64 = cert.toString('base64');
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
}

const app = express();

// Create both HTTP and HTTPS servers
const httpServer = http.createServer(app);
let httpsServer;
try {
  const certs = getOrCreateCert();
  httpsServer = https.createServer(certs, app);
  console.log(`[HTTPS] HTTPS server ready on port ${HTTPS_PORT}`);
} catch (err) {
  console.warn(`[HTTPS] Failed to create HTTPS server: ${err.message}`);
  console.warn('[HTTPS] WebCodecs H.264 streaming requires HTTPS - falling back to MJPEG');
}

// WebSocket on both HTTP and HTTPS
const wssHttp = new WebSocket.Server({ server: httpServer, path: '/ws' });
const wssHttps = httpsServer ? new WebSocket.Server({ server: httpsServer, path: '/ws' }) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const deviceStore = new DeviceStore();
const adbManager = new AdbManager(deviceStore);
const screenCapture = new ScreenCapture(adbManager, deviceStore);
const contentControl = new ContentControl(adbManager);
const streamManager = new StreamManager(adbManager, screenCapture);

// --- REST API ---

app.get('/api/status', async (req, res) => {
  let adbAvailable = false;
  let adbVersion = null;
  try {
    const output = await adbManager.adbExec('version', 5000);
    adbAvailable = true;
    adbVersion = output.split('\n')[0];
  } catch {}

  res.json({
    server: 'running',
    adb: adbAvailable,
    adbVersion,
    connectedDevices: deviceStore.getConnectedDevices().length,
    totalDevices: deviceStore.getAllDevices().length
  });
});

app.get('/api/devices', (req, res) => {
  res.json(deviceStore.getAllDevices());
});

app.post('/api/devices/scan', async (req, res) => {
  try {
    const devices = await adbManager.scanNetwork();
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/connect', async (req, res) => {
  try {
    await adbManager.connectDevice(req.params.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/disconnect', async (req, res) => {
  try {
    await adbManager.disconnectDevice(req.params.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/devices/:ip/info', async (req, res) => {
  try {
    const info = await adbManager.getDeviceInfo(req.params.ip);
    res.json(info);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/launch', async (req, res) => {
  try {
    const { packageName } = req.body;
    await contentControl.launchApp(req.params.ip, packageName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/stop', async (req, res) => {
  try {
    const { packageName } = req.body;
    await contentControl.stopApp(req.params.ip, packageName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/devices/:ip/apps', async (req, res) => {
  try {
    const apps = await contentControl.listApps(req.params.ip);
    res.json(apps);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/volume', async (req, res) => {
  try {
    const { level } = req.body;
    await contentControl.setVolume(req.params.ip, level);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/brightness', async (req, res) => {
  try {
    const { level } = req.body;
    await contentControl.setBrightness(req.params.ip, level);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/reboot', async (req, res) => {
  try {
    await contentControl.reboot(req.params.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:ip/push', async (req, res) => {
  try {
    const { localPath, remotePath } = req.body;
    await contentControl.pushFile(req.params.ip, localPath, remotePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Bulk operations ---

app.post('/api/all/launch', async (req, res) => {
  try {
    const { packageName } = req.body;
    const results = await contentControl.launchOnAll(packageName, deviceStore);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/all/stop', async (req, res) => {
  try {
    const { packageName } = req.body;
    const results = await contentControl.stopOnAll(packageName, deviceStore);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/all/volume', async (req, res) => {
  try {
    const { level } = req.body;
    const results = await contentControl.setVolumeOnAll(level, deviceStore);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Single screenshot (uses screencap + sharp) ---

app.get('/api/devices/:ip/screenshot', async (req, res) => {
  try {
    const buffer = await screenCapture.captureScreenshot(req.params.ip);
    res.set('Content-Type', 'image/jpeg');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- MJPEG fallback stream (slow, uses screencap) ---

app.get('/api/devices/:ip/mjpeg', async (req, res) => {
  const ip = req.params.ip;
  console.log(`[MJPEG] Starting screencap stream for ${ip} (slow fallback)`);

  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
  });

  let running = true;
  let frameCount = 0;
  req.on('close', () => {
    running = false;
    console.log(`[MJPEG] Stream closed for ${ip} after ${frameCount} frames`);
  });

  while (running) {
    try {
      const buffer = await screenCapture.captureScreenshot(ip);
      if (buffer && running) {
        const ct = buffer[0] === 0xFF && buffer[1] === 0xD8 ? 'image/jpeg' : 'image/png';
        res.write(`--frame\r\nContent-Type: ${ct}\r\nContent-Length: ${buffer.length}\r\n\r\n`);
        res.write(buffer);
        res.write('\r\n');
        frameCount++;
        if (frameCount === 1) console.log(`[MJPEG] First frame for ${ip} (${buffer.length} bytes)`);
      }
    } catch (err) {
      if (frameCount === 0) console.error(`[MJPEG] Error for ${ip}: ${err.message}`);
      await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 50));
  }
});

// --- WebSocket: H.264 real-time streaming + device status ---

function setupWebSocket(wssInstance) {
  if (!wssInstance) return;

  wssInstance.on('connection', (ws) => {
    console.log('[WS] Client connected');
    const unsubscribers = new Map();

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.type) {
          case 'start_stream': {
            const ip = data.ip;
            if (unsubscribers.has(ip)) break;
            const h264 = data.h264 !== false;
            console.log(`[WS] Start stream for ${ip} (h264: ${h264})`);
            const unsub = streamManager.subscribe(ip, ws, { h264 });
            unsubscribers.set(ip, unsub);
            break;
          }
          case 'stop_stream': {
            const ip = data.ip;
            const unsub = unsubscribers.get(ip);
            if (unsub) {
              unsub();
              unsubscribers.delete(ip);
            }
            break;
          }
          case 'start_all_streams': {
            const h264All = data.h264 !== false;
            const devices = deviceStore.getConnectedDevices();
            devices.forEach(device => {
              if (!unsubscribers.has(device.ip)) {
                const unsub = streamManager.subscribe(device.ip, ws, { h264: h264All });
                unsubscribers.set(device.ip, unsub);
              }
            });
            break;
          }
          case 'stop_all_streams': {
            for (const [ip, unsub] of unsubscribers) {
              unsub();
            }
            unsubscribers.clear();
            break;
          }
        }
      } catch (err) {
        console.error('[WS] Error processing message:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      for (const [ip, unsub] of unsubscribers) {
        unsub();
      }
      unsubscribers.clear();
    });
  });
}

setupWebSocket(wssHttp);
setupWebSocket(wssHttps);

// --- Status broadcast (to all WS clients on both servers) ---

function broadcastToAll(data) {
  const msg = JSON.stringify(data);
  [wssHttp, wssHttps].forEach(wss => {
    if (!wss) return;
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });
}

setInterval(() => {
  broadcastToAll({ type: 'device_status', devices: deviceStore.getAllDevices() });
}, 5000);

// --- Start servers ---

httpServer.listen(PORT, '0.0.0.0', () => {
  const httpsInfo = httpsServer ? `║  HTTPS: https://0.0.0.0:${HTTPS_PORT}  (use this!)    ║` : '';
  console.log(`
╔══════════════════════════════════════════════════╗
║          PICO 4 VR Manager                       ║
║  HTTP:  http://0.0.0.0:${PORT}                     ║
${httpsInfo}
║                                                  ║
║  Use HTTPS for real-time streaming (30 FPS)      ║
║  Accept the certificate warning in your browser  ║
╚══════════════════════════════════════════════════╝
  `);

  adbManager.adbExec('version').then(output => {
    console.log(`[Startup] ADB available: ${output.split('\n')[0]}`);
    return adbManager.scanNetwork();
  }).then(devices => {
    console.log(`[Startup] Found ${devices.length} device(s) on network`);
  }).catch(err => {
    console.error(`[Startup] ADB check/scan failed: ${err.message}`);
    console.log('[Startup] Make sure ADB is installed and in PATH');
  });
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0');
}
