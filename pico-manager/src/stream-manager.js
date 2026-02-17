const { spawn } = require('child_process');
const EventEmitter = require('events');

/**
 * StreamManager - Real-time screen streaming using screenrecord + ffmpeg
 *
 * screenrecord uses hardware H.264 encoding on the device (~1-4 Mbps)
 * instead of screencap which captures raw pixels (~14MB per frame).
 * ffmpeg decodes H.264 and outputs JPEG frames for MJPEG streaming.
 */
class StreamManager {
  constructor(adbManager) {
    this.adbManager = adbManager;
    this.ffmpegPath = null;
    this.streams = new Map();
    this._initFfmpeg();
  }

  _initFfmpeg() {
    try {
      this.ffmpegPath = require('ffmpeg-static');
      console.log(`[StreamManager] FFmpeg available: ${this.ffmpegPath}`);
    } catch {
      console.warn('[StreamManager] ffmpeg-static not installed - real-time streaming unavailable');
      console.warn('[StreamManager] Falling back to screencap (slow). Install with: npm install ffmpeg-static');
    }
  }

  get available() {
    return !!this.ffmpegPath;
  }

  /**
   * Start or get an existing stream for a device.
   * Returns a DeviceStream (EventEmitter) that emits 'frame' events with JPEG buffers.
   */
  startStream(ip, options = {}) {
    if (this.streams.has(ip)) {
      return this.streams.get(ip);
    }

    const stream = new DeviceStream(this, ip, options);
    this.streams.set(ip, stream);
    stream.start();
    return stream;
  }

  /**
   * Stop and clean up a device stream.
   */
  stopStream(ip) {
    const stream = this.streams.get(ip);
    if (stream) {
      stream.stop();
      this.streams.delete(ip);
    }
  }

  stopAll() {
    for (const [ip] of this.streams) {
      this.stopStream(ip);
    }
  }
}

class DeviceStream extends EventEmitter {
  constructor(manager, ip, options) {
    super();
    this.manager = manager;
    this.ip = ip;
    this.bitRate = options.bitRate || 8000000;
    this.maxSize = options.maxSize || 800;
    this.running = false;
    this.lastFrame = null;
    this.frameCount = 0;
    this._adbProc = null;
    this._ffmpegProc = null;
    this._restartTimer = null;
  }

  start() {
    this.running = true;
    this._startPipeline();
  }

  stop() {
    this.running = false;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    this._killProcesses();
    this.removeAllListeners();
  }

  _killProcesses() {
    if (this._adbProc) {
      try { this._adbProc.kill(); } catch {}
      this._adbProc = null;
    }
    if (this._ffmpegProc) {
      try { this._ffmpegProc.kill(); } catch {}
      this._ffmpegProc = null;
    }
  }

  _startPipeline() {
    if (!this.running) return;
    this._killProcesses();

    const adbPath = this.manager.adbManager.adbPath;
    const ffmpegPath = this.manager.ffmpegPath;

    console.log(`[Stream] Starting screenrecord+ffmpeg pipeline for ${this.ip}`);

    // Start screenrecord → raw H.264 stream to stdout
    // screenrecord uses hardware H.264 encoder on device = fast + small
    this._adbProc = spawn(adbPath, [
      '-s', `${this.ip}:5555`,
      'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--bit-rate', String(this.bitRate),
      '-'
    ]);

    // Start ffmpeg: decode H.264 → output JPEG frames
    this._ffmpegProc = spawn(ffmpegPath, [
      '-loglevel', 'error',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-f', 'h264',
      '-i', 'pipe:0',
      '-vf', `scale=${this.maxSize}:-1`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '5',
      '-an',
      'pipe:1'
    ]);

    // Pipe: adb → ffmpeg
    this._adbProc.stdout.pipe(this._ffmpegProc.stdin);

    // Parse JPEG frames from ffmpeg stdout
    let buf = Buffer.alloc(0);
    this._ffmpegProc.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      // Extract complete JPEG frames by finding FFD8..FFD9 boundaries
      let safetyLimit = 50; // prevent infinite loops
      while (buf.length > 4 && safetyLimit-- > 0) {
        const start = buf.indexOf(Buffer.from([0xFF, 0xD8]));
        if (start === -1) { buf = Buffer.alloc(0); break; }
        if (start > 0) buf = buf.subarray(start);

        const end = findJpegEnd(buf);
        if (end === -1) break;

        const frame = Buffer.from(buf.subarray(0, end));
        buf = buf.subarray(end);

        this.lastFrame = frame;
        this.frameCount++;
        this.emit('frame', frame);

        if (this.frameCount === 1) {
          console.log(`[Stream] First frame for ${this.ip}: ${frame.length} bytes`);
        }
      }
    });

    // Log errors
    this._adbProc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.warn(`[Stream] adb stderr (${this.ip}): ${msg}`);
    });

    this._ffmpegProc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('Last message repeated')) {
        console.warn(`[Stream] ffmpeg stderr (${this.ip}): ${msg}`);
      }
    });

    // Handle process endings
    // screenrecord has a 180-second time limit on Android → auto-restart
    let adbClosed = false;
    this._adbProc.on('close', (code) => {
      adbClosed = true;
      if (this.running) {
        console.log(`[Stream] screenrecord ended for ${this.ip} (code ${code}), restarting in 500ms...`);
        this._restartTimer = setTimeout(() => {
          if (this.running) this._startPipeline();
        }, 500);
      }
    });

    this._ffmpegProc.on('close', (code) => {
      if (this.running && !adbClosed && code !== 0) {
        console.error(`[Stream] ffmpeg died for ${this.ip} (code ${code}), restarting...`);
        this._restartTimer = setTimeout(() => {
          if (this.running) this._startPipeline();
        }, 1000);
      }
    });

    this._adbProc.on('error', (err) => {
      console.error(`[Stream] ADB spawn error (${this.ip}): ${err.message}`);
      this.emit('error', err);
    });

    this._ffmpegProc.on('error', (err) => {
      console.error(`[Stream] FFmpeg spawn error (${this.ip}): ${err.message}`);
      this.emit('error', err);
    });
  }
}

/**
 * Find end of a JPEG frame (FF D9 marker).
 * Returns the byte position AFTER the marker, or -1 if not found.
 */
function findJpegEnd(buf) {
  // Start searching after the initial FF D8 marker
  for (let i = 2; i < buf.length - 1; i++) {
    if (buf[i] === 0xFF && buf[i + 1] === 0xD9) {
      return i + 2;
    }
  }
  return -1;
}

module.exports = { StreamManager };
