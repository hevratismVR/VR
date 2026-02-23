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

  // Try to read existing certificates and validate them
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const cert = fs.readFileSync(certFile, 'utf8');
    const key = fs.readFileSync(keyFile, 'utf8');
    if (cert && key && cert.includes('BEGIN CERTIFICATE') && key.includes('BEGIN')) {
      // Validate cert is parseable by Node.js
      try {
        const crypto = require('crypto');
        if (crypto.X509Certificate) {
          new crypto.X509Certificate(cert);
        }
        return { cert, key };
      } catch {
        console.log('[HTTPS] Existing certificate is malformed, regenerating...');
      }
    } else {
      console.log('[HTTPS] Existing certificate files are invalid, regenerating...');
    }
    // Delete bad cert files
    try { fs.unlinkSync(certFile); } catch {}
    try { fs.unlinkSync(keyFile); } catch {}
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

  // Method 2: Try OpenSSL command (check system PATH + Git for Windows locations)
  {
    const { execSync } = require('child_process');
    const opensslCandidates = [
      'openssl',
      'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
      'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
    ];
    for (const opensslCmd of opensslCandidates) {
      try {
        console.log(`[HTTPS] Trying OpenSSL: ${opensslCmd}`);
        execSync(
          `"${opensslCmd}" req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 365 -nodes -subj "/CN=PICO VR Manager"`,
          { timeout: 15000, stdio: 'pipe' }
        );
        const cert = fs.readFileSync(certFile, 'utf8');
        const key = fs.readFileSync(keyFile, 'utf8');
        if (cert && key) {
          console.log(`[HTTPS] Certificate generated with OpenSSL (${opensslCmd})`);
          return { cert, key };
        }
      } catch (err) {
        // Try next candidate
      }
    }
    console.warn('[HTTPS] All OpenSSL candidates failed');
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
    // UTCTime format: YYMMDDHHMMSSZ (2-digit year)
    const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return derWrap(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${mi}${ss}Z`));
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
    scrcpy: !!adbManager.scrcpyPath,
    scrcpyPath: adbManager.scrcpyPath || null,
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

// --- Device Number Management ---

app.get('/api/devices/:ip/number', (req, res) => {
  const num = deviceStore.getDeviceNumber(req.params.ip);
  res.json({ success: true, ip: req.params.ip, deviceNumber: num });
});

app.post('/api/devices/:ip/number', (req, res) => {
  const { number } = req.body;
  if (!number || isNaN(number)) {
    return res.status(400).json({ success: false, error: 'Invalid number' });
  }
  deviceStore.setDeviceNumber(req.params.ip, parseInt(number));
  console.log(`[Config] Device ${req.params.ip} assigned number #${number}`);
  res.json({ success: true, ip: req.params.ip, deviceNumber: parseInt(number) });
});

app.get('/api/device-numbers', (req, res) => {
  res.json({ success: true, numbers: deviceStore.deviceNumbers });
});

// --- Scrcpy window management ---

// Track running scrcpy windows
const scrcpyWindows = new Map(); // ip -> child process
const overlayWindows = new Map(); // ip -> overlay child process

app.post('/api/devices/:ip/mirror', async (req, res) => {
  const ip = req.params.ip;

  // Kill existing window for this device
  if (scrcpyWindows.has(ip)) {
    try { scrcpyWindows.get(ip).kill(); } catch {}
    scrcpyWindows.delete(ip);
  }

  const scrcpyPath = adbManager.scrcpyPath;
  if (!scrcpyPath) {
    return res.status(500).json({ success: false, error: 'scrcpy not found' });
  }

  // Calculate window position in grid (up to 5 devices)
  const allDevices = deviceStore.getConnectedDevices();
  const idx = allDevices.findIndex(d => d.ip === ip);
  const pos = getWindowPosition(idx >= 0 ? idx : scrcpyWindows.size, allDevices.length);

  // Get persistent device number
  const deviceNum = deviceStore.getDeviceNumber(ip);
  const titleLabel = deviceNum ? `[ #${deviceNum} ]` : `PICO ${idx + 1}`;

  const args = [
    '-s', `${ip}:5555`,
    '--video-codec=h265',
    '--video-bit-rate=8000000',
    '--max-fps=30',
    '--no-audio',
    `--window-title=${titleLabel} (${ip})`,
    `--window-x=${pos.x}`,
    `--window-y=${pos.y}`,
    `--window-width=${pos.w}`,
    `--window-height=${pos.h}`,
  ];

  console.log(`[Mirror] Launching scrcpy window for ${ip} at ${pos.x},${pos.y} (${pos.w}x${pos.h})`);
  const scrcpyDir = require('path').dirname(scrcpyPath);

  const proc = require('child_process').spawn(scrcpyPath, args, {
    cwd: scrcpyDir,
    env: { ...process.env, ADB: adbManager.adbPath },
    detached: true,
    stdio: 'pipe',
  });

  proc.unref();
  scrcpyWindows.set(ip, proc);

  // Log scrcpy output for debugging
  if (proc.stderr) proc.stderr.on('data', d => console.log(`[scrcpy ${ip}] ${d.toString().trim()}`));
  if (proc.stdout) proc.stdout.on('data', d => console.log(`[scrcpy ${ip}] ${d.toString().trim()}`));

  proc.on('close', (code) => {
    scrcpyWindows.delete(ip);
    console.log(`[Mirror] scrcpy window closed for ${ip} (code: ${code})`);
    // Auto-restart if scrcpy crashed (not manually stopped)
    if (code !== 0 && code !== null && !proc._manualStop) {
      console.log(`[Mirror] Auto-restarting scrcpy for ${ip} in 3 seconds...`);
      setTimeout(() => {
        if (!scrcpyWindows.has(ip)) {
          const restartProc = require('child_process').spawn(scrcpyPath, args, {
            cwd: scrcpyDir,
            env: { ...process.env, ADB: adbManager.adbPath },
            detached: true,
            stdio: 'ignore',
          });
          restartProc.unref();
          scrcpyWindows.set(ip, restartProc);
          restartProc.on('close', (c) => {
            scrcpyWindows.delete(ip);
            console.log(`[Mirror] Restarted scrcpy closed for ${ip} (code: ${c})`);
          });
          console.log(`[Mirror] Restarted scrcpy for ${ip}`);
        }
      }, 3000);
    }
  });

  // Launch number overlay on the scrcpy window
  if (deviceNum) {
    launchOverlay(ip, deviceNum, pos);
  }

  res.json({ success: true, position: pos });
});

