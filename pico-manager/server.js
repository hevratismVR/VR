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

  const intervalMs = Math.max(200, Math.floor(1000 / fps));

  const interval = setInterval(async () => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      intervals.delete(ip);
      return;
    }
    try {
      const buffer = await screenCapture.captureScreenshot(ip);
      if (buffer && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'frame',
          ip: ip,
          data: buffer.toString('base64'),
          timestamp: Date.now()
        }));
      }
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'stream_error',
          ip: ip,
          error: err.message
        }));
      }
    }
  }, intervalMs);

  intervals.set(ip, interval);
}

function stopDeviceStream(ip, intervals) {
  if (intervals.has(ip)) {
    clearInterval(intervals.get(ip));
    intervals.delete(ip);
  }
}

function startAllStreams(ws, fps, intervals) {
  const devices = deviceStore.getConnectedDevices();
  devices.forEach(device => {
    startDeviceStream(ws, device.ip, fps, intervals);
  });
}

function stopAllStreams(intervals) {
  intervals.forEach((interval) => clearInterval(interval));
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

  // Auto-scan on startup
  adbManager.scanNetwork().then(devices => {
    console.log(`[Startup] Found ${devices.length} device(s) on network`);
  }).catch(() => {
    console.log('[Startup] Network scan completed (run manual scan from dashboard)');
  });
});
