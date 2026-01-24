/**
 * Lip Sync engine: connects audio phonemes to blendshape animation.
 * Handles smooth interpolation between visemes and generates animation tracks.
 */
export class LipSync {
    constructor() {
        this.animationData = null;
        this.isPlaying = false;
        this.currentTime = 0;
        this.pausedAt = 0; // time position when paused
        this.audioSource = null;
        this.audioContext = null;
        this.audioBuffer = null;
        this._lastFrameTime = 0;
        this.mesh = null;
        this.morphTargetDictionary = null;
        this.onUpdate = null;
        this.animFrameId = null;

        // Interpolation settings
        this.transitionSpeed = 0.12; // seconds for transitions
        this.playbackSpeed = 1.0; // speed multiplier (0.5x, 1x, 2x)
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
                } else if (viseme === 'viseme_U') {
                    if (tracks['jawOpen']) tracks['jawOpen'][frame] += weight * 0.4;
                    if (tracks['mouthOpen']) tracks['mouthOpen'][frame] += weight * 0.3;
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
     * Get the phoneme active at a specific time using binary search.
     */
    getPhonemeAt(phonemes, time) {
        const idx = this.findPhonemeIndex(phonemes, time);
        if (idx >= 0 && idx < phonemes.length) {
            const p = phonemes[idx];
            if (time >= p.start && time < p.end) return p;
        }
        return { viseme: 'viseme_sil', start: time, end: time, energy: 0 };
    }

    /**
     * Binary search for the first phoneme whose end > time.
     */
    findPhonemeIndex(phonemes, time) {
        let lo = 0, hi = phonemes.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (phonemes[mid].end <= time) {
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }

    /**
     * Compute blend weights with coarticulation.
     * Adjacent phonemes influence each other: carry-over from previous,
     * anticipation of next. Produces more natural mouth movements than
     * simple crossfade.
     */
    computeBlendWeights(phonemes, time) {
        const weights = {};
        const transitionDuration = this.transitionSpeed;
        const coarticulationStrength = 0.2;

        // Binary search: find first phoneme that could be relevant
        let startIdx = this.findPhonemeIndex(phonemes, time - transitionDuration);
        if (startIdx > 0) startIdx--;

        let currentIdx = -1;

        for (let i = startIdx; i < phonemes.length; i++) {
            const p = phonemes[i];

            // Past the relevant window
            if (p.start > time + transitionDuration) break;
            if (time > p.end + transitionDuration) continue;

            let weight = 0;

            if (time >= p.start && time <= p.end) {
                currentIdx = i;
                const fadeInEnd = p.start + transitionDuration;
                const fadeOutStart = p.end - transitionDuration;

                if (time < fadeInEnd) {
                    weight = (time - p.start) / transitionDuration;
                } else if (time > fadeOutStart) {
                    weight = (p.end - time) / transitionDuration;
                } else {
                    weight = 1.0;
                }
            } else if (time < p.start) {
                weight = Math.max(0, 1 - (p.start - time) / transitionDuration) * 0.3;
            }

            weight *= Math.min(1, (p.energy || 0.5) * 10);
            weight = Math.min(1, Math.max(0, weight));

            if (weight > 0.01) {
                weights[p.viseme] = (weights[p.viseme] || 0) + weight;
            }
        }

        // Coarticulation: neighboring phonemes influence current shape
        if (currentIdx >= 0) {
            const current = phonemes[currentIdx];
            const dur = current.end - current.start;
            const relPos = dur > 0 ? (time - current.start) / dur : 0.5;

            // Carry-over from previous (strong at phoneme start, fades out)
            if (currentIdx > 0) {
                const prev = phonemes[currentIdx - 1];
                if (prev.viseme !== current.viseme && prev.viseme !== 'viseme_sil') {
                    const carry = (1 - relPos) * coarticulationStrength;
                    if (carry > 0.01) {
                        weights[prev.viseme] = (weights[prev.viseme] || 0) + carry;
                    }
                }
            }

            // Anticipation of next (grows towards phoneme end)
            if (currentIdx < phonemes.length - 1) {
                const next = phonemes[currentIdx + 1];
                if (next.viseme !== current.viseme && next.viseme !== 'viseme_sil') {
                    const antic = relPos * coarticulationStrength;
                    if (antic > 0.01) {
                        weights[next.viseme] = (weights[next.viseme] || 0) + antic;
                    }
                }
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
     * Supports resume from paused position.
     */
    play(mesh, audioBuffer, audioContext) {
        this.mesh = mesh;
        this.audioBuffer = audioBuffer;
        this.audioContext = audioContext;
        this.isPlaying = true;

        const resumeFrom = this.pausedAt;

        // Create and play audio from the resume position
        if (audioBuffer && audioContext) {
            this.audioSource = audioContext.createBufferSource();
            this.audioSource.buffer = audioBuffer;
            this.audioSource.playbackRate.value = this.playbackSpeed;
            this.audioSource.connect(audioContext.destination);
            this.audioSource.start(0, resumeFrom);

            this.audioSource.onended = () => {
                this.stop();
            };
        }

        this.currentTime = resumeFrom;
        this._lastFrameTime = performance.now();

        this.animate();
    }

    /**
     * Animation loop. Uses delta-time for correct playback speed support.
     */
    animate() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const delta = (now - this._lastFrameTime) / 1000;
        this._lastFrameTime = now;
        this.currentTime += delta * this.playbackSpeed;

        // Sync audio playback rate if speed changed
        if (this.audioSource && this.audioSource.playbackRate.value !== this.playbackSpeed) {
            this.audioSource.playbackRate.value = this.playbackSpeed;
        }

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
     * Uses linear interpolation between frames for smooth playback.
     */
    updateMorphTargets(time) {
        if (!this.mesh || !this.animationData) return;

        const { tracks, fps, totalFrames } = this.animationData;
        const exactFrame = time * fps;
        const frame0 = Math.min(Math.floor(exactFrame), totalFrames - 1);
        const frame1 = Math.min(frame0 + 1, totalFrames - 1);
        const t = exactFrame - frame0; // interpolation factor (0-1)

        const dictionary = (this.mesh.morphTargetDictionary || this.mesh.geometry.morphTargetDictionary);

        for (const [name, curve] of Object.entries(tracks)) {
            const idx = dictionary[name];
            if (idx !== undefined && this.mesh.morphTargetInfluences) {
                // Linear interpolation between adjacent frames
                const v0 = curve[frame0] || 0;
                const v1 = curve[frame1] || 0;
                this.mesh.morphTargetInfluences[idx] = v0 + (v1 - v0) * t;
            }
        }
    }

    /**
     * Pause the animation, saving position for resume.
     */
    pause() {
        this.isPlaying = false;
        this.pausedAt = this.currentTime; // save position for resume
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this.audioSource) {
            try { this.audioSource.stop(); } catch (e) {}
            this.audioSource = null;
        }
    }

    /**
     * Stop and reset the animation.
     */
    stop() {
        this.isPlaying = false;
        this.currentTime = 0;
        this.pausedAt = 0; // reset resume position

        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
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
     * If playing, restarts audio from the new position.
     */
    seek(time) {
        this.currentTime = time;
        this.pausedAt = time;

        if (this.isPlaying) {
            // Stop current audio source
            if (this.audioSource) {
                try { this.audioSource.stop(); } catch (e) {}
                this.audioSource = null;
            }

            // Restart audio from new position with current speed
            if (this.audioBuffer && this.audioContext) {
                this.audioSource = this.audioContext.createBufferSource();
                this.audioSource.buffer = this.audioBuffer;
                this.audioSource.playbackRate.value = this.playbackSpeed;
                this.audioSource.connect(this.audioContext.destination);
                this.audioSource.start(0, time);
                this.audioSource.onended = () => { this.stop(); };
            }

            // Reset frame timer for delta-based time tracking
            this._lastFrameTime = performance.now();
        } else {
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
