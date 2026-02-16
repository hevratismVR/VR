/**
 * ContentControl - Manages content and settings on PICO 4 devices
 */
class ContentControl {
  constructor(adbManager) {
    this.adb = adbManager;
  }

  /**
   * Launch an app on a device
   */
  async launchApp(ip, packageName) {
    // Try to get the launch activity
    try {
      const output = await this.adb.shell(ip,
        `cmd package resolve-activity --brief ${packageName} | tail -n 1`
      );
      if (output && output.includes('/')) {
        await this.adb.shell(ip, `am start -n ${output.trim()}`);
        return;
      }
    } catch {
      // fallback
    }
    // Fallback: use monkey to launch
    await this.adb.shell(ip,
      `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`
    );
  }

  /**
   * Stop an app on a device
   */
  async stopApp(ip, packageName) {
    await this.adb.shell(ip, `am force-stop ${packageName}`);
  }

  /**
   * List installed apps (3rd party only)
   */
  async listApps(ip) {
    const output = await this.adb.shell(ip, 'pm list packages -3');
    const packages = output
      .split('\n')
      .filter(line => line.startsWith('package:'))
      .map(line => {
        const pkg = line.replace('package:', '').trim();
        return { packageName: pkg };
      });

    // Try to get app labels
    const enriched = await Promise.all(packages.map(async (app) => {
      try {
        const label = await this.adb.shell(ip,
          `dumpsys package ${app.packageName} | grep 'applicationInfo' | head -1`
        );
        return { ...app, label: label.trim() || app.packageName };
      } catch {
        return { ...app, label: app.packageName };
      }
    }));

    return enriched;
  }

  /**
   * Set device volume (0-15)
   */
  async setVolume(ip, level) {
    const vol = Math.min(15, Math.max(0, parseInt(level)));
    await this.adb.shell(ip, `media volume --stream 3 --set ${vol}`);
  }

  /**
   * Set screen brightness (0-255)
   */
  async setBrightness(ip, level) {
    const brightness = Math.min(255, Math.max(0, parseInt(level)));
    await this.adb.shell(ip, `settings put system screen_brightness ${brightness}`);
  }

  /**
   * Reboot device
   */
  async reboot(ip) {
    await this.adb.shell(ip, 'reboot');
  }

  /**
   * Push a file to device
   */
  async pushFile(ip, localPath, remotePath) {
    await this.adb.adbExec(`-s ${ip}:5555 push "${localPath}" "${remotePath}"`, 60000);
  }

  /**
   * Install APK on device
   */
  async installApk(ip, apkPath) {
    await this.adb.adbExec(`-s ${ip}:5555 install -r "${apkPath}"`, 120000);
  }

  /**
   * Send key event
   */
  async sendKey(ip, keyCode) {
    await this.adb.shell(ip, `input keyevent ${keyCode}`);
  }

  /**
   * Go to home screen
   */
  async goHome(ip) {
    await this.sendKey(ip, 'KEYCODE_HOME');
  }

  /**
   * Get current foreground app
   */
  async getCurrentApp(ip) {
    try {
      const output = await this.adb.shell(ip,
        "dumpsys activity activities | grep 'mResumedActivity' | head -1"
      );
      const match = output.match(/u0 ([^\s/]+)/);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // --- Bulk operations ---

  async launchOnAll(packageName, deviceStore) {
    const devices = deviceStore.getConnectedDevices();
    const results = await Promise.allSettled(
      devices.map(d => this.launchApp(d.ip, packageName).then(() => ({ ip: d.ip, success: true })))
    );
    return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });
  }

  async stopOnAll(packageName, deviceStore) {
    const devices = deviceStore.getConnectedDevices();
    const results = await Promise.allSettled(
      devices.map(d => this.stopApp(d.ip, packageName).then(() => ({ ip: d.ip, success: true })))
    );
    return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });
  }

  async setVolumeOnAll(level, deviceStore) {
    const devices = deviceStore.getConnectedDevices();
    const results = await Promise.allSettled(
      devices.map(d => this.setVolume(d.ip, level).then(() => ({ ip: d.ip, success: true })))
    );
    return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });
  }
}

module.exports = { ContentControl };
