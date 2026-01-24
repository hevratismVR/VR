import * as THREE from 'three';

/**
 * Professional blendshape generator.
 * Creates ARKit-compatible 52 blendshapes + 15 visemes with proper deformation magnitudes.
 */
export class BlendshapeGenerator {
    constructor() {
        this.blendshapes = {};
        this.visemes = {};
        this.mesh = null;
        this.basePositions = null;
        this.intensity = 1.0;
        this.scaleFactor = 1;
        this.faceHeight = 1;
        this.mouthCenter = { x: 0, y: 0, z: 0 };
        this.jawPivot = { x: 0, y: 0, z: 0 };
        // Manual offsets (set by UI)
        this.seamYOffset = 0;
        this.zThresholdOffset = 0;
        // Manually adjusted landmark positions (from drag)
        this.manualLandmarks = {};
        // Character type (affects magnitude)
        this.characterType = 'human';
        this.magnitudeScale = 1.0;
    }

    /**
     * Generate all blendshapes for the detected face.
     * @param {Function} onProgress - Optional callback(progress: 0-1, stage: string)
     */
    async generate(mesh, landmarks, regions, intensity = 1.0, onProgress = null) {
        this.mesh = mesh;
        this.basePositions = mesh.geometry.attributes.position.clone();
        this.regions = regions;

        if (onProgress) onProgress(0, 'Computing face metrics');

        // Compute scale factor based on actual face size
        this.computeScaleFactor(regions);

        // Magnitude multiplier for cartoon/stylized characters (exaggerated expressions)
        this.magnitudeScale = (this.characterType === 'cartoon') ? 1.5 : 1.0;
        this.intensity = intensity * this.magnitudeScale;

        // Compute key reference points
        this.computeReferencePoints(regions);

        const geometry = mesh.geometry;

        if (onProgress) onProgress(0.05, 'Generating ARKit blendshapes');

        // Generate ARKit-compatible blendshapes
        this.blendshapes = this.generateARKitBlendshapes(geometry, landmarks, regions);

        if (onProgress) onProgress(0.15, 'Generating visemes');

        // Generate viseme blendshapes for lip sync
        this.visemes = this.generateVisemes(geometry, landmarks, regions);

        if (onProgress) onProgress(0.25, 'Computing morph targets');

        // Apply morph targets to the mesh (async for progress reporting)
        await this.applyMorphTargets(geometry, onProgress);

        // Enable morphTargets on material
        this.enableMorphOnMaterial(mesh);

        if (onProgress) onProgress(1.0, 'Complete');

        return {
            blendshapes: this.blendshapes,
            visemes: this.visemes,
            morphTargetDictionary: mesh.morphTargetDictionary,
            morphTargetInfluences: mesh.morphTargetInfluences
        };
    }

    computeScaleFactor(regions) {
        const positions = this.basePositions;
        let minY = Infinity, maxY = -Infinity;

        const allIndices = [
            ...(regions.forehead || []),
            ...(regions.eyeLeft || []),
            ...(regions.eyeRight || []),
            ...(regions.nose || []),
            ...(regions.mouth || []),
            ...(regions.jaw || []),
            ...(regions.upperLip || []),
            ...(regions.lowerLip || [])
        ];

        if (allIndices.length === 0) {
            this.scaleFactor = 1;
            this.faceHeight = 1;
            return;
        }

        for (const i of allIndices) {
            const y = positions.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        this.faceHeight = maxY - minY;
        this.scaleFactor = this.faceHeight > 0 ? this.faceHeight : 1;
    }

    computeReferencePoints(regions) {
        const positions = this.basePositions;

        // Mouth center - use manual position if available, otherwise compute
        let mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];

        // If mouth region is very small, expand it by including nearby jaw/nose vertices
        if (mouthIndices.length < 20) {
            const noseIndices = regions.nose || [];
            const jawIndices = regions.jaw || [];
            if (noseIndices.length > 0 && jawIndices.length > 0) {
                // Estimate mouth Y from bottom of nose to top of jaw
                const noseMinY = this.getMinY(positions, noseIndices);
                const jawMaxY = this.getMaxY(positions, jawIndices);
                const estimatedMouthY = (noseMinY + jawMaxY) / 2;
                const tolerance = this.scaleFactor * 0.08;

                // Gather vertices near the estimated mouth Y
                const allFaceIndices = [...noseIndices, ...jawIndices, ...(regions.cheekLeft || []), ...(regions.cheekRight || [])];
                for (const i of allFaceIndices) {
                    if (Math.abs(positions.getY(i) - estimatedMouthY) < tolerance) {
                        mouthIndices.push(i);
                    }
                }
            }
        }

        if (this.manualLandmarks.mouth) {
            this.mouthCenter = {
                x: this.manualLandmarks.mouth.x,
                y: this.manualLandmarks.mouth.y,
                z: this.manualLandmarks.mouth.z
            };
        } else {
            this.mouthCenter = {
                x: this.getMidX(positions, mouthIndices),
                y: this.getMidY(positions, mouthIndices),
                z: this.getMidZ(positions, mouthIndices)
            };
        }

        // Jaw position - use manual if available
        const jawIndices = regions.jaw || [];
        if (this.manualLandmarks.jaw) {
            this.jawCenter = {
                x: this.manualLandmarks.jaw.x,
                y: this.manualLandmarks.jaw.y,
                z: this.manualLandmarks.jaw.z
            };
        } else {
            this.jawCenter = {
                x: this.getMidX(positions, jawIndices),
                y: this.getMidY(positions, jawIndices),
                z: this.getMidZ(positions, jawIndices)
            };
        }

        // Upper lip position - refines the seam line
        if (this.manualLandmarks.upperLip) {
            this.upperLipCenter = {
                x: this.manualLandmarks.upperLip.x,
                y: this.manualLandmarks.upperLip.y,
                z: this.manualLandmarks.upperLip.z
            };
            // Use upper lip Y as seam if it's below the detected mouth center
            // (upper lip is the boundary between what moves and what doesn't)
            if (this.upperLipCenter.y < this.mouthCenter.y) {
                this.mouthCenter.y = (this.mouthCenter.y + this.upperLipCenter.y) / 2;
            }
        }

        // Lower lip - affects mouth height
        if (this.manualLandmarks.lowerLip) {
            this.lowerLipCenter = {
                x: this.manualLandmarks.lowerLip.x,
                y: this.manualLandmarks.lowerLip.y,
                z: this.manualLandmarks.lowerLip.z
            };
        }

        // Jaw pivot - behind and above the mouth center (ear level)
        this.jawPivot = {
            x: this.mouthCenter.x,
            y: this.mouthCenter.y + this.scaleFactor * 0.15,
            z: this.mouthCenter.z - this.scaleFactor * 0.25
        };

        // Mouth bounds
        let mouthMinY = Infinity, mouthMaxY = -Infinity;
        let mouthMinX = Infinity, mouthMaxX = -Infinity;
        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            if (y < mouthMinY) mouthMinY = y;
            if (y > mouthMaxY) mouthMaxY = y;
            if (x < mouthMinX) mouthMinX = x;
            if (x > mouthMaxX) mouthMaxX = x;
        }
        this.mouthMinY = mouthMinY;
        this.mouthMaxY = mouthMaxY;
        this.mouthWidth = mouthMaxX - mouthMinX;
        this.mouthHeight = mouthMaxY - mouthMinY;

        // Override face min Y (jaw bottom) if manually set
        if (this.manualLandmarks.jaw) {
            this.manualJawBottom = this.manualLandmarks.jaw.y;
        } else {
            this.manualJawBottom = null;
        }

