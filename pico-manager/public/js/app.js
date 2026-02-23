/**
 * PICO 4 VR Manager - Dashboard Client
 */

// --- State ---
let ws = null;
let devices = [];
let streaming = false;
let streamingDevices = new Set();
let wsReconnectDelay = 1000;
const WS_MAX_RECONNECT_DELAY = 15000;

// H.264 players for each device (keyed by IP)
const h264Players = new Map();

// --- DOM Elements ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elGrid = $('#screenGrid');
const elEmpty = $('#emptyState');
const elDeviceCount = $('#deviceCount');
const elToastContainer = $('#toastContainer');

// --- API Helper ---
async function api(path, options = {}) {
  try {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return await res.json();
  } catch (err) {
    toast(`שגיאת תקשורת: ${err.message}`, 'error');
    throw err;
  }
}

// --- Toast Notifications ---
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  elToastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// --- WebSocket ---
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.binaryType = 'arraybuffer'; // For H.264 binary data

  ws.onopen = () => {
    console.log('[WS] Connected');
    wsReconnectDelay = 1000;
    const statusEl = document.querySelector('.ws-status');
    if (statusEl) statusEl.className = 'ws-status connected';

    // Re-start any active streams after reconnect
    const h264Cap = typeof H264Player !== 'undefined' && H264Player.supported;
    for (const ip of streamingDevices) {
      wsSend({ type: 'start_stream', ip, h264: h264Cap });
    }
  };

  ws.onmessage = (event) => {
    // Binary message = stream data (H.264 or JPEG)
    if (event.data instanceof ArrayBuffer) {
      handleBinaryData(event.data);
      return;
    }

    // Text message = JSON
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'device_status':
          updateDevicesFromStatus(data.devices);
          break;
        case 'stream_method':
          console.log(`[Stream] ${data.ip} using: ${data.method}`);
          toast(`שיקוף ${data.ip}: ${data.method}`, 'info');
          break;
        case 'stream_error':
          console.warn(`[Stream] Error for ${data.ip}:`, data.error);
          toast(`שגיאת שיקוף ${data.ip}: ${data.error}`, 'error');
          break;
      }
    } catch (err) {
      console.error('[WS] Error parsing message:', err);
    }
  };

  ws.onclose = () => {
    console.log(`[WS] Disconnected, reconnecting in ${wsReconnectDelay / 1000}s...`);
    const statusEl = document.querySelector('.ws-status');
    if (statusEl) statusEl.className = 'ws-status disconnected';
    setTimeout(connectWebSocket, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, WS_MAX_RECONNECT_DELAY);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// --- Binary Stream Data Handler ---
let _binaryCount = 0;
function handleBinaryData(buffer) {
  const view = new Uint8Array(buffer);
  if (view.length < 3) return;

  // Parse packet: [1 byte type][1 byte IP length][IP string][data]
  const type = view[0];
  const ipLen = view[1];
  if (view.length < 2 + ipLen) return;

  const ip = new TextDecoder().decode(view.subarray(2, 2 + ipLen));
  const data = view.subarray(2 + ipLen);

  _binaryCount++;
  if (_binaryCount <= 5) {
    console.log(`[WS] Binary #${_binaryCount}: type=0x${type.toString(16)}, ip=${ip}, data=${data.length}B, hasPlayer=${h264Players.has(ip)}`);
  }

  if (type === 0x01) {
    // H.264 data - feed to H264Player
    const player = h264Players.get(ip);
    if (player) {
      player.feed(data);
    } else if (_binaryCount <= 5) {
      console.warn(`[WS] No H264Player for ${ip}! Players: ${[...h264Players.keys()].join(', ')}`);
    }
  } else if (type === 0x02) {
    // JPEG frame - render directly to canvas
    renderJpegFrame(ip, data);
  }
}

// Render a JPEG frame directly to canvas
function renderJpegFrame(ip, data) {
  const ipId = ip.replace(/\./g, '-');
  const canvas = document.getElementById(`screen-canvas-${ipId}`);
  if (!canvas) return;

  const blob = new Blob([data], { type: 'image/jpeg' });
  createImageBitmap(blob).then(bitmap => {
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    // Update FPS counter for MJPEG
    if (!canvas._mjpegFpsFrames) canvas._mjpegFpsFrames = 0;
    canvas._mjpegFpsFrames++;
    if (!canvas._mjpegFpsTimer) {
      canvas._mjpegFpsTimer = setInterval(() => {
        const badge = canvas.parentElement?.querySelector('.fps-badge');
        if (badge) badge.textContent = `${canvas._mjpegFpsFrames} FPS`;
        canvas._mjpegFpsFrames = 0;
      }, 1000);
    }
  }).catch(() => {});
}

// --- Device Status Update ---
function updateDevicesFromStatus(deviceList) {
  const prevCount = devices.length;
  devices = deviceList;
  updateDeviceCount();

  if (deviceList.length !== prevCount) {
    renderDevices();
    return;
  }

  deviceList.forEach(device => {
    const ipId = device.ip.replace(/\./g, '-');
    const card = document.getElementById(`card-${ipId}`);
    if (!card) {
      renderDevices();
      return;
    }

    const dot = card.querySelector('.status-dot');
    if (dot) {
      dot.className = `status-dot ${device.connected ? 'connected' : ''}`;
    }

    const batteryEl = card.querySelector('.battery-indicator');
    if (batteryEl && device.battery !== null) {
      const level = device.battery;
      const cls = level > 60 ? 'high' : level > 20 ? 'medium' : 'low';
      batteryEl.className = `battery-indicator ${cls}`;
      batteryEl.querySelector('span').textContent = `${level}%`;
    }
  });
}

// --- UI Update ---
function updateDeviceCount() {
  const connected = devices.filter(d => d.connected).length;
  elDeviceCount.textContent = `${connected}/5 מחוברים`;
}

// --- Render Device Card ---
function createDeviceCard(device) {
  const ipId = device.ip.replace(/\./g, '-');
  const batteryClass = device.battery > 60 ? 'high' : device.battery > 20 ? 'medium' : 'low';

  const card = document.createElement('div');
  card.className = 'device-card';
  card.id = `card-${ipId}`;
  const deviceNum = device.deviceNumber;
  const numBadge = deviceNum
    ? `<span class="device-number-badge" onclick="event.stopPropagation();setDeviceNumber('${device.ip}')" title="לחץ לשינוי מספר">#${deviceNum}</span>`
    : `<span class="device-number-badge unset" onclick="event.stopPropagation();setDeviceNumber('${device.ip}')" title="הגדר מספר משקף">?</span>`;

  card.innerHTML = `
    <div class="device-header">
      <div class="device-info">
        ${numBadge}
        <div class="status-dot ${device.connected ? 'connected' : ''}"></div>
        <div>
          <div class="device-name">${device.name || 'PICO 4'}</div>
          <div class="device-ip">${device.ip}</div>
        </div>
      </div>
      <div class="device-meta">
        <div class="battery-indicator ${device.battery ? batteryClass : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="10" x2="23" y2="14"/>
          </svg>
          <span>${device.battery ? device.battery + '%' : '--'}</span>
        </div>
      </div>
    </div>

    <div class="device-screen" id="screen-${ipId}">
      <canvas id="screen-canvas-${ipId}" style="display:none"></canvas>
      <div class="screen-placeholder">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <div>לחץ ▶ להפעלת שיקוף</div>
      </div>
      <div class="screen-overlay">
        <span class="screen-badge device-num-overlay">${deviceNum ? '#' + deviceNum : ''}</span>
        <span class="screen-badge fps-badge">-- FPS</span>
      </div>
    </div>

    <div class="device-controls">
      ${device.connected ? `
        <button class="btn-icon" title="שיקוף scrcpy (חלון נפרד)" onclick="mirrorDevice('${device.ip}')" style="background:var(--success);color:white">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </button>
        <button class="btn-icon" title="אפליקציות" onclick="showApps('${device.ip}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </button>
        <button class="btn-icon" title="מסך בית" onclick="goHome('${device.ip}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4"/>
          </svg>
        </button>
        <button class="btn-icon" title="הנמך ווליום" onclick="adjustVolume('${device.ip}', -1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          </svg>
        </button>
        <button class="btn-icon" title="הגבר ווליום" onclick="adjustVolume('${device.ip}', 1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>
          </svg>
        </button>
        <button class="btn-icon" title="נתק" onclick="disconnectDevice('${device.ip}')" style="margin-right:auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      ` : `
        <button class="btn btn-primary btn-sm" onclick="connectDevice('${device.ip}')">התחבר</button>
      `}
    </div>
  `;

  return card;
}

function renderDevices() {
  const empty = elGrid.querySelector('.empty-state');

  if (devices.length === 0) {
    if (!empty) {
      elGrid.innerHTML = '';
      elGrid.appendChild(createEmptyState());
    }
    return;
  }

  if (empty) empty.remove();

  devices.forEach(device => {
    const ipId = device.ip.replace(/\./g, '-');
    const existing = document.getElementById(`card-${ipId}`);
    if (!existing) {
      elGrid.appendChild(createDeviceCard(device));
    }
  });

  const currentIps = new Set(devices.map(d => d.ip.replace(/\./g, '-')));
  elGrid.querySelectorAll('.device-card').forEach(card => {
    const cardIp = card.id.replace('card-', '');
    if (!currentIps.has(cardIp)) {
      card.remove();
    }
  });
}

function createEmptyState() {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.id = 'emptyState';
  el.innerHTML = `
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
    </svg>
    <h2>אין מכשירים מחוברים</h2>
    <p>לחץ על "סריקה" כדי לחפש משקפי PICO 4 ברשת המקומית</p>
    <p class="hint">ודא שהמשקפיים מחוברים לאותה רשת WiFi וש-ADB מופעל</p>
  `;
  return el;
}

// --- Device Actions ---

async function scanDevices() {
  const btn = $('#btnScan');
  btn.disabled = true;
  document.body.classList.add('scanning');
  toast('סורק מכשירים ברשת...', 'info');

  try {
    const result = await api('/devices/scan', { method: 'POST' });
    if (result.success) {
      devices = result.devices || [];
      renderDevices();
      updateDeviceCount();
      toast(`נמצאו ${devices.length} מכשירים`, 'success');
    }
  } catch (err) {
    toast('שגיאה בסריקה', 'error');
  } finally {
    btn.disabled = false;
    document.body.classList.remove('scanning');
  }
}

async function setDeviceNumber(ip) {
  const num = prompt(`הכנס מספר משקף עבור ${ip} (1-5):`);
  if (num === null) return;
  const parsed = parseInt(num);
  if (isNaN(parsed) || parsed < 1 || parsed > 99) {
    toast('מספר לא תקין', 'error');
    return;
  }
  try {
    await api(`/devices/${ip}/number`, { method: 'POST', body: { number: parsed } });
    toast(`משקף ${ip} הוגדר כ-#${parsed}`, 'success');
    // Remove old card so it gets re-created with the new number
    const ipId = ip.replace(/\./g, '-');
    const oldCard = document.getElementById(`card-${ipId}`);
    if (oldCard) oldCard.remove();
    await refreshDevices();
  } catch (err) {
    toast('שגיאה בהגדרת מספר', 'error');
  }
}

async function connectDevice(ip) {
  toast(`מתחבר ל-${ip}...`, 'info');
  try {
    const result = await api(`/devices/${ip}/connect`, { method: 'POST' });
    if (result.success) {
      toast(`מחובר ל-${ip}`, 'success');
      await refreshDevices();
    }
  } catch (err) {
    toast(`שגיאת חיבור ל-${ip}`, 'error');
  }
}

async function disconnectDevice(ip) {
  stopStream(ip);
  try {
    await api(`/devices/${ip}/disconnect`, { method: 'POST' });
    toast(`${ip} נותק`, 'info');
    await refreshDevices();
  } catch (err) {
    toast(`שגיאה בניתוק ${ip}`, 'error');
  }
}

async function refreshDevices() {
  try {
    devices = await api('/devices');
    renderDevices();
    updateDeviceCount();
  } catch {}
}

// --- Scrcpy Mirror (native window, flat VR view) ---

async function mirrorDevice(ip) {
  toast(`מפעיל שיקוף scrcpy עבור ${ip}...`, 'info');
  try {
    const result = await api(`/devices/${ip}/mirror`, { method: 'POST' });
    if (result.success) {
      toast(`שיקוף scrcpy מופעל: ${ip}`, 'success');
    } else {
      toast(`שגיאת שיקוף: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    toast(`שגיאת שיקוף: ${err.message}`, 'error');
  }
}

async function mirrorAll() {
  toast('מפעיל שיקוף לכל המכשירים...', 'info');
  try {
    const result = await api('/mirror/all', { method: 'POST' });
    if (result.success) {
      const ok = result.results.filter(r => r.success).length;
      const fail = result.results.filter(r => !r.success).length;
      if (ok > 0) toast(`שיקוף מופעל ל-${ok} מכשירים`, 'success');
      if (fail > 0) toast(`שיקוף נכשל ב-${fail} מכשירים`, 'error');
    } else {
      toast(`שגיאת שיקוף: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    toast(`שגיאה: ${err.message}`, 'error');
  }
}

async function stopMirrorAll() {
  try {
    await api('/mirror/stop', { method: 'POST' });
    toast('שיקוף הופסק', 'info');
  } catch {}
}

// --- Stream Control ---

function toggleStream(ip) {
  if (streamingDevices.has(ip)) {
    stopStream(ip);
  } else {
    startStream(ip);
  }
}

function startStream(ip) {
  const ipId = ip.replace(/\./g, '-');
  const canvas = document.getElementById(`screen-canvas-${ipId}`);
  if (!canvas) return;

  // Set up H264Player if browser supports WebCodecs (for H.264 streams)
  if (typeof H264Player !== 'undefined' && H264Player.supported) {
    const player = new H264Player(canvas);
    player.onFps = (fps) => {
      const badge = canvas.parentElement.querySelector('.fps-badge');
      if (badge) badge.textContent = `${fps} FPS`;
    };
    h264Players.set(ip, player);
  }
  // Even without H264Player, server can send JPEG frames which render via renderJpegFrame()

  canvas.style.display = 'block';
  const placeholder = canvas.parentElement.querySelector('.screen-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  // Tell server to start stream - include h264 capability so server knows what to send
  const h264Supported = typeof H264Player !== 'undefined' && H264Player.supported;
  wsSend({ type: 'start_stream', ip, h264: h264Supported });
  streamingDevices.add(ip);
  toast(`שיקוף מופעל: ${ip}`, 'success');
}

function stopStream(ip) {
  const ipId = ip.replace(/\./g, '-');

  // Stop H.264 player
  const player = h264Players.get(ip);
  if (player) {
    player.destroy();
    h264Players.delete(ip);
  }

  // Tell server to stop
  wsSend({ type: 'stop_stream', ip });

  // Hide canvas and clean up MJPEG FPS timer
  const canvas = document.getElementById(`screen-canvas-${ipId}`);
  if (canvas) {
    canvas.style.display = 'none';
    if (canvas._mjpegFpsTimer) {
      clearInterval(canvas._mjpegFpsTimer);
      canvas._mjpegFpsTimer = null;
      canvas._mjpegFpsFrames = 0;
    }
  }

  // Show placeholder
  const screen = document.getElementById(`screen-${ipId}`);
  if (screen) {
    const placeholder = screen.querySelector('.screen-placeholder');
    if (placeholder) placeholder.style.display = '';
    const badge = screen.querySelector('.fps-badge');
    if (badge) badge.textContent = '-- FPS';
  }

  streamingDevices.delete(ip);
}

function toggleStreamAll() {
  if (streaming) {
    devices.filter(d => d.connected).forEach(d => stopStream(d.ip));
    streamingDevices.clear();
    streaming = false;
    $('#btnStreamAll').innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
      שיקוף הכל
    `;
    toast('שיקוף הופסק', 'info');
  } else {
    devices.filter(d => d.connected).forEach(d => startStream(d.ip));
    streaming = true;
    $('#btnStreamAll').innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
      </svg>
      עצור שיקוף
    `;
    toast('שיקוף מופעל לכל המכשירים', 'success');
  }
}

// --- Fullscreen ---

function toggleFullscreen(ip) {
  const ipId = ip.replace(/\./g, '-');
  const screenEl = document.getElementById(`screen-${ipId}`);
  if (!screenEl) return;

  if (screenEl.classList.contains('fullscreen-active')) {
    screenEl.classList.remove('fullscreen-active');
    document.removeEventListener('keydown', fullscreenEscHandler);
  } else {
    screenEl.classList.add('fullscreen-active');
    document.addEventListener('keydown', fullscreenEscHandler);
  }
}

function fullscreenEscHandler(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.fullscreen-active').forEach(el => {
      el.classList.remove('fullscreen-active');
    });
    document.removeEventListener('keydown', fullscreenEscHandler);
  }
}

// --- App Management ---

async function showApps(ip) {
  $('#appListDevice').textContent = ip;
  $('#appList').innerHTML = '<div class="spinner"></div>';
  $('#appListModal').classList.add('active');

  try {
    const apps = await api(`/devices/${ip}/apps`);
    if (apps.length === 0) {
      $('#appList').innerHTML = '<p>לא נמצאו אפליקציות</p>';
      return;
    }

    $('#appList').innerHTML = apps.map(app => `
      <div class="app-item">
        <span class="app-item-name">${app.packageName}</span>
        <div class="app-item-actions">
          <button class="btn btn-sm btn-success" onclick="launchApp('${ip}', '${app.packageName}')">הפעל</button>
          <button class="btn btn-sm btn-danger" onclick="stopApp('${ip}', '${app.packageName}')">עצור</button>
        </div>
      </div>
    `).join('');
  } catch {
    $('#appList').innerHTML = '<p>שגיאה בטעינת אפליקציות</p>';
  }
}

async function launchApp(ip, packageName) {
  try {
    await api(`/devices/${ip}/launch`, { method: 'POST', body: { packageName } });
    toast(`אפליקציה הופעלה: ${packageName}`, 'success');
  } catch {
    toast('שגיאה בהפעלת אפליקציה', 'error');
  }
}

async function stopApp(ip, packageName) {
  try {
    await api(`/devices/${ip}/stop`, { method: 'POST', body: { packageName } });
    toast(`אפליקציה נעצרה: ${packageName}`, 'info');
  } catch {
    toast('שגיאה בעצירת אפליקציה', 'error');
  }
}

async function goHome(ip) {
  try {
    await api(`/devices/${ip}/launch`, {
      method: 'POST',
      body: { packageName: 'com.pvr.launcher' }
    });
  } catch {}
}

// --- Volume ---

let volumeState = {};
async function adjustVolume(ip, delta) {
  if (!volumeState[ip]) volumeState[ip] = 8;
  volumeState[ip] = Math.max(0, Math.min(15, volumeState[ip] + delta));
  try {
    await api(`/devices/${ip}/volume`, {
      method: 'POST',
      body: { level: volumeState[ip] }
    });
  } catch {}
}

// --- Bulk Actions ---

async function bulkLaunch() {
  const pkg = $('#bulkAppPackage').value.trim();
  if (!pkg) {
    toast('יש להזין שם חבילה', 'error');
    return;
  }
  toast(`מפעיל ${pkg} בכל המכשירים...`, 'info');
  try {
    await api('/all/launch', { method: 'POST', body: { packageName: pkg } });
    toast('אפליקציה הופעלה בכל המכשירים', 'success');
  } catch {
    toast('שגיאה בהפעלת אפליקציה', 'error');
  }
}

async function bulkStop() {
  const pkg = $('#bulkAppPackage').value.trim();
  if (!pkg) {
    toast('יש להזין שם חבילה', 'error');
    return;
  }
  try {
    await api('/all/stop', { method: 'POST', body: { packageName: pkg } });
    toast('אפליקציה נעצרה בכל המכשירים', 'info');
  } catch {
    toast('שגיאה', 'error');
  }
}

async function bulkVolume() {
  const level = parseInt($('#bulkVolume').value);
  try {
    await api('/all/volume', { method: 'POST', body: { level } });
    toast(`ווליום הוגדר ל-${level} בכל המכשירים`, 'success');
  } catch {
    toast('שגיאה בהגדרת ווליום', 'error');
  }
}

// --- Manual Connect ---

async function manualConnect() {
  const ip = $('#manualIp').value.trim();
  if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    toast('יש להזין כתובת IP תקינה', 'error');
    return;
  }
  $('#addDeviceModal').classList.remove('active');
  await connectDevice(ip);
}