app.post('/api/mirror/all', async (req, res) => {
  const devices = deviceStore.getConnectedDevices();
  if (devices.length === 0) {
    return res.json({ success: false, error: 'No connected devices' });
  }

  const results = [];
  for (const device of devices) {
    try {
      // Kill existing
      if (scrcpyWindows.has(device.ip)) {
        try { scrcpyWindows.get(device.ip).kill(); } catch {}
        scrcpyWindows.delete(device.ip);
      }

      const scrcpyPath = adbManager.scrcpyPath;
      const idx = devices.indexOf(device);
      const pos = getWindowPosition(idx, devices.length);

      // Get persistent device number
      const deviceNum = deviceStore.getDeviceNumber(device.ip);
      const titleLabel = deviceNum ? `[ #${deviceNum} ]` : `PICO ${idx + 1}`;

      const args = [
        '-s', `${device.ip}:5555`,
        '--video-codec=h265',
        '--video-bit-rate=8000000',
        '--max-fps=30',
        '--no-audio',
        `--window-title=${titleLabel} (${device.ip})`,
        `--window-x=${pos.x}`,
        `--window-y=${pos.y}`,
        `--window-width=${pos.w}`,
        `--window-height=${pos.h}`,
      ];

      const scrcpyDir = require('path').dirname(scrcpyPath);
      const proc = require('child_process').spawn(scrcpyPath, args, {
        cwd: scrcpyDir,
        env: { ...process.env, ADB: adbManager.adbPath },
        detached: true,
        stdio: 'pipe',
      });
      proc.unref();
      scrcpyWindows.set(device.ip, proc);

      // Log scrcpy output for debugging
      if (proc.stderr) proc.stderr.on('data', d => console.log(`[scrcpy ${device.ip}] ${d.toString().trim()}`));
      if (proc.stdout) proc.stdout.on('data', d => console.log(`[scrcpy ${device.ip}] ${d.toString().trim()}`));

      proc.on('close', (code) => {
        scrcpyWindows.delete(device.ip);
        console.log(`[Mirror] scrcpy closed for ${device.ip} (code: ${code})`);
        // Auto-restart if scrcpy crashed (not manually stopped)
        if (code !== 0 && code !== null && !proc._manualStop) {
          console.log(`[Mirror] Auto-restarting scrcpy for ${device.ip} in 3 seconds...`);
          setTimeout(() => {
            if (!scrcpyWindows.has(device.ip)) {
              const restartProc = require('child_process').spawn(scrcpyPath, args, {
                cwd: scrcpyDir,
                env: { ...process.env, ADB: adbManager.adbPath },
                detached: true,
                stdio: 'ignore',
              });
              restartProc.unref();
              scrcpyWindows.set(device.ip, restartProc);
              restartProc.on('close', (c) => {
                scrcpyWindows.delete(device.ip);
                console.log(`[Mirror] Restarted scrcpy closed for ${device.ip} (code: ${c})`);
              });
              console.log(`[Mirror] Restarted scrcpy for ${device.ip}`);
            }
          }, 3000);
        }
      });

      // Launch number overlay
      if (deviceNum) {
        launchOverlay(device.ip, deviceNum, pos);
      }

      results.push({ ip: device.ip, success: true });
      console.log(`[Mirror] Launched scrcpy for ${device.ip} at ${pos.x},${pos.y}`);

      // Small delay between launches to avoid ADB congestion
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      results.push({ ip: device.ip, success: false, error: err.message });
    }
  }

  res.json({ success: true, results });
});

