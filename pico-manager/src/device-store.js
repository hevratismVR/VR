/**
 * DeviceStore - Manages the state of all PICO 4 devices
 */
class DeviceStore {
  constructor() {
    // Map of ip -> device state
    this.devices = new Map();
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
