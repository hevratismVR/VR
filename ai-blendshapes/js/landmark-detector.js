import * as THREE from 'three';

/**
 * AI-based facial landmark detector for 3D meshes.
 * Works on human, animal, and creature faces by analyzing
 * geometric properties of the mesh.
 */
export class LandmarkDetector {
    constructor() {
        this.landmarks = null;
        this.faceRegions = null;
        this.characterType = 'human';
    }

    /**
     * Detect facial landmarks on the given meshes.
     * Uses geometric analysis: curvature, symmetry, and protrusion detection.
     */
    detect(meshes, characterType = 'human') {
        this.characterType = characterType;

        // Find the mesh most likely to be the face/head
        const faceMesh = this.findFaceMesh(meshes);
        if (!faceMesh) {
            throw new Error('Could not identify a face mesh in the model');
        }

        const geometry = faceMesh.geometry;
        const positions = geometry.attributes.position;
        const normals = geometry.attributes.normal;

        // Analyze the mesh geometry
        const analysis = this.analyzeMeshGeometry(positions, normals, geometry);

        // Detect facial regions based on geometric features
        this.faceRegions = this.detectFaceRegions(analysis, characterType);

        // Extract specific landmarks
        this.landmarks = this.extractLandmarks(this.faceRegions, positions);

        return {
            mesh: faceMesh,
            landmarks: this.landmarks,
            regions: this.faceRegions,
            analysis
        };
    }

    /**
     * Find the mesh most likely to be the face/head.
     * Strategy: check names first, then find topmost centered mesh.
     */
    findFaceMesh(meshes) {
        if (meshes.length === 1) return meshes[0];

        // Strategy 1: Check mesh names for head/face keywords
        const headKeywords = ['head', 'face', 'skull', 'cranium', 'pnw', 'ראש', 'פנים'];
        for (const mesh of meshes) {
            const name = (mesh.name || '').toLowerCase();
            if (headKeywords.some(k => name.includes(k))) {
                return mesh;
            }
        }

        // Strategy 2: Find the overall bounding box to understand model proportions
        const overallBox = new THREE.Box3();
        for (const mesh of meshes) {
            mesh.updateWorldMatrix(true, false);
            const meshBox = new THREE.Box3().setFromBufferAttribute(
                mesh.geometry.attributes.position
            ).applyMatrix4(mesh.matrixWorld);
            overallBox.union(meshBox);
        }

        const overallCenter = overallBox.getCenter(new THREE.Vector3());
        const overallSize = overallBox.getSize(new THREE.Vector3());
        const modelHeight = overallSize.y;
        const modelTop = overallBox.max.y;

        // Strategy 3: Score each mesh
        let bestMesh = null;
        let bestScore = -Infinity;

        for (const mesh of meshes) {
            const positions = mesh.geometry.attributes.position;
            const vertexCount = positions.count;

            // Skip very small meshes (less than 100 vertices - probably eyes, teeth, etc.)
            if (vertexCount < 100) continue;

            // Compute bounding box in world space
            const box = new THREE.Box3().setFromBufferAttribute(positions)
                .applyMatrix4(mesh.matrixWorld);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Score 1: Height position (0-1, where 1 = top of model)
            const relativeHeight = (center.y - overallBox.min.y) / modelHeight;
            const heightScore = relativeHeight * 10; // Heavy weight on being at top

            // Score 2: Centered on X axis (head should be centered)
            const xOffset = Math.abs(center.x - overallCenter.x) / (overallSize.x + 0.001);
            const centerScore = (1 - xOffset) * 3;

            // Score 3: Reasonable size (head is ~15-30% of model height)
            const sizeRatio = size.y / modelHeight;
            const sizeScore = (sizeRatio > 0.1 && sizeRatio < 0.5) ? 2 : 0;

            // Score 4: Vertex count bonus (face usually has many vertices)
            const vertexScore = Math.min(2, vertexCount / 5000);

            // Score 5: Roughly compact shape (not a long limb)
            const aspectRatio = Math.max(size.x, size.y, size.z) / (Math.min(size.x, size.y, size.z) + 0.001);
            const compactScore = aspectRatio < 3 ? 2 : 0;

            const score = heightScore + centerScore + sizeScore + vertexScore + compactScore;

            if (score > bestScore) {
                bestScore = score;
                bestMesh = mesh;
            }
        }

        return bestMesh || meshes[0];
    }

    /**
     * Analyze mesh geometry: compute curvature, find protrusions, detect symmetry.
     */
    analyzeMeshGeometry(positions, normals, geometry) {
        const vertexCount = positions.count;
        const vertices = [];
        const vertexNormals = [];

        // Extract vertex data
        for (let i = 0; i < vertexCount; i++) {
            vertices.push(new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            ));
            if (normals) {
                vertexNormals.push(new THREE.Vector3(
                    normals.getX(i),
                    normals.getY(i),
                    normals.getZ(i)
                ));
            }
        }

