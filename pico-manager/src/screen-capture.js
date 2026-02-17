let sharp;
try {
  sharp = require('sharp');
} catch {
  console.warn('[Capture] sharp not available - screenshots will be unprocessed (large)');
  console.warn('[Capture] Install with: npm install sharp');
}

class ScreenCapture {
  constructor(adbManager, deviceStore) {
    this.adbManager = adbManager;
    this.deviceStore = deviceStore;
    this.captureInProgress = new Map();
    this._lastFrame = new Map();
    this._useFileBased = new Map();
    this._imageMetadata = new Map();
  }

  async captureScreenshot(ip) {
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

      const processed = sharp ? await this._processFrame(rawBuffer, ip) : rawBuffer;
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

  async _processFrame(rawBuffer, ip) {
    try {
      let meta = this._imageMetadata.get(ip);
      if (!meta) {
        meta = await sharp(rawBuffer).metadata();
        this._imageMetadata.set(ip, { width: meta.width, height: meta.height });
        console.log(`[Capture] ${ip} raw frame: ${meta.width}x${meta.height} (${rawBuffer.length} bytes)`);
      }

      const halfWidth = Math.floor(meta.width / 2);
      const marginX = Math.floor(halfWidth * 0.18);
      const marginY = Math.floor(meta.height * 0.18);
      const cropWidth = halfWidth - (marginX * 2);
      const cropHeight = meta.height - (marginY * 2);

      const processed = await sharp(rawBuffer)
        .extract({ left: marginX, top: marginY, width: cropWidth, height: cropHeight })
        .resize(800, null, { fit: 'inside' })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();

      if (!this._lastFrame.has(ip)) {
        console.log(`[Capture] ${ip} processed: ${processed.length} bytes (${(rawBuffer.length / processed.length).toFixed(0)}x smaller)`);
      }
      return processed;
    } catch (err) {
      console.error(`[Capture] sharp processing failed for ${ip}: ${err.message}`);
      return rawBuffer;
    }
  }
}

module.exports = { ScreenCapture };
