const { spawn } = require('child_process');
const path = require('path');

/**
 * StreamManager - Multi-strategy real-time streaming from PICO devices
 *
 * Tries these approaches in order:
 * 1. scrcpy --record=- --record-format=h264  (best: uses MediaCodec, 30fps)
 * 2. screenrecord --output-format=h264        (may not work on all devices)
 * 3. WebSocket MJPEG (screencap + JPEG)       (slow fallback, 1-3 fps)
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
      method: null,      // 'scrcpy', 'screenrecord', 'mjpeg'
      bytesSent: 0,
      startTime: Date.now(),
      mjpegRunning: false,
    };

    this._startStream(ctx);
    return ctx;
  }

  async _startStream(ctx) {
    if (!ctx.running) return;

    // Strategy 1: Try scrcpy (best quality, uses device MediaCodec)
    if (await this._tryScrcpy(ctx)) {
      this._notifyMethod(ctx, 'scrcpy (H.264 30fps)');
      return;
    }

    // Strategy 2: Try screenrecord variants
    if (await this._tryScreenrecord(ctx)) {
      this._notifyMethod(ctx, 'screenrecord (H.264)');
      return;
    }

    // Strategy 3: WebSocket MJPEG fallback
    console.log(`[Stream] All H.264 methods failed for ${ctx.ip}, using MJPEG fallback`);
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

  // --- Strategy 1: scrcpy with raw H.264 output ---

  async _tryScrcpy(ctx) {
    const scrcpyPath = this.adbManager.scrcpyPath;
    if (!scrcpyPath) {
      console.log(`[Stream] scrcpy not found, skipping`);
      return false;
    }

    console.log(`[Stream] Trying scrcpy for ${ctx.ip}...`);
    const scrcpyDir = path.dirname(scrcpyPath);

    return new Promise((resolve) => {
      let gotData = false;
      let settled = false;

      const args = [
        '-s', `${ctx.ip}:5555`,
        '--no-playback',
        '--no-audio',
        '--no-control',
        '--video-codec=h264',
        '--video-bit-rate=4000000',
        '--max-size=800',
        '--max-fps=30',
        '--record=-',
        '--record-format=h264',
      ];

      console.log(`[Stream] Running: scrcpy ${args.join(' ')}`);

      ctx.proc = spawn(scrcpyPath, args, {
        cwd: scrcpyDir, // so scrcpy finds scrcpy-server and SDL2.dll
        env: { ...process.env, ADB: this.adbManager.adbPath },
      });

      // Give scrcpy 10 seconds to start producing data
      const timeout = setTimeout(() => {
        if (!gotData && !settled) {
          settled = true;
          console.log(`[Stream] scrcpy timeout for ${ctx.ip} (no data in 10s)`);
          try { ctx.proc.kill(); } catch {}
          ctx.proc = null;
          resolve(false);
        }
      }, 10000);

      ctx.proc.stdout.on('data', (chunk) => {
        if (!gotData) {
          gotData = true;
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            ctx.method = 'scrcpy';
            console.log(`[Stream] scrcpy producing H.264 for ${ctx.ip} (first chunk: ${chunk.length} bytes)`);
            resolve(true);
          }
        }
        ctx.bytesSent += chunk.length;
        this._sendH264(ctx, chunk);
      });

      ctx.proc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) {
          // Filter out common info messages
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
        } else if (gotData && ctx.running && ctx.clients.size > 0) {
          console.log(`[Stream] scrcpy ended for ${ctx.ip} (code ${code}), restarting in 1s...`);
          ctx.proc = null;
          ctx.restartTimer = setTimeout(() => {
            if (ctx.running && ctx.clients.size > 0) {
              this._tryScrcpy(ctx).then(ok => {
                if (!ok && ctx.running) {
                  console.log(`[Stream] scrcpy restart failed for ${ctx.ip}, falling back`);
                  this._startMjpegWs(ctx);
                }
              });
            }
          }, 1000);
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