app.post('/api/mirror/stop', (req, res) => {
  for (const [ip, proc] of scrcpyWindows) {
    try { proc._manualStop = true; proc.kill(); } catch {}
    killOverlay(ip);
  }
  scrcpyWindows.clear();
  console.log('[Mirror] All scrcpy windows closed (manual stop)');
  res.json({ success: true });
});

// --- Overlay management ---
function launchOverlay(ip, deviceNum, pos) {
  killOverlay(ip); // kill existing overlay for this IP

  const overlayScript = path.join(__dirname, 'overlay.ps1');
  const args = [
    '-ExecutionPolicy', 'Bypass',
    '-File', overlayScript,
    '-Number', String(deviceNum),
    '-X', String(pos.x),
    '-Y', String(pos.y),
    '-WinWidth', String(pos.w),
  ];

  try {
    const proc = require('child_process').spawn('powershell.exe', args, {
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
    overlayWindows.set(ip, proc);
    proc.on('close', () => overlayWindows.delete(ip));
    console.log(`[Overlay] Launched #${deviceNum} overlay for ${ip} at ${pos.x},${pos.y}`);
  } catch (err) {
    console.error(`[Overlay] Failed to launch for ${ip}:`, err.message);
  }
}

function killOverlay(ip) {
  if (overlayWindows.has(ip)) {
    try { overlayWindows.get(ip).kill(); } catch {}
    overlayWindows.delete(ip);
  }
}

// Calculate grid position for scrcpy windows (1920x1080 screen)
function getWindowPosition(index, total) {
  const screenW = 1920, screenH = 1080;
  const padding = 5;

  if (total <= 1) {
    return { x: 50, y: 50, w: screenW - 100, h: screenH - 100 };
  }
  if (total <= 2) {
    const w = Math.floor(screenW / 2) - padding * 2;
    const h = screenH - padding * 2;
    return { x: index * (w + padding * 2) + padding, y: padding, w, h };
  }
  if (total <= 4) {
    const cols = 2, rows = 2;
    const w = Math.floor(screenW / cols) - padding * 2;
    const h = Math.floor(screenH / rows) - padding * 2;
    const col = index % cols, row = Math.floor(index / cols);
    return { x: col * (w + padding * 2) + padding, y: row * (h + padding * 2) + padding, w, h };
  }
  // 5 devices: 3 top, 2 bottom centered
  if (index < 3) {
    const w = Math.floor(screenW / 3) - padding * 2;
    const h = Math.floor(screenH / 2) - padding * 2;
    return { x: index * (w + padding * 2) + padding, y: padding, w, h };
  } else {
    const w = Math.floor(screenW / 3) - padding * 2;
    const h = Math.floor(screenH / 2) - padding * 2;
    const bottomIdx = index - 3;
    const offsetX = Math.floor(screenW / 6); // center 2 under 3
    return { x: offsetX + bottomIdx * (w + padding * 2) + padding, y: h + padding * 2 + padding, w, h };
  }
}

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

  // Ping/pong keepalive - prevent timeout disconnects
  const pingInterval = setInterval(() => {
    wssInstance.clients.forEach(client => {
      if (client.isAlive === false) {
        console.log('[WS] Client not responding to ping, terminating');
        return client.terminate();
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30000);

  wssInstance.on('close', () => clearInterval(pingInterval));

  wssInstance.on('connection', (ws) => {
    console.log('[WS] Client connected');
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
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

  adbManager.adbExec('version').then(async (output) => {
    console.log(`[Startup] ADB available: ${output.split('\n')[0]}`);

    // Phase 1: Try reconnecting to known/saved devices first (fast)
    const savedIPs = Object.keys(deviceStore.deviceNumbers);
    if (savedIPs.length > 0) {
      console.log(`[Startup] Reconnecting to ${savedIPs.length} saved device(s): ${savedIPs.join(', ')}`);
      const reconnectResults = await Promise.allSettled(
        savedIPs.map(ip => adbManager.connectDevice(ip).catch(() => null))
      );
      const reconnected = reconnectResults.filter(r => r.status === 'fulfilled' && r.value).length;
      console.log(`[Startup] Reconnected to ${reconnected}/${savedIPs.length} saved device(s)`);
    }

    // Phase 2: Full network scan to find any new devices
    const devices = await adbManager.scanNetwork();
    console.log(`[Startup] Total: ${devices.length} device(s) found`);
  }).catch(err => {
    console.error(`[Startup] ADB check/scan failed: ${err.message}`);
    console.log('[Startup] Make sure ADB is installed and in PATH');
  });
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0');
}
