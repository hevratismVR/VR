import { ModelLoader } from './model-loader.js';
import { LandmarkDetector } from './landmark-detector.js';
import { BlendshapeGenerator } from './blendshape-generator.js';
import { AudioAnalyzer } from './audio-analyzer.js';
import { LipSync } from './lip-sync.js';
import { Exporter } from './exporter.js';
import { Viewer } from './viewer.js';

/**
 * Main application - AI Blendshapes Generator
 */
class App {
    constructor() {
        this.viewer = null;
        this.modelLoader = new ModelLoader();
        this.landmarkDetector = new LandmarkDetector();
        this.blendshapeGenerator = new BlendshapeGenerator();
        this.audioAnalyzer = new AudioAnalyzer();
        this.lipSync = new LipSync();
        this.exporter = new Exporter();

        // State
        this.modelData = null;
        this.faceMesh = null;
        this.landmarks = null;
        this.regions = null;
        this.blendshapesGenerated = false;
        this.animationData = null;
        this.audioBuffer = null;
        this.audioContext = null;

        this.init();
    }

    init() {
        // Initialize 3D viewer
        const canvas = document.getElementById('viewport');
        this.viewer = new Viewer(canvas);

        // Bind UI events
        this.bindEvents();

        this.setStatus('Ready - upload a 3D model to start');
    }

    bindEvents() {
        // Model upload
        const modelBtn = document.getElementById('model-upload-btn');
        const modelInput = document.getElementById('model-input');
        modelBtn.addEventListener('click', () => modelInput.click());
        modelInput.addEventListener('change', (e) => this.handleModelUpload(e));

        // Drag and drop for model
        const modelZone = document.getElementById('model-upload-zone');
        modelZone.addEventListener('dragover', (e) => { e.preventDefault(); modelZone.style.borderColor = '#e94560'; });
        modelZone.addEventListener('dragleave', () => { modelZone.style.borderColor = ''; });
        modelZone.addEventListener('drop', (e) => {
            e.preventDefault();
            modelZone.style.borderColor = '';
            if (e.dataTransfer.files.length > 0) {
                this.loadModel(e.dataTransfer.files[0]);
            }
        });

        // Character type and intensity
        document.getElementById('blend-intensity').addEventListener('input', (e) => {
            document.getElementById('blend-intensity-val').textContent = e.target.value;
        });

        // Face detection
        document.getElementById('detect-face-btn').addEventListener('click', () => this.detectFace());

        // Blendshape generation
        document.getElementById('generate-blendshapes-btn').addEventListener('click', () => this.generateBlendshapes());

        // Audio upload
        const audioBtn = document.getElementById('audio-upload-btn');
        const audioInput = document.getElementById('audio-input');
        audioBtn.addEventListener('click', () => audioInput.click());
        audioInput.addEventListener('change', (e) => this.handleAudioUpload(e));

        // Audio drag and drop
        const audioZone = document.getElementById('audio-upload-zone');
        audioZone.addEventListener('dragover', (e) => { e.preventDefault(); audioZone.style.borderColor = '#e94560'; });
        audioZone.addEventListener('dragleave', () => { audioZone.style.borderColor = ''; });
        audioZone.addEventListener('drop', (e) => {
            e.preventDefault();
            audioZone.style.borderColor = '';
            if (e.dataTransfer.files.length > 0) {
                this.loadAudio(e.dataTransfer.files[0]);
            }
        });

        // Lip sync generation
        document.getElementById('generate-lipsync-btn').addEventListener('click', () => this.generateLipSync());

        // Playback controls
        document.getElementById('play-btn').addEventListener('click', () => this.play());
        document.getElementById('pause-btn').addEventListener('click', () => this.pause());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());

        // Timeline scrub
        document.getElementById('timeline').addEventListener('input', (e) => {
            if (this.animationData) {
                const time = (e.target.value / 100) * this.animationData.duration;
                this.lipSync.seek(time);
            }
        });

