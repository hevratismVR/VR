/**
 * ScreenCapture - Manages screen capture/streaming from PICO devices
 * Uses ADB screencap for reliable frame capture
 */
class ScreenCapture {
  constructor(adbManager, deviceStore) {
    this.adbManager = adbManager;
    this.deviceStore = deviceStore;
    this.captureInProgress = new Map();
    this._lastFrame = new Map();
    this._useFileBased = new Map(); // Track which devices need file-based capture
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
      let buffer;

      if (this._useFileBased.get(ip)) {
        // Use reliable file-based method
        buffer = await this.adbManager.screenshot(ip);
      } else {
        // Try fast method first
        try {
          buffer = await this.adbManager.screenshotFast(ip);
        } catch (fastErr) {
          // Fast method failed, switch to file-based for this device
          console.log(`[Capture] exec-out failed for ${ip}, switching to file-based method`);
          this._useFileBased.set(ip, true);
          buffer = await this.adbManager.screenshot(ip);
        }
      }

      this._lastFrame.set(ip, buffer);
      return buffer;
    } catch (err) {
      // Return last known frame if available
      if (this._lastFrame.has(ip)) {
        return this._lastFrame.get(ip);
      }
      throw err;
    } finally {
      this.captureInProgress.set(ip, false);
    }
  }
}

module.exports = { ScreenCapture };
