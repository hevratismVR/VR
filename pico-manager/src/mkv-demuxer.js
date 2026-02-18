/**
 * Minimal MKV/EBML streaming demuxer for extracting H.264 NAL units.
 *
 * scrcpy v3.2+ no longer supports --record-format=h264.
 * Instead we use --record-format=mkv and demux the Matroska container
 * to get raw H.264 Annex B data for the browser's WebCodecs API.
 *
 * The demuxer:
 *  - Parses EBML element headers (ID + size)
 *  - Descends into master elements (Segment, Tracks, Cluster, etc.)
 *  - Extracts SPS/PPS from CodecPrivate (AVCDecoderConfigurationRecord)
 *  - Extracts video frames from SimpleBlock/Block elements
 *  - Converts AVCC format (length-prefixed) to Annex B (start codes)
 *  - Emits raw H.264 NAL units via callback
 */

const ANNEX_B_START = Buffer.from([0x00, 0x00, 0x00, 0x01]);

// Maximum non-master element size we'll buffer (1MB).
// Anything larger is skipped to prevent memory issues.
const MAX_ELEMENT_SIZE = 1024 * 1024;

// Master elements: containers whose children we parse individually
const MASTER_ELEMENTS = new Set([
  0x1A45DFA3, // EBML Header
  0x18538067, // Segment
  0x1549A966, // Info
  0x1654AE6B, // Tracks
  0xAE,       // TrackEntry
  0xE0,       // Video
  0xE1,       // Audio
  0x6D80,     // ContentEncodings
  0x6240,     // ContentEncoding
  0x1F43B675, // Cluster
  0xA0,       // BlockGroup
  0x114D9B74, // SeekHead
  0x4DBB,     // Seek
  0x1254C367, // Tags
  0x7373,     // Tag
  0x63C0,     // Targets
  0x67C8,     // SimpleTag
  0x1C53BB6B, // Cues
  0xBB,       // CuePoint
  0xB7,       // CueTrackPositions
]);

/**
 * Read an EBML element ID from a buffer.
 * IDs keep the VINT marker bit as part of the value.
 * Returns { value, length } or null if not enough data.
 */
function readEBMLId(buf, offset) {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let len;
  if (first & 0x80) len = 1;
  else if (first & 0x40) len = 2;
  else if (first & 0x20) len = 3;
  else if (first & 0x10) len = 4;
  else return null; // IDs are max 4 bytes in EBML

  if (offset + len > buf.length) return null;

  let value = first;
  for (let i = 1; i < len; i++) {
    value = (value << 8) | buf[offset + i];
  }
  // Ensure unsigned for 4-byte IDs (JS bitwise ops are signed 32-bit)
  value = value >>> 0;

  return { value, length: len };
}

/**
 * Read an EBML data size from a buffer.
 * The VINT marker bit is stripped from the value.
 * Returns { value, length } or null if not enough data.
 * value = -1 means unknown/indeterminate size.
 */
function readEBMLSize(buf, offset) {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let len, mask;
  if (first & 0x80)      { len = 1; mask = 0x7F; }
  else if (first & 0x40) { len = 2; mask = 0x3F; }
  else if (first & 0x20) { len = 3; mask = 0x1F; }
  else if (first & 0x10) { len = 4; mask = 0x0F; }
  else if (first & 0x08) { len = 5; mask = 0x07; }
  else if (first & 0x04) { len = 6; mask = 0x03; }
  else if (first & 0x02) { len = 7; mask = 0x01; }
  else if (first & 0x01) { len = 8; mask = 0x00; }
  else return null;

  if (offset + len > buf.length) return null;

  // Use number arithmetic (safe up to 2^53)
  let value = first & mask;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[offset + i];
  }

  // Check for unknown/indeterminate size (all value bits set to 1)
  const maxValue = Math.pow(2, 7 * len) - 1;
  if (value === maxValue) {
    return { value: -1, length: len }; // unknown size
  }

  return { value, length: len };
}

class MkvH264Demuxer {
  /**
   * @param {function(Buffer)} onH264Data - Called with Annex B H.264 data chunks
   */
  constructor(onH264Data) {
    this.onH264Data = onH264Data;
    this.buffer = Buffer.alloc(0);
    this.nalLengthSize = 4; // from AVCDecoderConfigurationRecord, default 4
    this.skipBytes = 0;     // bytes to skip (large unneeded elements)
    this.gotCodecPrivate = false;
  }