// --- Event Listeners ---

$('#btnScan').addEventListener('click', scanDevices);
$('#btnBulkLaunch').addEventListener('click', bulkLaunch);
$('#btnBulkStop').addEventListener('click', bulkStop);
$('#btnBulkVolume').addEventListener('click', bulkVolume);

$('#bulkVolume').addEventListener('input', (e) => {
  $('#bulkVolumeVal').textContent = e.target.value;
});

$('#btnAddDevice').addEventListener('click', () => {
  $('#addDeviceModal').classList.add('active');
  $('#manualIp').focus();
});

$('#btnCloseModal').addEventListener('click', () => {
  $('#addDeviceModal').classList.remove('active');
});

$('#btnCloseAppModal').addEventListener('click', () => {
  $('#appListModal').classList.remove('active');
});

$('#btnManualConnect').addEventListener('click', manualConnect);

$('#manualIp').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') manualConnect();
});

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });
});

// --- Init ---
(async function init() {
  connectWebSocket();

  // Check server status
  try {
    const status = await api('/status');
    if (!status.adb) {
      toast('ADB לא זמין - ודא ש-ADB מותקן ונגיש', 'error');
    }
    if (!status.scrcpy) {
      toast('⚠ scrcpy לא נמצא - השיקוף לא יעבוד. הורד מ: github.com/Genymobile/scrcpy', 'error');
      const btnMirror = document.getElementById('btnMirrorAll');
      const btnStop = document.getElementById('btnStopMirror');
      if (btnMirror) { btnMirror.disabled = true; btnMirror.title = 'scrcpy לא מותקן'; }
      if (btnStop) { btnStop.disabled = true; }
    }
    if (typeof H264Player !== 'undefined' && H264Player.supported) {
      console.log('[Init] WebCodecs H.264 streaming available');
    } else {
      console.warn('[Init] WebCodecs not supported - using MJPEG fallback (slow)');
    }
  } catch {
    toast('לא ניתן להתחבר לשרת', 'error');
  }

  await refreshDevices();
})();
