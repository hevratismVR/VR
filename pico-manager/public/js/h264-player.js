/**
 * H264Player - Decodes H.264 Annex B stream using WebCodecs API
 * Renders frames to a <canvas> element.
 * Zero dependencies - uses browser-native VideoDecoder.
 */
class H264Player {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.decoder = null;
    this.configured = false;
    this.sps = null;
    this.pps = null;
    this.timestamp = 0;
    this.buffer = new Uint8Array(0);
    this.frameCount = 0;
    this.onFps = null; // callback(fps)
    this._fpsFrames = 0;
    this._fpsTimer = setInterval(() => {
      if (this.onFps) this.onFps(this._fpsFrames);
      this._fpsFrames = 0;
    }, 1000);
  }

  /**
   * Feed raw H.264 Annex B data (from screenrecord --output-format=h264)
   */
  feed(data) {
    // Append to buffer
    const newBuf = new Uint8Array(this.buffer.length + data.length);
    newBuf.set(this.buffer);
    newBuf.set(data, this.buffer.length);
    this.buffer = newBuf;

    // Extract complete NAL units
    const nalus = this._extractNALUs();

    for (const nalu of nalus) {
      if (nalu.length === 0) continue;
      const type = nalu[0] & 0x1F;

      if (type === 7) { // SPS
        this.sps = nalu;
        this._tryConfigureDecoder();
      } else if (type === 8) { // PPS
        this.pps = nalu;
        this._tryConfigureDecoder();
      } else if ((type === 5 || type === 1) && this.configured) {
        // IDR (keyframe) or non-IDR slice
        this._decodeFrame(nalu, type === 5);
      }
    }
  }

  _tryConfigureDecoder() {
    if (!this.sps || !this.pps) return;

    // Close existing decoder if reconfiguring
    if (this.decoder) {
      try { this.decoder.close(); } catch {}
    }

    // Extract codec string from SPS: avc1.PPCCLL
    const profile = this.sps[1];
    const compat = this.sps[2];
    const level = this.sps[3];
    const codec = `avc1.${_hex(profile)}${_hex(compat)}${_hex(level)}`;

    // Create AVCDecoderConfigurationRecord for VideoDecoder
    const description = this._createAVCDCR(this.sps, this.pps);

    this.decoder = new VideoDecoder({
      output: (frame) => {
        // Resize canvas to match video
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
        }
        this.ctx.drawImage(frame, 0, 0);
        frame.close();
        this.frameCount++;
        this._fpsFrames++;
      },
      error: (e) => {
        console.error('[H264] VideoDecoder error:', e);
      }
    });

    this.decoder.configure({
      codec,
      description,
      optimizeForLatency: true,
    });

    this.configured = true;
    this.timestamp = 0;
    console.log(`[H264] Decoder configured: ${codec}`);
  }

  /**
   * Create AVCDecoderConfigurationRecord from SPS and PPS
   */
  _createAVCDCR(sps, pps) {
    const buf = new Uint8Array(11 + sps.length + pps.length);
    let i = 0;
    buf[i++] = 1;           // configurationVersion
    buf[i++] = sps[1];      // AVCProfileIndication
    buf[i++] = sps[2];      // profile_compatibility
    buf[i++] = sps[3];      // AVCLevelIndication
    buf[i++] = 0xFF;        // lengthSizeMinusOne=3 | reserved (6 bits = 111111)
    buf[i++] = 0xE1;        // numSPS=1 | reserved (3 bits = 111)
    buf[i++] = (sps.length >> 8) & 0xFF;
    buf[i++] = sps.length & 0xFF;
    buf.set(sps, i); i += sps.length;
    buf[i++] = 1;           // numPPS
    buf[i++] = (pps.length >> 8) & 0xFF;
    buf[i++] = pps.length & 0xFF;
    buf.set(pps, i);
    return buf;
  }

  /**
   * Decode a single NAL unit as a video frame
   */
  _decodeFrame(nalu, isKeyframe) {
    if (!this.decoder || this.decoder.state !== 'configured') return;

    // Convert to AVC format: 4-byte length prefix instead of start code
    const avcData = new Uint8Array(4 + nalu.length);
    avcData[0] = (nalu.length >> 24) & 0xFF;
    avcData[1] = (nalu.length >> 16) & 0xFF;
    avcData[2] = (nalu.length >> 8) & 0xFF;
    avcData[3] = nalu.length & 0xFF;
    avcData.set(nalu, 4);

    try {
      this.decoder.decode(new EncodedVideoChunk({
        type: isKeyframe ? 'key' : 'delta',
        timestamp: this.timestamp,
        data: avcData,
      }));
      this.timestamp += 33333; // ~30fps in microseconds
    } catch (e) {
      // Queue full or decode error - skip frame
    }
  }

  /**
   * Extract complete NAL units from the buffer.
   * NAL units are delimited by start codes (00 00 01 or 00 00 00 01).
   * Keeps incomplete data in the buffer for the next call.
   */
  _extractNALUs() {
    const nalus = [];
    const buf = this.buffer;
    const starts = []; // positions of NAL unit data (after start code)

    for (let i = 0; i < buf.length - 3; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0) {
        if (buf[i + 2] === 1) {
          starts.push(i + 3);
          i += 2;
        } else if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) {
          starts.push(i + 4);
          i += 3;
        }
      }
    }

    // Extract NAL units between consecutive start codes
    for (let j = 0; j < starts.length - 1; j++) {
      nalus.push(buf.subarray(starts[j], starts[j + 1] - (buf[starts[j + 1] - 3] === 0 ? 4 : 3)));
    }

    // Keep buffer from last start code onward (possibly incomplete NAL unit)
    if (starts.length > 0) {
      this.buffer = new Uint8Array(buf.subarray(starts[starts.length - 1]));
    } else if (buf.length > 4 * 1024 * 1024) {
      // Buffer too large with no start codes found - reset
      this.buffer = new Uint8Array(0);
    }

    return nalus;
  }

  destroy() {
    clearInterval(this._fpsTimer);
    if (this.decoder) {
      try { this.decoder.close(); } catch {}
      this.decoder = null;
    }
    this.configured = false;
    this.sps = null;
    this.pps = null;
    this.buffer = new Uint8Array(0);
  }

  static get supported() {
    return typeof VideoDecoder !== 'undefined';
  }
}

function _hex(n) {
  return n.toString(16).padStart(2, '0');
}
