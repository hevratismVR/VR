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
        const bodyExcludeKeywords = ['body', 'torso', 'arm', 'leg', 'foot', 'hand', 'finger', 'hair', 'cloth', 'shirt', 'pant', 'shoe', 'גוף'];
        for (const mesh of meshes) {
            const name = (mesh.name || '').toLowerCase();
            if (headKeywords.some(k => name.includes(k)) &&
                !bodyExcludeKeywords.some(k => name.includes(k))) {
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

        // Strategy 3: Score each mesh
        let bestMesh = null;
        let bestScore = -Infinity;

        for (const mesh of meshes) {
            const positions = mesh.geometry.attributes.position;
            const vertexCount = positions.count;

            // Skip very small meshes (less than 100 vertices - probably eyes, teeth, etc.)
            if (vertexCount < 100) continue;

            const name = (mesh.name || '').toLowerCase();
            // Skip meshes with body-part names
            if (bodyExcludeKeywords.some(k => name.includes(k))) continue;

            // Compute bounding box in world space
            const box = new THREE.Box3().setFromBufferAttribute(positions)
                .applyMatrix4(mesh.matrixWorld);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Score 1: Height position (0-1, where 1 = top of model)
            const relativeHeight = (center.y - overallBox.min.y) / modelHeight;
            const heightScore = relativeHeight * 10;

            // Score 2: Centered on X axis (head should be centered)
            const xOffset = Math.abs(center.x - overallCenter.x) / (overallSize.x + 0.001);
            const centerScore = (1 - xOffset) * 3;

            // Score 3: Reasonable size (head is ~15-30% of model height)
            const sizeRatio = size.y / modelHeight;
            let sizeScore = 0;
            if (sizeRatio > 0.1 && sizeRatio < 0.5) {
                sizeScore = 3; // Ideal head size
            } else if (sizeRatio >= 0.5 && sizeRatio < 0.7) {
                sizeScore = 1; // Acceptable but not ideal
            }
            // Penalize meshes spanning most of the model (likely full body)
            if (sizeRatio > 0.7) {
                sizeScore = -5;
            }

            // Score 4: Vertex count (moderate bonus, not too high to avoid picking body meshes)
            const vertexScore = Math.min(1.5, vertexCount / 10000);

            // Score 5: Roughly compact shape (not a long limb or full body)
            const aspectRatio = Math.max(size.x, size.y, size.z) / (Math.min(size.x, size.y, size.z) + 0.001);
            const compactScore = aspectRatio < 2.5 ? 3 : (aspectRatio < 4 ? 1 : -2);

            // Score 6: Bottom of mesh is in upper half of model (head starts above shoulders)
            const meshBottom = (box.min.y - overallBox.min.y) / modelHeight;
            const topStartScore = meshBottom > 0.5 ? 4 : (meshBottom > 0.3 ? 2 : 0);

            const score = heightScore + centerScore + sizeScore + vertexScore + compactScore + topStartScore;

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
     * Detect the axis of symmetry using spatial hashing with vertex sampling.
     * O(n) instead of O(n²).
     */
    detectSymmetryAxis(vertices, center) {
        let bestAxis = 'x';
        let bestSymmetry = 0;

        // Sample up to 500 vertices for performance
        const sampleSize = Math.min(500, vertices.length);
        const step = Math.max(1, Math.floor(vertices.length / sampleSize));

        // Build spatial hash for fast neighbor lookup
        const bbox = new THREE.Box3();
        for (const v of vertices) bbox.expandByPoint(v);
        const bboxSize = bbox.getSize(new THREE.Vector3());
        const cellSize = Math.max(bboxSize.x, bboxSize.y, bboxSize.z) * 0.02;

        const hashVertex = (v) => {
            const ix = Math.floor((v.x - bbox.min.x) / cellSize);
            const iy = Math.floor((v.y - bbox.min.y) / cellSize);
            const iz = Math.floor((v.z - bbox.min.z) / cellSize);
            return `${ix},${iy},${iz}`;
        };

        // Build hash map once
        const spatialHash = new Map();
        for (let i = 0; i < vertices.length; i++) {
            const key = hashVertex(vertices[i]);
            if (!spatialHash.has(key)) spatialHash.set(key, []);
            spatialHash.get(key).push(i);
        }

        const tolerance = cellSize * 1.5;

        for (const axis of ['x', 'y', 'z']) {
            let symmetryScore = 0;

            for (let i = 0; i < vertices.length; i += step) {
                const v = vertices[i];
                const reflected = v.clone();
                reflected[axis] = 2 * center[axis] - reflected[axis];

                // Check 3x3x3 neighborhood of cells around reflected position
                const rix = Math.floor((reflected.x - bbox.min.x) / cellSize);
                const riy = Math.floor((reflected.y - bbox.min.y) / cellSize);
                const riz = Math.floor((reflected.z - bbox.min.z) / cellSize);

                let found = false;
                outer:
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const key = `${rix + dx},${riy + dy},${riz + dz}`;
                            const candidates = spatialHash.get(key);
                            if (!candidates) continue;

                            for (const ci of candidates) {
                                if (reflected.distanceTo(vertices[ci]) < tolerance) {
                                    found = true;
                                    break outer;
                                }
                            }
                        }
                    }
                }

                if (found) symmetryScore++;
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
     * Handles full-body meshes by isolating the head cluster.
     */
    detectFaceRegions(analysis, characterType) {
        const { vertices, center, size, forwardDir, symmetryAxis, protrusions } = analysis;

        // Determine face front vertices (facing forward)
        let frontVertices = [];
        for (let i = 0; i < vertices.length; i++) {
            const toVertex = vertices[i].clone().sub(center);
            const forwardProjection = toVertex.dot(forwardDir);

            if (forwardProjection > 0) {
                frontVertices.push({ index: i, vertex: vertices[i], projection: forwardProjection });
            }
        }

        // Compute Y-axis range for front vertices
        let minY = Infinity, maxY = -Infinity;
        let minX = Infinity, maxX = -Infinity;
        for (const fv of frontVertices) {
            if (fv.vertex.y < minY) minY = fv.vertex.y;
            if (fv.vertex.y > maxY) maxY = fv.vertex.y;
            if (fv.vertex.x < minX) minX = fv.vertex.x;
            if (fv.vertex.x > maxX) maxX = fv.vertex.x;
        }
        let faceHeight = maxY - minY;
        const faceWidth = maxX - minX;

        // HEAD ISOLATION: If front vertices span a disproportionately tall range,
        // the mesh likely includes the body. Focus on the head at the top.
        const heightToWidthRatio = faceHeight / (faceWidth + 0.001);
        if (heightToWidthRatio > 2.0 && faceHeight > size.y * 0.5) {
            // Find the head cluster: vertices in the top 30% of the Y range
            // then expand slightly to include the jaw
            const headTopThreshold = maxY - faceHeight * 0.30;

            // Find the actual head cluster by looking for a gap/density change
            // Use the top portion and then expand down to find chin
            const headWidth = this.estimateHeadWidth(frontVertices, headTopThreshold, maxY, symmetryAxis);

            // Head is roughly as wide as it is tall - use width to estimate head extent
            const estimatedHeadHeight = headWidth * 1.3; // head is slightly taller than wide
            const headBottom = Math.max(minY, maxY - estimatedHeadHeight);

            // Filter front vertices to head region only
            frontVertices = frontVertices.filter(fv => fv.vertex.y >= headBottom);

            // Recompute bounds
            minY = headBottom;
            faceHeight = maxY - minY;
        }

        // Divide face into vertical zones based on characterType
        const zones = this.getZoneRatios(characterType);

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

        // Compute X center from the head-isolated front vertices
        let headMinX = Infinity, headMaxX = -Infinity;
        for (const fv of frontVertices) {
            if (fv.vertex[symmetryAxis] < headMinX) headMinX = fv.vertex[symmetryAxis];
            if (fv.vertex[symmetryAxis] > headMaxX) headMaxX = fv.vertex[symmetryAxis];
        }
        const headWidth = headMaxX - headMinX;
        const symCenter = (headMinX + headMaxX) / 2;

        for (const fv of frontVertices) {
            const relY = (fv.vertex.y - minY) / faceHeight; // 0=bottom, 1=top
            const symOffset = fv.vertex[symmetryAxis] - symCenter;

            if (relY > zones.foreheadStart) {
                regions.forehead.push(fv.index);
            } else if (relY > zones.eyeStart && relY < zones.eyeEnd) {
                if (symOffset > headWidth * 0.08) {
                    regions.eyeLeft.push(fv.index);
                } else if (symOffset < -headWidth * 0.08) {
                    regions.eyeRight.push(fv.index);
                } else {
                    regions.nose.push(fv.index);
                }
            } else if (relY > zones.noseStart && relY <= zones.eyeStart) {
                regions.nose.push(fv.index);
            } else if (relY > zones.mouthStart && relY <= zones.noseStart) {
                if (Math.abs(symOffset) > headWidth * 0.15) {
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
     * Estimate head width from vertices in the top portion of the mesh.
     * Uses IQR-based filtering to exclude outliers (raised arms, accessories).
     */
    estimateHeadWidth(frontVertices, yMin, yMax, symmetryAxis) {
        const xValues = [];
        for (const fv of frontVertices) {
            if (fv.vertex.y >= yMin && fv.vertex.y <= yMax) {
                xValues.push(fv.vertex[symmetryAxis]);
            }
        }

        if (xValues.length === 0) return 0;

        // Use IQR to exclude outliers (e.g. raised arms)
        xValues.sort((a, b) => a - b);
        const q1 = xValues[Math.floor(xValues.length * 0.15)];
        const q3 = xValues[Math.floor(xValues.length * 0.85)];
        return q3 - q1;
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