        // Export
        document.getElementById('export-glb-btn').addEventListener('click', () => this.exportGLB());
        document.getElementById('export-animation-btn').addEventListener('click', () => this.exportAnimation());
    }

    /**
     * Handle model file input change.
     */
    handleModelUpload(event) {
        const file = event.target.files[0];
        if (file) this.loadModel(file);
    }

    /**
     * Load a 3D model file.
     */
    async loadModel(file) {
        this.setStatus('Loading model...');
        this.showProgress(true);

        try {
            this.modelData = await this.modelLoader.load(file);

            // Display in viewer
            this.viewer.setModel(this.modelData);

            // Hide overlay
            document.getElementById('viewport-overlay').classList.add('hidden');

            // Show model info
            const info = this.modelData.info;
            const infoBox = document.getElementById('model-info');
            infoBox.innerHTML = `
                <strong>${file.name}</strong><br>
                Vertices: ${info.vertices.toLocaleString()}<br>
                Faces: ${info.faces.toLocaleString()}<br>
                Meshes: ${info.meshCount}<br>
                Skinned: ${info.hasSkinnedMesh ? 'Yes' : 'No'}
            `;
            infoBox.classList.remove('hidden');

            // Enable next steps
            document.getElementById('detect-face-btn').disabled = false;

            this.setStatus(`Model loaded: ${info.vertices.toLocaleString()} vertices`);
        } catch (error) {
            this.setStatus(`Error: ${error.message}`);
            console.error('Model load error:', error);
        }

        this.showProgress(false);
    }

    /**
     * Detect facial landmarks on the loaded model.
     */
    detectFace() {
        if (!this.modelData) return;

        this.setStatus('Detecting facial landmarks...');
        this.showProgress(true);

        try {
            const characterType = document.getElementById('character-type').value;

            const result = this.landmarkDetector.detect(
                this.modelData.meshes,
                characterType
            );

            this.faceMesh = result.mesh;
            this.landmarks = result.landmarks;
            this.regions = result.regions;

            // Show landmarks in viewer
            this.viewer.showLandmarks(this.landmarks, this.faceMesh);

            // Show detection info
            const regionCounts = {};
            for (const [name, indices] of Object.entries(this.regions)) {
                if (indices.length > 0) {
                    regionCounts[name] = indices.length;
                }
            }

            const infoBox = document.getElementById('blendshapes-info');
            infoBox.innerHTML = `
                <strong>Face detected!</strong><br>
                Regions found: ${Object.keys(regionCounts).length}<br>
                ${Object.entries(regionCounts).map(([k, v]) =>
                    `${k}: ${v} vertices`
                ).join('<br>')}
            `;
            infoBox.classList.remove('hidden');
            infoBox.classList.add('success');

            // Enable blendshape generation
            document.getElementById('generate-blendshapes-btn').disabled = false;

            this.setStatus('Face detected - ready to generate blendshapes');
        } catch (error) {
            this.setStatus(`Detection error: ${error.message}`);
            console.error('Face detection error:', error);
        }

        this.showProgress(false);
    }

    /**
     * Generate blendshapes for the detected face.
     */
    generateBlendshapes() {
        if (!this.faceMesh || !this.regions) return;

        this.setStatus('Generating blendshapes...');
        this.showProgress(true);

        try {
            const intensity = parseFloat(document.getElementById('blend-intensity').value);

            const result = this.blendshapeGenerator.generate(
                this.faceMesh,
                this.landmarks,
                this.regions,
                intensity
            );

            this.blendshapesGenerated = true;

            // Update blendshapes UI list
            this.updateBlendshapesList(result);

            // Enable audio upload
            document.getElementById('audio-upload-btn').disabled = false;
            document.getElementById('export-glb-btn').disabled = false;

            // Clear landmarks visualization
            this.viewer.clearHelpers();

            const shapeCount = Object.keys(result.blendshapes).length;
            const visemeCount = Object.keys(result.visemes).length;
            this.setStatus(`Generated ${shapeCount} blendshapes + ${visemeCount} visemes`);
        } catch (error) {
            this.setStatus(`Generation error: ${error.message}`);
            console.error('Blendshape generation error:', error);
        }

        this.showProgress(false);
    }

    /**
     * Update the UI blendshapes list with sliders.
     */
    updateBlendshapesList(result) {
        const listEl = document.getElementById('blendshapes-list');
        const visemeListEl = document.getElementById('visemes-list');

        // Blendshapes
        listEl.innerHTML = '';
        for (const name of Object.keys(result.blendshapes)) {
            listEl.appendChild(this.createBlendshapeSlider(name));
        }

        // Visemes
        visemeListEl.innerHTML = '';
        for (const name of Object.keys(result.visemes)) {
            visemeListEl.appendChild(this.createBlendshapeSlider(name));
        }
    }

    /**
     * Create a slider control for a blendshape.
     */
    createBlendshapeSlider(name) {
        const item = document.createElement('div');
        item.className = 'blendshape-item';

        const label = document.createElement('label');
        label.textContent = name.replace('viseme_', '').replace(/([A-Z])/g, ' $1').trim();

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.value = '0';

        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = '0';

        slider.addEventListener('input', () => {
            const weight = parseFloat(slider.value);
            value.textContent = weight.toFixed(2);
            this.lipSync.setBlendshapeWeight(this.faceMesh, name, weight);
        });

        item.appendChild(label);
        item.appendChild(slider);
        item.appendChild(value);

        return item;
    }

    /**
     * Handle audio file upload.
     */
    handleAudioUpload(event) {
        const file = event.target.files[0];
        if (file) this.loadAudio(file);
    }

    /**
     * Load and analyze audio file.
     */
    async loadAudio(file) {
        if (!this.blendshapesGenerated) {
            this.setStatus('Generate blendshapes first!');
            return;
        }

        this.setStatus('Analyzing audio...');
        this.showProgress(true);

        try {
            const result = await this.audioAnalyzer.analyze(file);

            this.audioBuffer = this.audioAnalyzer.getAudioBuffer();
            this.audioContext = this.audioAnalyzer.getAudioContext();

            // Show audio info
            const infoBox = document.getElementById('audio-info');
            infoBox.innerHTML = `
                <strong>${file.name}</strong><br>
                Duration: ${result.duration.toFixed(2)}s<br>
                Sample rate: ${result.sampleRate}Hz<br>
                Phonemes detected: ${result.phonemeCount}
            `;
            infoBox.classList.remove('hidden');

            // Enable lip sync generation
            document.getElementById('generate-lipsync-btn').disabled = false;

            this.setStatus(`Audio analyzed: ${result.phonemeCount} phonemes in ${result.duration.toFixed(1)}s`);
        } catch (error) {
            this.setStatus(`Audio error: ${error.message}`);
            console.error('Audio analysis error:', error);
        }

        this.showProgress(false);
    }

    /**
     * Generate lip sync animation.
     */
    generateLipSync() {
        if (!this.audioAnalyzer.phonemes.length || !this.faceMesh) return;

        this.setStatus('Generating lip sync animation...');
        this.showProgress(true);

        try {
            const morphDict = this.faceMesh.geometry.morphTargetDictionary;

            this.animationData = this.lipSync.generateAnimation(
                this.audioAnalyzer.phonemes,
                morphDict,
                this.audioAnalyzer.duration
            );

            // Setup playback update callback
            this.lipSync.onUpdate = (currentTime, duration) => {
                this.updatePlaybackUI(currentTime, duration);
            };

            // Enable playback controls
            document.getElementById('play-btn').disabled = false;
            document.getElementById('reset-btn').disabled = false;
            document.getElementById('timeline').disabled = false;
            document.getElementById('export-animation-btn').disabled = false;

            const trackCount = Object.keys(this.animationData.tracks).length;
            this.setStatus(`Lip sync ready: ${trackCount} tracks, ${this.animationData.duration.toFixed(1)}s`);
        } catch (error) {
            this.setStatus(`Lip sync error: ${error.message}`);
            console.error('Lip sync error:', error);
        }

        this.showProgress(false);
    }

    /**
     * Play the lip sync animation with audio.
     */
    play() {
        if (!this.animationData || !this.faceMesh) return;

        // Need a fresh audio context if previous was closed
        if (this.audioContext && this.audioContext.state === 'closed') {
            this.audioContext = new AudioContext();
        }

        this.lipSync.play(this.faceMesh, this.audioBuffer, this.audioContext);

        document.getElementById('play-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;

        this.setStatus('Playing...');
    }

    /**
     * Pause playback.
     */
    pause() {
        this.lipSync.pause();
        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;
        this.setStatus('Paused');
    }

    /**
     * Reset playback to beginning.
     */
    reset() {
        this.lipSync.stop();
        document.getElementById('play-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;
        document.getElementById('timeline').value = 0;
        document.getElementById('time-display').textContent = '0:00 / 0:00';
        this.setStatus('Reset');
    }

    /**
     * Update playback UI (timeline, time display).
     */
    updatePlaybackUI(currentTime, duration) {
        const progress = (currentTime / duration) * 100;
        document.getElementById('timeline').value = progress;

        const formatTime = (t) => {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        document.getElementById('time-display').textContent =
            `${formatTime(currentTime)} / ${formatTime(duration)}`;

        // If animation ended
        if (currentTime >= duration) {
            document.getElementById('play-btn').disabled = false;
            document.getElementById('pause-btn').disabled = true;
            this.setStatus('Playback complete');
        }
    }

    /**
     * Export model with blendshapes as GLB.
     */
    async exportGLB() {
        this.setStatus('Exporting GLB...');
        this.showProgress(true);

        try {
            const blob = await this.exporter.exportGLB(
                this.modelData.scene,
                this.faceMesh,
                this.animationData
            );

            this.exporter.downloadBlob(blob, 'model-with-blendshapes.glb');
            this.setStatus('GLB exported successfully!');
        } catch (error) {
            this.setStatus(`Export error: ${error.message}`);
            console.error('Export error:', error);
        }

        this.showProgress(false);
    }

    /**
     * Export only the animation.
     */
    async exportAnimation() {
        if (!this.animationData) return;

        this.setStatus('Exporting animation...');
        this.showProgress(true);

        try {
            const blob = await this.exporter.exportAnimation(
                this.faceMesh,
                this.animationData
            );

            this.exporter.downloadBlob(blob, 'lipsync-animation.glb');
            this.setStatus('Animation exported successfully!');
        } catch (error) {
            this.setStatus(`Export error: ${error.message}`);
            console.error('Export error:', error);
        }

        this.showProgress(false);
    }

    /**
     * Set status bar text.
     */
    setStatus(text) {
        document.getElementById('status-text').textContent = text;
    }

    /**
     * Show/hide progress bar.
     */
    showProgress(show) {
        const bar = document.getElementById('progress-bar');
        if (show) {
            bar.classList.remove('hidden');
            document.getElementById('progress-fill').style.width = '100%';
        } else {
            bar.classList.add('hidden');
        }
    }
}

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
    new App();
});
