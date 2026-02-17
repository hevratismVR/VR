const { exec, execSync, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const net = require('net');

const execAsync = promisify(exec);

/**
 * AdbManager - Handles ADB connections and commands for PICO 4 devices
 */
class AdbManager {
  constructor(deviceStore) {
    this.deviceStore = deviceStore;
    this.adbPath = this._findAdb();
    console.log(`[ADB] Using adb at: ${this.adbPath}`);
  }

  _findAdb() {
    try {
      const cmd = process.platform === 'win32' ? 'where adb' : 'which adb';
      const path = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0];
      return path || 'adb';
    } catch {
      return 'adb';
    }
  }

  /**
   * Execute an ADB command
   */
  async adbExec(args, timeout = 10000) {
    const cmd = `${this.adbPath} ${args}`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout });
      return stdout.trim();
    } catch (err) {
      throw new Error(`ADB command failed: ${cmd}\n${err.message}`);
    }
  }

  /**
   * Execute an ADB shell command on a specific device
   */
  async shell(ip, command, timeout = 10000) {
    return this.adbExec(`-s ${ip}:5555 shell ${command}`, timeout);
  }

  /**
   * Scan local network for PICO devices (subnet scan on port 5555)
   */
  async scanNetwork() {
    console.log('[ADB] Scanning network for devices...');

    // First get already-connected devices from adb
    const knownDevices = await this._getAdbDevices();

    // Try to detect subnet from device IP or use common subnets
    const subnets = this._detectSubnets();
    console.log(`[ADB] Scanning subnets: ${subnets.join(', ')}`);

    // Phase 1: Fast TCP port probe to find devices with port 5555 open
    const openIPs = [];
    const tcpPromises = [];
    for (const subnet of subnets) {
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        tcpPromises.push(this._tcpProbe(ip, 5555, 800).then(open => {
          if (open) {
            console.log(`[ADB] Port 5555 open on ${ip}`);
            openIPs.push(ip);
          }
        }));
      }
    }
    await Promise.allSettled(tcpPromises);
    console.log(`[ADB] TCP probe found ${openIPs.length} device(s) with port 5555 open`);

    // Phase 2: Try ADB connect only on IPs with open port
    const adbPromises = openIPs.map(ip => this._probeDevice(ip));
    const results = await Promise.allSettled(adbPromises);
    const found = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    // Merge with known devices
    for (const device of knownDevices) {
      if (!found.find(d => d.ip === device.ip)) {
        found.push(device);
      }
    }

    // Update device store
    for (const device of found) {
      this.deviceStore.addDevice(device.ip, device);
    }

    console.log(`[ADB] Found ${found.length} device(s)`);
    return found;
  }

  /**
   * Fast TCP port probe - checks if a port is open without full ADB handshake
   */
  _tcpProbe(ip, port, timeoutMs = 800) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, ip);
    });
  }

  /**
   * Get devices already known to ADB
   */
  async _getAdbDevices() {
    try {
      const output = await this.adbExec('devices -l');
      const lines = output.split('\n').slice(1);
      const devices = [];

      for (const line of lines) {
        const match = line.match(/^([\d.]+):(\d+)\s+(\w+)/);
        if (match) {
          const ip = match[1];
          const status = match[3];
          devices.push({
            ip,
            connected: status === 'device',
            status: status === 'device' ? 'connected' : status
          });
          this.deviceStore.addDevice(ip, {
            connected: status === 'device',
            status: status === 'device' ? 'connected' : status
          });
        }
      }
      return devices;
    } catch {
      return [];
    }
  }

  /**
   * Detect network subnets to scan (cross-platform using Node.js os module)
   */
  _detectSubnets() {
    try {
      const interfaces = os.networkInterfaces();
      const subnets = new Set();

      for (const [name, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            const subnet = addr.address.split('.').slice(0, 3).join('.');
            subnets.add(subnet);
            console.log(`[ADB] Found network interface ${name}: ${addr.address} (subnet ${subnet}.x)`);
          }
        }
      }

      if (subnets.size === 0) {
        console.log('[ADB] No network interfaces found, using default subnets');
        return ['192.168.1', '192.168.0', '10.0.0'];
      }

      return [...subnets];
    } catch (err) {
      console.error('[ADB] Error detecting subnets:', err.message);
      return ['192.168.1', '192.168.0', '10.0.0'];
    }
  }

  /**
   * Probe a single IP for ADB device
   */
  async _probeDevice(ip) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 1500);

      const proc = spawn(this.adbPath, ['connect', `${ip}:5555`], { timeout: 2000 });
      let output = '';

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { output += data.toString(); });

      proc.on('close', () => {
        clearTimeout(timeout);
        if (output.includes('connected') && !output.includes('unable')) {
          resolve({ ip, connected: true, status: 'connected' });
          // Immediately disconnect to not flood - we'll reconnect explicitly
          exec(`${this.adbPath} disconnect ${ip}:5555`);
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  /**
   * Connect to a specific device
   */
  async connectDevice(ip) {
    console.log(`[ADB] Connecting to ${ip}...`);
    try {
      const output = await this.adbExec(`connect ${ip}:5555`, 15000);
      console.log(`[ADB] Connect response for ${ip}: ${output}`);

      if (output.includes('connected') || output.includes('already')) {
        this.deviceStore.addDevice(ip, { connected: true, status: 'connected' });
        console.log(`[ADB] Successfully connected to ${ip}`);

        // Fetch device info after connect
        this._updateDeviceInfo(ip).catch(() => {});

        return true;
      }
      throw new Error(`Failed to connect: ${output}`);
    } catch (err) {
      console.error(`[ADB] Connection failed for ${ip}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Disconnect from a device
   */
  async disconnectDevice(ip) {
    await this.adbExec(`disconnect ${ip}:5555`);
    this.deviceStore.setConnected(ip, false);
  }

  /**
   * Get detailed device info
   */
  async getDeviceInfo(ip) {
    const [model, battery, androidVer, serialNo] = await Promise.allSettled([
      this.shell(ip, 'getprop ro.product.model'),
      this.shell(ip, 'dumpsys battery | grep level'),
      this.shell(ip, 'getprop ro.build.version.release'),
      this.shell(ip, 'getprop ro.serialno'),
    ]);

    const batteryLevel = battery.status === 'fulfilled'
      ? parseInt(battery.value.replace(/[^0-9]/g, '')) || null
      : null;

    const info = {
      ip,
      model: model.status === 'fulfilled' ? model.value : 'Unknown',
      battery: batteryLevel,
      androidVersion: androidVer.status === 'fulfilled' ? androidVer.value : 'Unknown',
      serial: serialNo.status === 'fulfilled' ? serialNo.value : 'Unknown',
    };

    this.deviceStore.updateDevice(ip, info);
    return info;
  }

  /**
   * Update device info in background
   */
  async _updateDeviceInfo(ip) {
    try {
      const info = await this.getDeviceInfo(ip);
      this.deviceStore.updateDevice(ip, info);
    } catch (err) {
      console.error(`[ADB] Failed to get info for ${ip}:`, err.message);
    }
  }

  /**
   * Execute raw shell command on device
   */
  async execShell(ip, command) {
    return this.shell(ip, `"${command.replace(/"/g, '\\"')}"`);
  }

  /**
   * Take a screenshot from device and return as Buffer
   */
  async screenshot(ip) {
    const tmpFile = `/tmp/screen_${ip.replace(/\./g, '_')}.png`;
    await this.shell(ip, `screencap -p /sdcard/screen_tmp.png`);
    await this.adbExec(`-s ${ip}:5555 pull /sdcard/screen_tmp.png ${tmpFile}`, 15000);
    const fs = require('fs');
    const buffer = fs.readFileSync(tmpFile);
    // Clean up
    fs.unlink(tmpFile, () => {});
    this.shell(ip, 'rm /sdcard/screen_tmp.png').catch(() => {});
    return buffer;
  }

  /**
   * Fast screenshot using exec-out (no temp file)
   */
  async screenshotFast(ip) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const proc = spawn(this.adbPath, ['-s', `${ip}:5555`, 'exec-out', 'screencap', '-p'], {
        timeout: 8000
      });

      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`Screenshot failed for ${ip} (code: ${code})`));
        }
      });
      proc.on('error', reject);

      setTimeout(() => {
        proc.kill();
        reject(new Error('Screenshot timeout'));
      }, 8000);
    });
  }
}

module.exports = { AdbManager };
