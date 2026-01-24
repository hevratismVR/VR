/**
 * Audio analyzer that extracts phoneme-like features from WAV files.
 * Uses spectral analysis to detect mouth shapes for lip sync.
 */
export class AudioAnalyzer {
    constructor() {
        this.audioContext = null;
        this.audioBuffer = null;
        this.phonemes = [];
        this.duration = 0;
    }

    /**
     * Load and analyze an audio file.
     */
    async analyze(file) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const arrayBuffer = await file.arrayBuffer();
        this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.duration = this.audioBuffer.duration;

        // Extract phoneme-like segments from the audio
        this.phonemes = this.extractPhonemes();

        return {
            duration: this.duration,
            sampleRate: this.audioBuffer.sampleRate,
            phonemes: this.phonemes,
            phonemeCount: this.phonemes.length
        };
    }

    /**
     * Extract phoneme-like segments using spectral analysis.
     * Uses native FFT via Float32Array for performance.
     */
    extractPhonemes() {
        const channelData = this.audioBuffer.getChannelData(0);
        const sampleRate = this.audioBuffer.sampleRate;

        // Analysis parameters
        const fftSize = 512;
        const windowSize = fftSize;
        const hopSize = Math.floor(windowSize / 2); // 50% overlap
        const totalWindows = Math.floor((channelData.length - windowSize) / hopSize);

        // Pre-compute Hanning window
        const hanningWindow = new Float32Array(windowSize);
        for (let i = 0; i < windowSize; i++) {
            hanningWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowSize - 1)));
        }

        const phonemes = [];
        let currentPhoneme = null;

        // Reusable buffer for windowed samples
        const windowedBuffer = new Float32Array(fftSize);

        for (let w = 0; w < totalWindows; w++) {
            const startSample = w * hopSize;
            const timeStart = startSample / sampleRate;

            // Apply window function
            for (let i = 0; i < windowSize; i++) {
                windowedBuffer[i] = channelData[startSample + i] * hanningWindow[i];
            }

            // Compute features
            const energy = this.computeEnergy(windowedBuffer);
            const zcr = this.computeZeroCrossingRate(channelData, startSample, windowSize);
            const magnitudes = this.computeFFTReal(windowedBuffer, fftSize);
            const spectralCentroid = this.centroidFromMagnitudes(magnitudes, sampleRate, fftSize);
            const formants = this.formantsFromMagnitudes(magnitudes, sampleRate, fftSize);

            // Classify the phoneme/viseme
            const viseme = this.classifyViseme(energy, zcr, spectralCentroid, formants);

            // Group consecutive same visemes
            if (currentPhoneme && currentPhoneme.viseme === viseme) {
                currentPhoneme.end = timeStart + (windowSize / sampleRate);
            } else {
                if (currentPhoneme) {
                    phonemes.push(currentPhoneme);
                }
                currentPhoneme = {
                    viseme,
                    start: timeStart,
                    end: timeStart + (windowSize / sampleRate),
                    energy,
                    features: { zcr, spectralCentroid, formants }
                };
            }
        }

        if (currentPhoneme) {
            phonemes.push(currentPhoneme);
        }

        // Merge very short segments and smooth transitions
        return this.smoothPhonemes(phonemes);
    }

    /**
     * Compute RMS energy of a windowed buffer.
     */
    computeEnergy(buffer) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i] * buffer[i];
        }
        return Math.sqrt(sum / buffer.length);
    }

    /**
     * Compute zero-crossing rate from raw channel data at offset.
     */
    computeZeroCrossingRate(data, offset, length) {
        let crossings = 0;
        for (let i = 1; i < length; i++) {
            if ((data[offset + i] >= 0) !== (data[offset + i - 1] >= 0)) {
                crossings++;
            }
        }
        return crossings / length;
    }

    /**
     * Compute FFT magnitudes using Cooley-Tukey radix-2 algorithm.
     * Much faster than the DFT approach: O(n log n) vs O(n²).
     */
    computeFFTReal(input, size) {
        // Allocate real and imaginary parts
        const real = new Float32Array(size);
        const imag = new Float32Array(size);
        real.set(input);

        // Bit-reversal permutation
        let j = 0;
        for (let i = 0; i < size - 1; i++) {
            if (i < j) {
                let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
                tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
            }
            let k = size >> 1;
            while (k <= j) { j -= k; k >>= 1; }
            j += k;
        }

        // FFT butterfly operations
        for (let len = 2; len <= size; len <<= 1) {
            const halfLen = len >> 1;
            const angleStep = -2 * Math.PI / len;
            const wR = Math.cos(angleStep);
            const wI = Math.sin(angleStep);

            for (let i = 0; i < size; i += len) {
                let curR = 1, curI = 0;
                for (let k = 0; k < halfLen; k++) {
                    const idx1 = i + k;
                    const idx2 = i + k + halfLen;
                    const tR = curR * real[idx2] - curI * imag[idx2];
                    const tI = curR * imag[idx2] + curI * real[idx2];
                    real[idx2] = real[idx1] - tR;
                    imag[idx2] = imag[idx1] - tI;
                    real[idx1] += tR;
                    imag[idx1] += tI;
                    const newCurR = curR * wR - curI * wI;
                    curI = curR * wI + curI * wR;
                    curR = newCurR;
                }
            }
        }

        // Compute magnitudes (only first half - positive frequencies)
        const magnitudes = new Float32Array(size / 2);
        for (let i = 0; i < size / 2; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        }
        return magnitudes;
    }

    /**
     * Compute spectral centroid from pre-computed magnitudes.
     */
    centroidFromMagnitudes(magnitudes, sampleRate, fftSize) {
        let weightedSum = 0;
        let totalMagnitude = 0;

        for (let i = 0; i < magnitudes.length; i++) {
            const freq = (i * sampleRate) / fftSize;
            weightedSum += freq * magnitudes[i];
            totalMagnitude += magnitudes[i];
        }

        return totalMagnitude > 0 ? weightedSum / totalMagnitude : 0;
    }

    /**
     * Estimate formant frequencies (F1, F2) from pre-computed magnitudes.
     */
    formantsFromMagnitudes(magnitudes, sampleRate, fftSize) {
        const freqRes = sampleRate / fftSize;

        // F1 range: 200-900 Hz
        const f1Start = Math.floor(200 / freqRes);
        const f1End = Math.min(Math.floor(900 / freqRes), magnitudes.length);

        // F2 range: 900-2500 Hz
        const f2Start = Math.floor(900 / freqRes);
        const f2End = Math.min(Math.floor(2500 / freqRes), magnitudes.length);

        let f1 = 0, f1Max = 0;
        for (let i = f1Start; i < f1End; i++) {
            if (magnitudes[i] > f1Max) {
                f1Max = magnitudes[i];
                f1 = i * freqRes;
            }
        }

        let f2 = 0, f2Max = 0;
        for (let i = f2Start; i < f2End; i++) {
            if (magnitudes[i] > f2Max) {
                f2Max = magnitudes[i];
                f2 = i * freqRes;
            }
        }

        return { f1, f2 };
    }

    /**
     * Classify a time window into a viseme based on audio features.
     */
    classifyViseme(energy, zcr, spectralCentroid, formants) {
        const { f1, f2 } = formants;

        // Silence detection
        if (energy < 0.01) {
            return 'viseme_sil';
        }

        // High ZCR + high frequency = fricatives (S, F, SH)
        if (zcr > 0.3 && spectralCentroid > 3000) {
            return 'viseme_SS'; // S, Z
        }

        if (zcr > 0.25 && spectralCentroid > 2000) {
            return 'viseme_FF'; // F, V
        }

        if (zcr > 0.2 && spectralCentroid > 2500) {
            return 'viseme_CH'; // Ch, Sh
        }

        // Low energy burst = plosives (P, B, T, D, K, G)
        if (energy < 0.05 && zcr > 0.15) {
            if (spectralCentroid < 1500) {
                return 'viseme_PP'; // P, B, M
            } else if (spectralCentroid < 2500) {
                return 'viseme_DD'; // T, D
            } else {
                return 'viseme_kk'; // K, G
            }
        }

        // Vowel detection based on formants
        if (energy > 0.03) {
            // A: F1 high (700-1000), F2 mid (1200-1800)
            if (f1 > 600 && f1 < 1000 && f2 > 1000 && f2 < 1800) {
                return 'viseme_aa';
            }

            // E: F1 mid (400-600), F2 high (1800-2500)
            if (f1 > 350 && f1 < 700 && f2 > 1700) {
                return 'viseme_E';
            }

            // I: F1 low (200-400), F2 high (2000-2800)
            if (f1 < 450 && f2 > 1900) {
                return 'viseme_I';
            }

            // O: F1 mid (400-700), F2 low (700-1200)
            if (f1 > 350 && f1 < 750 && f2 < 1300) {
                return 'viseme_O';
            }

            // U: F1 low (200-400), F2 low (600-1200)
            if (f1 < 450 && f2 < 1300) {
                return 'viseme_U';
            }

            // Nasal (N, M, NG)
            if (energy > 0.02 && energy < 0.08 && zcr < 0.1) {
                return 'viseme_nn';
            }

            // R-like
            if (f1 > 300 && f1 < 600 && f2 > 1000 && f2 < 1800 && zcr < 0.15) {
                return 'viseme_RR';
            }

            // Default vowel - open mouth
            return 'viseme_aa';
        }

        // TH-like
        if (zcr > 0.1 && energy < 0.05) {
            return 'viseme_TH';
        }

        return 'viseme_sil';
    }

    /**
     * Smooth phoneme sequence: merge short segments, ensure minimum duration.
     */
    smoothPhonemes(phonemes) {
        if (phonemes.length === 0) return phonemes;

        const minDuration = 0.04; // Minimum 40ms per phoneme
        const smoothed = [];

        for (const p of phonemes) {
            const duration = p.end - p.start;

            if (duration < minDuration && smoothed.length > 0) {
                // Merge with previous if too short
                smoothed[smoothed.length - 1].end = p.end;
            } else {
                smoothed.push({ ...p });
            }
        }

        return smoothed;
    }

    /**
     * Get the viseme at a specific time.
     */
    getVisemeAtTime(time) {
        for (const p of this.phonemes) {
            if (time >= p.start && time < p.end) {
                return p;
            }
        }
        return { viseme: 'viseme_sil', energy: 0 };
    }

    /**
     * Get the audio buffer for playback.
     */
    getAudioBuffer() {
        return this.audioBuffer;
    }

    getAudioContext() {
        return this.audioContext;
    }
}
