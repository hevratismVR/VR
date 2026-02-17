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
    return; // Already connecting or connected
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    console.log('[WS] Connected');
    wsReconnectDelay = 1000; // Reset backoff on success
    // Update connection status in UI
    const statusEl = document.querySelector('.ws-status');
    if (statusEl) statusEl.className = 'ws-status connected';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'frame':
          updateScreenFrame(data.ip, data.data);
          break;
        case 'device_status':
          updateDevicesFromStatus(data.devices);
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

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
    ws.close();
  };
}

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// --- Screen Frame Update ---
function updateScreenFrame(ip, base64Data) {
  const img = document.getElementById(`screen-img-${ip.replace(/\./g, '-')}`);
  if (img) {
    img.src = `data:image/png;base64,${base64Data}`;
    img.style.display = 'block';

    // Hide placeholder
    const placeholder = img.parentElement.querySelector('.screen-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    // Update FPS counter
    const badge = img.parentElement.querySelector('.fps-badge');
    if (badge) {
      const now = Date.now();
      if (!img._lastFrame) img._lastFrame = now;
      const fps = Math.round(1000 / (now - img._lastFrame));
      badge.textContent = `${fps} FPS`;
      img._lastFrame = now;
    }
  }
}

// --- Device Status Update ---
function updateDevicesFromStatus(deviceList) {
  const prevCount = devices.length;
  devices = deviceList;
  updateDeviceCount();

  // If device count changed, re-render all cards
  if (deviceList.length !== prevCount) {
    renderDevices();
    return;
  }

  deviceList.forEach(device => {
    const ipId = device.ip.replace(/\./g, '-');
    const card = document.getElementById(`card-${ipId}`);
    if (!card) {
      // New device - render all
      renderDevices();
      return;
    }

    // Update status dot
    const dot = card.querySelector('.status-dot');
    if (dot) {
      dot.className = `status-dot ${device.connected ? 'connected' : ''}`;
    }

    // Update battery
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
  card.innerHTML = `
    <div class="device-header">
      <div class="device-info">
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
      <img id="screen-img-${ipId}" style="display:none" alt="Screen">
      <div class="screen-placeholder">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <div>לחץ ▶ להפעלת שיקוף</div>
      </div>
      <div class="screen-overlay">
        <span class="screen-badge fps-badge">-- FPS</span>
      </div>
    </div>

    <div class="device-controls">
      ${device.connected ? `
        <!-- Stream toggle -->
        <button class="btn-icon" title="שיקוף מסך" onclick="toggleStream('${device.ip}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>

        <!-- Fullscreen -->
        <button class="btn-icon" title="מסך מלא" onclick="toggleFullscreen('${device.ip}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>

        <!-- Apps -->
        <button class="btn-icon" title="אפליקציות" onclick="showApps('${device.ip}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </button>

        <!-- Home -->
        <button class="btn-icon" title="מסך בית" onclick="goHome('${device.ip}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4"/>
          </svg>
        </button>

        <!-- Volume Down -->
        <button class="btn-icon" title="הנמך ווליום" onclick="adjustVolume('${device.ip}', -1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          </svg>
        </button>

        <!-- Volume Up -->
        <button class="btn-icon" title="הגבר ווליום" onclick="adjustVolume('${device.ip}', 1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>
          </svg>
        </button>

        <!-- Disconnect -->
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
  // Remove empty state
  const empty = elGrid.querySelector('.empty-state');

  if (devices.length === 0) {
    if (!empty) {
      elGrid.innerHTML = '';
      elGrid.appendChild(createEmptyState());
    }
    return;
  }

  if (empty) empty.remove();

  // Update existing cards or create new ones
  devices.forEach(device => {
    const ipId = device.ip.replace(/\./g, '-');
    const existing = document.getElementById(`card-${ipId}`);
    if (!existing) {
      elGrid.appendChild(createDeviceCard(device));
    }
  });

  // Remove cards for devices no longer present
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
  const img = document.getElementById(`screen-img-${ipId}`);
  if (img) {
    // Use MJPEG stream - browser natively handles multipart image updates
    img.src = `/api/devices/${ip}/mjpeg?t=${Date.now()}`;
    img.style.display = 'block';
    const placeholder = img.parentElement.querySelector('.screen-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  }
  streamingDevices.add(ip);
  toast(`שיקוף מופעל: ${ip}`, 'success');
}

function stopStream(ip) {
  const ipId = ip.replace(/\./g, '-');
  const img = document.getElementById(`screen-img-${ipId}`);
  if (img) {
    img.src = '';
    img.style.display = 'none';
    const placeholder = img.parentElement.querySelector('.screen-placeholder');
    if (placeholder) placeholder.style.display = '';
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
$('#btnStreamAll').addEventListener('click', toggleStreamAll);
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

// Close modals on background click
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
  } catch {
    toast('לא ניתן להתחבר לשרת', 'error');
  }

  await refreshDevices();
})();
