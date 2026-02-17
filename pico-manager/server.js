const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { AdbManager } = require('./src/adb-manager');
const { ScreenCapture } = require('./src/screen-capture');
const { ContentControl } = require('./src/content-control');
const { DeviceStore } = require('./src/device-store');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const deviceStore = new DeviceStore();
const adbManager = new AdbManager(deviceStore);
const screenCapture = new ScreenCapture(adbManager, deviceStore);
const contentControl = new ContentControl(adbManager);

// --- REST API ---

// Server health check
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

// Get all devices
app.get('/api/devices', (req, res) => {
  res.json(deviceStore.getAllDevices());
});

// Scan network for PICO devices
app.post('/api/devices/scan', async (req, res) => {
  try {
    const devices = await adbManager.scanNetwork();
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Connect to a device
app.post('/api/devices/:ip/connect', async (req, res) => {
  try {
    await adbManager.connectDevice(req.params.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disconnect a device
app.post('/api/devices/:ip/disconnect', async (req, res) => {
  try {
    await adbManager.disconnectDevice(req.params.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get device info
app.get('/api/devices/:ip/info', async (req, res) => {
  try {
    const info = await adbManager.getDeviceInfo(req.params.ip);
    res.json(info);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Launch app on device
app.post('/api/devices/:ip/launch', async (req, res) => {
  try {
    const { packageName } = req.body;
    await contentControl.launchApp(req.params.ip, packageName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stop app on device
app.post('/api/devices/:ip/stop', async (req, res) => {
  try {
    const { packageName } = req.body;
    await contentControl.stopApp(req.params.ip, packageName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List installed apps
app.get('/api/devices/:ip/apps', async (req, res) => {
  try {
    const apps = await contentControl.listApps(req.params.ip);
    res.json(apps);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Set volume
app.post('/api/devices/:ip/volume', async (req, res) => {
  try {
    const { level } = req.body;
    await contentControl.setVolume(req.params.ip, level);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Set brightness
app.post('/api/devices/:ip/brightness', async (req, res) => {
  try {
    const { level } = req.body;
    await contentControl.setBrightness(req.params.ip, level);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reboot device
app.post('/api/devices/:ip/reboot', async (req, res) => {
  try {
    await contentControl.reboot(req.params.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Push file to device
app.post('/api/devices/:ip/push', async (req, res) => {
  try {
    const { localPath, remotePath } = req.body;
    await contentControl.pushFile(req.params.ip, localPath, remotePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Bulk operations (all devices) ---

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

// Screenshot endpoint (single frame)
app.get('/api/devices/:ip/screenshot', async (req, res) => {
  try {
    const buffer = await screenCapture.captureScreenshot(req.params.ip);
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- WebSocket for live streaming ---

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  let streamIntervals = new Map();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'start_stream':
          startDeviceStream(ws, data.ip, data.fps || 3, streamIntervals);
          break;
        case 'stop_stream':
          stopDeviceStream(data.ip, streamIntervals);
          break;
        case 'start_all_streams':
          startAllStreams(ws, data.fps || 2, streamIntervals);
          break;
        case 'stop_all_streams':
          stopAllStreams(streamIntervals);
          break;
      }
    } catch (err) {
      console.error('[WS] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    stopAllStreams(streamIntervals);
  });
});

function startDeviceStream(ws, ip, fps, intervals) {
  if (intervals.has(ip)) return;

  console.log(`[Stream] Starting stream for ${ip}`);
  let running = true;
  let frameCount = 0;
  let errorCount = 0;

  // Use a continuous loop instead of fixed interval
  // This way each frame is captured as soon as the previous one finishes
  async function captureLoop() {
    while (running && ws.readyState === WebSocket.OPEN) {
      try {
        const buffer = await screenCapture.captureScreenshot(ip);
        if (buffer && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'frame',
            ip: ip,
            data: buffer.toString('base64'),
            timestamp: Date.now()
          }));
          frameCount++;
          errorCount = 0;
          if (frameCount === 1) console.log(`[Stream] First frame sent for ${ip} (${buffer.length} bytes)`);
          if (frameCount % 30 === 0) console.log(`[Stream] ${ip}: ${frameCount} frames sent`);
        }
      } catch (err) {
        errorCount++;
        if (errorCount <= 3) console.error(`[Stream] Screenshot error for ${ip}: ${err.message}`);
        if (errorCount > 10) {
          console.error(`[Stream] Too many errors for ${ip}, stopping stream`);
          break;
        }
        // Wait a bit before retrying on error
        await new Promise(r => setTimeout(r, 1000));
      }
      // Small delay between frames to prevent CPU overload
      await new Promise(r => setTimeout(r, 100));
    }
    intervals.delete(ip);
  }

  // Store a stop function instead of interval ID
  intervals.set(ip, { stop: () => { running = false; } });
  captureLoop();
}

function stopDeviceStream(ip, intervals) {
  if (intervals.has(ip)) {
    intervals.get(ip).stop();
    intervals.delete(ip);
  }
}

function startAllStreams(ws, fps, intervals) {
  const devices = deviceStore.getConnectedDevices();
  console.log(`[Stream] Starting all streams for ${devices.length} connected device(s)`);
  if (devices.length === 0) {
    console.log('[Stream] No connected devices to stream');
  }
  devices.forEach(device => {
    startDeviceStream(ws, device.ip, fps, intervals);
  });
}

function stopAllStreams(intervals) {
  intervals.forEach((stream) => stream.stop());
  intervals.clear();
}

// --- Status broadcast ---

setInterval(() => {
  const status = deviceStore.getAllDevices();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'device_status', devices: status }));
    }
  });
}, 5000);

// --- Start server ---

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║          PICO 4 VR Manager                       ║
║          http://0.0.0.0:${PORT}                     ║
║                                                  ║
║  Open this address in your tablet browser        ║
╚══════════════════════════════════════════════════╝
  `);

  // Verify ADB is available
  adbManager.adbExec('version').then(output => {
    console.log(`[Startup] ADB available: ${output.split('\n')[0]}`);

    // Auto-scan on startup
    return adbManager.scanNetwork();
  }).then(devices => {
    console.log(`[Startup] Found ${devices.length} device(s) on network`);
  }).catch(err => {
    console.error(`[Startup] ADB check/scan failed: ${err.message}`);
    console.log('[Startup] Make sure ADB is installed and in PATH');
    console.log('[Startup] You can still use the dashboard - connect devices manually');
  });
});
