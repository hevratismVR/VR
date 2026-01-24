import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';

/**
 * 3D Viewport for previewing models with blendshapes.
 */
export class Viewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.model = null;
        this.animFrameId = null;
        this.helpers = [];
        this.dragControls = null;
        this.landmarkSpheres = [];
        this.accessoryHandles = []; // draggable handles for accessories
        this.labels = []; // sprite labels
        this.onLandmarkMoved = null; // callback(name, newPosition)
        this.onAccessoryMoved = null; // callback(type, newPosition)

        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        // Camera
        const container = this.canvas.parentElement;
        const aspect = container.clientWidth / container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 100);
        this.camera.position.set(0, 0, 3);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        // Controls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 10;

        // Lighting
        this.setupLighting();

        // Grid helper
        const grid = new THREE.GridHelper(4, 20, 0x2a4a7f, 0x16213e);
        grid.position.y = -1.2;
        this.scene.add(grid);

        // Handle resize
        window.addEventListener('resize', () => this.onResize());

        // Start render loop
        this.render();
    }

    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        // Key light
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
        keyLight.position.set(2, 3, 2);
        keyLight.castShadow = true;
        this.scene.add(keyLight);

        // Fill light
        const fillLight = new THREE.DirectionalLight(0x6688cc, 0.5);
        fillLight.position.set(-2, 1, -1);
        this.scene.add(fillLight);

        // Rim light
        const rimLight = new THREE.DirectionalLight(0xe94560, 0.3);
        rimLight.position.set(0, -1, -3);
        this.scene.add(rimLight);
    }

    /**
     * Set the model to display.
     */
    setModel(modelData) {
        // Remove existing model and all helpers
        if (this.model) {
            this.scene.remove(this.model);
        }
        this.clearHelpers();
        this.accessoryHandles = [];

        this.model = modelData.scene;
        this.scene.add(this.model);

        // Focus camera on model
        this.focusOnModel();
    }

    /**
     * Focus camera on the current model.
     */
    focusOnModel() {
        if (!this.model) return;

        const box = new THREE.Box3().setFromObject(this.model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        this.camera.position.set(
            center.x,
            center.y + maxDim * 0.3,
            center.z + maxDim * 2
        );

        this.controls.target.copy(center);
        this.controls.update();
    }

    /**
     * Show landmark detection results as draggable colored spheres with labels.
     */
    showLandmarks(landmarks, mesh) {
        // Remove old helpers and drag controls
        this.clearHelpers();

        const colors = {
            forehead: 0xff0000,
            eyeLeft: 0x00ff00,
            eyeRight: 0x00ff00,
            nose: 0x0000ff,
            mouth: 0xff00ff,
            jaw: 0xffff00,
            cheekLeft: 0x00ffff,
            cheekRight: 0x00ffff,
            upperLip: 0xff8800,
            lowerLip: 0xff4400
        };

        const labelNames = {
            forehead: 'Forehead',
            eyeLeft: 'L Eye',
            eyeRight: 'R Eye',
            nose: 'Nose',
            mouth: 'Mouth',
            jaw: 'Jaw',
            cheekLeft: 'L Cheek',
            cheekRight: 'R Cheek',
            upperLip: 'Upper Lip',
            lowerLip: 'Lower Lip'
        };

        this.landmarkSpheres = [];

        // Compute sphere size relative to FACE (not full model)
        const faceBox = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
        const faceSize = faceBox.getSize(new THREE.Vector3());
        const faceExtent = Math.max(faceSize.x, faceSize.y, faceSize.z);
        const sphereRadius = faceExtent * 0.025;

        for (const [name, data] of Object.entries(landmarks)) {
            if (!data.center) continue;

            const color = colors[name] || 0xffffff;

            // Main sphere - emissive, always visible (renders on top)
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(sphereRadius, 16, 16),
                new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: false
                })
            );

            // Wireframe outline for contrast
            const outline = new THREE.Mesh(
                new THREE.SphereGeometry(sphereRadius * 1.3, 16, 16),
                new THREE.MeshBasicMaterial({
                    color: 0x000000,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.5,
                    depthTest: false
                })
            );

            // Transform to world space
            const worldPos = data.center.clone();
            if (mesh.parent) {
                mesh.localToWorld(worldPos);
            }

            sphere.position.copy(worldPos);
            sphere.userData.landmarkName = name;
            sphere.userData.mesh = mesh;
            sphere.userData.isDraggable = true;
            sphere.renderOrder = 999;

            outline.position.copy(worldPos);
            outline.renderOrder = 998;

            this.scene.add(sphere);
            this.scene.add(outline);
            this.helpers.push(sphere);
            this.helpers.push(outline);
            this.landmarkSpheres.push(sphere);

            // Add text label sprite (size relative to model)
            const label = this.createLabel(labelNames[name] || name, color);
            label.position.copy(worldPos);
            label.position.x += sphereRadius * 2.5;
            label.position.y += sphereRadius * 1.5;
            label.scale.set(sphereRadius * 6, sphereRadius * 1.6, 1);
            label.userData.parentSphere = sphere;
            this.scene.add(label);
            this.helpers.push(label);
            this.labels.push(label);
        }

        // Set up drag controls for the spheres
        this.setupDragControls();
    }

    /**
     * Show landmarks on auxiliary meshes (separate eyes, nose).
     */
    showAuxiliaryLandmarks(auxiliaryMeshes, faceMesh) {
        const auxColors = {
            eyeLeft: 0x44ff44,
            eyeRight: 0x44ff44,
            nose: 0x4488ff
        };
        const auxLabels = {
            eyeLeft: 'L Eye Mesh',
            eyeRight: 'R Eye Mesh',
            nose: 'Nose Mesh'
        };

        for (const [name, mesh] of Object.entries(auxiliaryMeshes)) {
            if (!mesh) continue;

            const positions = mesh.geometry.attributes.position;
            const box = new THREE.Box3().setFromBufferAttribute(positions);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const extent = Math.max(size.x, size.y, size.z);

            const sphereRadius = extent * 0.08;
            const color = auxColors[name] || 0xffffff;

            // Diamond shape for auxiliary landmarks (to distinguish from face landmarks)
            const sphere = new THREE.Mesh(
                new THREE.OctahedronGeometry(sphereRadius),
                new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: false
                })
            );

            const worldPos = center.clone();
            if (mesh.parent) {
                mesh.localToWorld(worldPos);
            }

            sphere.position.copy(worldPos);
            sphere.renderOrder = 999;

            this.scene.add(sphere);
            this.helpers.push(sphere);

            // Label
            const label = this.createLabel(auxLabels[name] || name, color);
            label.position.copy(worldPos);
            label.position.x += sphereRadius * 3;
            label.position.y += sphereRadius * 2;
            label.scale.set(sphereRadius * 8, sphereRadius * 2, 1);
            this.scene.add(label);
            this.helpers.push(label);
            this.labels.push(label);
        }
    }

    /**
     * Create a text sprite label.
     */
    createLabel(text, color) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 32;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        const r = 4, w = canvas.width, h = canvas.height;
        ctx.moveTo(r, 0);
        ctx.lineTo(w - r, 0);
        ctx.quadraticCurveTo(w, 0, w, r);
        ctx.lineTo(w, h - r);
        ctx.quadraticCurveTo(w, h, w - r, h);
        ctx.lineTo(r, h);
        ctx.quadraticCurveTo(0, h, 0, h - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();

        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false
        });

        const sprite = new THREE.Sprite(material);
        // Scale will be set by showLandmarks based on model size
        sprite.scale.set(0.15, 0.04, 1);
        sprite.userData.isLabel = true;
        return sprite;
    }

    /**
     * Add an accessory mesh as a draggable object in the viewport.
     */
    addAccessoryHandle(type, mesh) {
        if (!mesh) return;

        // Mark the mesh as draggable accessory
        mesh.userData.accessoryType = type;
        mesh.userData.isDraggable = true;

        this.accessoryHandles.push(mesh);

        // Rebuild drag controls with both landmarks and accessories
        this.setupDragControls();
    }

    /**
     * Remove an accessory handle.
     */
    removeAccessoryHandle(type) {
        this.accessoryHandles = this.accessoryHandles.filter(m => m.userData.accessoryType !== type);
        this.setupDragControls();
    }

    /**
     * Set up DragControls for landmark spheres and accessories.
     */
    setupDragControls() {
        if (this.dragControls) {
            this.dragControls.dispose();
            this.dragControls = null;
        }

        // Combine all draggable objects
        const draggables = [...this.landmarkSpheres, ...this.accessoryHandles];
        if (draggables.length === 0) return;

        this.dragControls = new DragControls(
            draggables,
            this.camera,
            this.renderer.domElement
        );

        this.dragControls.addEventListener('dragstart', (event) => {
            this.controls.enabled = false;
            const obj = event.object;

            if (obj.userData.landmarkName) {
                // Landmark sphere
                obj.material.opacity = 1.0;
                obj.scale.setScalar(1.3);
            } else if (obj.userData.accessoryType) {
                // Accessory mesh - show highlight
                if (obj.material) {
                    obj.userData._origEmissive = obj.material.emissive ?
                        obj.material.emissive.clone() : null;
                    if (obj.material.emissive) {
                        obj.material.emissive.setHex(0x444444);
                    }
                }
            }
        });

        this.dragControls.addEventListener('drag', (event) => {
            const obj = event.object;

            if (obj.userData.landmarkName) {
                // Landmark sphere dragged
                const name = obj.userData.landmarkName;
                if (this.onLandmarkMoved && name) {
                    const localPos = obj.position.clone();
                    const mesh = obj.userData.mesh;
                    if (mesh && mesh.parent) {
                        mesh.worldToLocal(localPos);
                    }
                    this.onLandmarkMoved(name, localPos);
                }

                // Update label position
                for (const label of this.labels) {
                    if (label.userData.parentSphere === obj) {
                        label.position.copy(obj.position);
                        label.position.x += 0.02;
                        label.position.y += 0.015;
                        break;
                    }
                }
            } else if (obj.userData.accessoryType) {
                // Accessory mesh dragged
                if (this.onAccessoryMoved) {
                    this.onAccessoryMoved(obj.userData.accessoryType, obj.position.clone());
                }
            }
        });

        this.dragControls.addEventListener('dragend', (event) => {
            this.controls.enabled = true;
            const obj = event.object;

            if (obj.userData.landmarkName) {
                obj.material.opacity = 0.85;
                obj.scale.setScalar(1.0);
            } else if (obj.userData.accessoryType) {
                if (obj.userData._origEmissive && obj.material && obj.material.emissive) {
                    obj.material.emissive.copy(obj.userData._origEmissive);
                }
            }
        });
    }

    /**
     * Clear all helper objects (landmarks, labels, handles).
     */
    clearHelpers() {
        if (this.dragControls) {
            this.dragControls.dispose();
            this.dragControls = null;
        }
        this.landmarkSpheres = [];
        this.labels = [];

        for (const helper of this.helpers) {
            this.scene.remove(helper);
            if (helper.geometry) helper.geometry.dispose();
            if (helper.material) {
                if (helper.material.map) helper.material.map.dispose();
                helper.material.dispose();
            }
        }
        this.helpers = [];
    }

    /**
     * Handle window resize.
     */
    onResize() {
        const container = this.canvas.parentElement;
        if (!container) return;

        const width = container.clientWidth;
        const height = container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Toggle wireframe overlay on the model.
     */
    toggleWireframe() {
        if (!this.model) return;

        if (this._wireframeOverlay) {
            // Remove wireframe
            this.model.traverse((child) => {
                if (child._wireHelper) {
                    child.remove(child._wireHelper);
                    child._wireHelper.geometry.dispose();
                    child._wireHelper.material.dispose();
                    child._wireHelper = null;
                }
            });
            this._wireframeOverlay = false;
        } else {
            // Add wireframe overlay
            this.model.traverse((child) => {
                if (child.isMesh && !child._wireHelper) {
                    const wireGeo = new THREE.WireframeGeometry(child.geometry);
                    const wireMat = new THREE.LineBasicMaterial({
                        color: 0x4ecdc4,
                        opacity: 0.3,
                        transparent: true
                    });
                    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
                    wireframe.raycast = () => {}; // non-pickable
                    child._wireHelper = wireframe;
                    child.add(wireframe);
                }
            });
            this._wireframeOverlay = true;
        }

        return this._wireframeOverlay;
    }

    /**
     * Register auxiliary meshes for morph target syncing.
     * Every frame, shared blendshape names are synced from face to auxiliary meshes.
     */
    setAuxiliaryMeshes(faceMesh, auxiliaryMeshes) {
        this._faceMesh = faceMesh;
        this._auxiliaryMeshes = auxiliaryMeshes || {};
    }

    /**
     * Render loop.
     */
    render() {
        this.animFrameId = requestAnimationFrame(() => this.render());
        this.controls.update();

        // Sync auxiliary mesh morph influences from face mesh
        this.syncAuxiliaryMorphs();

        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Sync morph target influences from face mesh to auxiliary meshes.
     */
    syncAuxiliaryMorphs() {
        if (!this._faceMesh || !this._auxiliaryMeshes) return;
        const faceDict = this._faceMesh.morphTargetDictionary;
        const faceInfluences = this._faceMesh.morphTargetInfluences;
        if (!faceDict || !faceInfluences) return;

        for (const mesh of Object.values(this._auxiliaryMeshes)) {
            if (!mesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            const auxDict = mesh.morphTargetDictionary;
            for (const [name, auxIdx] of Object.entries(auxDict)) {
                if (name in faceDict) {
                    mesh.morphTargetInfluences[auxIdx] = faceInfluences[faceDict[name]];
                }
            }
        }
    }

    /**
     * Get the scene for export.
     */
    getScene() {
        return this.scene;
    }

    /**
     * Dispose of all resources.
     */
    dispose() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
        }
        this.clearHelpers();
        this.renderer.dispose();
        this.controls.dispose();
    }
}
