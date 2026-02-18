const fs = require('fs');
const path = require('path');

/**
 * DeviceStore - Manages the state of all PICO 4 devices
 */
class DeviceStore {
  constructor() {
    // Map of ip -> device state
    this.devices = new Map();
    // Persistent device number mapping (ip -> number)
    this.deviceNumbersFile = path.join(__dirname, '..', 'device-numbers.json');
    this.deviceNumbers = this._loadDeviceNumbers();
  }

  _loadDeviceNumbers() {
    try {
      if (fs.existsSync(this.deviceNumbersFile)) {
        return JSON.parse(fs.readFileSync(this.deviceNumbersFile, 'utf8'));
      }
    } catch (err) {
      console.error('[DeviceStore] Error loading device numbers:', err.message);
    }
    return {};
  }

  _saveDeviceNumbers() {
    try {
      fs.writeFileSync(this.deviceNumbersFile, JSON.stringify(this.deviceNumbers, null, 2));
    } catch (err) {
      console.error('[DeviceStore] Error saving device numbers:', err.message);
    }
  }

  setDeviceNumber(ip, number) {
    this.deviceNumbers[ip] = number;
    this._saveDeviceNumbers();
    const device = this.devices.get(ip);
    if (device) device.deviceNumber = number;
  }

  getDeviceNumber(ip) {
    return this.deviceNumbers[ip] || null;
  }

  addDevice(ip, info = {}) {
    const device = {
      ip,
      name: info.name || `PICO-${ip.split('.').pop()}`,
      model: info.model || 'PICO 4',
      status: 'discovered',
      battery: null,
      currentApp: null,
      connected: false,
      lastSeen: Date.now(),
      deviceNumber: this.deviceNumbers[ip] || null,
      ...info
    };
    this.devices.set(ip, device);
    return device;
  }

  updateDevice(ip, updates) {
    const device = this.devices.get(ip);
    if (device) {
      Object.assign(device, updates, { lastSeen: Date.now() });
      return device;
    }
    return null;
  }

  setConnected(ip, connected) {
    return this.updateDevice(ip, { connected, status: connected ? 'connected' : 'disconnected' });
  }

  getDevice(ip) {
    return this.devices.get(ip) || null;
  }

  getAllDevices() {
    return Array.from(this.devices.values());
  }

  getConnectedDevices() {
    return this.getAllDevices().filter(d => d.connected);
  }

  removeDevice(ip) {
    this.devices.delete(ip);
  }

  getDeviceCount() {
    return this.devices.size;
  }

  getConnectedCount() {
    return this.getConnectedDevices().length;
  }
}

module.exports = { DeviceStore };
