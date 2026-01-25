import * as THREE from 'three';

/**
 * AI-based facial landmark detector using MediaPipe Face Mesh.
 * Renders the 3D model from front view, detects 2D landmarks via AI,
 * then back-projects to find corresponding 3D mesh vertices.
 */
export class AILandmarkDetector {
    constructor() {
        this.faceMesh = null;
        this.isLoaded = false;
        this.loadPromise = null;
    }

    /**
     * Load MediaPipe Face Mesh model.
     * Call this once before using detect().
     */
    async load() {
        if (this.isLoaded) return;
        if (this.loadPromise) return this.loadPromise;

        this.loadPromise = this._loadMediaPipe();
        await this.loadPromise;
        this.isLoaded = true;
    }

    async _loadMediaPipe() {
        // Dynamically import MediaPipe
        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs');

        const { FaceLandmarker, FilesetResolver } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        this.faceMesh = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'GPU'
            },
            runningMode: 'IMAGE',
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false
        });

        console.log('[AI Detector] MediaPipe Face Mesh loaded');
    }

    /**
     * Detect facial landmarks using AI.
     * @param {THREE.Mesh[]} meshes - Array of meshes to check
     * @param {THREE.WebGLRenderer} renderer - Three.js renderer
     * @param {THREE.Scene} scene - Three.js scene
     * @param {THREE.Camera} camera - Three.js camera
     * @returns {Object} Detection result with landmarks and regions
     */
    async detect(meshes, renderer, scene, camera) {
        if (!this.isLoaded) {
            await this.load();
        }

        // Find the largest mesh (likely the face)
        let faceMesh = null;
        let maxVertices = 0;
        for (const mesh of meshes) {
            if (mesh.geometry && mesh.geometry.attributes.position) {
                const count = mesh.geometry.attributes.position.count;
                if (count > maxVertices) {
                    maxVertices = count;
                    faceMesh = mesh;
                }
            }
        }

        if (!faceMesh) {
            throw new Error('No valid mesh found');
        }

        // Render front view to canvas
        const { canvas, renderCamera } = this._renderFrontView(faceMesh, renderer, scene);

        // Run MediaPipe detection
        const detections = this.faceMesh.detect(canvas);

        if (!detections.faceLandmarks || detections.faceLandmarks.length === 0) {
            console.warn('[AI Detector] No face detected, falling back to geometry-based detection');
            return null;
        }

        const landmarks2D = detections.faceLandmarks[0];
        console.log(`[AI Detector] Detected ${landmarks2D.length} landmarks`);

        // Back-project 2D landmarks to 3D
        const landmarks3D = this._backProject(landmarks2D, faceMesh, renderCamera, canvas.width, canvas.height);

        // Map MediaPipe indices to our region system
        const regions = this._mapToRegions(landmarks3D, faceMesh);

        // Convert regions to landmark format expected by the app
        // Each landmark needs: { center: Vector3, indices: [], vertexCount: number }
        const landmarkPoints = this._convertToLandmarkFormat(regions, faceMesh.geometry.attributes.position);

        return {
            mesh: faceMesh,
            landmarks: landmarkPoints,
            regions: regions,
            auxiliaryMeshes: this._findAuxiliaryMeshes(meshes, faceMesh, landmarks3D)
        };
    }

    /**
     * Render the mesh from front view to an offscreen canvas.
     */
    _renderFrontView(mesh, renderer, scene) {
        // Compute bounding box
        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // Create orthographic camera for front view
        const aspect = 1;
        const frustumSize = maxDim * 1.5;
        const renderCamera = new THREE.OrthographicCamera(
            -frustumSize * aspect / 2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            -frustumSize / 2,
            0.1,
            maxDim * 10
        );

        // Position camera in front of the face
        renderCamera.position.set(center.x, center.y, center.z + maxDim * 2);
        renderCamera.lookAt(center);
        renderCamera.updateMatrixWorld();
        renderCamera.updateProjectionMatrix();

        // Create offscreen render target
        const renderSize = 512;
        const renderTarget = new THREE.WebGLRenderTarget(renderSize, renderSize);

        // Store original background
        const originalBackground = scene.background;
        scene.background = new THREE.Color(0x808080); // Neutral gray for better detection

        // Render to target
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, renderCamera);
        renderer.setRenderTarget(null);

        // Restore background
        scene.background = originalBackground;

        // Read pixels to canvas
        const canvas = document.createElement('canvas');
        canvas.width = renderSize;
        canvas.height = renderSize;
        const ctx = canvas.getContext('2d');

        const pixels = new Uint8Array(renderSize * renderSize * 4);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, renderSize, renderSize, pixels);

        // Flip Y and copy to canvas
        const imageData = ctx.createImageData(renderSize, renderSize);
        for (let y = 0; y < renderSize; y++) {
            for (let x = 0; x < renderSize; x++) {
                const srcIdx = ((renderSize - 1 - y) * renderSize + x) * 4;
                const dstIdx = (y * renderSize + x) * 4;
                imageData.data[dstIdx] = pixels[srcIdx];
                imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
                imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
                imageData.data[dstIdx + 3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);

        renderTarget.dispose();

        return { canvas, renderCamera };
    }

    /**
     * Back-project 2D landmarks to 3D positions on the mesh.
     */
    _backProject(landmarks2D, mesh, camera, width, height) {
        const landmarks3D = [];
        const raycaster = new THREE.Raycaster();
        const positions = mesh.geometry.attributes.position;

        // Get mesh world matrix for transforming local positions
        mesh.updateMatrixWorld(true);

        // Build spatial hash for fast nearest-vertex lookup
        const spatialHash = this._buildSpatialHash(positions, mesh.matrixWorld);

        for (const lm of landmarks2D) {
            // MediaPipe returns normalized coords [0,1], convert to NDC [-1,1]
            const ndcX = lm.x * 2 - 1;
            const ndcY = -(lm.y * 2 - 1); // Flip Y

            // Create ray from camera through this point
            raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

            // Find intersection with mesh
            const intersects = raycaster.intersectObject(mesh, false);

            if (intersects.length > 0) {
                // Use the closest intersection point
                landmarks3D.push({
                    x: intersects[0].point.x,
                    y: intersects[0].point.y,
                    z: intersects[0].point.z,
                    vertexIndex: this._findClosestVertexFast(intersects[0].point, spatialHash)
                });
            } else {
                // No intersection - find closest vertex to ray using spatial hash
                const closestIdx = this._findClosestVertexToRayFast(raycaster.ray, spatialHash);
                const pos = new THREE.Vector3();
                pos.fromBufferAttribute(positions, closestIdx);
                pos.applyMatrix4(mesh.matrixWorld);
                landmarks3D.push({
                    x: pos.x,
                    y: pos.y,
                    z: pos.z,
                    vertexIndex: closestIdx
                });
            }
        }

        return landmarks3D;
    }

    /**
     * Build spatial hash for fast nearest-vertex lookup.
     */
    _buildSpatialHash(positions, worldMatrix) {
        const vertices = [];
        const temp = new THREE.Vector3();

        // Transform all vertices to world space
        for (let i = 0; i < positions.count; i++) {
            temp.fromBufferAttribute(positions, i);
            temp.applyMatrix4(worldMatrix);
            vertices.push({ x: temp.x, y: temp.y, z: temp.z, index: i });
        }

        // Compute bounding box
        const bbox = new THREE.Box3();
        for (const v of vertices) {
            bbox.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
        }

        const size = bbox.getSize(new THREE.Vector3());
        const cellSize = Math.max(size.x, size.y, size.z) / 20; // 20x20x20 grid

        const hash = new Map();
        const hashKey = (x, y, z) => {
            const ix = Math.floor((x - bbox.min.x) / cellSize);
            const iy = Math.floor((y - bbox.min.y) / cellSize);
            const iz = Math.floor((z - bbox.min.z) / cellSize);
            return `${ix},${iy},${iz}`;
        };

        for (const v of vertices) {
            const key = hashKey(v.x, v.y, v.z);
            if (!hash.has(key)) hash.set(key, []);
            hash.get(key).push(v);
        }

        return { hash, hashKey, cellSize, bbox, vertices };
    }

    /**
     * Find the closest vertex to a 3D point using spatial hash.
     */
    _findClosestVertexFast(point, spatialHash) {
        const { hash, hashKey, cellSize, bbox } = spatialHash;

        // Search in expanding radius
        for (let radius = 0; radius <= 3; radius++) {
            const ix = Math.floor((point.x - bbox.min.x) / cellSize);
            const iy = Math.floor((point.y - bbox.min.y) / cellSize);
            const iz = Math.floor((point.z - bbox.min.z) / cellSize);

            let closestIdx = 0;
            let closestDist = Infinity;

            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dz = -radius; dz <= radius; dz++) {
                        const key = `${ix + dx},${iy + dy},${iz + dz}`;
                        const cell = hash.get(key);
                        if (!cell) continue;

                        for (const v of cell) {
                            const dist = (point.x - v.x) ** 2 + (point.y - v.y) ** 2 + (point.z - v.z) ** 2;
                            if (dist < closestDist) {
                                closestDist = dist;
                                closestIdx = v.index;
                            }
                        }
                    }
                }
            }

            if (closestDist < Infinity) return closestIdx;
        }

        // Fallback to first vertex
        return 0;
    }

    /**
     * Find closest vertex to a ray using spatial hash.
     */
    _findClosestVertexToRayFast(ray, spatialHash) {
        const { vertices } = spatialHash;

        // Sample vertices along the ray direction
        let closestIdx = 0;
        let closestDist = Infinity;

        // For rays, we still need to check all vertices but can use early termination
        for (const v of vertices) {
            const point = new THREE.Vector3(v.x, v.y, v.z);
            const dist = ray.distanceToPoint(point);
            if (dist < closestDist) {
                closestDist = dist;
                closestIdx = v.index;
            }
        }

        return closestIdx;
    }

    /**
     * Map MediaPipe landmark indices to our region system.
     * MediaPipe has 468 landmarks with specific semantic meanings.
     */
    _mapToRegions(landmarks3D, mesh) {
        const positions = mesh.geometry.attributes.position;
        mesh.updateMatrixWorld(true);

        // MediaPipe Face Mesh landmark indices for each region
        // See: https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
        const regionIndices = {
            // Left eye (outer)
            eyeLeft: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
            // Right eye (outer)
            eyeRight: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
            // Nose
            nose: [1, 2, 98, 327, 168, 6, 197, 195, 5, 4, 19, 94, 370],
            // Upper lip
            upperLip: [0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61, 185, 40, 39, 37],
            // Lower lip
            lowerLip: [0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61, 185, 40, 39, 37,
                       78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
            // Mouth (combined)
            mouth: [0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61, 185, 40, 39, 37,
                    78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 13, 312, 311, 310, 415, 308, 324, 318, 402],
            // Forehead
            forehead: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
                       152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
            // Left cheek
            cheekLeft: [36, 142, 126, 217, 174, 196, 197, 419, 248, 281, 363, 360, 279, 331],
            // Right cheek
            cheekRight: [266, 371, 355, 437, 399, 412, 465, 343, 357, 350, 349, 348, 347],
            // Jaw/chin
            jaw: [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323,
                  454, 356, 389, 251, 284, 332, 297, 338, 10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58]
        };

        const regions = {};

        for (const [regionName, mpIndices] of Object.entries(regionIndices)) {
            const vertexIndices = new Set();

            for (const mpIdx of mpIndices) {
                if (mpIdx < landmarks3D.length && landmarks3D[mpIdx].vertexIndex !== undefined) {
                    // Add the landmark vertex
                    vertexIndices.add(landmarks3D[mpIdx].vertexIndex);

                    // Also add nearby vertices within a radius
                    const lm = landmarks3D[mpIdx];
                    const lmPos = new THREE.Vector3(lm.x, lm.y, lm.z);
                    const radius = this._computeRegionRadius(regionName, landmarks3D);

                    for (let i = 0; i < positions.count; i++) {
                        const vPos = new THREE.Vector3().fromBufferAttribute(positions, i);
                        vPos.applyMatrix4(mesh.matrixWorld);
                        if (lmPos.distanceTo(vPos) < radius) {
                            vertexIndices.add(i);
                        }
                    }
                }
            }

            regions[regionName] = Array.from(vertexIndices);
        }

        return regions;
    }

    /**
     * Compute appropriate radius for region expansion based on face size.
     */
    _computeRegionRadius(regionName, landmarks3D) {
        // Estimate face size from landmark positions
        if (landmarks3D.length < 400) return 0.01;

        // Distance from chin (152) to forehead (10)
        const chin = landmarks3D[152] || landmarks3D[0];
        const forehead = landmarks3D[10] || landmarks3D[landmarks3D.length - 1];
        const faceHeight = Math.sqrt(
            (forehead.x - chin.x) ** 2 +
            (forehead.y - chin.y) ** 2 +
            (forehead.z - chin.z) ** 2
        );

        // Different radii for different regions
        const radiusFactors = {
            eyeLeft: 0.08,
            eyeRight: 0.08,
            nose: 0.1,
            upperLip: 0.06,
            lowerLip: 0.06,
            mouth: 0.08,
            forehead: 0.15,
            cheekLeft: 0.12,
            cheekRight: 0.12,
            jaw: 0.1
        };

        return faceHeight * (radiusFactors[regionName] || 0.1);
    }

    /**
     * Convert regions to the landmark format expected by the app.
     * Each landmark needs: { center: Vector3, indices: [], vertexCount: number }
     */
    _convertToLandmarkFormat(regions, positions) {
        const landmarks = {};

        for (const [name, indices] of Object.entries(regions)) {
            if (!indices || indices.length === 0) continue;

            // Calculate center of the region
            const center = new THREE.Vector3();
            for (const i of indices) {
                center.add(new THREE.Vector3(
                    positions.getX(i),
                    positions.getY(i),
                    positions.getZ(i)
                ));
            }
            center.divideScalar(indices.length);

            landmarks[name] = {
                center,
                indices,
                vertexCount: indices.length
            };
        }

        return landmarks;
    }

    /**
     * Find auxiliary meshes (separate eyes, nose) based on detected landmarks.
     */
    _findAuxiliaryMeshes(meshes, faceMesh, landmarks3D) {
        const auxiliary = {};

        if (landmarks3D.length < 400) return auxiliary;

        // Get eye positions from landmarks
        const leftEyePos = landmarks3D[33] ? new THREE.Vector3(landmarks3D[33].x, landmarks3D[33].y, landmarks3D[33].z) : null;
        const rightEyePos = landmarks3D[263] ? new THREE.Vector3(landmarks3D[263].x, landmarks3D[263].y, landmarks3D[263].z) : null;
        const nosePos = landmarks3D[1] ? new THREE.Vector3(landmarks3D[1].x, landmarks3D[1].y, landmarks3D[1].z) : null;

        for (const mesh of meshes) {
            if (mesh === faceMesh) continue;
            if (!mesh.geometry || !mesh.geometry.attributes.position) continue;

            const box = new THREE.Box3().setFromObject(mesh);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Check if this mesh is near an eye or nose position
            if (leftEyePos && center.distanceTo(leftEyePos) < size.length() * 2) {
                auxiliary.eyeLeft = mesh;
            } else if (rightEyePos && center.distanceTo(rightEyePos) < size.length() * 2) {
                auxiliary.eyeRight = mesh;
            } else if (nosePos && center.distanceTo(nosePos) < size.length() * 2) {
                auxiliary.nose = mesh;
            }
        }

        return auxiliary;
    }
}
