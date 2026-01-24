/**
 * Lip Sync engine: connects audio phonemes to blendshape animation.
 * Handles smooth interpolation between visemes and generates animation tracks.
 */
export class LipSync {
    constructor() {
        this.animationData = null;
        this.isPlaying = false;
        this.currentTime = 0;
        this.audioSource = null;
        this.startTimestamp = 0;
        this.mesh = null;
        this.morphTargetDictionary = null;
        this.onUpdate = null;
        this.animFrameId = null;

        // Interpolation settings
        this.transitionSpeed = 0.12; // seconds for transitions
        this.currentWeights = {};
    }

    /**
     * Generate lip sync animation data from phonemes.
     */
    generateAnimation(phonemes, morphTargetDictionary, duration) {
        this.morphTargetDictionary = morphTargetDictionary;

        // Create keyframe tracks for each viseme
        const tracks = {};
        const fps = 30;
        const totalFrames = Math.ceil(duration * fps);

        // Initialize tracks for all visemes
        const visemeNames = Object.keys(morphTargetDictionary).filter(k => k.startsWith('viseme_'));
        for (const name of visemeNames) {
            tracks[name] = new Float32Array(totalFrames);
        }

        // Also animate jaw and mouth shapes for more natural look
        const extraShapes = ['jawOpen', 'mouthOpen'];
        for (const name of extraShapes) {
            if (morphTargetDictionary[name] !== undefined) {
                tracks[name] = new Float32Array(totalFrames);
            }
        }

        // Fill keyframes based on phonemes
        for (let frame = 0; frame < totalFrames; frame++) {
            const time = frame / fps;

            // Find current and neighboring phonemes for interpolation
            const current = this.getPhonemeAt(phonemes, time);
            const blendWeights = this.computeBlendWeights(phonemes, time);

            for (const [viseme, weight] of Object.entries(blendWeights)) {
                if (tracks[viseme]) {
                    tracks[viseme][frame] = weight;
                }

                // Drive jaw/mouth based on viseme energy
                if (viseme === 'viseme_aa' || viseme === 'viseme_O') {
                    if (tracks['jawOpen']) tracks['jawOpen'][frame] += weight * 0.7;
                    if (tracks['mouthOpen']) tracks['mouthOpen'][frame] += weight * 0.8;
                } else if (viseme === 'viseme_E' || viseme === 'viseme_I') {
                    if (tracks['jawOpen']) tracks['jawOpen'][frame] += weight * 0.3;
                    if (tracks['mouthOpen']) tracks['mouthOpen'][frame] += weight * 0.4;
                } else if (viseme === 'viseme_U' || viseme === 'viseme_O') {
                    if (tracks['jawOpen']) tracks['jawOpen'][frame] += weight * 0.4;
                }
            }

            // Clamp all values
            for (const name in tracks) {
                tracks[name][frame] = Math.min(1, Math.max(0, tracks[name][frame]));
            }
        }

        // Smooth the animation curves
        for (const name in tracks) {
            tracks[name] = this.smoothCurve(tracks[name], 3);
        }

        this.animationData = {
            tracks,
            duration,
            fps,
            totalFrames
        };

        return this.animationData;
    }

    /**
     * Get the phoneme active at a specific time.
     */
    getPhonemeAt(phonemes, time) {
        for (const p of phonemes) {
            if (time >= p.start && time < p.end) return p;
        }
        return { viseme: 'viseme_sil', start: time, end: time, energy: 0 };
    }

    /**
     * Compute blend weights with smooth transitions between phonemes.
     */
    computeBlendWeights(phonemes, time) {
        const weights = {};
        const transitionDuration = this.transitionSpeed;

        for (let i = 0; i < phonemes.length; i++) {
            const p = phonemes[i];
            if (time < p.start - transitionDuration || time > p.end + transitionDuration) continue;

            let weight = 0;

            if (time >= p.start && time <= p.end) {
                // Inside the phoneme
                const fadeInEnd = p.start + transitionDuration;
                const fadeOutStart = p.end - transitionDuration;

                if (time < fadeInEnd) {
                    // Fade in
                    weight = (time - p.start) / transitionDuration;
                } else if (time > fadeOutStart) {
                    // Fade out
                    weight = (p.end - time) / transitionDuration;
                } else {
                    // Full weight
                    weight = 1.0;
                }
            } else if (time < p.start) {
                // Pre-transition (anticipation)
                weight = Math.max(0, 1 - (p.start - time) / transitionDuration) * 0.3;
            }

            // Scale by energy for more natural animation
            weight *= Math.min(1, (p.energy || 0.5) * 10);
            weight = Math.min(1, Math.max(0, weight));

            if (weight > 0.01) {
                weights[p.viseme] = (weights[p.viseme] || 0) + weight;
            }
        }

        // Normalize if total > 1
        const total = Object.values(weights).reduce((a, b) => a + b, 0);
        if (total > 1) {
            for (const key in weights) {
                weights[key] /= total;
            }
        }

        return weights;
    }