        // Apply manual offsets from UI sliders
        if (this.seamYOffset) {
            this.mouthCenter.y += this.seamYOffset * this.scaleFactor * 0.3;
        }
    }

    /**
     * Expand a sparse region by including nearby vertices with distance-based falloff.
     * Returns array of {index, weight} where weight is 1.0 for original region vertices
     * and falls off for nearby expanded vertices.
     * @param {number[]} regionIndices - Original region vertex indices
     * @param {number} minCount - Minimum vertices needed; expand if below this
     * @param {number} searchRadius - Search radius as fraction of scaleFactor
     * @returns {{index: number, weight: number}[]}
     */
    getExpandedIndices(regionIndices, minCount = 15, searchRadius = 0.12) {
        const result = regionIndices.map(i => ({ index: i, weight: 1.0 }));
        if (regionIndices.length >= minCount) return result;
        if (regionIndices.length === 0) return result;

        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const radius = sf * searchRadius;
        const radiusSq = radius * radius;

        // Compute center of the region
        let cx = 0, cy = 0, cz = 0;
        for (const i of regionIndices) {
            cx += positions.getX(i);
            cy += positions.getY(i);
            cz += positions.getZ(i);
        }
        cx /= regionIndices.length;
        cy /= regionIndices.length;
        cz /= regionIndices.length;

        const regionSet = new Set(regionIndices);

        // Search all face vertices for nearby ones
        const allFaceIndices = [
            ...(this.regions.mouth || []), ...(this.regions.upperLip || []),
            ...(this.regions.lowerLip || []), ...(this.regions.jaw || []),
            ...(this.regions.nose || []), ...(this.regions.cheekLeft || []),
            ...(this.regions.cheekRight || []), ...(this.regions.eyeLeft || []),
            ...(this.regions.eyeRight || []), ...(this.regions.forehead || [])
        ];

        for (const i of allFaceIndices) {
            if (regionSet.has(i)) continue;
            const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
            const dx = x - cx, dy = y - cy, dz = z - cz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < radiusSq) {
                const dist = Math.sqrt(distSq);
                const t = 1.0 - (dist / radius);
                // Cubic ease-out for smooth falloff (avoids hard boundary)
                const smooth = 1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t);
                if (smooth > 0.08) {
                    result.push({ index: i, weight: smooth * 0.6 });
                }
            }
        }

        return result;
    }

    enableMorphOnMaterial(mesh) {
        // Three.js r160+ automatically enables morph targets in shaders when
        // geometry has morphAttributes. Just trigger shader recompile.
        const updateMaterial = (mat) => {
            mat.morphTargets = true;
            mat.morphNormals = true;
            mat.needsUpdate = true;
        };

        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(updateMaterial);
        } else if (mesh.material) {
            updateMaterial(mesh.material);
        }
    }

    /**
     * Generate ARKit-compatible blendshapes with professional deformation magnitudes.
     */
    generateARKitBlendshapes(geometry, landmarks, regions) {
        const shapes = {};
        const vertexCount = this.basePositions.count;

        const shapeDefinitions = {
            // Jaw - uses rotational displacement with large angle
            jawOpen: () => this.createJawOpen(regions, 0.85), // strong visible drop (~15% face height)
            jawForward: () => this.createJawForward(regions, 0.12),
            jawLeft: () => this.createJawSlide(regions, 'left', 0.08),
            jawRight: () => this.createJawSlide(regions, 'right', 0.08),

            // Mouth - strong visible deformations
            mouthOpen: () => this.createJawOpen(regions, 0.65), // medium jaw drop (~12% face height)
            mouthClose: () => this.createMouthClose(regions),
            mouthSmileLeft: () => this.createSmile(regions, 'left'),
            mouthSmileRight: () => this.createSmile(regions, 'right'),
            mouthFrownLeft: () => this.createFrown(regions, 'left'),
            mouthFrownRight: () => this.createFrown(regions, 'right'),
            mouthPucker: () => this.createPucker(regions),
            mouthFunnel: () => this.createFunnel(regions),
            mouthStretchLeft: () => this.createStretch(regions, 'left'),
            mouthStretchRight: () => this.createStretch(regions, 'right'),
            mouthRollUpper: () => this.createLipRoll(regions, 'upper'),
            mouthRollLower: () => this.createLipRoll(regions, 'lower'),
            mouthShrugUpper: () => this.createLipShrug(regions, 'upper'),
            mouthShrugLower: () => this.createLipShrug(regions, 'lower'),
            mouthPressLeft: () => this.createLipPress(regions, 'left'),
            mouthPressRight: () => this.createLipPress(regions, 'right'),
            mouthUpperUpLeft: () => this.createUpperLipUp(regions, 'left'),
            mouthUpperUpRight: () => this.createUpperLipUp(regions, 'right'),
            mouthLowerDownLeft: () => this.createLowerLipDown(regions, 'left'),
            mouthLowerDownRight: () => this.createLowerLipDown(regions, 'right'),
            mouthDimpleLeft: () => this.createDimple(regions, 'left'),
            mouthDimpleRight: () => this.createDimple(regions, 'right'),
            mouthLeft: () => this.createMouthSlide(regions, 'left'),
            mouthRight: () => this.createMouthSlide(regions, 'right'),

            // Eyes - proportional to eye height
            eyeBlinkLeft: () => this.createBlink(regions, 'left'),
            eyeBlinkRight: () => this.createBlink(regions, 'right'),
            eyeWideLeft: () => this.createEyeWide(regions, 'left'),
            eyeWideRight: () => this.createEyeWide(regions, 'right'),
            eyeSquintLeft: () => this.createEyeSquint(regions, 'left'),
            eyeSquintRight: () => this.createEyeSquint(regions, 'right'),
            eyeLookUpLeft: () => this.createEyeLook(regions, 'left', 'up'),
            eyeLookUpRight: () => this.createEyeLook(regions, 'right', 'up'),
            eyeLookDownLeft: () => this.createEyeLook(regions, 'left', 'down'),
            eyeLookDownRight: () => this.createEyeLook(regions, 'right', 'down'),
            eyeLookInLeft: () => this.createEyeLook(regions, 'left', 'in'),
            eyeLookInRight: () => this.createEyeLook(regions, 'right', 'in'),
            eyeLookOutLeft: () => this.createEyeLook(regions, 'left', 'out'),
            eyeLookOutRight: () => this.createEyeLook(regions, 'right', 'out'),

            // Brow
            browDownLeft: () => this.createBrowMovement(regions, 'left', -1),
            browDownRight: () => this.createBrowMovement(regions, 'right', -1),
            browInnerUp: () => this.createBrowInnerUp(regions),
            browOuterUpLeft: () => this.createBrowOuterUp(regions, 'left'),
            browOuterUpRight: () => this.createBrowOuterUp(regions, 'right'),

            // Cheek
            cheekPuff: () => this.createCheekPuff(regions),
            cheekSquintLeft: () => this.createCheekSquint(regions, 'left'),
            cheekSquintRight: () => this.createCheekSquint(regions, 'right'),

            // Nose
            noseSneerLeft: () => this.createNoseSneer(regions, 'left'),
            noseSneerRight: () => this.createNoseSneer(regions, 'right'),

            // Tongue
            tongueOut: () => this.createTongueOut(regions)
        };

        for (const [name, generator] of Object.entries(shapeDefinitions)) {
            const displacement = generator();
            if (displacement && displacement.size > 0) {
                shapes[name] = this.createMorphTarget(vertexCount, displacement);
            }
        }

        return shapes;
    }

    generateVisemes(geometry, landmarks, regions) {
        const visemes = {};
        const vertexCount = this.basePositions.count;

        const visemeDefinitions = {
            viseme_sil: () => new Map(),
            viseme_PP: () => this.createVisemeClosed(regions),
            viseme_FF: () => this.createVisemeFF(regions),
            viseme_TH: () => this.createVisemeTH(regions),
            viseme_DD: () => this.createVisemeDD(regions),
            viseme_kk: () => this.createVisemeKK(regions),
            viseme_CH: () => this.createVisemeCH(regions),
            viseme_SS: () => this.createVisemeSS(regions),
            viseme_nn: () => this.createVisemeNN(regions),
            viseme_RR: () => this.createVisemeRR(regions),
            viseme_aa: () => this.createVisemeAA(regions),
            viseme_E: () => this.createVisemeE(regions),
            viseme_I: () => this.createVisemeI(regions),
            viseme_O: () => this.createVisemeO(regions),
            viseme_U: () => this.createVisemeU(regions),
        };

        for (const [name, generator] of Object.entries(visemeDefinitions)) {
            const displacement = generator();
            visemes[name] = this.createMorphTarget(vertexCount, displacement || new Map());
        }

        return visemes;
    }

    // ========================================================================
    // JAW & MOUTH
    // ========================================================================

    /**
     * Professional jaw open using translation-based displacement.
     * Moves lower face vertices DOWNWARD with weight proportional to
     * distance below the mouth seam line.
     * angle: controls magnitude (0.85 = full open, ~15% of face height drop)
     */
    createJawOpen(regions, angle) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const vertexCount = positions.count;

        // The lip seam line is where upper and lower lip MEET
        // (NOT mouthCenter.y which is the geometric center of the whole mouth region)
        // Use the boundary between upperLip and lowerLip regions
        const upperLipIndices = regions.upperLip || [];
        const lowerLipIndices = regions.lowerLip || [];

        let lipSeamY;
        if (upperLipIndices.length > 5 && lowerLipIndices.length > 5) {
            // Lip seam = midpoint between min of upperLip and max of lowerLip
            let upperLipMinY = Infinity;
            for (const i of upperLipIndices) {
                const y = positions.getY(i);
                if (y < upperLipMinY) upperLipMinY = y;
            }
            let lowerLipMaxY = -Infinity;
            for (const i of lowerLipIndices) {
                const y = positions.getY(i);
                if (y > lowerLipMaxY) lowerLipMaxY = y;
            }
            lipSeamY = (upperLipMinY + lowerLipMaxY) / 2;
        } else if ((regions.mouth || []).length > 5) {
            // Mouth region exists but no proper upper/lower lip split
            // Use the center of the mouth region as seam
            const mouthIndices = regions.mouth;
            let mouthMinY = Infinity, mouthMaxY = -Infinity;
            for (const i of mouthIndices) {
                const y = positions.getY(i);
                if (y < mouthMinY) mouthMinY = y;
                if (y > mouthMaxY) mouthMaxY = y;
            }
            // Place seam at 55% from bottom (slightly above center to get more lower lip)
            lipSeamY = mouthMinY + (mouthMaxY - mouthMinY) * 0.55;
        } else {
            // Fallback: estimate from nose and jaw reference points
            // The lip seam is roughly 30% of the way from nose to jaw bottom
            const noseIndices = regions.nose || [];
            const jawIndices = regions.jaw || [];
            if (noseIndices.length > 0 && jawIndices.length > 0) {
                const noseBottomY = this.getMinY(positions, noseIndices);
                const jawBottomY = this.getMinY(positions, jawIndices);
                lipSeamY = noseBottomY - (noseBottomY - jawBottomY) * 0.3;
            } else {
                lipSeamY = this.mouthCenter.y + sf * 0.01;
            }
        }

        // Find face bounds
        const allFaceIndices = [
            ...(regions.forehead || []),
            ...(regions.eyeLeft || []),
            ...(regions.eyeRight || []),
            ...(regions.nose || []),
            ...(regions.mouth || []),
            ...(regions.jaw || []),
            ...(regions.upperLip || []),
            ...(regions.lowerLip || []),
            ...(regions.cheekLeft || []),
            ...(regions.cheekRight || [])
        ];

        let faceMinY = Infinity, faceMaxZ = -Infinity, faceMinZ = Infinity;
        for (const i of allFaceIndices) {
            const y = positions.getY(i);
            const z = positions.getZ(i);
            if (y < faceMinY) faceMinY = y;
            if (z > faceMaxZ) faceMaxZ = z;
            if (z < faceMinZ) faceMinZ = z;
        }

        if (this.manualJawBottom !== null && this.manualJawBottom !== undefined) {
            faceMinY = this.manualJawBottom;
        }

        const jawLength = lipSeamY - faceMinY;
        if (jawLength < 0.001) return displacements;

        // Z threshold: only affect front-facing vertices
        // For flat-faced characters (box mesh), faceDepth is very small - skip Z filter
        const faceDepth = faceMaxZ - faceMinZ;
        const isFlatFace = faceDepth < sf * 0.1;
        const zAdjust = this.zThresholdOffset ? this.zThresholdOffset * faceDepth * 0.3 : 0;
        const zThreshold = isFlatFace ? -Infinity : (faceMinZ + faceDepth * 0.3 + zAdjust);

        // Maximum displacement
        const maxDrop = sf * 0.18 * angle * this.intensity;
        const maxBack = -sf * 0.03 * angle * this.intensity;

        // Neck fade
        const neckFadeRange = sf * 0.08;

        // Upper face: never moves with jaw (handled separately at end)
        const upperFaceSet = new Set([
            ...(regions.forehead || []),
            ...(regions.eyeLeft || []),
            ...(regions.eyeRight || []),
            ...(regions.nose || []),
            ...upperLipIndices
        ]);

        // Lower lip set: these get strong immediate movement
        const lowerLipSet = new Set(lowerLipIndices);

        // Iterate all vertices spatially
        for (let i = 0; i < vertexCount; i++) {
            if (upperFaceSet.has(i)) continue;

            const y = positions.getY(i);
            const z = positions.getZ(i);

            // Skip vertices well above the lip seam (upper face)
            if (y > lipSeamY + sf * 0.01 && !lowerLipSet.has(i)) continue;

            // Skip back-of-head vertices
            if (z < zThreshold) continue;

            let weight;

            if (lowerLipSet.has(i)) {
                // Lower lip: strong opening weight (0.5-0.7 depending on distance from seam)
                const distFromSeam = lipSeamY - y;
                const lipHeight = lipSeamY - this.getMinY(positions, lowerLipIndices);
                const lipFrac = lipHeight > 0.001 ? distFromSeam / lipHeight : 0.5;
                weight = 0.5 + lipFrac * 0.3; // 0.5 at lip seam, 0.8 at bottom of lower lip
            } else if (y < lipSeamY) {
                // Below lip seam (jaw/chin area): ramp from 0.7 to 1.0
                const distBelowSeam = lipSeamY - y;
                const frac = Math.min(1.0, distBelowSeam / (jawLength * 0.6));
                weight = 0.7 + frac * 0.3; // 0.7 near seam, 1.0 at chin
            } else {
                // Slightly above seam (lip border): tiny weight for smooth transition
                const distAboveSeam = y - lipSeamY;
                weight = Math.max(0, 0.3 - distAboveSeam / (sf * 0.02));
                if (weight < 0.01) continue;
            }

            // Neck fade: vertices below face bottom get reduced
            if (y < faceMinY) {
                const neckDist = faceMinY - y;
                weight *= Math.max(0, 1 - neckDist / neckFadeRange);
            }

            if (weight < 0.01) continue;

            displacements.set(i, {
                x: 0,
                y: -maxDrop * weight,
                z: maxBack * weight
            });
        }

        // Upper lip: push UP to enhance the opening appearance
        for (const i of upperLipIndices) {
            const z = positions.getZ(i);
            if (z < zThreshold) continue;
            displacements.set(i, {
                x: 0,
                y: sf * 0.03 * angle * this.intensity,
                z: sf * 0.02 * angle * this.intensity
            });
        }

        // Lip corners: pull slightly inward/down for realism
        const mouthIndices = regions.mouth || [];
        if (mouthIndices.length > 0) {
            const mouthMinX = this.getMinX(positions, mouthIndices);
            const mouthMaxX = this.getMaxX(positions, mouthIndices);
            const mouthWidth = mouthMaxX - mouthMinX;
            const cornerThreshold = mouthWidth * 0.35;

            for (const i of mouthIndices) {
                const x = positions.getX(i);
                const z = positions.getZ(i);
                if (z < zThreshold) continue;
                const xDist = Math.min(
                    Math.abs(x - mouthMinX),
                    Math.abs(x - mouthMaxX)
                );
                if (xDist < cornerThreshold) {
                    const cornerWeight = 1 - xDist / cornerThreshold;
                    const existing = displacements.get(i) || { x: 0, y: 0, z: 0 };
                    // Pull corners inward and slightly down
                    const inwardDir = x < this.mouthCenter.x ? 1 : -1;
                    displacements.set(i, {
                        x: existing.x + inwardDir * sf * 0.01 * angle * cornerWeight * this.intensity,
                        y: existing.y - sf * 0.01 * angle * cornerWeight * this.intensity,
                        z: existing.z
                    });
                }
            }
        }

        return displacements;
    }

    createJawForward(regions, amount) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const vertexCount = positions.count;
        const seamY = this.mouthCenter.y;
        const zThreshold = this.mouthCenter.z - sf * 0.3;

        for (let i = 0; i < vertexCount; i++) {
            const y = positions.getY(i);
            const z = positions.getZ(i);
            if (y >= seamY || z < zThreshold) continue;

            const distBelow = seamY - y;
            const weight = Math.min(1, distBelow / (sf * 0.2));
            if (weight < 0.01) continue;

            displacements.set(i, {
                x: 0,
                y: 0,
                z: sf * amount * weight * this.intensity
            });
        }

        return displacements;
    }

    createJawSlide(regions, side, amount) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const vertexCount = positions.count;
        const seamY = this.mouthCenter.y;
        const zThreshold = this.mouthCenter.z - sf * 0.3;
        const dir = side === 'left' ? 1 : -1;

        for (let i = 0; i < vertexCount; i++) {
            const y = positions.getY(i);
            const z = positions.getZ(i);
            if (y >= seamY || z < zThreshold) continue;

            const distBelow = seamY - y;
            const weight = Math.min(1, distBelow / (sf * 0.2));
            if (weight < 0.01) continue;

            displacements.set(i, {
                x: sf * amount * dir * weight * this.intensity,
                y: 0,
                z: 0
            });
        }

        return displacements;
    }

    createMouthClose(regions) {
        const displacements = new Map();
        const sf = this.scaleFactor;

        const upperExp = this.getExpandedIndices(regions.upperLip || [], 6, 0.08);
        const lowerExp = this.getExpandedIndices(regions.lowerLip || [], 6, 0.08);

        for (const { index: i, weight: w } of upperExp) {
            displacements.set(i, { x: 0, y: -sf * 0.015 * w * this.intensity, z: sf * 0.005 * w * this.intensity });
        }
        for (const { index: i, weight: w } of lowerExp) {
            displacements.set(i, { x: 0, y: sf * 0.015 * w * this.intensity, z: sf * 0.005 * w * this.intensity });
        }
        return displacements;
    }

    createSmile(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const dir = side === 'left' ? 1 : -1;
        const rawMouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawMouthIndices, 15, 0.15);
        const centerX = this.mouthCenter.x;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * regionW;

            if (influence > 0.05) {
                displacements.set(i, {
                    x: dir * sf * 0.06 * influence * this.intensity,
                    y: sf * 0.05 * influence * this.intensity,
                    z: sf * 0.01 * influence * this.intensity
                });
            }
        }

        // Cheeks rise on smile side
        const cheekRaw = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        const cheekExpanded = this.getExpandedIndices(cheekRaw, 8, 0.12);
        for (const { index: i, weight: w } of cheekExpanded) {
            displacements.set(i, {
                x: dir * sf * 0.02 * w * this.intensity,
                y: sf * 0.04 * w * this.intensity,
                z: sf * 0.02 * w * this.intensity
            });
        }

        return displacements;
    }

    createFrown(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const dir = side === 'left' ? 1 : -1;
        const rawIndices = [...(regions.mouth || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawIndices, 12, 0.12);
        const centerX = this.mouthCenter.x;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * regionW;

            if (influence > 0.05) {
                displacements.set(i, {
                    x: dir * sf * 0.03 * influence * this.intensity,
                    y: -sf * 0.06 * influence * this.intensity,
                    z: 0
                });
            }
        }

        return displacements;
    }

    createPucker(regions) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawIndices, 15, 0.12);
        const cx = this.mouthCenter.x;
        const cy = this.mouthCenter.y;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dx = x - cx;
            const dy = y - cy;

            displacements.set(i, {
                x: -dx * 0.5 * regionW * this.intensity,
                y: -dy * 0.4 * regionW * this.intensity,
                z: sf * 0.06 * regionW * this.intensity
            });
        }

        return displacements;
    }

    createFunnel(regions) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawIndices, 15, 0.12);
        const cx = this.mouthCenter.x;
        const cy = this.mouthCenter.y;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) / (this.mouthWidth * 0.5 + 0.001);

            displacements.set(i, {
                x: -dx * 0.3 * regionW * this.intensity,
                y: -dy * 0.25 * regionW * this.intensity,
                z: sf * 0.04 * (1.2 - dist) * regionW * this.intensity
            });
        }

        return displacements;
    }

    createStretch(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const dir = side === 'left' ? 1 : -1;
        const rawIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawIndices, 12, 0.12);
        const centerX = this.mouthCenter.x;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * regionW;

            if (influence > 0.05) {
                displacements.set(i, {
                    x: dir * sf * 0.08 * influence * this.intensity,
                    y: 0,
                    z: -sf * 0.01 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    createLipRoll(regions, part) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const rawIndices = part === 'upper' ? (regions.upperLip || []) : (regions.lowerLip || []);
        const expanded = this.getExpandedIndices(rawIndices, 8, 0.08);
        const dir = part === 'upper' ? -1 : 1;

        for (const { index: i, weight: w } of expanded) {
            displacements.set(i, {
                x: 0,
                y: dir * sf * 0.02 * w * this.intensity,
                z: -sf * 0.03 * w * this.intensity
            });
        }

        return displacements;
    }

    createLipShrug(regions, part) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const rawIndices = part === 'upper' ? (regions.upperLip || []) : (regions.lowerLip || []);
        const expanded = this.getExpandedIndices(rawIndices, 8, 0.08);
        const dir = part === 'upper' ? 1 : -1;

        for (const { index: i, weight: w } of expanded) {
            displacements.set(i, {
                x: 0,
                y: dir * sf * 0.025 * w * this.intensity,
                z: sf * 0.01 * w * this.intensity
            });
        }

        return displacements;
    }

    createLipPress(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawIndices = [...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawIndices, 10, 0.10);
        const centerX = this.mouthCenter.x;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * regionW;

            if (influence > 0.05) {
                displacements.set(i, {
                    x: 0,
                    y: 0,
                    z: -sf * 0.02 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    createUpperLipUp(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawIndices = regions.upperLip || [];
        const expanded = this.getExpandedIndices(rawIndices, 8, 0.08);
        const centerX = this.mouthCenter.x;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, 0.5 + (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, 0.5 + (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * regionW;

            displacements.set(i, {
                x: 0,
                y: sf * 0.035 * influence * this.intensity,
                z: sf * 0.01 * influence * this.intensity
            });
        }

        return displacements;
    }

    createLowerLipDown(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawIndices = regions.lowerLip || [];
        const expanded = this.getExpandedIndices(rawIndices, 8, 0.08);
        const centerX = this.mouthCenter.x;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, 0.5 + (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, 0.5 + (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * regionW;

            displacements.set(i, {
                x: 0,
                y: -sf * 0.035 * influence * this.intensity,
                z: sf * 0.01 * influence * this.intensity
            });
        }

        return displacements;
    }

    /**
     * Mouth dimple: pulls corner inward creating a dimple.
     */
    createDimple(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawIndices, 12, 0.12);
        const centerX = this.mouthCenter.x;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));

            if (sideWeight < 0.4) continue;

            const influence = Math.min(1, (sideWeight - 0.4) / 0.6) * regionW;
            const pullDir = side === 'left' ? -1 : 1;

            displacements.set(i, {
                x: pullDir * sf * 0.02 * influence * this.intensity,
                y: 0,
                z: -sf * 0.025 * influence * this.intensity
            });
        }

        return displacements;
    }

    /**
     * Mouth slide: entire mouth area moves left or right.
     */
    createMouthSlide(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const expanded = this.getExpandedIndices(rawIndices, 12, 0.12);
        const dir = side === 'left' ? 1 : -1;

        for (const { index: i, weight: w } of expanded) {
            displacements.set(i, {
                x: dir * sf * 0.04 * w * this.intensity,
                y: 0,
                z: 0
            });
        }

        // Also slightly move nearby cheek/jaw vertices
        const jawIndices = regions.jaw || [];
        for (const i of jawIndices) {
            const y = positions.getY(i);
            if (y > this.mouthCenter.y - sf * 0.08) {
                const weight = Math.max(0, 1 - (this.mouthCenter.y - y) / (sf * 0.08));
                displacements.set(i, {
                    x: dir * sf * 0.02 * weight * this.intensity,
                    y: 0,
                    z: 0
                });
            }
        }

        return displacements;
    }

    // ========================================================================
    // EYES
    // ========================================================================

    createBlink(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawEyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        if (rawEyeIndices.length === 0) return displacements;

        // Use raw indices for metrics, expanded for displacement
        const centerY = this.getMidY(positions, rawEyeIndices);
        const centerX = this.getMidX(positions, rawEyeIndices);

        let minY = Infinity, maxY = -Infinity;
        for (const i of rawEyeIndices) {
            const y = positions.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const eyeHeight = maxY - minY;
        if (eyeHeight < 0.001) return displacements;

        const expanded = this.getExpandedIndices(rawEyeIndices, 10, 0.10);

        for (const { index: i, weight: regionW } of expanded) {
            const y = positions.getY(i);
            const relY = (y - centerY) / (eyeHeight * 0.5);

            if (relY > 0) {
                displacements.set(i, {
                    x: 0,
                    y: -relY * eyeHeight * 0.48 * regionW * this.intensity,
                    z: 0.005 * sf * relY * regionW * this.intensity
                });
            } else {
                displacements.set(i, {
                    x: 0,
                    y: -relY * eyeHeight * 0.12 * regionW * this.intensity,
                    z: 0.003 * sf * (-relY) * regionW * this.intensity
                });
            }
        }

        // Slight upper cheek push (skin squishes when eyes close)
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        for (const i of cheekIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            // Only affect cheek vertices near the eye (upper cheek area)
            if (y < centerY - eyeHeight) continue;
            const distFromEye = Math.sqrt(
                (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY)
            );
            const maxDist = eyeHeight * 2.5;
            if (distFromEye > maxDist) continue;

            const falloff = 1 - distFromEye / maxDist;
            displacements.set(i, {
                x: 0,
                y: sf * 0.008 * falloff * this.intensity,
                z: sf * 0.005 * falloff * this.intensity
            });
        }

        return displacements;
    }

    createEyeWide(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawEyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        if (rawEyeIndices.length === 0) return displacements;

        const centerY = this.getMidY(positions, rawEyeIndices);
        const expanded = this.getExpandedIndices(rawEyeIndices, 8, 0.10);

        for (const { index: i, weight: w } of expanded) {
            const y = positions.getY(i);
            const above = y > centerY;

            displacements.set(i, {
                x: 0,
                y: (above ? sf * 0.03 : -sf * 0.015) * w * this.intensity,
                z: 0
            });
        }

        return displacements;
    }

    createEyeSquint(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawEyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        const cheekRaw = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        if (rawEyeIndices.length === 0) return displacements;

        const centerY = this.getMidY(positions, rawEyeIndices);
        const centerX = this.getMidX(positions, rawEyeIndices);
        const expanded = this.getExpandedIndices(rawEyeIndices, 8, 0.10);

        for (const { index: i, weight: w } of expanded) {
            const y = positions.getY(i);
            const above = y > centerY;

            displacements.set(i, {
                x: 0,
                y: (above ? -sf * 0.02 : sf * 0.015) * w * this.intensity,
                z: sf * 0.008 * w * this.intensity
            });
        }

        // Push upper cheek up with distance-based falloff from eye center
        const cheekExpanded = this.getExpandedIndices(cheekRaw, 6, 0.10);
        for (const { index: i, weight: w } of cheekExpanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dist = Math.sqrt(
                (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY)
            );
            const maxDist = sf * 0.2;
            if (dist > maxDist) continue;

            const falloff = (1 - dist / maxDist) * w;
            displacements.set(i, {
                x: 0,
                y: sf * 0.025 * falloff * this.intensity,
                z: sf * 0.012 * falloff * this.intensity
            });
        }

        return displacements;
    }

    createEyeLook(regions, side, direction) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const rawEyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        const expanded = this.getExpandedIndices(rawEyeIndices, 8, 0.08);

        let dx = 0, dy = 0;
        switch (direction) {
            case 'up': dy = sf * 0.012; break;
            case 'down': dy = -sf * 0.012; break;
            case 'in': dx = (side === 'left' ? -1 : 1) * sf * 0.008; break;
            case 'out': dx = (side === 'left' ? 1 : -1) * sf * 0.008; break;
        }

        for (const { index: i, weight: w } of expanded) {
            displacements.set(i, {
                x: dx * w * this.intensity,
                y: dy * w * this.intensity,
                z: 0
            });
        }

        return displacements;
    }

    // ========================================================================
    // BROWS
    // ========================================================================

    createBrowMovement(regions, side, direction) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawForehead = regions.forehead || [];
        if (rawForehead.length === 0) return displacements;

        const centerX = this.getMidX(positions, rawForehead);
        const minY = this.getMinY(positions, rawForehead);
        const maxY = this.getMaxY(positions, rawForehead);
        const browHeight = maxY - minY;

        const expanded = this.getExpandedIndices(rawForehead, 10, 0.10);
        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            // Side influence
            const sideWeight = side === 'left'
                ? Math.max(0, 0.3 + (x - centerX) / (this.mouthWidth + 0.001))
                : Math.max(0, 0.3 + (centerX - x) / (this.mouthWidth + 0.001));

            // Height influence - brow is at bottom of forehead region
            const heightWeight = Math.max(0, 1 - (y - minY) / (browHeight * 0.5 + 0.001));

            const influence = Math.min(1, sideWeight) * Math.min(1, heightWeight) * regionW;

            if (influence > 0.1) {
                const zDisp = direction < 0
                    ? sf * 0.015 * influence * this.intensity
                    : -sf * 0.005 * influence * this.intensity;

                displacements.set(i, {
                    x: 0,
                    y: direction * sf * 0.04 * influence * this.intensity,
                    z: zDisp
                });
            }
        }

        return displacements;
    }

    createBrowInnerUp(regions) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawForehead = regions.forehead || [];
        if (rawForehead.length === 0) return displacements;

        const centerX = this.getMidX(positions, rawForehead);
        const minY = this.getMinY(positions, rawForehead);
        const maxY = this.getMaxY(positions, rawForehead);
        const browHeight = maxY - minY;

        const expanded = this.getExpandedIndices(rawForehead, 10, 0.10);
        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const centerWeight = Math.max(0, 1 - Math.abs(x - centerX) / (this.mouthWidth * 0.4 + 0.001));
            const heightWeight = Math.max(0, 1 - (y - minY) / (browHeight * 0.4 + 0.001));
            const influence = centerWeight * heightWeight * regionW;

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.05 * influence * this.intensity,
                    z: -sf * 0.005 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    createBrowOuterUp(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawForehead = regions.forehead || [];
        if (rawForehead.length === 0) return displacements;

        const centerX = this.getMidX(positions, rawForehead);
        const minY = this.getMinY(positions, rawForehead);
        const maxY = this.getMaxY(positions, rawForehead);
        const browHeight = maxY - minY;

        const expanded = this.getExpandedIndices(rawForehead, 10, 0.10);
        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const dist = Math.abs(x - centerX);
            const outerWeight = side === 'left'
                ? (x > centerX ? Math.min(1, dist / (this.mouthWidth * 0.5 + 0.001)) : 0)
                : (x < centerX ? Math.min(1, dist / (this.mouthWidth * 0.5 + 0.001)) : 0);

            const heightWeight = Math.max(0, 1 - (y - minY) / (browHeight * 0.4 + 0.001));
            const influence = outerWeight * heightWeight * regionW;

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.05 * influence * this.intensity,
                    z: -sf * 0.005 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    // ========================================================================
    // CHEEKS & NOSE
    // ========================================================================

    createCheekPuff(regions) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawCheeks = [...(regions.cheekLeft || []), ...(regions.cheekRight || [])];
        const expanded = this.getExpandedIndices(rawCheeks, 12, 0.15);
        const centerX = this.mouthCenter.x;

        // Puff cheeks outward
        for (const { index: i, weight: w } of expanded) {
            const x = positions.getX(i);
            const dir = x > centerX ? 1 : -1;

            displacements.set(i, {
                x: dir * sf * 0.05 * w * this.intensity,
                y: 0,
                z: sf * 0.06 * w * this.intensity
            });
        }

        // Press lips together (mouth closes during puff)
        const upperLipIndices = regions.upperLip || [];
        for (const i of upperLipIndices) {
            displacements.set(i, {
                x: 0,
                y: -sf * 0.01 * this.intensity,
                z: sf * 0.008 * this.intensity
            });
        }
        const lowerLipIndices = regions.lowerLip || [];
        for (const i of lowerLipIndices) {
            displacements.set(i, {
                x: 0,
                y: sf * 0.01 * this.intensity,
                z: sf * 0.008 * this.intensity
            });
        }

        // Slightly push jaw area outward as well
        const jawIndices = regions.jaw || [];
        for (const i of jawIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            // Only upper jaw area
            if (y > this.mouthCenter.y - sf * 0.1) {
                const dir = x > centerX ? 1 : -1;
                const weight = Math.max(0, 1 - Math.abs(y - this.mouthCenter.y) / (sf * 0.1));
                displacements.set(i, {
                    x: dir * sf * 0.02 * weight * this.intensity,
                    y: 0,
                    z: sf * 0.03 * weight * this.intensity
                });
            }
        }

        return displacements;
    }

    createCheekSquint(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawCheek = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        const rawEye = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);

        let eyeCenterX, eyeCenterY;
        if (rawEye.length > 0) {
            eyeCenterX = this.getMidX(positions, rawEye);
            eyeCenterY = this.getMidY(positions, rawEye);
        } else {
            eyeCenterX = this.mouthCenter.x;
            eyeCenterY = this.mouthCenter.y + sf * 0.15;
        }

        const cheekExpanded = this.getExpandedIndices(rawCheek, 8, 0.12);
        for (const { index: i, weight: w } of cheekExpanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const dist = Math.sqrt(
                (x - eyeCenterX) * (x - eyeCenterX) + (y - eyeCenterY) * (y - eyeCenterY)
            );
            const maxDist = sf * 0.25;
            const falloff = Math.max(0, 1 - dist / maxDist) * w;

            if (falloff > 0.05) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.035 * falloff * this.intensity,
                    z: sf * 0.02 * falloff * this.intensity
                });
            }
        }

        // Also slightly squint the lower eye vertices
        const eyeExpanded = this.getExpandedIndices(rawEye, 6, 0.08);
        for (const { index: i, weight: w } of eyeExpanded) {
            const y = positions.getY(i);
            if (y < eyeCenterY) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.01 * w * this.intensity,
                    z: sf * 0.005 * w * this.intensity
                });
            }
        }

        return displacements;
    }

    createNoseSneer(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawNose = regions.nose || [];
        const centerX = this.mouthCenter.x;
        const dir = side === 'left' ? 1 : -1;

        const noseExpanded = this.getExpandedIndices(rawNose, 8, 0.10);
        for (const { index: i, weight: regionW } of noseExpanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * regionW;

            if (influence > 0.1) {
                const lowerWeight = Math.max(0, (this.mouthCenter.y - y) / (sf * 0.1 + 0.001));
                const nostrilFlare = Math.min(1, lowerWeight) * 0.6 + 0.4;

                displacements.set(i, {
                    x: dir * sf * 0.02 * influence * nostrilFlare * this.intensity,
                    y: sf * 0.03 * influence * this.intensity,
                    z: sf * 0.015 * influence * this.intensity
                });
            }
        }

        // Nasolabial fold: raise the cheek area between nose and mouth corner
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        for (const i of cheekIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            // Only affect vertices near the nose-to-mouth-corner line
            const distFromCenter = Math.abs(x - centerX);
            if (distFromCenter > this.mouthWidth * 0.6) continue;
            if (y < this.mouthCenter.y - sf * 0.05) continue; // below mouth

            const proximity = 1 - distFromCenter / (this.mouthWidth * 0.6);
            const vertWeight = Math.max(0, 1 - Math.abs(y - this.mouthCenter.y) / (sf * 0.12));
            const influence = proximity * vertWeight;

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.02 * influence * this.intensity,
                    z: sf * 0.012 * influence * this.intensity
                });
            }
        }

        // Upper lip: slight raise on the sneer side
        const upperLipIndices = regions.upperLip || [];
        for (const i of upperLipIndices) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight) * 0.5;

            if (influence > 0.05) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.015 * influence * this.intensity,
                    z: sf * 0.005 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    createTongueOut(regions) {
        // Tongue protrusion: jaw opens, lower lip pushes down, center pushes forward
        const displacements = this.createJawOpen(regions, 0.12);
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const rawMouth = [...(regions.lowerLip || []), ...(regions.mouth || [])];
        const expanded = this.getExpandedIndices(rawMouth, 10, 0.10);
        const cx = this.mouthCenter.x;
        const cy = this.mouthCenter.y;

        for (const { index: i, weight: regionW } of expanded) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const distX = Math.abs(x - cx);
            const halfWidth = this.mouthWidth * 0.35 + 0.001;

            // Center weight: strongest at center, fades at edges
            const centerWeight = Math.max(0, 1 - distX / halfWidth);
            // Below mouth center: tongue pushes here
            const belowWeight = y < cy ? Math.min(1, (cy - y) / (sf * 0.06 + 0.001)) : 0;
            const influence = centerWeight * (0.4 + belowWeight * 0.6) * regionW;

            if (influence > 0.1) {
                const existing = displacements.get(i) || { x: 0, y: 0, z: 0 };
                displacements.set(i, {
                    x: existing.x,
                    y: existing.y - sf * 0.03 * influence * this.intensity,
                    z: existing.z + sf * 0.10 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    // ========================================================================
    // VISEMES
    // ========================================================================

    createVisemeClosed(regions) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const upperExp = this.getExpandedIndices(regions.upperLip || [], 6, 0.08);
        const lowerExp = this.getExpandedIndices(regions.lowerLip || [], 6, 0.08);

        for (const { index: i, weight: w } of upperExp) {
            displacements.set(i, { x: 0, y: -sf * 0.008 * w * this.intensity, z: sf * 0.01 * w * this.intensity });
        }
        for (const { index: i, weight: w } of lowerExp) {
            displacements.set(i, { x: 0, y: sf * 0.008 * w * this.intensity, z: sf * 0.01 * w * this.intensity });
        }

        return displacements;
    }

    createVisemeFF(regions) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const lowerExp = this.getExpandedIndices(regions.lowerLip || [], 6, 0.08);

        for (const { index: i, weight: w } of lowerExp) {
            displacements.set(i, {
                x: 0,
                y: sf * 0.015 * w * this.intensity,
                z: -sf * 0.02 * w * this.intensity
            });
        }

        return displacements;
    }

    createVisemeTH(regions) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const upperExp = this.getExpandedIndices(regions.upperLip || [], 6, 0.08);
        const lowerExp = this.getExpandedIndices(regions.lowerLip || [], 6, 0.08);

        for (const { index: i, weight: w } of upperExp) {
            displacements.set(i, { x: 0, y: sf * 0.012 * w * this.intensity, z: 0 });
        }
        for (const { index: i, weight: w } of lowerExp) {
            displacements.set(i, { x: 0, y: -sf * 0.015 * w * this.intensity, z: sf * 0.01 * w * this.intensity });
        }

        return displacements;
    }

    createVisemeDD(regions) {
        // D/T: tongue behind upper teeth, slight jaw open + upper lip raises
        const open = this.createJawOpen(regions, 0.08);
        const sf = this.scaleFactor;
        const upperExp = this.getExpandedIndices(regions.upperLip || [], 6, 0.08);

        for (const { index: i, weight: w } of upperExp) {
            const e = open.get(i) || { x: 0, y: 0, z: 0 };
            open.set(i, {
                x: e.x,
                y: e.y + sf * 0.01 * w * this.intensity,
                z: e.z + sf * 0.005 * w * this.intensity
            });
        }
        return open;
    }

    createVisemeKK(regions) {
        // K/G: back tongue up, medium jaw open + slight stretch
        const open = this.createJawOpen(regions, 0.12);
        const stretchL = this.createStretch(regions, 'left');
        const stretchR = this.createStretch(regions, 'right');

        for (const map of [stretchL, stretchR]) {
            for (const [i, d] of map) {
                const e = open.get(i) || { x: 0, y: 0, z: 0 };
                open.set(i, { x: e.x + d.x * 0.2, y: e.y + d.y * 0.2, z: e.z + d.z * 0.2 });
            }
        }
        return open;
    }

    createVisemeNN(regions) {
        // N/M: nasal, lips barely separated + pressed together
        const closed = this.createVisemeClosed(regions);
        const open = this.createJawOpen(regions, 0.04);

        // Blend: mostly closed with tiny jaw open
        for (const [i, d] of open) {
            const e = closed.get(i) || { x: 0, y: 0, z: 0 };
            closed.set(i, { x: e.x + d.x * 0.4, y: e.y + d.y * 0.4, z: e.z + d.z * 0.4 });
        }
        return closed;
    }

    createVisemeAA(regions) {
        // AH: wide open, lips stretched slightly
        const open = this.createJawOpen(regions, 0.25);
        const stretchL = this.createStretch(regions, 'left');
        const stretchR = this.createStretch(regions, 'right');

        for (const map of [stretchL, stretchR]) {
            for (const [i, d] of map) {
                const e = open.get(i) || { x: 0, y: 0, z: 0 };
                open.set(i, { x: e.x + d.x * 0.3, y: e.y + d.y * 0.3, z: e.z + d.z * 0.3 });
            }
        }
        return open;
    }

    createVisemeCH(regions) {
        const pucker = this.createPucker(regions);
        const open = this.createJawOpen(regions, 0.06);

        // Merge: pucker * 0.5 + open
        const displacements = new Map(open);
        for (const [i, d] of pucker) {
            const existing = displacements.get(i) || { x: 0, y: 0, z: 0 };
            displacements.set(i, {
                x: existing.x + d.x * 0.5,
                y: existing.y + d.y * 0.5,
                z: existing.z + d.z * 0.5
            });
        }

        return displacements;
    }

    createVisemeSS(regions) {
        // S/Z: narrow opening, teeth close, lips stretched wide symmetrically
        const displacements = this.createJawOpen(regions, 0.04);
        const stretchL = this.createStretch(regions, 'left');
        const stretchR = this.createStretch(regions, 'right');

        for (const map of [stretchL, stretchR]) {
            for (const [i, d] of map) {
                const existing = displacements.get(i) || { x: 0, y: 0, z: 0 };
                displacements.set(i, {
                    x: existing.x + d.x * 0.4,
                    y: existing.y + d.y * 0.4,
                    z: existing.z + d.z * 0.4
                });
            }
        }

        return displacements;
    }

    createVisemeRR(regions) {
        const open = this.createJawOpen(regions, 0.08);
        const pucker = this.createPucker(regions);

        for (const [i, d] of pucker) {
            const existing = open.get(i) || { x: 0, y: 0, z: 0 };
            open.set(i, {
                x: existing.x + d.x * 0.4,
                y: existing.y + d.y * 0.4,
                z: existing.z + d.z * 0.4
            });
        }

        return open;
    }

    createVisemeE(regions) {
        const open = this.createJawOpen(regions, 0.10);
        const stretchL = this.createStretch(regions, 'left');
        const stretchR = this.createStretch(regions, 'right');

        for (const map of [stretchL, stretchR]) {
            for (const [i, d] of map) {
                const e = open.get(i) || { x: 0, y: 0, z: 0 };
                open.set(i, { x: e.x + d.x * 0.6, y: e.y + d.y * 0.6, z: e.z + d.z * 0.6 });
            }
        }

        return open;
    }

    createVisemeI(regions) {
        const open = this.createJawOpen(regions, 0.05);
        const stretchL = this.createStretch(regions, 'left');
        const stretchR = this.createStretch(regions, 'right');

        for (const map of [stretchL, stretchR]) {
            for (const [i, d] of map) {
                const e = open.get(i) || { x: 0, y: 0, z: 0 };
                open.set(i, { x: e.x + d.x * 0.7, y: e.y + d.y * 0.7, z: e.z + d.z * 0.7 });
            }
        }

        return open;
    }

    createVisemeO(regions) {
        const open = this.createJawOpen(regions, 0.18);
        const pucker = this.createPucker(regions);

        for (const [i, d] of pucker) {
            const e = open.get(i) || { x: 0, y: 0, z: 0 };
            open.set(i, { x: e.x + d.x * 0.7, y: e.y + d.y * 0.7, z: e.z + d.z * 0.7 });
        }

        return open;
    }

    createVisemeU(regions) {
        const open = this.createJawOpen(regions, 0.08);
        const pucker = this.createPucker(regions);

        for (const [i, d] of pucker) {
            const e = open.get(i) || { x: 0, y: 0, z: 0 };
            open.set(i, { x: e.x + d.x * 0.9, y: e.y + d.y * 0.9, z: e.z + d.z * 0.9 });
        }

        return open;
    }

    // ========================================================================
    // MORPH TARGET APPLICATION
    // ========================================================================

    createMorphTarget(vertexCount, displacements) {
        const positions = new Float32Array(vertexCount * 3);

        for (const [index, offset] of displacements) {
            positions[index * 3] = offset.x;
            positions[index * 3 + 1] = offset.y;
            positions[index * 3 + 2] = offset.z;
        }

        return positions;
    }

    async applyMorphTargets(geometry, onProgress = null) {
        const newGeometry = geometry.clone();
        newGeometry.morphAttributes.position = [];
        newGeometry.morphAttributes.normal = [];
        newGeometry.morphTargetsRelative = true;

        const dictionary = {};
        let index = 0;

        const allShapes = { ...this.blendshapes, ...this.visemes };
        const shapeEntries = Object.entries(allShapes);
        const totalShapes = shapeEntries.length;

        // Pre-build vertex→face lookup for efficient morph normal computation
        const vertexFaceMap = this.buildVertexFaceMap(newGeometry);

        for (let s = 0; s < shapeEntries.length; s++) {
            const [name, buffer] = shapeEntries[s];

            const posAttr = new THREE.Float32BufferAttribute(buffer, 3);
            posAttr.name = name;
            newGeometry.morphAttributes.position.push(posAttr);

            // Compute morph normals for correct lighting
            const normalBuffer = this.computeMorphNormals(newGeometry, buffer, vertexFaceMap);
            const normAttr = new THREE.Float32BufferAttribute(normalBuffer, 3);
            normAttr.name = name;
            newGeometry.morphAttributes.normal.push(normAttr);

            dictionary[name] = index++;

            // Yield every 5 shapes to allow UI repaint
            if (onProgress && s % 5 === 4) {
                const progress = 0.25 + (s / totalShapes) * 0.7;
                onProgress(progress, `Morph normals: ${s + 1}/${totalShapes}`);
                await new Promise(r => setTimeout(r, 0));
            }
        }

        this.mesh.geometry = newGeometry;
        this.mesh.morphTargetDictionary = dictionary;
        this.mesh.morphTargetInfluences = new Array(index).fill(0);
    }

    /**
     * Build a map from vertex index → list of face indices that contain it.
     * Built once and reused across all morph targets for O(affectedFaces) per target
     * instead of O(allFaces).
     */
    buildVertexFaceMap(geometry) {
        const indices = geometry.index ? geometry.index.array : null;
        const vertexCount = this.basePositions.count;
        const faceCount = indices ? indices.length / 3 : vertexCount / 3;

        const map = new Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) map[i] = [];

        for (let f = 0; f < faceCount; f++) {
            const a = indices ? indices[f * 3] : f * 3;
            const b = indices ? indices[f * 3 + 1] : f * 3 + 1;
            const c = indices ? indices[f * 3 + 2] : f * 3 + 2;
            map[a].push(f);
            map[b].push(f);
            map[c].push(f);
        }

        return map;
    }

    /**
     * Compute morph target normals (delta from base normals).
     * Uses vertex→face map to only process faces containing displaced vertices.
     * Performance: O(affectedFaces) instead of O(allFaces) per morph target.
     */
    computeMorphNormals(geometry, positionDeltas, vertexFaceMap) {
        const basePos = this.basePositions;
        const baseNormals = geometry.attributes.normal;
        const vertexCount = basePos.count;
        const normalDeltas = new Float32Array(vertexCount * 3);

        if (!baseNormals) return normalDeltas;

        const indices = geometry.index ? geometry.index.array : null;

        // Find displaced vertices
        const displacedVerts = [];
        for (let i = 0; i < vertexCount; i++) {
            const dx = positionDeltas[i * 3];
            const dy = positionDeltas[i * 3 + 1];
            const dz = positionDeltas[i * 3 + 2];
            if (dx * dx + dy * dy + dz * dz > 1e-8) {
                displacedVerts.push(i);
            }
        }

        if (displacedVerts.length === 0) return normalDeltas;

        const displacedSet = new Set(displacedVerts);

        // Collect unique affected faces using vertex→face map
        const affectedFaces = new Set();
        for (const vi of displacedVerts) {
            if (vertexFaceMap[vi]) {
                for (const f of vertexFaceMap[vi]) {
                    affectedFaces.add(f);
                }
            }
        }

        // Accumulate face normals for affected vertices
        const normAccum = new Float32Array(vertexCount * 3);
        const normCount = new Uint16Array(vertexCount);

        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const edge1 = new THREE.Vector3();
        const edge2 = new THREE.Vector3();
        const faceNormal = new THREE.Vector3();

        for (const f of affectedFaces) {
            const a = indices ? indices[f * 3] : f * 3;
            const b = indices ? indices[f * 3 + 1] : f * 3 + 1;
            const c = indices ? indices[f * 3 + 2] : f * 3 + 2;

            // Displaced positions
            vA.set(
                basePos.getX(a) + positionDeltas[a * 3],
                basePos.getY(a) + positionDeltas[a * 3 + 1],
                basePos.getZ(a) + positionDeltas[a * 3 + 2]
            );
            vB.set(
                basePos.getX(b) + positionDeltas[b * 3],
                basePos.getY(b) + positionDeltas[b * 3 + 1],
                basePos.getZ(b) + positionDeltas[b * 3 + 2]
            );
            vC.set(
                basePos.getX(c) + positionDeltas[c * 3],
                basePos.getY(c) + positionDeltas[c * 3 + 1],
                basePos.getZ(c) + positionDeltas[c * 3 + 2]
            );

            edge1.subVectors(vB, vA);
            edge2.subVectors(vC, vA);
            faceNormal.crossVectors(edge1, edge2);

            // Accumulate for displaced vertices in this face
            for (const vi of [a, b, c]) {
                if (displacedSet.has(vi)) {
                    normAccum[vi * 3] += faceNormal.x;
                    normAccum[vi * 3 + 1] += faceNormal.y;
                    normAccum[vi * 3 + 2] += faceNormal.z;
                    normCount[vi]++;
                }
            }
        }

        // Normalize and compute delta from base normals
        for (const vi of displacedVerts) {
            if (normCount[vi] === 0) continue;
            let nx = normAccum[vi * 3];
            let ny = normAccum[vi * 3 + 1];
            let nz = normAccum[vi * 3 + 2];
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 1e-6) {
                nx /= len;
                ny /= len;
                nz /= len;
            }

            // Delta = displaced normal - base normal
            normalDeltas[vi * 3] = nx - baseNormals.getX(vi);
            normalDeltas[vi * 3 + 1] = ny - baseNormals.getY(vi);
            normalDeltas[vi * 3 + 2] = nz - baseNormals.getZ(vi);
        }

        return normalDeltas;
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    getMidX(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let sum = 0;
        for (const i of indices) sum += positions.getX(i);
        return sum / indices.length;
    }

    getMidY(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let sum = 0;
        for (const i of indices) sum += positions.getY(i);
        return sum / indices.length;
    }

    getMidZ(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let sum = 0;
        for (const i of indices) sum += positions.getZ(i);
        return sum / indices.length;
    }

    getMinY(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let min = Infinity;
        for (const i of indices) {
            const y = positions.getY(i);
            if (y < min) min = y;
        }
        return min;
    }

    getMaxY(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let max = -Infinity;
        for (const i of indices) {
            const y = positions.getY(i);
            if (y > max) max = y;
        }
        return max;
    }

    getMinX(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let min = Infinity;
        for (const i of indices) {
            const x = positions.getX(i);
            if (x < min) min = x;
        }
        return min;
    }

    getMaxX(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let max = -Infinity;
        for (const i of indices) {
            const x = positions.getX(i);
            if (x > max) max = x;
        }
        return max;
    }

    // ========================================================================
    // MULTI-MESH BLENDSHAPES (Eyes, Nose)
    // ========================================================================

    /**
     * Generate blendshapes for auxiliary meshes (separate eye/nose meshes).
     * Creates ARKit-compatible morph targets on each auxiliary mesh.
     */
    generateAuxiliaryBlendshapes(auxiliaryMeshes, regions, intensity) {
        if (!auxiliaryMeshes) return;

        if (auxiliaryMeshes.eyeLeft) {
            this.generateEyeBlendshapes(auxiliaryMeshes.eyeLeft, 'left', intensity);
        }
        if (auxiliaryMeshes.eyeRight) {
            this.generateEyeBlendshapes(auxiliaryMeshes.eyeRight, 'right', intensity);
        }
        if (auxiliaryMeshes.nose) {
            this.generateNoseBlendshapes(auxiliaryMeshes.nose, intensity);
        }
    }

    /**
     * Generate eye blendshapes on a separate eye mesh.
     * Uses scale/translate to create blink, wide, squint, look directions.
     */
    generateEyeBlendshapes(eyeMesh, side, intensity) {
        const geometry = eyeMesh.geometry;
        const positions = geometry.attributes.position;
        const vertexCount = positions.count;

        // Compute eye center and extents
        const box = new THREE.Box3().setFromBufferAttribute(positions);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const eyeHeight = size.y;
        const eyeWidth = size.x;

        const shapes = {};

        // Blink: compress vertically toward center (squeeze Y)
        const blinkName = side === 'left' ? 'eyeBlinkLeft' : 'eyeBlinkRight';
        shapes[blinkName] = this.createEyeMeshBlink(positions, center, eyeHeight, intensity);

        // Wide: expand vertically from center
        const wideName = side === 'left' ? 'eyeWideLeft' : 'eyeWideRight';
        shapes[wideName] = this.createEyeMeshWide(positions, center, eyeHeight, intensity);

        // Squint: compress slightly + push forward
        const squintName = side === 'left' ? 'eyeSquintLeft' : 'eyeSquintRight';
        shapes[squintName] = this.createEyeMeshSquint(positions, center, eyeHeight, intensity);

        // Look directions: translate iris/pupil area
        const lookNames = {
            up: side === 'left' ? 'eyeLookUpLeft' : 'eyeLookUpRight',
            down: side === 'left' ? 'eyeLookDownLeft' : 'eyeLookDownRight',
            in: side === 'left' ? 'eyeLookInLeft' : 'eyeLookInRight',
            out: side === 'left' ? 'eyeLookOutLeft' : 'eyeLookOutRight'
        };

        for (const [dir, name] of Object.entries(lookNames)) {
            shapes[name] = this.createEyeMeshLook(positions, center, eyeHeight, side, dir, intensity);
        }

        // Apply morph targets to the eye mesh
        this.applyAuxiliaryMorphTargets(eyeMesh, shapes);
    }

    createEyeMeshBlink(positions, center, eyeHeight, intensity) {
        const vertexCount = positions.count;
        const buffer = new Float32Array(vertexCount * 3);

        for (let i = 0; i < vertexCount; i++) {
            const y = positions.getY(i);
            const relY = (y - center.y) / (eyeHeight * 0.5 + 0.001);

            // Squeeze toward Y center - upper eyelid moves down more, lower less
            let yDisp;
            if (relY > 0) {
                // Upper part: move down strongly
                yDisp = -relY * eyeHeight * 0.45 * intensity;
            } else {
                // Lower part: move up slightly
                yDisp = -relY * eyeHeight * 0.15 * intensity;
            }

            buffer[i * 3] = 0;
            buffer[i * 3 + 1] = yDisp;
            buffer[i * 3 + 2] = 0;
        }

        return buffer;
    }

    createEyeMeshWide(positions, center, eyeHeight, intensity) {
        const vertexCount = positions.count;
        const buffer = new Float32Array(vertexCount * 3);

        for (let i = 0; i < vertexCount; i++) {
            const y = positions.getY(i);
            const relY = (y - center.y) / (eyeHeight * 0.5 + 0.001);

            // Expand from center
            const yDisp = relY > 0
                ? relY * eyeHeight * 0.15 * intensity
                : relY * eyeHeight * 0.08 * intensity;

            buffer[i * 3] = 0;
            buffer[i * 3 + 1] = yDisp;
            buffer[i * 3 + 2] = 0;
        }

        return buffer;
    }

    createEyeMeshSquint(positions, center, eyeHeight, intensity) {
        const vertexCount = positions.count;
        const buffer = new Float32Array(vertexCount * 3);

        for (let i = 0; i < vertexCount; i++) {
            const y = positions.getY(i);
            const z = positions.getZ(i);
            const relY = (y - center.y) / (eyeHeight * 0.5 + 0.001);

            // Slight vertical compression + forward push
            buffer[i * 3] = 0;
            buffer[i * 3 + 1] = -relY * eyeHeight * 0.1 * intensity;
            buffer[i * 3 + 2] = eyeHeight * 0.05 * intensity;
        }

        return buffer;
    }

    createEyeMeshLook(positions, center, eyeHeight, side, direction, intensity) {
        const vertexCount = positions.count;
        const buffer = new Float32Array(vertexCount * 3);

        // Compute displacement based on direction
        let dx = 0, dy = 0;
        const lookAmount = eyeHeight * 0.08 * intensity;

        switch (direction) {
            case 'up': dy = lookAmount; break;
            case 'down': dy = -lookAmount; break;
            case 'in': dx = (side === 'left' ? -1 : 1) * lookAmount; break;
            case 'out': dx = (side === 'left' ? 1 : -1) * lookAmount; break;
        }

        // Apply stronger displacement to front-facing vertices (pupil area)
        for (let i = 0; i < vertexCount; i++) {
            const z = positions.getZ(i);
            const relZ = (z - center.z) / (eyeHeight * 0.5 + 0.001);
            const frontWeight = Math.max(0, relZ); // Only front vertices move

            buffer[i * 3] = dx * frontWeight;
            buffer[i * 3 + 1] = dy * frontWeight;
            buffer[i * 3 + 2] = 0;
        }

        return buffer;
    }

    /**
     * Generate nose blendshapes on a separate nose mesh.
     */
    generateNoseBlendshapes(noseMesh, intensity) {
        const geometry = noseMesh.geometry;
        const positions = geometry.attributes.position;
        const vertexCount = positions.count;

        const box = new THREE.Box3().setFromBufferAttribute(positions);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const noseHeight = size.y;

        const shapes = {};

        // Nose sneer: translate up and to the side
        shapes.noseSneerLeft = this.createNoseMeshSneer(positions, center, noseHeight, 'left', intensity);
        shapes.noseSneerRight = this.createNoseMeshSneer(positions, center, noseHeight, 'right', intensity);

        // Jaw open: nose follows slightly
        shapes.jawOpen = this.createNoseMeshJawFollow(positions, center, noseHeight, intensity);

        this.applyAuxiliaryMorphTargets(noseMesh, shapes);
    }

    createNoseMeshSneer(positions, center, noseHeight, side, intensity) {
        const vertexCount = positions.count;
        const buffer = new Float32Array(vertexCount * 3);
        const dir = side === 'left' ? 1 : -1;

        for (let i = 0; i < vertexCount; i++) {
            buffer[i * 3] = dir * noseHeight * 0.08 * intensity;
            buffer[i * 3 + 1] = noseHeight * 0.12 * intensity;
            buffer[i * 3 + 2] = noseHeight * 0.05 * intensity;
        }

        return buffer;
    }

    createNoseMeshJawFollow(positions, center, noseHeight, intensity) {
        const vertexCount = positions.count;
        const buffer = new Float32Array(vertexCount * 3);

        // Nose drops slightly when jaw opens
        for (let i = 0; i < vertexCount; i++) {
            const y = positions.getY(i);
            const relY = (y - center.y) / (noseHeight * 0.5 + 0.001);
            // Lower part of nose follows jaw more
            const weight = Math.max(0, -relY * 0.5 + 0.3);

            buffer[i * 3] = 0;
            buffer[i * 3 + 1] = -noseHeight * 0.06 * weight * intensity;
            buffer[i * 3 + 2] = 0;
        }

        return buffer;
    }

    /**
     * Apply morph targets to an auxiliary mesh (eyes, nose).
     */
    applyAuxiliaryMorphTargets(mesh, shapes) {
        const geometry = mesh.geometry;
        const newGeometry = geometry.clone();
        newGeometry.morphAttributes.position = [];
        newGeometry.morphTargetsRelative = true;

        const dictionary = {};
        let index = 0;

        for (const [name, buffer] of Object.entries(shapes)) {
            const posAttr = new THREE.Float32BufferAttribute(buffer, 3);
            posAttr.name = name;
            newGeometry.morphAttributes.position.push(posAttr);
            dictionary[name] = index++;
        }

        mesh.geometry = newGeometry;
        mesh.morphTargetDictionary = dictionary;
        mesh.morphTargetInfluences = new Array(index).fill(0);

        // Enable morphTargets on material
        this.enableMorphOnMaterial(mesh);
    }
}
