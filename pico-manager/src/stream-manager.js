const { spawn } = require('child_process');
const path = require('path');
const { MkvH264Demuxer } = require('./mkv-demuxer');

/**
 * StreamManager - Multi-strategy real-time streaming from PICO devices
 *
 * Tries these approaches in order:
 * 1. scrcpy --record=- --record-format=mkv  (best: uses MediaCodec, 30fps)
 *    MKV output is demuxed to extract raw H.264 Annex B NAL units
 * 2. screenrecord --output-format=h264      (may not work on all devices)
 * 3. WebSocket MJPEG (screencap + JPEG)     (slow fallback, 1-3 fps)
 *
 * Binary packet format sent to browser:
 *   [1 byte type] [1 byte IP length] [IP string] [data]
 *   Type 0x01 = H.264 Annex B data
 *   Type 0x02 = JPEG frame
 */
class StreamManager {
  constructor(adbManager, screenCapture) {
    this.adbManager = adbManager;
    this.screenCapture = screenCapture; // for MJPEG fallback
    this.streams = new Map(); // ip -> StreamContext
  }

  /**
   * Subscribe a WebSocket client to a device's stream.
   * Starts the stream if not already running. Multiple clients share one stream.
   * Returns an unsubscribe function.
   */
  subscribe(ip, ws, options = {}) {
    let ctx = this.streams.get(ip);
    if (!ctx) {
      ctx = this._createStream(ip, options);
      this.streams.set(ip, ctx);
    }
    ctx.clients.add(ws);
    console.log(`[Stream] Client subscribed to ${ip} (${ctx.clients.size} total, h264: ${ctx.h264Capable})`);

    return () => {
      ctx.clients.delete(ws);
      console.log(`[Stream] Client unsubscribed from ${ip} (${ctx.clients.size} remaining)`);
      if (ctx.clients.size === 0) {
        this._destroyStream(ip);
      }
    };
  }

  _createStream(ip, options = {}) {
    const ctx = {
      ip,
      clients: new Set(),
      proc: null,
      running: true,
      restartTimer: null,
      method: null,      // 'scrcpy', 'screenrecord', 'mjpeg'
      h264Capable: options.h264 !== false,
      bytesSent: 0,
      startTime: Date.now(),
      mjpegRunning: false,
      scrcpyRestarts: 0,       // track restart count
      lastScrcpyStart: 0,      // detect rapid failures
    };

    this._startStream(ctx);
    return ctx;
  }

  async _startStream(ctx) {
    if (!ctx.running) return;

    if (ctx.h264Capable) {
      // Strategy 1: scrcpy with display crop (flat 2D view, best for PICO VR)
      if (await this._tryScrcpy(ctx)) {
        this._notifyMethod(ctx, 'scrcpy (H.264 flat view)');
        return;
      }

      // Strategy 2: screenrecord fallback (shows raw VR stereo view)
      if (await this._tryScreenrecord(ctx)) {
        this._notifyMethod(ctx, 'screenrecord (H.264 VR view)');
        return;
      }

      console.log(`[Stream] All H.264 methods failed for ${ctx.ip}, using MJPEG fallback`);
    } else {
      console.log(`[Stream] Browser doesn't support H.264 for ${ctx.ip}, using MJPEG directly`);
    }

    // Strategy 3: WebSocket MJPEG fallback
    this._startMjpegWs(ctx);
    this._notifyMethod(ctx, 'MJPEG (slow fallback)');
  }