        // Find bounding box and center
        const bbox = new THREE.Box3();
        vertices.forEach(v => bbox.expandByPoint(v));
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());

        // Detect symmetry axis (usually X)
        const symmetryAxis = this.detectSymmetryAxis(vertices, center);

        // Compute forward direction (where the face points)
        const forwardDir = this.detectForwardDirection(vertices, vertexNormals, center);

        // Compute per-vertex curvature approximation
        const curvatures = this.computeCurvature(vertices, geometry);

        // Detect protrusions (nose, chin, brow)
        const protrusions = this.detectProtrusions(vertices, forwardDir, center);

        return {
            vertices,
            vertexNormals,
            curvatures,
            protrusions,
            center,
            size,
            bbox,
            symmetryAxis,
            forwardDir
        };
    }

    /**
     * Detect the axis of symmetry by comparing vertex distributions.
     */
    detectSymmetryAxis(vertices, center) {
        // Test each axis for bilateral symmetry
        let bestAxis = 'x';
        let bestSymmetry = 0;

        for (const axis of ['x', 'y', 'z']) {
            let symmetryScore = 0;
            const tolerance = 0.05;

            for (const v of vertices) {
                const reflected = v.clone();
                reflected[axis] = 2 * center[axis] - reflected[axis];

                // Find closest vertex to reflected position
                let minDist = Infinity;
                for (const other of vertices) {
                    const dist = reflected.distanceTo(other);
                    if (dist < minDist) minDist = dist;
                }

                if (minDist < tolerance) symmetryScore++;
            }

            if (symmetryScore > bestSymmetry) {
                bestSymmetry = symmetryScore;
                bestAxis = axis;
            }
        }

        return bestAxis;
    }

    /**
     * Detect which direction the face is pointing based on normal distribution.
     */
    detectForwardDirection(vertices, normals, center) {
        if (normals.length === 0) return new THREE.Vector3(0, 0, 1);

        // The forward direction is the average normal of front-facing vertices
        const avgNormal = new THREE.Vector3();
        let count = 0;

        for (let i = 0; i < normals.length; i++) {
            const toVertex = vertices[i].clone().sub(center).normalize();
            // Consider vertices whose normals point outward
            if (normals[i].dot(toVertex) > 0.3) {
                avgNormal.add(normals[i]);
                count++;
            }
        }

        if (count > 0) {
            avgNormal.divideScalar(count).normalize();
        } else {
            avgNormal.set(0, 0, 1);
        }

        return avgNormal;
    }

    /**
     * Approximate per-vertex curvature using neighbor analysis.
     */
    computeCurvature(vertices, geometry) {
        const curvatures = new Float32Array(vertices.length);
        const neighborMap = this.buildNeighborMap(geometry);

        for (let i = 0; i < vertices.length; i++) {
            const neighbors = neighborMap[i] || [];
            if (neighbors.length < 2) continue;

            // Curvature = average angle between vertex-neighbor vectors
            let totalAngle = 0;
            const v = vertices[i];

            for (let j = 0; j < neighbors.length; j++) {
                const n1 = vertices[neighbors[j]];
                const n2 = vertices[neighbors[(j + 1) % neighbors.length]];

                const v1 = n1.clone().sub(v).normalize();
                const v2 = n2.clone().sub(v).normalize();

                totalAngle += Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
            }

            curvatures[i] = totalAngle / neighbors.length;
        }

        return curvatures;
    }

    /**
     * Build a map of vertex neighbors from the mesh topology.
     */
    buildNeighborMap(geometry) {
        const neighborMap = {};
        const index = geometry.index;

        if (index) {
            const indices = index.array;
            for (let i = 0; i < indices.length; i += 3) {
                const a = indices[i], b = indices[i + 1], c = indices[i + 2];

                if (!neighborMap[a]) neighborMap[a] = new Set();
                if (!neighborMap[b]) neighborMap[b] = new Set();
                if (!neighborMap[c]) neighborMap[c] = new Set();

                neighborMap[a].add(b); neighborMap[a].add(c);
                neighborMap[b].add(a); neighborMap[b].add(c);
                neighborMap[c].add(a); neighborMap[c].add(b);
            }
        } else {
            const count = geometry.attributes.position.count;
            for (let i = 0; i < count; i += 3) {
                const a = i, b = i + 1, c = i + 2;
                if (!neighborMap[a]) neighborMap[a] = new Set();
                if (!neighborMap[b]) neighborMap[b] = new Set();
                if (!neighborMap[c]) neighborMap[c] = new Set();

                neighborMap[a].add(b); neighborMap[a].add(c);
                neighborMap[b].add(a); neighborMap[b].add(c);
                neighborMap[c].add(a); neighborMap[c].add(b);
            }
        }

        // Convert sets to arrays
        for (const key in neighborMap) {
            neighborMap[key] = [...neighborMap[key]];
        }

        return neighborMap;
    }

    /**
     * Detect protrusions (points that stick out from the surface) - nose, chin, brow.
     */
    detectProtrusions(vertices, forwardDir, center) {
        const projections = vertices.map((v, i) => ({
            index: i,
            projection: v.clone().sub(center).dot(forwardDir),
            vertex: v
        }));

        // Sort by projection distance (most protruding first)
        projections.sort((a, b) => b.projection - a.projection);

        return projections;
    }

    /**
     * Detect face regions: mouth, eyes, nose, forehead, jaw, cheeks.
     */
    detectFaceRegions(analysis, characterType) {
        const { vertices, center, size, forwardDir, symmetryAxis, protrusions } = analysis;

        // Determine face front vertices (facing forward)
        const frontVertices = [];
        for (let i = 0; i < vertices.length; i++) {
            const toVertex = vertices[i].clone().sub(center);
            const forwardProjection = toVertex.dot(forwardDir);

            if (forwardProjection > 0) {
                frontVertices.push({ index: i, vertex: vertices[i], projection: forwardProjection });
            }
        }

        // Divide face into vertical zones based on characterType
        const zones = this.getZoneRatios(characterType);

        // Compute Y-axis range for front vertices
        let minY = Infinity, maxY = -Infinity;
        for (const fv of frontVertices) {
            if (fv.vertex.y < minY) minY = fv.vertex.y;
            if (fv.vertex.y > maxY) maxY = fv.vertex.y;
        }
        const faceHeight = maxY - minY;

        // Categorize vertices into regions
        const regions = {
            forehead: [],
            eyeLeft: [],
            eyeRight: [],
            nose: [],
            mouth: [],
            jaw: [],
            cheekLeft: [],
            cheekRight: [],
            upperLip: [],
            lowerLip: []
        };

        const symCenter = center[symmetryAxis];

        for (const fv of frontVertices) {
            const relY = (fv.vertex.y - minY) / faceHeight; // 0=bottom, 1=top
            const symOffset = fv.vertex[symmetryAxis] - symCenter;

            if (relY > zones.foreheadStart) {
                regions.forehead.push(fv.index);
            } else if (relY > zones.eyeStart && relY < zones.eyeEnd) {
                if (symOffset > size[symmetryAxis] * 0.08) {
                    regions.eyeLeft.push(fv.index);
                } else if (symOffset < -size[symmetryAxis] * 0.08) {
                    regions.eyeRight.push(fv.index);
                } else {
                    regions.nose.push(fv.index);
                }
            } else if (relY > zones.noseStart && relY <= zones.eyeStart) {
                regions.nose.push(fv.index);
            } else if (relY > zones.mouthStart && relY <= zones.noseStart) {
                if (Math.abs(symOffset) > size[symmetryAxis] * 0.15) {
                    if (symOffset > 0) regions.cheekLeft.push(fv.index);
                    else regions.cheekRight.push(fv.index);
                } else {
                    // Subdivide mouth into upper/lower lip
                    const mouthMid = (zones.mouthStart + zones.noseStart) / 2;
                    if (relY > mouthMid) {
                        regions.upperLip.push(fv.index);
                    } else {
                        regions.lowerLip.push(fv.index);
                    }
                    regions.mouth.push(fv.index);
                }
            } else if (relY <= zones.mouthStart) {
                regions.jaw.push(fv.index);
            }
        }

        return regions;
    }

    /**
     * Get face zone ratios based on character type.
     * Different creatures have different proportions.
     */
    getZoneRatios(characterType) {
        switch (characterType) {
            case 'animal':
                return {
                    foreheadStart: 0.8,
                    eyeStart: 0.6,
                    eyeEnd: 0.78,
                    noseStart: 0.35,
                    mouthStart: 0.15
                };
            case 'creature':
                return {
                    foreheadStart: 0.75,
                    eyeStart: 0.55,
                    eyeEnd: 0.73,
                    noseStart: 0.35,
                    mouthStart: 0.12
                };
            case 'human':
            default:
                return {
                    foreheadStart: 0.78,
                    eyeStart: 0.58,
                    eyeEnd: 0.76,
                    noseStart: 0.38,
                    mouthStart: 0.18
                };
        }
    }

    /**
     * Extract specific landmark points from regions.
     */
    extractLandmarks(regions, positions) {
        const landmarks = {};

        // Find center point of each region
        for (const [name, indices] of Object.entries(regions)) {
            if (indices.length === 0) continue;

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
}
