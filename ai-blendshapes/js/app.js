import * as THREE from 'three';
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
        this.landmarkUndoStack = []; // history for Ctrl+Z
        this._testAllAbort = false; // abort flag for test-all
        this.playbackSpeed = 1.0; // playback speed multiplier
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

        // Drag and drop on viewport (accepts model or audio files)
        const viewport = document.getElementById('viewport-container');
        viewport.addEventListener('dragover', (e) => {
            e.preventDefault();
            viewport.classList.add('drag-over');
        });
        viewport.addEventListener('dragleave', () => {
            viewport.classList.remove('drag-over');
        });
        viewport.addEventListener('drop', (e) => {
            e.preventDefault();
            viewport.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                const ext = file.name.split('.').pop().toLowerCase();
                if (['glb', 'gltf', 'fbx', 'obj'].includes(ext)) {
                    this.loadModel(file);
                } else if (['wav', 'mp3', 'ogg'].includes(ext)) {
                    this.loadAudio(file);
                }
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
        document.getElementById('export-json-btn').addEventListener('click', () => this.exportJSON());

        // Speed control
        const speedBtn = document.getElementById('speed-btn');
        const speeds = [0.5, 1.0, 1.5, 2.0];
        speedBtn.addEventListener('click', () => {
            const currentIdx = speeds.indexOf(this.playbackSpeed);
            this.playbackSpeed = speeds[(currentIdx + 1) % speeds.length];
            speedBtn.textContent = `${this.playbackSpeed}x`;
            if (this.lipSync) {
                this.lipSync.playbackSpeed = this.playbackSpeed;
            }
        });

        // Test all blendshapes (click again to stop)
        document.getElementById('test-all-btn').addEventListener('click', () => {
            if (this._testAllRunning) {
                this._testAllAbort = true;
            } else {
                this.testAllBlendshapes();
            }
        });

        // Expression presets
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.applyExpressionPreset(preset);
                // Toggle active state
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                if (preset !== 'neutral') btn.classList.add('active');
            });
        });

        // Region overlay toggle
        document.getElementById('region-overlay-toggle').addEventListener('change', (e) => {
            // Clear any active heatmap first
            this._heatmapActive = null;
            document.querySelectorAll('.blendshape-item.heatmap-active').forEach(el => el.classList.remove('heatmap-active'));

            if (e.target.checked && this.faceMesh && this.regions) {
                this.viewer.showRegionOverlay(this.faceMesh, this.regions);
            } else {
                this.viewer.hideRegionOverlay(this.faceMesh);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ignore if user is typing in an input/select
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    if (this.animationData) {
                        if (this.lipSync.isPlaying) {
                            this.pause();
                        } else {
                            this.play();
                        }
                    }
                    break;
                case 'KeyR':
                    if (this.animationData) {
                        this.reset();
                    }
                    break;
                case 'KeyW':
                    if (this.viewer) {
                        const on = this.viewer.toggleWireframe();
                        this.setStatus(on ? 'Wireframe ON' : 'Wireframe OFF');
                    }
                    break;
                case 'KeyZ':
                    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
                        e.preventDefault();
                        this.undoLandmarkDrag();
                    }
                    break;
            }
        });
    }

    /**
     * Reset all state when loading a new model.
     */
    resetState() {
        // Stop any playing animation
        this.lipSync.stop();

        // Cancel accessory update loop
        if (this._accessoryLoop) {
            cancelAnimationFrame(this._accessoryLoop);
            this._accessoryLoop = null;
        }

        // Remove all accessories
        for (const type of Object.keys(this.accessoriesManager.accessories)) {
            if (this.accessoriesManager.accessories[type]) {
                this.accessoriesManager.removeAccessory(type);
            }
        }

        // Reset state variables
        this.faceMesh = null;
        this.landmarks = null;
        this.regions = null;
        this.auxiliaryMeshes = {};
        this.blendshapesGenerated = false;
        this.animationData = null;
        this.audioBuffer = null;
        this.landmarkOffsets = {};
        this.selectedAccessory = null;
        this.blendshapeGenerator.manualLandmarks = {};
        this.blendshapeGenerator.seamYOffset = 0;
        this.blendshapeGenerator.zThresholdOffset = 0;

        // Reset UI
        document.getElementById('detect-face-btn').disabled = true;
        document.getElementById('generate-blendshapes-btn').disabled = true;
        document.getElementById('audio-upload-btn').disabled = true;
        document.getElementById('generate-lipsync-btn').disabled = true;
        document.getElementById('export-glb-btn').disabled = true;
        document.getElementById('export-animation-btn').disabled = true;
        document.getElementById('export-json-btn').disabled = true;
        document.getElementById('test-all-btn').disabled = true;
        document.getElementById('play-btn').disabled = true;
        document.getElementById('pause-btn').disabled = true;
        document.getElementById('reset-btn').disabled = true;
        document.getElementById('timeline').disabled = true;

        // Reset accessory buttons
        ['upper-teeth', 'lower-teeth', 'tongue', 'eye-left', 'eye-right'].forEach(id => {
            const btn = document.getElementById(`${id}-btn`);
            btn.disabled = true;
            btn.classList.remove('loaded');
            btn.style.outline = '';
            document.getElementById(`${id}-status`).textContent = '';
        });

        // Hide panels
        document.getElementById('manual-adjust').classList.add('hidden');
        document.getElementById('accessory-transform').classList.add('hidden');
        document.getElementById('blendshapes-info').classList.add('hidden');
        document.getElementById('audio-info').classList.add('hidden');

        // Reset lists
        document.getElementById('blendshapes-list').innerHTML =
            '<p class="placeholder">Blendshapes יופיעו כאן לאחר יצירה</p>';
        document.getElementById('visemes-list').innerHTML =
            '<p class="placeholder">Visemes יופיעו כאן לאחר יצירת Blendshapes</p>';

        // Reset sliders
        document.getElementById('seam-y-offset').value = 0;
        document.getElementById('seam-y-val').textContent = '0';
        document.getElementById('z-threshold-offset').value = 0;
        document.getElementById('z-threshold-val').textContent = '0';
        document.getElementById('timeline').value = 0;
        document.getElementById('time-display').textContent = '0:00 / 0:00';
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

        // Reset previous state
        this.resetState();

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

            // Auto-detect character type based on mesh composition
            this.autoDetectCharacterType(this.modelData.meshes);

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
     * Auto-detect character type based on mesh composition.
     * Multi-mesh models with small spherical parts are likely cartoon/stylized.
     */
    autoDetectCharacterType(meshes) {
        if (meshes.length < 3) return; // Simple models default to human

        // Count small spherical meshes (likely separate eyes/nose)
        const overallBox = new THREE.Box3();
        for (const mesh of meshes) {
            mesh.updateWorldMatrix(true, false);
            const box = new THREE.Box3().setFromBufferAttribute(
                mesh.geometry.attributes.position
            ).applyMatrix4(mesh.matrixWorld);
            overallBox.union(box);
        }
        const modelHeight = overallBox.getSize(new THREE.Vector3()).y;

        let sphericalCount = 0;
        for (const mesh of meshes) {
            const pos = mesh.geometry.attributes.position;
            if (pos.count < 50) continue;

            const box = new THREE.Box3().setFromBufferAttribute(pos);
            const size = box.getSize(new THREE.Vector3());
            const extent = Math.max(size.x, size.y, size.z);
            const minDim = Math.min(size.x, size.y, size.z);

            // Small, roughly spherical mesh (aspect ratio < 2, size < 30% of model)
            if (extent < modelHeight * 0.3 && extent / (minDim + 0.001) < 2.0) {
                sphericalCount++;
            }
        }

        // If there are 2+ small spherical meshes, likely cartoon character
        if (sphericalCount >= 2) {
            const select = document.getElementById('character-type');
            select.value = 'cartoon';
        }
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
            this.auxiliaryMeshes = result.auxiliaryMeshes || {};

            // Show landmarks in viewer (face mesh + auxiliary meshes)
            this.viewer.showLandmarks(this.landmarks, this.faceMesh);

            // Show auxiliary mesh landmarks (eyes, nose)
            if (this.auxiliaryMeshes.eyeLeft || this.auxiliaryMeshes.eyeRight || this.auxiliaryMeshes.nose) {
                this.viewer.showAuxiliaryLandmarks(this.auxiliaryMeshes, this.faceMesh);
            }

            // Show detection info with diagnostics
            const regionCounts = {};
            for (const [name, indices] of Object.entries(this.regions)) {
                regionCounts[name] = indices.length;
            }

            // Minimum vertex thresholds for quality blendshapes
            const minThresholds = {
                mouth: 10, upperLip: 5, lowerLip: 5,
                jaw: 10, eyeLeft: 5, eyeRight: 5,
                nose: 3, cheekLeft: 3, cheekRight: 3, forehead: 5
            };
            const warnThresholds = {
                mouth: 20, upperLip: 10, lowerLip: 10,
                jaw: 20, eyeLeft: 10, eyeRight: 10,
                nose: 8, cheekLeft: 8, cheekRight: 8, forehead: 10
            };

            const regionLabels = {
                forehead: 'Forehead', eyeLeft: 'L Eye', eyeRight: 'R Eye',
                nose: 'Nose', cheekLeft: 'L Cheek', cheekRight: 'R Cheek',
                upperLip: 'Upper Lip', lowerLip: 'Lower Lip',
                mouth: 'Mouth', jaw: 'Jaw'
            };

            const allRegions = ['forehead', 'eyeLeft', 'eyeRight', 'nose', 'cheekLeft', 'cheekRight', 'upperLip', 'lowerLip', 'mouth', 'jaw'];
            let regionHTML = '<div class="region-grid">';
            const warnings = [];

            for (const key of allRegions) {
                const count = regionCounts[key] || 0;
                const minT = minThresholds[key] || 3;
                const warnT = warnThresholds[key] || 8;
                let cls = 'good';
                if (count < minT) {
                    cls = 'error';
                    warnings.push(`${regionLabels[key]}: ${count < 1 ? 'missing' : 'too few vertices'}`);
                } else if (count < warnT) {
                    cls = 'warn';
                }
                regionHTML += `<div class="region-item ${cls}"><span>${regionLabels[key]}</span><span class="count">${count}</span></div>`;
            }
            regionHTML += '</div>';

            const auxInfo = [];
            if (this.auxiliaryMeshes.eyeLeft) auxInfo.push(`L Eye mesh: ${this.auxiliaryMeshes.eyeLeft.geometry.attributes.position.count}v`);
            if (this.auxiliaryMeshes.eyeRight) auxInfo.push(`R Eye mesh: ${this.auxiliaryMeshes.eyeRight.geometry.attributes.position.count}v`);
            if (this.auxiliaryMeshes.nose) auxInfo.push(`Nose mesh: ${this.auxiliaryMeshes.nose.geometry.attributes.position.count}v`);

            let warningHTML = '';
            if (warnings.length > 0) {
                warningHTML = `<div class="diag-warning">Issues: ${warnings.join(', ')}</div>`;
                warningHTML += `<div class="diag-tip">Try adjusting seam Y / Z threshold, or switch character type</div>`;
            }

            const infoBox = document.getElementById('blendshapes-info');
            infoBox.innerHTML = `
                <strong>Face detected!</strong> (${Object.values(regionCounts).filter(v => v > 0).length}/10 regions)
                ${regionHTML}
                ${auxInfo.length > 0 ? '<strong>Auxiliary:</strong> ' + auxInfo.join(' | ') : ''}
                ${warningHTML}
            `;
            infoBox.classList.remove('hidden');
            infoBox.classList.remove('success');
            if (warnings.length === 0) {
                infoBox.classList.add('success');
            }

            // Show region overlay toggle
            const overlayLabel = document.getElementById('region-overlay-label');
            overlayLabel.classList.remove('hidden');

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
    async generateBlendshapes() {
        if (!this.faceMesh || !this.regions) return;

        this.setStatus('Generating blendshapes...');
        this.showProgress(true, 0);

        try {
            const intensity = parseFloat(document.getElementById('blend-intensity').value);

            // Pass character type and manually adjusted landmark positions
            const characterType = document.getElementById('character-type').value;
            this.blendshapeGenerator.characterType = characterType;
            this.blendshapeGenerator.manualLandmarks = { ...this.landmarkOffsets };

            const result = await this.blendshapeGenerator.generate(
                this.faceMesh,
                this.landmarks,
                this.regions,
                intensity,
                (progress, stage) => {
                    this.showProgress(true, Math.min(progress, 0.85));
                    this.setStatus(stage);
                }
            );

            // Generate blendshapes for auxiliary meshes (eyes, nose)
            if (this.auxiliaryMeshes) {
                this.setStatus('Generating auxiliary mesh blendshapes...');
                this.blendshapeGenerator.generateAuxiliaryBlendshapes(
                    this.auxiliaryMeshes,
                    this.regions,
                    intensity
                );
                this.showProgress(true, 0.95);
            }

            this.blendshapesGenerated = true;

            // Register auxiliary meshes for morph syncing in render loop
            if (this.auxiliaryMeshes) {
                this.viewer.setAuxiliaryMeshes(this.faceMesh, this.auxiliaryMeshes);
            }

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

            // Enable audio upload, test, and exports
            document.getElementById('audio-upload-btn').disabled = false;
            document.getElementById('export-glb-btn').disabled = false;
            document.getElementById('export-json-btn').disabled = false;
            document.getElementById('test-all-btn').disabled = false;

            // Enable expression presets
            const presetsEl = document.getElementById('expression-presets');
            presetsEl.classList.remove('hidden');
            presetsEl.querySelectorAll('.preset-btn').forEach(b => b.disabled = false);

            const shapeCount = Object.keys(result.blendshapes).length;
            const visemeCount = Object.keys(result.visemes).length;
            let auxCount = 0;
            if (this.auxiliaryMeshes) {
                for (const mesh of Object.values(this.auxiliaryMeshes)) {
                    if (mesh && mesh.morphTargetDictionary) {
                        auxCount += Object.keys(mesh.morphTargetDictionary).length;
                    }
                }
            }
            const auxText = auxCount > 0 ? ` + ${auxCount} auxiliary` : '';
            this.setStatus(`Generated ${shapeCount} blendshapes + ${visemeCount} visemes${auxText}`);
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

        // Reset landmarks to original detected positions
        document.getElementById('reset-landmarks-btn').addEventListener('click', () => {
            this.resetLandmarks();
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
     * Reset landmarks to their original detected positions.
     */
    resetLandmarks() {
        if (!this.landmarks || !this.faceMesh) return;

        // Clear all manual offsets
        this.landmarkOffsets = {};

        // Reset sliders
        document.getElementById('seam-y-offset').value = 0;
        document.getElementById('seam-y-val').textContent = '0';
        document.getElementById('z-threshold-offset').value = 0;
        document.getElementById('z-threshold-val').textContent = '0';

        // Clear generator offsets
        this.blendshapeGenerator.seamYOffset = 0;
        this.blendshapeGenerator.zThresholdOffset = 0;
        this.blendshapeGenerator.manualLandmarks = {};

        // Re-show landmarks at original positions
        this.viewer.showLandmarks(this.landmarks, this.faceMesh);

        this.setStatus('Landmarks reset to detected positions');
    }

    /**
     * Handle a landmark point being dragged in the viewport.
     */
    handleLandmarkMoved(name, newPosition) {
        // Push previous state to undo stack
        const prevPos = this.landmarkOffsets[name] ? this.landmarkOffsets[name].clone() : null;
        this.landmarkUndoStack.push({ name, prevPos });

        // Store the new position for this landmark
        this.landmarkOffsets[name] = newPosition.clone();
        this.setStatus(`Moved ${name} - click "צור Blendshapes" to apply (Ctrl+Z to undo)`);
    }

    /**
     * Undo the last landmark drag.
     */
    undoLandmarkDrag() {
        if (this.landmarkUndoStack.length === 0) {
            this.setStatus('Nothing to undo');
            return;
        }

        const { name, prevPos } = this.landmarkUndoStack.pop();
        if (prevPos) {
            this.landmarkOffsets[name] = prevPos;
        } else {
            delete this.landmarkOffsets[name];
        }

        // Update the sphere position in the viewport
        if (this.viewer && this.viewer.landmarkSpheres) {
            for (const sphere of this.viewer.landmarkSpheres) {
                if (sphere.userData && sphere.userData.name === name) {
                    if (prevPos) {
                        sphere.position.copy(prevPos);
                    }
                    break;
                }
            }
        }

        this.setStatus(`Undid move of ${name}`);
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

        // Compute quality metrics for each morph target
        const quality = this.computeMorphQuality();

        // Blendshapes
        listEl.innerHTML = '';
        let strongCount = 0, weakCount = 0, emptyCount = 0;
        for (const name of Object.keys(result.blendshapes)) {
            const q = quality[name] || 'empty';
            if (q === 'strong') strongCount++;
            else if (q === 'weak') weakCount++;
            else emptyCount++;
            listEl.appendChild(this.createBlendshapeSlider(name, q));
        }

        // Visemes
        visemeListEl.innerHTML = '';
        for (const name of Object.keys(result.visemes)) {
            const q = quality[name] || 'empty';
            visemeListEl.appendChild(this.createBlendshapeSlider(name, q));
        }

        // Show generation quality summary
        const total = Object.keys(result.blendshapes).length;
        if (total > 0) {
            const summary = document.createElement('div');
            summary.className = 'quality-summary';
            summary.innerHTML = `<span class="qs-strong">${strongCount}</span> strong / <span class="qs-weak">${weakCount}</span> weak / <span class="qs-empty">${emptyCount}</span> empty`;
            listEl.insertBefore(summary, listEl.firstChild);
        }
    }

    computeMorphQuality() {
        const quality = {};
        if (!this.faceMesh || !this.faceMesh.morphTargetDictionary) return quality;

        const dict = this.faceMesh.morphTargetDictionary;
        const morphPositions = this.faceMesh.geometry.morphAttributes.position;
        if (!morphPositions) return quality;

        const sf = this.blendshapeGenerator ? this.blendshapeGenerator.scaleFactor : 1;

        for (const [name, idx] of Object.entries(dict)) {
            const posAttr = morphPositions[idx];
            if (!posAttr) { quality[name] = 'empty'; continue; }

            let maxDisp = 0;
            for (let i = 0; i < posAttr.count; i++) {
                const dx = posAttr.getX(i), dy = posAttr.getY(i), dz = posAttr.getZ(i);
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > maxDisp) maxDisp = d;
            }

            // Threshold relative to scale factor
            if (maxDisp > sf * 0.02) quality[name] = 'strong';
            else if (maxDisp > sf * 0.005) quality[name] = 'weak';
            else quality[name] = 'empty';
        }
        return quality;
    }

    /**
     * Create a slider control for a blendshape.
     */
    createBlendshapeSlider(name, quality = 'strong') {
        const item = document.createElement('div');
        item.className = 'blendshape-item';
        item.dataset.shapeName = name;

        const dot = document.createElement('span');
        dot.className = `quality-dot q-${quality}`;
        dot.title = quality === 'strong' ? 'Strong deformation' : quality === 'weak' ? 'Weak deformation' : 'No movement';

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

            // One-time debug verification
            if (!this._morphDebugLogged) {
                this._morphDebugLogged = true;
                const dict = this.faceMesh?.morphTargetDictionary;
                const infl = this.faceMesh?.morphTargetInfluences;
                const geo = this.faceMesh?.geometry;
                console.log('[Slider Debug] Morph target state:', {
                    meshExists: !!this.faceMesh,
                    dictionarySize: dict ? Object.keys(dict).length : 0,
                    influencesLength: infl?.length || 0,
                    morphAttributeCount: geo?.morphAttributes?.position?.length || 0,
                    morphTargetsRelative: geo?.morphTargetsRelative,
                    sliderName: name,
                    sliderWeight: weight,
                    influenceIdx: dict?.[name],
                    influenceValue: infl?.[dict?.[name]]
                });
            }
        });

        // Click label to show weight heatmap
        label.style.cursor = 'pointer';
        label.title = 'Click to show weight heatmap';
        label.addEventListener('click', () => {
            this.toggleWeightHeatmap(name);
        });

        item.appendChild(dot);
        item.appendChild(label);
        item.appendChild(slider);
        item.appendChild(value);

        return item;
    }

    /**
     * Toggle weight heatmap for a blendshape.
     */
    toggleWeightHeatmap(name) {
        if (!this.faceMesh || !this.faceMesh.morphTargetDictionary) return;
        const dict = this.faceMesh.morphTargetDictionary;
        if (!(name in dict)) return;

        const idx = dict[name];

        if (this._heatmapActive === name) {
            // Turn off
            this.viewer.hideWeightHeatmap(this.faceMesh);
            this._heatmapActive = null;
            // Uncheck region overlay toggle if it was on
            const overlayToggle = document.getElementById('region-overlay-toggle');
            if (overlayToggle) overlayToggle.checked = false;
            // Remove highlight
            document.querySelectorAll('.blendshape-item.heatmap-active').forEach(el => el.classList.remove('heatmap-active'));
        } else {
            // Show heatmap for this blendshape
            this.viewer.showWeightHeatmap(this.faceMesh, idx);
            this._heatmapActive = name;
            // Uncheck region overlay
            const overlayToggle = document.getElementById('region-overlay-toggle');
            if (overlayToggle) overlayToggle.checked = false;
            // Highlight this slider item
            document.querySelectorAll('.blendshape-item.heatmap-active').forEach(el => el.classList.remove('heatmap-active'));
            const sliderItem = document.querySelector(`.blendshape-item[data-shape-name="${name}"]`);
            if (sliderItem) sliderItem.classList.add('heatmap-active');
        }
    }

    /**
     * Test all blendshapes by cycling through each one.
     */
    async testAllBlendshapes() {
        if (!this.faceMesh || !this.faceMesh.morphTargetDictionary) return;

        const dictionary = this.faceMesh.morphTargetDictionary;
        const names = Object.keys(dictionary);
        const btn = document.getElementById('test-all-btn');
        const viewportLabel = document.getElementById('viewport-label');

        this._testAllRunning = true;
        this._testAllAbort = false;
        btn.textContent = '\u25A0 Stop';

        // Reset all first
        for (let i = 0; i < this.faceMesh.morphTargetInfluences.length; i++) {
            this.faceMesh.morphTargetInfluences[i] = 0;
        }

        for (const name of names) {
            if (this._testAllAbort) break;

            const idx = dictionary[name];
            const sliderItem = document.querySelector(`.blendshape-item[data-shape-name="${name}"]`);
            const slider = sliderItem ? sliderItem.querySelector('input[type="range"]') : null;
            const valueSpan = sliderItem ? sliderItem.querySelector('.value') : null;

            // Scroll to show the active blendshape in the panel
            if (sliderItem) {
                sliderItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                sliderItem.style.background = 'rgba(233,69,96,0.15)';
            }

            // Show name in viewport
            viewportLabel.textContent = name;
            viewportLabel.classList.remove('hidden');

            // Animate in (ramp up over 150ms)
            const steps = 5;
            for (let s = 1; s <= steps && !this._testAllAbort; s++) {
                const weight = s / steps;
                this.faceMesh.morphTargetInfluences[idx] = weight;
                if (slider) slider.value = weight.toFixed(2);
                if (valueSpan) valueSpan.textContent = weight.toFixed(2);
                await this.delay(30);
            }

            if (this._testAllAbort) {
                this.faceMesh.morphTargetInfluences[idx] = 0;
                if (slider) slider.value = '0';
                if (valueSpan) valueSpan.textContent = '0';
                if (sliderItem) sliderItem.style.background = '';
                break;
            }

            // Hold for 300ms
            this.setStatus(`Testing: ${name} (${names.indexOf(name) + 1}/${names.length})`);
            await this.delay(300);

            // Animate out (ramp down over 150ms)
            for (let s = steps - 1; s >= 0 && !this._testAllAbort; s--) {
                const weight = s / steps;
                this.faceMesh.morphTargetInfluences[idx] = weight;
                if (slider) slider.value = weight.toFixed(2);
                if (valueSpan) valueSpan.textContent = weight.toFixed(2);
                await this.delay(30);
            }

            // Clear highlight
            if (sliderItem) sliderItem.style.background = '';

            // Brief pause between shapes
            await this.delay(50);
        }

        viewportLabel.classList.add('hidden');
        this._testAllRunning = false;
        this.setStatus(this._testAllAbort ? 'Test stopped' : 'Test complete');
        btn.textContent = '\u25B6 בדוק הכל';
    }

    /**
     * Simple delay helper.
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Apply an expression preset by setting multiple blendshape weights.
     */
    applyExpressionPreset(preset) {
        if (!this.faceMesh || !this.faceMesh.morphTargetDictionary) return;

        const dict = this.faceMesh.morphTargetDictionary;
        const influences = this.faceMesh.morphTargetInfluences;

        // Reset all first
        for (let i = 0; i < influences.length; i++) {
            influences[i] = 0;
        }

        // Expression definitions: blendshape name -> weight
        const expressions = {
            happy: {
                mouthSmileLeft: 0.85, mouthSmileRight: 0.85,
                cheekSquintLeft: 0.4, cheekSquintRight: 0.4,
                eyeSquintLeft: 0.3, eyeSquintRight: 0.3,
                browInnerUp: 0.2
            },
            sad: {
                mouthFrownLeft: 0.7, mouthFrownRight: 0.7,
                browDownLeft: 0.4, browDownRight: 0.4,
                browInnerUp: 0.6,
                eyeSquintLeft: 0.2, eyeSquintRight: 0.2,
                mouthPucker: 0.15
            },
            surprised: {
                jawOpen: 0.5, mouthOpen: 0.4,
                eyeWideLeft: 0.8, eyeWideRight: 0.8,
                browInnerUp: 0.7,
                browOuterUpLeft: 0.6, browOuterUpRight: 0.6
            },
            angry: {
                browDownLeft: 0.8, browDownRight: 0.8,
                eyeSquintLeft: 0.5, eyeSquintRight: 0.5,
                noseSneerLeft: 0.6, noseSneerRight: 0.6,
                mouthFrownLeft: 0.3, mouthFrownRight: 0.3,
                jawForward: 0.3,
                mouthPressLeft: 0.4, mouthPressRight: 0.4
            },
            neutral: {} // All zeros (reset)
        };

        const weights = expressions[preset] || {};

        for (const [name, weight] of Object.entries(weights)) {
            if (name in dict) {
                influences[dict[name]] = weight;
            }
        }

        // Update sliders to match
        for (const [name, idx] of Object.entries(dict)) {
            const sliderItem = document.querySelector(`.blendshape-item[data-shape-name="${name}"]`);
            if (sliderItem) {
                const slider = sliderItem.querySelector('input[type="range"]');
                const valueSpan = sliderItem.querySelector('.value');
                const w = influences[idx];
                if (slider) slider.value = w.toFixed(2);
                if (valueSpan) valueSpan.textContent = w > 0 ? w.toFixed(2) : '0';
            }
        }

        const viewportLabel = document.getElementById('viewport-label');
        if (preset !== 'neutral') {
            viewportLabel.textContent = preset;
            viewportLabel.classList.remove('hidden');
        } else {
            viewportLabel.classList.add('hidden');
        }
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

        // Stop any active playback and reset animation state
        this.lipSync.stop();
        this.animationData = null;
        document.getElementById('play-btn').disabled = true;
        document.getElementById('pause-btn').disabled = true;
        document.getElementById('reset-btn').disabled = true;
        document.getElementById('timeline').disabled = true;
        document.getElementById('timeline').value = 0;
        document.getElementById('time-display').textContent = '0:00 / 0:00';
        document.getElementById('export-animation-btn').disabled = true;
        document.getElementById('generate-lipsync-btn').disabled = true;

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
     * Update playback UI (timeline, time display, and blendshape sliders).
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

        // Update blendshape sliders to reflect current morph weights
        if (this.faceMesh && this.faceMesh.morphTargetInfluences) {
            this.updateBlendshapeSliderValues();
        }

        // If animation ended
        if (currentTime >= duration) {
            document.getElementById('play-btn').disabled = false;
            document.getElementById('pause-btn').disabled = true;
            this.setStatus('Playback complete');
        }
    }

    /**
     * Sync blendshape slider UI with current morph target weights.
     */
    updateBlendshapeSliderValues() {
        const dictionary = this.faceMesh.morphTargetDictionary;
        const influences = this.faceMesh.morphTargetInfluences;
        if (!dictionary || !influences) return;

        // Throttle: only update every 3rd frame to avoid excessive DOM writes
        this._sliderUpdateCounter = (this._sliderUpdateCounter || 0) + 1;
        if (this._sliderUpdateCounter % 3 !== 0) return;

        const items = document.querySelectorAll('.blendshape-item[data-shape-name]');
        for (const item of items) {
            const name = item.dataset.shapeName;
            const idx = dictionary[name];
            if (idx === undefined) continue;

            const weight = influences[idx] || 0;
            const slider = item.querySelector('input[type="range"]');
            const valueSpan = item.querySelector('.value');
            if (slider) slider.value = weight.toFixed(3);
            if (valueSpan) valueSpan.textContent = weight.toFixed(2);
        }
    }

    /**
     * Export model with blendshapes as GLB.
     */
    async exportGLB() {
        this.setStatus('Exporting GLB...');
        this.showProgress(true);

        try {
            // Build accessory info for baking jaw/eye tracking into animation
            let accessoriesInfo = null;
            if (this.accessoriesManager.hasAccessories()) {
                accessoriesInfo = {
                    accessories: this.accessoriesManager.getAccessories(),
                    attachments: this.accessoriesManager.attachments,
                    blendshapeGenerator: this.blendshapeGenerator
                };
            }

            const blob = await this.exporter.exportGLB(
                this.modelData.scene,
                this.faceMesh,
                this.animationData,
                accessoriesInfo
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
     * Export blendshape data as JSON.
     */
    exportJSON() {
        if (!this.faceMesh) return;

        try {
            const json = this.exporter.exportBlendshapeJSON(this.faceMesh);
            const blob = new Blob([json], { type: 'application/json' });
            this.exporter.downloadBlob(blob, 'blendshapes-data.json');
            this.setStatus('JSON exported successfully!');
        } catch (error) {
            this.setStatus(`JSON export error: ${error.message}`);
            console.error('JSON export error:', error);
        }
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
    showProgress(show, percent = null) {
        const bar = document.getElementById('progress-bar');
        const fill = document.getElementById('progress-fill');
        if (show) {
            bar.classList.remove('hidden');
            fill.style.width = percent !== null ? `${Math.round(percent * 100)}%` : '100%';
        } else {
            bar.classList.add('hidden');
            fill.style.width = '0%';
        }
    }
}

// Initialize app - modules are deferred, so DOM is likely ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new App());
} else {
    new App();
}