  /**
   * Feed raw MKV data from scrcpy stdout.
   */
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this._parse();
  }

  _parse() {
    // First, skip any remaining bytes from a large element
    if (this.skipBytes > 0) {
      const skip = Math.min(this.skipBytes, this.buffer.length);
      this.buffer = this.buffer.subarray(skip);
      this.skipBytes -= skip;
      if (this.skipBytes > 0) return; // need more data to finish skipping
    }

    while (this.buffer.length > 0) {
      // Read element ID
      const id = readEBMLId(this.buffer, 0);
      if (!id) break;

      // Read element data size
      const size = readEBMLSize(this.buffer, id.length);
      if (!size) break;

      const headerLen = id.length + size.length;
      const elementId = id.value;
      const dataSize = size.value;

      // Master elements: descend into children (strip header, parse children)
      if (MASTER_ELEMENTS.has(elementId)) {
        this.buffer = this.buffer.subarray(headerLen);
        continue;
      }

      // Unknown/indeterminate size for non-master element: skip header and hope
      if (dataSize < 0) {
        this.buffer = this.buffer.subarray(headerLen);
        continue;
      }

      // Large element we don't need: skip efficiently
      if (dataSize > MAX_ELEMENT_SIZE && elementId !== 0xA3 && elementId !== 0xA1) {
        this.buffer = this.buffer.subarray(headerLen);
        this.skipBytes = dataSize;
        const skip = Math.min(this.skipBytes, this.buffer.length);
        this.buffer = this.buffer.subarray(skip);
        this.skipBytes -= skip;
        if (this.skipBytes > 0) return;
        continue;
      }

      // Wait for the full element data
      if (this.buffer.length < headerLen + dataSize) break;

      const data = this.buffer.subarray(headerLen, headerLen + dataSize);
      this.buffer = this.buffer.subarray(headerLen + dataSize);

      // Process relevant elements
      if (elementId === 0x63A2) {
        // CodecPrivate: AVCDecoderConfigurationRecord (SPS/PPS)
        this._handleCodecPrivate(data);
      } else if (elementId === 0xA3 || elementId === 0xA1) {
        // SimpleBlock (0xA3) or Block (0xA1): video frame data
        this._handleBlock(data);
      }
      // All other elements are silently skipped
    }
  }

  /**
   * Parse AVCDecoderConfigurationRecord from CodecPrivate.
   * Extracts SPS and PPS, converts to Annex B, and emits them.
   */
  _handleCodecPrivate(data) {
    if (data.length < 7) return;

    // Check if this looks like an AVCDecoderConfigurationRecord
    const configVersion = data[0];
    if (configVersion !== 1) return; // Not AVC config

    this.nalLengthSize = (data[4] & 0x03) + 1;

    const parts = [];
    let offset = 5;

    // SPS entries
    const numSPS = data[offset] & 0x1F;
    offset++;
    for (let i = 0; i < numSPS && offset + 2 <= data.length; i++) {
      const len = data.readUInt16BE(offset);
      offset += 2;
      if (len > 0 && offset + len <= data.length) {
        parts.push(ANNEX_B_START);
        parts.push(data.subarray(offset, offset + len));
        offset += len;
      }
    }

    // PPS entries
    if (offset < data.length) {
      const numPPS = data[offset];
      offset++;
      for (let i = 0; i < numPPS && offset + 2 <= data.length; i++) {
        const len = data.readUInt16BE(offset);
        offset += 2;
        if (len > 0 && offset + len <= data.length) {
          parts.push(ANNEX_B_START);
          parts.push(data.subarray(offset, offset + len));
          offset += len;
        }
      }
    }

    if (parts.length > 0) {
      this.gotCodecPrivate = true;
      this.onH264Data(Buffer.concat(parts));
    }
  }

  /**
   * Parse a SimpleBlock or Block element.
   * Extracts NAL units in AVCC format and converts to Annex B.
   */
  _handleBlock(data) {
    if (data.length < 4) return;

    // Track number (VINT, same encoding as EBML size)
    const trackVint = readEBMLSize(data, 0);
    if (!trackVint || trackVint.value < 1) return;

    // We assume video is track 1 (scrcpy with --no-audio only has one track)
    // Skip: track number VINT + 2 bytes timestamp + 1 byte flags
    const headerLen = trackVint.length + 3;
    if (data.length <= headerLen) return;

    // Check lacing flags (bits 1-2 of flags byte)
    const flags = data[trackVint.length + 2];
    const lacing = (flags >> 1) & 0x03;
    if (lacing !== 0) {
      // Lacing is used - for simplicity we don't parse laced frames
      // This is uncommon for H.264 in scrcpy
      return;
    }

    let offset = headerLen;
    const parts = [];

    // Convert AVCC NAL units to Annex B
    while (offset + this.nalLengthSize <= data.length) {
      let nalLen = 0;
      for (let i = 0; i < this.nalLengthSize; i++) {
        nalLen = (nalLen << 8) | data[offset + i];
      }
      offset += this.nalLengthSize;

      if (nalLen <= 0 || offset + nalLen > data.length) break;

      parts.push(ANNEX_B_START);
      parts.push(data.subarray(offset, offset + nalLen));
      offset += nalLen;
    }

    if (parts.length > 0) {
      this.onH264Data(Buffer.concat(parts));
    }
  }
}

module.exports = { MkvH264Demuxer };
