import { ModelLoader } from './model-loader.js';
import { LandmarkDetector } from './landmark-detector.js';
import { BlendshapeGenerator } from './blendshape-generator.js';
import { AccessoriesManager } from './accessories-manager.js';
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
        this.accessoriesManager = new AccessoriesManager();
        this.audioAnalyzer = new AudioAnalyzer();
        this.lipSync = new LipSync();
        this.exporter = new Exporter();

        // State
        this.selectedAccessory = null;
        this.landmarkOffsets = {}; // manual adjustments to landmark positions
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

        // Set landmark drag callback
        this.viewer.onLandmarkMoved = (name, newPos) => {
            this.handleLandmarkMoved(name, newPos);
        };

        // Set accessory drag callback
        this.viewer.onAccessoryMoved = (type, newPos) => {
            this.handleAccessoryDragged(type, newPos);
        };

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

        // Accessories
        this.bindAccessoryButton('upper-teeth', 'upperTeeth');
        this.bindAccessoryButton('lower-teeth', 'lowerTeeth');
        this.bindAccessoryButton('tongue', 'tongue');
        this.bindAccessoryButton('eye-left', 'eyeLeft');
        this.bindAccessoryButton('eye-right', 'eyeRight');

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

        // Transform controls for accessories and manual adjustments
        this.bindTransformControls();

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

            // Populate mesh selection dropdown
            if (this.modelData.meshes.length > 1) {
                const meshSelect = document.getElementById('mesh-select');
                meshSelect.innerHTML = '<option value="auto">אוטומטי (זיהוי AI)</option>';
                this.modelData.meshes.forEach((mesh, idx) => {
                    const name = mesh.name || `Mesh ${idx}`;
                    const verts = mesh.geometry.attributes.position.count;
                    meshSelect.innerHTML += `<option value="${idx}">${name} (${verts.toLocaleString()} v)</option>`;
                });
                document.getElementById('mesh-select-label').classList.remove('hidden');
            }

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
            const meshSelectValue = document.getElementById('mesh-select').value;

            let meshesToDetect = this.modelData.meshes;

            // If user manually selected a mesh, use only that one
            if (meshSelectValue !== 'auto') {
                const idx = parseInt(meshSelectValue);
                meshesToDetect = [this.modelData.meshes[idx]];
            }

            const result = this.landmarkDetector.detect(
                meshesToDetect,
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

            this.setStatus('Face detected - drag landmarks to adjust, then generate blendshapes');
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

            // Pass any manually adjusted landmark positions
            this.blendshapeGenerator.manualLandmarks = { ...this.landmarkOffsets };

            const result = this.blendshapeGenerator.generate(
                this.faceMesh,
                this.landmarks,
                this.regions,
                intensity
            );

            this.blendshapesGenerated = true;

            // Set up accessories manager
            this.accessoriesManager.setFace(this.faceMesh, this.regions, this.blendshapeGenerator);

            // Enable accessory buttons
            document.getElementById('upper-teeth-btn').disabled = false;
            document.getElementById('lower-teeth-btn').disabled = false;
            document.getElementById('tongue-btn').disabled = false;
            document.getElementById('eye-left-btn').disabled = false;
            document.getElementById('eye-right-btn').disabled = false;

            // Show manual adjustment panel
            document.getElementById('manual-adjust').classList.remove('hidden');

            // Start accessory update loop
            this.startAccessoryUpdateLoop();

            // Update blendshapes UI list
            this.updateBlendshapesList(result);

            // Enable audio upload
            document.getElementById('audio-upload-btn').disabled = false;
            document.getElementById('export-glb-btn').disabled = false;

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
     * Bind an accessory upload button.
     * First click opens file dialog. After loaded, clicking selects it for transform.
     */
    bindAccessoryButton(htmlId, type) {
        const btn = document.getElementById(`${htmlId}-btn`);
        const input = document.getElementById(`${htmlId}-input`);

        btn.addEventListener('click', () => {
            if (this.accessoriesManager.accessories[type]) {
                // Already loaded - select for transform editing
                this.selectAccessory(type, htmlId);
            } else {
                input.click();
            }
        });

        input.addEventListener('change', (e) => {
            if (e.target.files[0]) this.loadAccessory(type, e.target.files[0], htmlId);
        });
    }

    /**
     * Load an accessory model and attach it to the face.
     */
    async loadAccessory(type, file, htmlId) {
        this.setStatus(`Loading ${type}...`);

        try {
            const modelData = await this.modelLoader.load(file);
            const accMesh = this.accessoriesManager.addAccessory(type, modelData.scene);

            // Register as draggable in the 3D viewport
            if (accMesh) {
                this.viewer.addAccessoryHandle(type, accMesh);
            }

            // Update UI
            const btn = document.getElementById(`${htmlId}-btn`);
            btn.classList.add('loaded');
            const status = document.getElementById(`${htmlId}-status`);
            status.textContent = 'V';

            // Auto-select this accessory for transform
            this.selectAccessory(type, htmlId);

            this.setStatus(`${type} loaded - drag in viewport or use sliders`);
        } catch (error) {
            this.setStatus(`Error loading ${type}: ${error.message}`);
            console.error('Accessory load error:', error);
        }
    }

    /**
     * Select an accessory for transform editing.
     */
    selectAccessory(type, htmlId) {
        this.selectedAccessory = type;

        const mesh = this.accessoriesManager.accessories[type];
        if (!mesh) return;

        const panel = document.getElementById('accessory-transform');
        panel.classList.remove('hidden');

        const names = {
            upperTeeth: 'שיניים עליונות',
            lowerTeeth: 'שיניים תחתונות',
            tongue: 'לשון',
            eyeLeft: 'עין שמאל',
            eyeRight: 'עין ימין'
        };
        document.getElementById('accessory-transform-title').textContent = `מיקום: ${names[type] || type}`;

        // Scale slider range based on face size
        const sf = this.blendshapeGenerator.scaleFactor || 1;
        const range = sf * 0.5;

        // Set slider ranges dynamically
        ['acc-pos-x', 'acc-pos-y', 'acc-pos-z'].forEach(id => {
            const el = document.getElementById(id);
            el.min = -100;
            el.max = 100;
            el.value = 0;
        });

        // Reset all sliders
        document.getElementById('acc-pos-x').value = 0;
        document.getElementById('acc-pos-y').value = 0;
        document.getElementById('acc-pos-z').value = 0;
        document.getElementById('acc-rot-x').value = 0;
        document.getElementById('acc-rot-y').value = 0;
        document.getElementById('acc-rot-z').value = 0;
        document.getElementById('acc-scale').value = 100;

        document.getElementById('acc-pos-x-val').textContent = '0';
        document.getElementById('acc-pos-y-val').textContent = '0';
        document.getElementById('acc-pos-z-val').textContent = '0';
        document.getElementById('acc-rot-x-val').textContent = '0°';
        document.getElementById('acc-rot-y-val').textContent = '0°';
        document.getElementById('acc-rot-z-val').textContent = '0°';
        document.getElementById('acc-scale-val').textContent = '100%';

        // Store base transform for relative adjustments
        this._accBasePos = mesh.position.clone();
        this._accBaseRot = mesh.rotation.clone();
        this._accBaseScale = mesh.scale.x;

        // Highlight selected button
        document.querySelectorAll('.btn-small.loaded').forEach(b => b.style.outline = '');
        const btn = document.getElementById(`${htmlId}-btn`);
        btn.style.outline = '2px solid var(--accent)';
    }

    /**
     * Bind transform control sliders.
     */
    bindTransformControls() {
        const sf = () => this.blendshapeGenerator.scaleFactor || 1;

        // Position sliders
        ['x', 'y', 'z'].forEach(axis => {
            document.getElementById(`acc-pos-${axis}`).addEventListener('input', (e) => {
                if (!this.selectedAccessory) return;
                const mesh = this.accessoriesManager.accessories[this.selectedAccessory];
                if (!mesh) return;

                const val = parseFloat(e.target.value);
                const offset = (val / 100) * sf() * 0.3;
                document.getElementById(`acc-pos-${axis}-val`).textContent = val.toFixed(0);

                mesh.position[axis] = this._accBasePos[axis] + offset;

                // Update attachment base position for animation
                const attachment = this.accessoriesManager.attachments[this.selectedAccessory];
                if (attachment) {
                    attachment.basePosition.copy(mesh.position);
                }
            });
        });

        // Rotation sliders
        ['x', 'y', 'z'].forEach(axis => {
            document.getElementById(`acc-rot-${axis}`).addEventListener('input', (e) => {
                if (!this.selectedAccessory) return;
                const mesh = this.accessoriesManager.accessories[this.selectedAccessory];
                if (!mesh) return;

                const deg = parseFloat(e.target.value);
                document.getElementById(`acc-rot-${axis}-val`).textContent = `${deg.toFixed(0)}°`;
                const rad = deg * Math.PI / 180;

                mesh.rotation[axis] = this._accBaseRot[axis] + rad;

                const attachment = this.accessoriesManager.attachments[this.selectedAccessory];
                if (attachment) {
                    attachment.baseRotation.copy(mesh.rotation);
                }
            });
        });

        // Scale slider
        document.getElementById('acc-scale').addEventListener('input', (e) => {
            if (!this.selectedAccessory) return;
            const mesh = this.accessoriesManager.accessories[this.selectedAccessory];
            if (!mesh) return;

            const pct = parseFloat(e.target.value);
            document.getElementById('acc-scale-val').textContent = `${pct.toFixed(0)}%`;
            const scale = this._accBaseScale * (pct / 100);
            mesh.scale.setScalar(scale);
        });

        // Remove button
        document.getElementById('acc-remove-btn').addEventListener('click', () => {
            if (!this.selectedAccessory) return;

            // Remove from viewer drag handles
            this.viewer.removeAccessoryHandle(this.selectedAccessory);

            this.accessoriesManager.removeAccessory(this.selectedAccessory);

            // Reset UI
            const allTypes = { upperTeeth: 'upper-teeth', lowerTeeth: 'lower-teeth', tongue: 'tongue', eyeLeft: 'eye-left', eyeRight: 'eye-right' };
            const htmlId = allTypes[this.selectedAccessory];
            if (htmlId) {
                const btn = document.getElementById(`${htmlId}-btn`);
                btn.classList.remove('loaded');
                btn.style.outline = '';
                document.getElementById(`${htmlId}-status`).textContent = '';
            }

            document.getElementById('accessory-transform').classList.add('hidden');
            this.selectedAccessory = null;
            this.setStatus('Accessory removed');
        });

        // Seam line / Z threshold adjustments
        document.getElementById('seam-y-offset').addEventListener('input', (e) => {
            document.getElementById('seam-y-val').textContent = e.target.value;
        });
        document.getElementById('z-threshold-offset').addEventListener('input', (e) => {
            document.getElementById('z-threshold-val').textContent = e.target.value;
        });
        document.getElementById('regenerate-btn').addEventListener('click', () => {
            this.regenerateWithOffsets();
        });
    }

    /**
     * Regenerate blendshapes with manual seam/Z offsets.
     */
    regenerateWithOffsets() {
        if (!this.faceMesh || !this.regions) return;

        const seamOffset = parseFloat(document.getElementById('seam-y-offset').value) / 100;
        const zOffset = parseFloat(document.getElementById('z-threshold-offset').value) / 100;

        // Pass offsets to blendshape generator
        this.blendshapeGenerator.seamYOffset = seamOffset;
        this.blendshapeGenerator.zThresholdOffset = zOffset;

        // Regenerate
        this.generateBlendshapes();

        this.setStatus('Blendshapes regenerated with manual adjustments');
    }

    /**
     * Handle a landmark point being dragged in the viewport.
     */
    handleLandmarkMoved(name, newPosition) {
        // Store the new position for this landmark
        this.landmarkOffsets[name] = newPosition.clone();
        this.setStatus(`Moved ${name} - click "צור Blendshapes" to apply`);
    }

    /**
     * Handle an accessory being dragged in the viewport.
     */
    handleAccessoryDragged(type, newWorldPosition) {
        const attachment = this.accessoriesManager.attachments[type];
        if (attachment) {
            attachment.basePosition.copy(newWorldPosition);
        }

        // If this is the currently selected accessory, update slider display
        if (this.selectedAccessory === type) {
            // Show current offset from original auto-position
            const mesh = this.accessoriesManager.accessories[type];
            if (mesh && this._accBasePos) {
                const sf = this.blendshapeGenerator.scaleFactor || 1;
                const range = sf * 0.3;
                ['x', 'y', 'z'].forEach(axis => {
                    const offset = mesh.position[axis] - this._accBasePos[axis];
                    const sliderVal = (offset / range) * 100;
                    const slider = document.getElementById(`acc-pos-${axis}`);
                    slider.value = Math.max(-100, Math.min(100, sliderVal));
                    document.getElementById(`acc-pos-${axis}-val`).textContent = Math.round(sliderVal);
                });
            }
        }

        this.setStatus(`${type} moved - position updated`);
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
            const morphDict = this.faceMesh.morphTargetDictionary || this.faceMesh.geometry.morphTargetDictionary;

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
    async play() {
        if (!this.animationData || !this.faceMesh) return;

        // Need a fresh audio context if previous was closed
        if (!this.audioContext || this.audioContext.state === 'closed') {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Resume if suspended (browser policy requires user gesture)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
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
     * Start a loop that updates accessories based on morph target influences.
     */
    startAccessoryUpdateLoop() {
        if (this._accessoryLoop) return;
        const update = () => {
            this._accessoryLoop = requestAnimationFrame(update);
            this.accessoriesManager.update();
        };
        update();
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

// Initialize app - modules are deferred, so DOM is likely ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new App());
} else {
    new App();
}
