const { spawn } = require('child_process');

/**
 * StreamManager - Real-time H.264 streaming from PICO devices
 *
 * Uses `adb exec-out screenrecord --output-format=h264` to get hardware-encoded
 * H.264 video from the device. Streams raw H.264 chunks to browser via WebSocket.
 * Browser decodes with WebCodecs API (VideoDecoder) - no server-side decoding needed.
 *
 * screenrecord on VR devices typically captures the flat "casting" view,
 * not the stereoscopic VR view. This means no lens circle, no stereo split.
 */
class StreamManager {
  constructor(adbManager) {
    this.adbManager = adbManager;
    this.streams = new Map(); // ip -> StreamContext
  }

  /**
   * Subscribe a WebSocket client to a device's H.264 stream.
   * Starts the stream if not already running. Multiple clients share one stream.
   * Returns an unsubscribe function.
   */
  subscribe(ip, ws) {
    let ctx = this.streams.get(ip);
    if (!ctx) {
      ctx = this._createStream(ip);
      this.streams.set(ip, ctx);
    }
    ctx.clients.add(ws);
    console.log(`[Stream] Client subscribed to ${ip} (${ctx.clients.size} total)`);

    return () => {
      ctx.clients.delete(ws);
      console.log(`[Stream] Client unsubscribed from ${ip} (${ctx.clients.size} remaining)`);
      if (ctx.clients.size === 0) {
        this._destroyStream(ip);
      }
    };
  }

  _createStream(ip) {
    const ctx = {
      ip,
      clients: new Set(),
      proc: null,
      running: true,
      restartTimer: null,
      bytesSent: 0,
      startTime: Date.now(),
    };

    this._startProcess(ctx);
    return ctx;
  }

  _startProcess(ctx) {
    if (!ctx.running) return;

    const adbPath = this.adbManager.adbPath;
    console.log(`[Stream] Starting screenrecord for ${ctx.ip}`);

    ctx.proc = spawn(adbPath, [
      '-s', `${ctx.ip}:5555`,
      'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--bit-rate', '4000000',
      '-'
    ]);

    ctx.proc.stdout.on('data', (chunk) => {
      ctx.bytesSent += chunk.length;

      // Create packet: [1 byte IP length][IP string][H.264 data]
      const ipBuf = Buffer.from(ctx.ip);
      const header = Buffer.alloc(1);
      header[0] = ipBuf.length;
      const packet = Buffer.concat([header, ipBuf, chunk]);

      for (const ws of ctx.clients) {
        if (ws.readyState === 1) { // WebSocket.OPEN
          try {
            ws.send(packet, { binary: true });
          } catch {}
        }
      }
    });

    ctx.proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.warn(`[Stream] screenrecord stderr (${ctx.ip}): ${msg}`);
    });

    // screenrecord has a 180-second time limit on Android - auto-restart
    ctx.proc.on('close', (code) => {
      console.log(`[Stream] screenrecord ended for ${ctx.ip} (code ${code})`);
      if (ctx.running && ctx.clients.size > 0) {
        console.log(`[Stream] Restarting screenrecord for ${ctx.ip} in 300ms...`);
        ctx.restartTimer = setTimeout(() => this._startProcess(ctx), 300);
      }
    });

    ctx.proc.on('error', (err) => {
      console.error(`[Stream] Failed to start screenrecord for ${ctx.ip}: ${err.message}`);
    });
  }

  _destroyStream(ip) {
    const ctx = this.streams.get(ip);
    if (!ctx) return;

    console.log(`[Stream] Destroying stream for ${ip}`);
    ctx.running = false;
    if (ctx.restartTimer) clearTimeout(ctx.restartTimer);
    if (ctx.proc) {
      try { ctx.proc.kill(); } catch {}
    }
    ctx.clients.clear();
    this.streams.delete(ip);
  }

  stopAll() {
    for (const [ip] of this.streams) {
      this._destroyStream(ip);
    }
  }
}

module.exports = { StreamManager };
