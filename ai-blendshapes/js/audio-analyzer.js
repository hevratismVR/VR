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
        // Close previous context to avoid browser resource exhaustion
        // (browsers limit active AudioContexts to ~6-8)
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try { await this.audioContext.close(); } catch (e) {}
        }

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
     * Uses formant distances with confidence scoring for better vowel discrimination.
     */
    classifyViseme(energy, zcr, spectralCentroid, formants) {
        const { f1, f2 } = formants;

        // Silence detection
        if (energy < 0.01) {
            return 'viseme_sil';
        }

        // Very low energy = near-silence or unvoiced transition
        if (energy < 0.025) {
            if (zcr > 0.2) {
                return 'viseme_TH'; // weak fricative/breath
            }
            return 'viseme_sil';
        }

        // High ZCR + high frequency = unvoiced fricatives
        if (zcr > 0.3 && spectralCentroid > 3000) {
            return 'viseme_SS'; // S, Z
        }
        if (zcr > 0.25 && spectralCentroid > 2500) {
            return 'viseme_CH'; // Ch, Sh
        }
        if (zcr > 0.25 && spectralCentroid > 1800) {
            return 'viseme_FF'; // F, V
        }

        // Low energy burst = plosives (P, B, T, D, K, G)
        if (energy < 0.06 && zcr > 0.15) {
            if (spectralCentroid < 1500) {
                return 'viseme_PP'; // P, B, M
            } else if (spectralCentroid < 2500) {
                return 'viseme_DD'; // T, D
            } else {
                return 'viseme_kk'; // K, G
            }
        }

        // Nasal detection: low ZCR, moderate energy, low spectral centroid
        if (zcr < 0.1 && energy < 0.1 && spectralCentroid < 1500) {
            return 'viseme_nn';
        }

        // Vowel detection using formant distance scoring
        // Each vowel has a target (F1, F2) and we pick the closest match
        const vowelTargets = [
            { viseme: 'viseme_aa', f1: 800, f2: 1400 },   // A: open
            { viseme: 'viseme_E',  f1: 500, f2: 2000 },   // E: mid-open spread
            { viseme: 'viseme_I',  f1: 300, f2: 2300 },   // I: close spread
            { viseme: 'viseme_O',  f1: 550, f2: 900 },    // O: mid-open rounded
            { viseme: 'viseme_U',  f1: 350, f2: 800 },    // U: close rounded
        ];

        let bestViseme = 'viseme_aa';
        let bestDist = Infinity;

        for (const target of vowelTargets) {
            // Normalized distance (F1 range ~200-900, F2 range ~600-2800)
            const d1 = (f1 - target.f1) / 400;
            const d2 = (f2 - target.f2) / 800;
            const dist = d1 * d1 + d2 * d2;

            if (dist < bestDist) {
                bestDist = dist;
                bestViseme = target.viseme;
            }
        }

        // R-like: moderate formants with low ZCR
        if (zcr < 0.12 && f1 > 300 && f1 < 600 && f2 > 900 && f2 < 1700) {
            // Only classify as RR if it's significantly closer than any vowel
            const rrDist = Math.abs(f1 - 450) / 400 + Math.abs(f2 - 1300) / 800;
            if (rrDist < 0.5) {
                return 'viseme_RR';
            }
        }

        return bestViseme;
    }

    /**
     * Smooth phoneme sequence: merge short segments intelligently.
     * - Silence segments shorter than 30ms are absorbed by neighbors
     * - Consonants shorter than 30ms are kept (they're naturally short)
     * - Identical adjacent visemes are always merged
     */
    smoothPhonemes(phonemes) {
        if (phonemes.length === 0) return phonemes;

        const minSilenceDuration = 0.03;
        const minVowelDuration = 0.05;
        const smoothed = [];

        // First pass: merge identical adjacent visemes
        for (const p of phonemes) {
            if (smoothed.length > 0 && smoothed[smoothed.length - 1].viseme === p.viseme) {
                smoothed[smoothed.length - 1].end = p.end;
                // Update energy to max of merged segments
                smoothed[smoothed.length - 1].energy = Math.max(
                    smoothed[smoothed.length - 1].energy, p.energy
                );
            } else {
                smoothed.push({ ...p });
            }
        }

        // Second pass: remove very short silence gaps between speech
        const result = [];
        for (let i = 0; i < smoothed.length; i++) {
            const p = smoothed[i];
            const duration = p.end - p.start;

            if (p.viseme === 'viseme_sil' && duration < minSilenceDuration) {
                // Absorb short silence into the previous segment
                if (result.length > 0) {
                    result[result.length - 1].end = p.end;
                }
                continue;
            }

            // Very short vowels: extend to minimum duration if possible
            if (duration < minVowelDuration && p.viseme.startsWith('viseme_')
                && !['viseme_sil', 'viseme_PP', 'viseme_DD', 'viseme_kk'].includes(p.viseme)) {
                p.end = Math.min(p.start + minVowelDuration,
                    i < smoothed.length - 1 ? smoothed[i + 1].start : p.end);
            }

            result.push(p);
        }

        return result;
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
