const sharp = require('sharp');

/**
 * ScreenCapture - Manages screen capture/streaming from PICO devices
 * Uses ADB screencap + sharp for fast, compressed frame delivery
 */
class ScreenCapture {
  constructor(adbManager, deviceStore) {
    this.adbManager = adbManager;
    this.deviceStore = deviceStore;
    this.captureInProgress = new Map();
    this._lastFrame = new Map();
    this._useFileBased = new Map();
    this._imageMetadata = new Map(); // Cache image dimensions per device
  }

  /**
   * Capture a single screenshot from a device, cropped and compressed
   * Returns a small JPEG buffer (~50-150KB) instead of raw 14MB PNG
   */
  async captureScreenshot(ip) {
    // Prevent concurrent captures on the same device
    if (this.captureInProgress.get(ip)) {
      return this._lastFrame.get(ip) || null;
    }

    this.captureInProgress.set(ip, true);
    try {
      let rawBuffer;

      if (this._useFileBased.get(ip)) {
        rawBuffer = await this.adbManager.screenshot(ip);
      } else {
        try {
          rawBuffer = await this.adbManager.screenshotFast(ip);
        } catch (fastErr) {
          console.log(`[Capture] exec-out failed for ${ip}, switching to file-based method`);
          this._useFileBased.set(ip, true);
          rawBuffer = await this.adbManager.screenshot(ip);
        }
      }

      // Process: crop left eye + resize + JPEG compress
      const processed = await this._processFrame(rawBuffer, ip);
      this._lastFrame.set(ip, processed);
      return processed;
    } catch (err) {
      if (this._lastFrame.has(ip)) {
        return this._lastFrame.get(ip);
      }
      throw err;
    } finally {
      this.captureInProgress.set(ip, false);
    }
  }

  /**
   * Process a raw VR screenshot:
   * 1. Crop left half (left eye only)
   * 2. Crop out the black circular border (inner 80% rectangle)
   * 3. Resize to reasonable width
   * 4. Compress as JPEG
   */
  async _processFrame(rawBuffer, ip) {
    try {
      // Get image dimensions (cache after first frame)
      let meta = this._imageMetadata.get(ip);
      if (!meta) {
        meta = await sharp(rawBuffer).metadata();
        this._imageMetadata.set(ip, { width: meta.width, height: meta.height });
        console.log(`[Capture] ${ip} raw frame: ${meta.width}x${meta.height} (${rawBuffer.length} bytes)`);
      }

      const halfWidth = Math.floor(meta.width / 2);

      // Crop the inner portion of the left eye to remove VR lens circle
      // The VR lens circle is roughly circular, so we crop an inner rectangle
      // that avoids the black borders (~10% margin on each side)
      const marginX = Math.floor(halfWidth * 0.1);
      const marginY = Math.floor(meta.height * 0.1);
      const cropWidth = halfWidth - (marginX * 2);
      const cropHeight = meta.height - (marginY * 2);

      const processed = await sharp(rawBuffer)
        .extract({
          left: marginX,
          top: marginY,
          width: cropWidth,
          height: cropHeight
        })
        .resize(800, null, { fit: 'inside' })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();

      if (this._lastFrame.size === 0 || !this._lastFrame.has(ip)) {
        console.log(`[Capture] ${ip} processed frame: ${processed.length} bytes (${(rawBuffer.length / processed.length).toFixed(0)}x smaller)`);
      }

      return processed;
    } catch (err) {
      console.error(`[Capture] sharp processing failed for ${ip}: ${err.message}`);
      // Fall back to raw buffer if processing fails
      return rawBuffer;
    }
  }
}

module.exports = { ScreenCapture };