  _notifyMethod(ctx, method) {
    // Send text message to clients about streaming method
    const msg = JSON.stringify({ type: 'stream_method', ip: ctx.ip, method });
    for (const ws of ctx.clients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  // --- Strategy 1: scrcpy with MKV output, demuxed to raw H.264 ---

  async _tryScrcpy(ctx) {
    const MAX_RAPID_RESTARTS = 3;
    const RAPID_FAILURE_MS = 5000; // if scrcpy dies within 5s, it's a rapid failure

    const scrcpyPath = this.adbManager.scrcpyPath;
    if (!scrcpyPath) {
      console.log(`[Stream] scrcpy not found, skipping`);
      return false;
    }

    // Check restart limit (prevent infinite loop from repeated failures)
    if (ctx.scrcpyRestarts >= MAX_RAPID_RESTARTS) {
      console.log(`[Stream] scrcpy failed ${MAX_RAPID_RESTARTS} times for ${ctx.ip}, giving up`);
      return false;
    }

    console.log(`[Stream] Trying scrcpy for ${ctx.ip} (attempt ${ctx.scrcpyRestarts + 1})...`);
    const scrcpyDir = path.dirname(scrcpyPath);
    ctx.lastScrcpyStart = Date.now();

    return new Promise((resolve) => {
      let gotH264 = false; // true once demuxer emits H.264 data
      let settled = false;

      const args = [
        '-s', `${ctx.ip}:5555`,
        '--no-playback',
        '--no-audio',
        '--no-control',
        '--display-id=0',
        '--crop=1920:1080:120:540',
        '--video-codec=h264',
        '--video-bit-rate=8000000',
        '--max-fps=30',
        '--record=-',
        '--record-format=mkv',
      ];

      console.log(`[Stream] Running: scrcpy ${args.join(' ')}`);

      // Create MKV demuxer that converts MKV → raw H.264 Annex B
      let stdoutBytes = 0;
      const demuxer = new MkvH264Demuxer((h264Data) => {
        if (!gotH264) {
          gotH264 = true;
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            ctx.method = 'scrcpy';
            console.log(`[Stream] scrcpy producing H.264 for ${ctx.ip} via MKV demux (${h264Data.length} bytes)`);
            resolve(true);
          }
        }
        ctx.bytesSent += h264Data.length;
        this._sendH264(ctx, h264Data);
      });

      ctx.proc = spawn(scrcpyPath, args, {
        cwd: scrcpyDir, // so scrcpy finds scrcpy-server and SDL2.dll
        env: { ...process.env, ADB: this.adbManager.adbPath },
      });

      // Give scrcpy 20 seconds to start producing demuxed H.264 data
      const timeout = setTimeout(() => {
        if (!gotH264 && !settled) {
          settled = true;
          console.log(`[Stream] scrcpy timeout for ${ctx.ip} (no H.264 data in 20s, stdout received: ${stdoutBytes} bytes)`);
          try { ctx.proc.kill(); } catch {}
          ctx.proc = null;
          resolve(false);
        }
      }, 20000);

      ctx.proc.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= chunk.length) {
          // First chunk - log it
          console.log(`[Stream] scrcpy stdout first data for ${ctx.ip}: ${chunk.length} bytes (first 16: ${chunk.subarray(0, 16).toString('hex')})`);
        }
        // Feed raw MKV data into the demuxer
        demuxer.feed(chunk);
      });

      ctx.proc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) {
          for (const line of msg.split('\n')) {
            const l = line.trim();
            if (l && !l.startsWith('INFO:')) {
              console.log(`[Stream] scrcpy (${ctx.ip}): ${l}`);
            }
          }
        }
      });

      ctx.proc.on('close', (code) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          console.log(`[Stream] scrcpy exited before producing data for ${ctx.ip} (code ${code})`);
          ctx.proc = null;
          resolve(false);
        } else if (gotH264 && ctx.running && ctx.clients.size > 0) {
          ctx.proc = null;
          // Check if this was a rapid failure
          const runTime = Date.now() - ctx.lastScrcpyStart;
          if (runTime < RAPID_FAILURE_MS) {
            ctx.scrcpyRestarts++;
            console.log(`[Stream] scrcpy died quickly for ${ctx.ip} (${runTime}ms, code ${code}), restart ${ctx.scrcpyRestarts}/${MAX_RAPID_RESTARTS}`);
            if (ctx.scrcpyRestarts >= MAX_RAPID_RESTARTS) {
              console.log(`[Stream] scrcpy keeps failing for ${ctx.ip}, falling back to MJPEG`);
              this._startMjpegWs(ctx);
              this._notifyMethod(ctx, 'MJPEG (slow fallback)');
              return;
            }
          } else {
            // Long-running session ended normally, reset counter
            ctx.scrcpyRestarts = 0;
          }

          console.log(`[Stream] scrcpy ended for ${ctx.ip} (code ${code}, ran ${runTime}ms), restarting in 2s...`);
          ctx.restartTimer = setTimeout(() => {
            if (ctx.running && ctx.clients.size > 0) {
              this._tryScrcpy(ctx).then(ok => {
                if (!ok && ctx.running) {
                  console.log(`[Stream] scrcpy restart failed for ${ctx.ip}, falling back`);
                  this._startMjpegWs(ctx);
                  this._notifyMethod(ctx, 'MJPEG (slow fallback)');
                }
              });
            }
          }, 2000);
        }
      });

      ctx.proc.on('error', (err) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          console.error(`[Stream] scrcpy spawn error: ${err.message}`);
          ctx.proc = null;
          resolve(false);
        }
      });
    });
  }

  // --- Strategy 2: screenrecord variants ---

  async _tryScreenrecord(ctx) {
    if (!ctx.running) return false;

    const adbPath = this.adbManager.adbPath;
    console.log(`[Stream] Trying screenrecord for ${ctx.ip}...`);

    // Try different flag combinations
    const variants = [
      // Variant 1: h264 to stdout with -
      ['exec-out', 'screenrecord', '--output-format=h264', '--bit-rate', '4000000', '--size', '800x600', '-'],
      // Variant 2: h264 to /dev/stdout
      ['exec-out', 'screenrecord', '--output-format=h264', '--bit-rate', '4000000', '/dev/stdout'],
      // Variant 3: h264 without --size
      ['exec-out', 'screenrecord', '--output-format=h264', '--bit-rate', '4000000', '-'],
      // Variant 4: using shell instead of exec-out
      ['shell', 'screenrecord', '--output-format=h264', '--bit-rate', '4000000', '-'],
    ];

    for (const variant of variants) {
      if (!ctx.running) return false;
      const result = await this._tryScreenrecordVariant(ctx, variant);
      if (result) return true;
    }

    console.log(`[Stream] All screenrecord variants failed for ${ctx.ip}`);
    return false;
  }

  _tryScreenrecordVariant(ctx, shellArgs) {
    const adbPath = this.adbManager.adbPath;
    const fullArgs = ['-s', `${ctx.ip}:5555`, ...shellArgs];

    return new Promise((resolve) => {
      let gotData = false;
      let settled = false;

      console.log(`[Stream]   Trying: adb ${fullArgs.join(' ')}`);
      const proc = spawn(adbPath, fullArgs);

      const timeout = setTimeout(() => {
        if (!gotData && !settled) {
          settled = true;
          try { proc.kill(); } catch {}
          resolve(false);
        }
      }, 5000);

      proc.stdout.on('data', (chunk) => {
        if (!gotData) {
          gotData = true;
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            ctx.proc = proc;
            ctx.method = 'screenrecord';
            console.log(`[Stream]   screenrecord working! (${chunk.length} bytes)`);
            // Set up restart handler for 180s Android limit
            proc.on('close', (code) => {
              console.log(`[Stream] screenrecord ended for ${ctx.ip} (code ${code})`);
              ctx.proc = null;
              if (ctx.running && ctx.clients.size > 0) {
                ctx.restartTimer = setTimeout(() => {
                  if (ctx.running && ctx.clients.size > 0) {
                    // Retry same variant
                    this._tryScreenrecordVariant(ctx, shellArgs).then(ok => {
                      if (!ok && ctx.running) {
                        this._startMjpegWs(ctx);
                      }
                    });
                  }
                }, 500);
              }
            });
            resolve(true);
          }
        }
        ctx.bytesSent += chunk.length;
        this._sendH264(ctx, chunk);
      });

      proc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) console.log(`[Stream]   screenrecord stderr: ${msg}`);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
    });
  }

  // --- Strategy 3: MJPEG via WebSocket ---

  _startMjpegWs(ctx) {
    if (!ctx.running || ctx.mjpegRunning) return;
    if (!this.screenCapture) {
      console.error(`[Stream] No screenCapture available for MJPEG fallback`);
      return;
    }

    ctx.method = 'mjpeg';
    ctx.mjpegRunning = true;
    console.log(`[Stream] Starting MJPEG fallback for ${ctx.ip}`);

    const loop = async () => {
      let frameCount = 0;
      while (ctx.running && ctx.mjpegRunning && ctx.clients.size > 0) {
        try {
          const buffer = await this.screenCapture.captureScreenshot(ctx.ip);
          if (buffer && ctx.running && ctx.mjpegRunning) {
            this._sendJpeg(ctx, buffer);
            frameCount++;
            if (frameCount === 1) {
              console.log(`[Stream] MJPEG first frame for ${ctx.ip} (${buffer.length} bytes)`);
            }
          }
        } catch (err) {
          if (frameCount === 0) {
            console.error(`[Stream] MJPEG capture error for ${ctx.ip}: ${err.message}`);
          }
          await new Promise(r => setTimeout(r, 2000));
        }
        // Small delay between captures to avoid hammering ADB
        await new Promise(r => setTimeout(r, 100));
      }
      ctx.mjpegRunning = false;
      console.log(`[Stream] MJPEG loop ended for ${ctx.ip} after ${frameCount} frames`);
    };

    loop();
  }

  // --- Packet sending ---

  _sendH264(ctx, data) {
    const ipBuf = Buffer.from(ctx.ip);
    const packet = Buffer.alloc(2 + ipBuf.length + data.length);
    packet[0] = 0x01; // type: H.264
    packet[1] = ipBuf.length;
    ipBuf.copy(packet, 2);
    if (Buffer.isBuffer(data)) {
      data.copy(packet, 2 + ipBuf.length);
    } else {
      packet.set(data, 2 + ipBuf.length);
    }

    // Debug: log first few sends and periodically
    if (!ctx._h264SendCount) ctx._h264SendCount = 0;
    ctx._h264SendCount++;
    if (ctx._h264SendCount <= 5 || ctx._h264SendCount % 100 === 0) {
      console.log(`[Stream] H.264 send #${ctx._h264SendCount} for ${ctx.ip}: ${data.length} bytes to ${ctx.clients.size} client(s)`);
    }

    for (const ws of ctx.clients) {
      if (ws.readyState === 1) {
        try { ws.send(packet, { binary: true }); } catch {}
      }
    }
  }

  _sendJpeg(ctx, data) {
    const ipBuf = Buffer.from(ctx.ip);
    const packet = Buffer.alloc(2 + ipBuf.length + data.length);
    packet[0] = 0x02; // type: JPEG
    packet[1] = ipBuf.length;
    ipBuf.copy(packet, 2);
    if (Buffer.isBuffer(data)) {
      data.copy(packet, 2 + ipBuf.length);
    } else {
      packet.set(data, 2 + ipBuf.length);
    }

    for (const ws of ctx.clients) {
      if (ws.readyState === 1) {
        try { ws.send(packet, { binary: true }); } catch {}
      }
    }
  }

  // --- Cleanup ---

  _destroyStream(ip) {
    const ctx = this.streams.get(ip);
    if (!ctx) return;

    console.log(`[Stream] Destroying stream for ${ip} (was using: ${ctx.method})`);
    ctx.running = false;
    ctx.mjpegRunning = false;
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
