import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
        // Remove existing model
        if (this.model) {
            this.scene.remove(this.model);
        }

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
     * Show landmark detection results as colored dots.
     */
    showLandmarks(landmarks, mesh) {
        // Remove old helpers
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

        for (const [name, data] of Object.entries(landmarks)) {
            if (!data.center) continue;

            const color = colors[name] || 0xffffff;

            // Show region center as sphere
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.015, 8, 8),
                new THREE.MeshBasicMaterial({ color })
            );

            // Transform to world space
            const worldPos = data.center.clone();
            if (mesh.parent) {
                mesh.localToWorld(worldPos);
            }

            sphere.position.copy(worldPos);
            this.scene.add(sphere);
            this.helpers.push(sphere);
        }
    }

    /**
     * Clear all helper objects.
     */
    clearHelpers() {
        for (const helper of this.helpers) {
            this.scene.remove(helper);
            if (helper.geometry) helper.geometry.dispose();
            if (helper.material) helper.material.dispose();
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
     * Render loop.
     */
    render() {
        this.animFrameId = requestAnimationFrame(() => this.render());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
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
