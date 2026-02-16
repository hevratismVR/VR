/**
 * ScreenCapture - Manages screen capture/streaming from PICO devices
 * Uses ADB screencap for reliable frame capture
 */
class ScreenCapture {
  constructor(adbManager, deviceStore) {
    this.adbManager = adbManager;
    this.deviceStore = deviceStore;
    this.captureInProgress = new Map();
  }

  /**
   * Capture a single screenshot from a device
   */
  async captureScreenshot(ip) {
    // Prevent concurrent captures on the same device
    if (this.captureInProgress.get(ip)) {
      return this._lastFrame.get(ip) || null;
    }

    this.captureInProgress.set(ip, true);
    try {
      const buffer = await this.adbManager.screenshotFast(ip);
      if (!this._lastFrame) this._lastFrame = new Map();
      this._lastFrame.set(ip, buffer);
      return buffer;
    } catch (err) {
      // Return last known frame if available
      if (this._lastFrame && this._lastFrame.has(ip)) {
        return this._lastFrame.get(ip);
      }
      throw err;
    } finally {
      this.captureInProgress.set(ip, false);
    }
  }
}

module.exports = { ScreenCapture };
