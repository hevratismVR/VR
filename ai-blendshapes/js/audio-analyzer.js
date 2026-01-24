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
     * Groups audio into time windows and classifies each by frequency content.
     */
    extractPhonemes() {
        const channelData = this.audioBuffer.getChannelData(0);
        const sampleRate = this.audioBuffer.sampleRate;

        // Analysis parameters
        const windowSize = Math.floor(sampleRate * 0.03); // 30ms windows
        const hopSize = Math.floor(windowSize / 2); // 50% overlap
        const totalWindows = Math.floor((channelData.length - windowSize) / hopSize);

        const phonemes = [];
        let currentPhoneme = null;

        for (let w = 0; w < totalWindows; w++) {
            const startSample = w * hopSize;
            const endSample = startSample + windowSize;
            const timeStart = startSample / sampleRate;

            // Extract window
            const window = channelData.slice(startSample, endSample);

            // Compute features
            const energy = this.computeEnergy(window);
            const zcr = this.computeZeroCrossingRate(window);
            const spectralCentroid = this.computeSpectralCentroid(window, sampleRate);
            const formants = this.estimateFormants(window, sampleRate);

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
     * Compute RMS energy of a window.
     */
    computeEnergy(window) {
        let sum = 0;
        for (let i = 0; i < window.length; i++) {
            sum += window[i] * window[i];
        }
        return Math.sqrt(sum / window.length);
    }

    /**
     * Compute zero-crossing rate (indicates noise/fricative content).
     */
    computeZeroCrossingRate(window) {
        let crossings = 0;
        for (let i = 1; i < window.length; i++) {
            if ((window[i] >= 0 && window[i - 1] < 0) ||
                (window[i] < 0 && window[i - 1] >= 0)) {
                crossings++;
            }
        }
        return crossings / window.length;
    }

    /**
     * Compute spectral centroid (brightness of sound).
     */
    computeSpectralCentroid(window, sampleRate) {
        // Simple DFT for frequency analysis
        const n = window.length;
        const fftSize = Math.pow(2, Math.ceil(Math.log2(n)));
        const real = new Float32Array(fftSize);
        const imag = new Float32Array(fftSize);

        // Apply Hanning window and copy
        for (let i = 0; i < n; i++) {
            const hanningValue = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
            real[i] = window[i] * hanningValue;
        }

        // Compute FFT magnitudes (simplified)
        const magnitudes = this.computeFFTMagnitudes(real, fftSize);

        // Compute centroid
        let weightedSum = 0;
        let totalMagnitude = 0;

        for (let i = 0; i < fftSize / 2; i++) {
            const frequency = (i * sampleRate) / fftSize;
            weightedSum += frequency * magnitudes[i];
            totalMagnitude += magnitudes[i];
        }

        return totalMagnitude > 0 ? weightedSum / totalMagnitude : 0;
    }

    /**
     * Simple FFT magnitude computation.
     */
    computeFFTMagnitudes(real, size) {
        const magnitudes = new Float32Array(size / 2);

        for (let k = 0; k < size / 2; k++) {
            let realPart = 0;
            let imagPart = 0;

            // For performance, only compute a subset of frequencies
            const step = Math.max(1, Math.floor(size / 128));
            for (let n = 0; n < size; n += step) {
                const angle = -2 * Math.PI * k * n / size;
                realPart += real[n] * Math.cos(angle);
                imagPart += real[n] * Math.sin(angle);
            }

            magnitudes[k] = Math.sqrt(realPart * realPart + imagPart * imagPart);
        }

        return magnitudes;
    }

    /**
     * Estimate formant frequencies (F1, F2) for vowel detection.
     * Uses peak detection in the spectrum.
     */
    estimateFormants(window, sampleRate) {
        const n = window.length;
        const fftSize = 256;
        const real = new Float32Array(fftSize);

        for (let i = 0; i < Math.min(n, fftSize); i++) {
            const hanningValue = 0.5 * (1 - Math.cos(2 * Math.PI * i / (Math.min(n, fftSize) - 1)));
            real[i] = window[i] * hanningValue;
        }

        const magnitudes = this.computeFFTMagnitudes(real, fftSize);

        // Find peaks in formant regions
        const freqResolution = sampleRate / fftSize;

        // F1 range: 200-900 Hz
        const f1Start = Math.floor(200 / freqResolution);
        const f1End = Math.floor(900 / freqResolution);

        // F2 range: 900-2500 Hz
        const f2Start = Math.floor(900 / freqResolution);
        const f2End = Math.min(Math.floor(2500 / freqResolution), fftSize / 2);

        let f1 = 0, f1Max = 0;
        for (let i = f1Start; i < f1End && i < magnitudes.length; i++) {
            if (magnitudes[i] > f1Max) {
                f1Max = magnitudes[i];
                f1 = i * freqResolution;
            }
        }

        let f2 = 0, f2Max = 0;
        for (let i = f2Start; i < f2End && i < magnitudes.length; i++) {
            if (magnitudes[i] > f2Max) {
                f2Max = magnitudes[i];
                f2 = i * freqResolution;
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