    /**
     * Smooth a curve using moving average.
     */
    smoothCurve(data, windowSize) {
        const result = new Float32Array(data.length);
        const halfWindow = Math.floor(windowSize / 2);

        for (let i = 0; i < data.length; i++) {
            let sum = 0;
            let count = 0;

            for (let j = -halfWindow; j <= halfWindow; j++) {
                const idx = i + j;
                if (idx >= 0 && idx < data.length) {
                    sum += data[idx];
                    count++;
                }
            }

            result[i] = sum / count;
        }

        return result;
    }

    /**
     * Start playing the lip sync animation with audio.
     */
    play(mesh, audioBuffer, audioContext) {
        this.mesh = mesh;
        this.isPlaying = true;

        // Create and play audio
        if (audioBuffer && audioContext) {
            this.audioSource = audioContext.createBufferSource();
            this.audioSource.buffer = audioBuffer;
            this.audioSource.connect(audioContext.destination);
            this.audioSource.start(0);

            this.audioSource.onended = () => {
                this.stop();
            };
        }

        this.startTimestamp = performance.now();
        this.currentTime = 0;

        this.animate();
    }

    /**
     * Animation loop.
     */
    animate() {
        if (!this.isPlaying) return;

        const now = performance.now();
        this.currentTime = (now - this.startTimestamp) / 1000;

        if (this.currentTime >= this.animationData.duration) {
            this.stop();
            return;
        }

        // Update morph targets based on current time
        this.updateMorphTargets(this.currentTime);

        // Notify listener
        if (this.onUpdate) {
            this.onUpdate(this.currentTime, this.animationData.duration);
        }

        this.animFrameId = requestAnimationFrame(() => this.animate());
    }

    /**
     * Update mesh morph targets at the given time.
     */
    updateMorphTargets(time) {
        if (!this.mesh || !this.animationData) return;

        const { tracks, fps } = this.animationData;
        const frame = Math.min(
            Math.floor(time * fps),
            this.animationData.totalFrames - 1
        );

        const dictionary = this.(mesh.morphTargetDictionary || mesh.geometry.morphTargetDictionary);

        for (const [name, curve] of Object.entries(tracks)) {
            const idx = dictionary[name];
            if (idx !== undefined && this.mesh.morphTargetInfluences) {
                this.mesh.morphTargetInfluences[idx] = curve[frame] || 0;
            }
        }
    }

    /**
     * Pause the animation.
     */
    pause() {
        this.isPlaying = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
        }
        if (this.audioSource) {
            try { this.audioSource.stop(); } catch (e) {}
        }
    }

    /**
     * Stop and reset the animation.
     */
    stop() {
        this.isPlaying = false;
        this.currentTime = 0;

        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
        }

        if (this.audioSource) {
            try { this.audioSource.stop(); } catch (e) {}
            this.audioSource = null;
        }

        // Reset all morph targets
        if (this.mesh && this.mesh.morphTargetInfluences) {
            for (let i = 0; i < this.mesh.morphTargetInfluences.length; i++) {
                this.mesh.morphTargetInfluences[i] = 0;
            }
        }

        if (this.onUpdate) {
            this.onUpdate(0, this.animationData?.duration || 0);
        }
    }

    /**
     * Seek to a specific time.
     */
    seek(time) {
        this.currentTime = time;
        if (!this.isPlaying) {
            this.updateMorphTargets(time);
        }
    }

    /**
     * Set a specific blendshape weight (for manual control).
     */
    setBlendshapeWeight(mesh, name, weight) {
        const dictionary = (mesh.morphTargetDictionary || mesh.geometry.morphTargetDictionary);
        if (!dictionary || dictionary[name] === undefined) return;

        const idx = dictionary[name];
        if (mesh.morphTargetInfluences) {
            mesh.morphTargetInfluences[idx] = weight;
        }
    }

    /**
     * Get current animation progress (0-1).
     */
    getProgress() {
        if (!this.animationData) return 0;
        return this.currentTime / this.animationData.duration;
    }
}
