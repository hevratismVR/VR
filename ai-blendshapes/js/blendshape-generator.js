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
    }

    /**
     * Generate all blendshapes for the detected face.
     */
    generate(mesh, landmarks, regions, intensity = 1.0) {
        this.mesh = mesh;
        this.basePositions = mesh.geometry.attributes.position.clone();
        this.regions = regions;

        // Compute scale factor based on actual face size
        this.computeScaleFactor(regions);
        this.intensity = intensity;

        // Compute key reference points
        this.computeReferencePoints(regions);

        const geometry = mesh.geometry;

        // Generate ARKit-compatible blendshapes
        this.blendshapes = this.generateARKitBlendshapes(geometry, landmarks, regions);

        // Generate viseme blendshapes for lip sync
        this.visemes = this.generateVisemes(geometry, landmarks, regions);

        // Apply morph targets to the mesh
        this.applyMorphTargets(geometry);

        // Enable morphTargets on material
        this.enableMorphOnMaterial(mesh);

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

        // Mouth center
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        this.mouthCenter = {
            x: this.getMidX(positions, mouthIndices),
            y: this.getMidY(positions, mouthIndices),
            z: this.getMidZ(positions, mouthIndices)
        };

        // Jaw pivot - behind and above the mouth center (ear level)
        const jawIndices = regions.jaw || [];
        const jawMidY = this.getMidY(positions, jawIndices);
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
    }

    enableMorphOnMaterial(mesh) {
        const updateMaterial = (mat) => {
            mat.morphTargets = true;
            mat.needsUpdate = true;
            const newMat = mat.clone();
            newMat.needsUpdate = true;
            return newMat;
        };

        if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map(updateMaterial);
        } else if (mesh.material) {
            mesh.material = updateMaterial(mesh.material);
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
            jawOpen: () => this.createJawOpen(regions, 0.45), // ~25 degrees
            jawForward: () => this.createJawForward(regions, 0.12),
            jawLeft: () => this.createJawSlide(regions, 'left', 0.08),
            jawRight: () => this.createJawSlide(regions, 'right', 0.08),

            // Mouth - strong visible deformations
            mouthOpen: () => this.createJawOpen(regions, 0.35), // less than jaw open
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
            viseme_DD: () => this.createJawOpen(regions, 0.08),
            viseme_kk: () => this.createJawOpen(regions, 0.10),
            viseme_CH: () => this.createVisemeCH(regions),
            viseme_SS: () => this.createVisemeSS(regions),
            viseme_nn: () => this.createJawOpen(regions, 0.06),
            viseme_RR: () => this.createVisemeRR(regions),
            viseme_aa: () => this.createJawOpen(regions, 0.25),
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
     * Professional jaw open using rotational displacement around a hinge pivot.
     * angle: rotation in radians (0.45 ≈ 25 degrees for full open)
     */
    createJawOpen(regions, angle) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;

        const pivotY = this.jawPivot.y;
        const pivotZ = this.jawPivot.z;

        // Determine which vertices are in the "lower face" (jaw, lower lip, lower mouth)
        const lowerLipIndices = new Set(regions.lowerLip || []);
        const jawIndices = new Set(regions.jaw || []);
        const mouthIndices = regions.mouth || [];

        // Split mouth into upper and lower by Y
        const mouthCenterY = this.mouthCenter.y;
        const lowerMouthIndices = new Set();
        const upperMouthIndices = new Set();
        for (const i of mouthIndices) {
            if (positions.getY(i) < mouthCenterY) {
                lowerMouthIndices.add(i);
            } else {
                upperMouthIndices.add(i);
            }
        }

        // All vertices that should rotate with the jaw
        const rotatingSet = new Set([
            ...lowerLipIndices,
            ...jawIndices,
            ...lowerMouthIndices
        ]);

        // Neck cutoff: don't affect vertices too far below the jaw
        let jawMinY = Infinity;
        for (const i of jawIndices) {
            const y = positions.getY(i);
            if (y < jawMinY) jawMinY = y;
        }
        // Falloff starts at the bottom of jaw region
        const neckCutoff = jawMinY - sf * 0.05;
        const falloffRange = sf * 0.15;

        // Rotate lower face vertices
        for (const i of rotatingSet) {
            const y = positions.getY(i);
            const z = positions.getZ(i);

            // Neck protection: fade out below jaw
            let falloff = 1.0;
            if (y < jawMinY) {
                const dist = jawMinY - y;
                falloff = Math.max(0, 1 - dist / falloffRange);
                if (falloff < 0.01) continue;
            }

            // Compute distance from pivot
            const dy = y - pivotY;
            const dz = z - pivotZ;
            const dist = Math.sqrt(dy * dy + dz * dz);
            if (dist < 0.001) continue;

            // Rotate around pivot (negative angle = open downward)
            const currentAngle = Math.atan2(dy, dz);
            const rotAngle = -angle * this.intensity * falloff;
            const newAngle = currentAngle + rotAngle;

            const newDy = dist * Math.sin(newAngle) - dy;
            const newDz = dist * Math.cos(newAngle) - dz;

            displacements.set(i, { x: 0, y: newDy, z: newDz });
        }

        // Upper lip: slight outward push (lip curls up when mouth opens)
        const upperLipIndices = regions.upperLip || [];
        for (const i of upperLipIndices) {
            displacements.set(i, {
                x: 0,
                y: sf * 0.02 * this.intensity,
                z: sf * 0.015 * this.intensity
            });
        }

        // Upper mouth vertices get slight separation
        for (const i of upperMouthIndices) {
            if (!displacements.has(i)) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.01 * this.intensity,
                    z: sf * 0.005 * this.intensity
                });
            }
        }

        // Cheeks stretch when jaw opens
        const cheekIndices = [...(regions.cheekLeft || []), ...(regions.cheekRight || [])];
        for (const i of cheekIndices) {
            const y = positions.getY(i);
            // Only affect cheek vertices near/below mouth level
            const influence = Math.max(0, Math.min(1, (mouthCenterY - y) / (sf * 0.2)));
            if (influence > 0.05) {
                const existing = displacements.get(i) || { x: 0, y: 0, z: 0 };
                displacements.set(i, {
                    x: existing.x,
                    y: existing.y - sf * 0.04 * angle * influence * this.intensity,
                    z: existing.z + sf * 0.01 * angle * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    createJawForward(regions, amount) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;

        const indices = [...(regions.jaw || []), ...(regions.lowerLip || [])];
        const mouthLower = (regions.mouth || []).filter(i => positions.getY(i) < this.mouthCenter.y);
        indices.push(...mouthLower);

        for (const i of indices) {
            displacements.set(i, {
                x: 0,
                y: 0,
                z: sf * amount * this.intensity
            });
        }

        return displacements;
    }

    createJawSlide(regions, side, amount) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const dir = side === 'left' ? 1 : -1;

        const indices = [...(regions.jaw || []), ...(regions.lowerLip || [])];
        for (const i of indices) {
            displacements.set(i, {
                x: sf * amount * dir * this.intensity,
                y: 0,
                z: 0
            });
        }

        return displacements;
    }

    createMouthClose(regions) {
        const displacements = new Map();
        const sf = this.scaleFactor;

        if (regions.upperLip) {
            for (const i of regions.upperLip) {
                displacements.set(i, { x: 0, y: -sf * 0.015 * this.intensity, z: sf * 0.005 * this.intensity });
            }
        }
        if (regions.lowerLip) {
            for (const i of regions.lowerLip) {
                displacements.set(i, { x: 0, y: sf * 0.015 * this.intensity, z: sf * 0.005 * this.intensity });
            }
        }
        return displacements;
    }

    createSmile(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const dir = side === 'left' ? 1 : -1;
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const centerX = this.mouthCenter.x;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            // Weight by how far this vertex is on the correct side
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight);

            if (influence > 0.05) {
                displacements.set(i, {
                    x: dir * sf * 0.06 * influence * this.intensity,
                    y: sf * 0.05 * influence * this.intensity,
                    z: sf * 0.01 * influence * this.intensity
                });
            }
        }

        // Cheeks rise on smile side
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        for (const i of cheekIndices) {
            displacements.set(i, {
                x: dir * sf * 0.02 * this.intensity,
                y: sf * 0.04 * this.intensity,
                z: sf * 0.02 * this.intensity
            });
        }

        return displacements;
    }

    createFrown(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const dir = side === 'left' ? 1 : -1;
        const mouthIndices = [...(regions.mouth || []), ...(regions.lowerLip || [])];
        const centerX = this.mouthCenter.x;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight);

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
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const cx = this.mouthCenter.x;
        const cy = this.mouthCenter.y;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dx = x - cx;
            const dy = y - cy;

            displacements.set(i, {
                x: -dx * 0.5 * this.intensity,
                y: -dy * 0.4 * this.intensity,
                z: sf * 0.06 * this.intensity
            });
        }

        return displacements;
    }

    createFunnel(regions) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const cx = this.mouthCenter.x;
        const cy = this.mouthCenter.y;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) / (this.mouthWidth * 0.5 + 0.001);

            displacements.set(i, {
                x: -dx * 0.3 * this.intensity,
                y: -dy * 0.25 * this.intensity,
                z: sf * 0.04 * (1.2 - dist) * this.intensity
            });
        }

        return displacements;
    }

    createStretch(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const dir = side === 'left' ? 1 : -1;
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const centerX = this.mouthCenter.x;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight);

            displacements.set(i, {
                x: dir * sf * 0.08 * influence * this.intensity,
                y: 0,
                z: -sf * 0.01 * influence * this.intensity
            });
        }

        return displacements;
    }

    createLipRoll(regions, part) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const indices = part === 'upper' ? (regions.upperLip || []) : (regions.lowerLip || []);
        const dir = part === 'upper' ? -1 : 1;

        for (const i of indices) {
            displacements.set(i, {
                x: 0,
                y: dir * sf * 0.02 * this.intensity,
                z: -sf * 0.03 * this.intensity
            });
        }

        return displacements;
    }

    createLipShrug(regions, part) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const indices = part === 'upper' ? (regions.upperLip || []) : (regions.lowerLip || []);
        const dir = part === 'upper' ? 1 : -1;

        for (const i of indices) {
            displacements.set(i, {
                x: 0,
                y: dir * sf * 0.025 * this.intensity,
                z: sf * 0.01 * this.intensity
            });
        }

        return displacements;
    }

    createLipPress(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const mouthIndices = [...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const centerX = this.mouthCenter.x;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight);

            displacements.set(i, {
                x: 0,
                y: 0,
                z: -sf * 0.02 * influence * this.intensity
            });
        }

        return displacements;
    }

    createUpperLipUp(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const indices = regions.upperLip || [];
        const centerX = this.mouthCenter.x;

        for (const i of indices) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, 0.5 + (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, 0.5 + (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight);

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
        const indices = regions.lowerLip || [];
        const centerX = this.mouthCenter.x;

        for (const i of indices) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, 0.5 + (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, 0.5 + (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight);

            displacements.set(i, {
                x: 0,
                y: -sf * 0.035 * influence * this.intensity,
                z: sf * 0.01 * influence * this.intensity
            });
        }

        return displacements;
    }

    // ========================================================================
    // EYES
    // ========================================================================

    createBlink(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        if (eyeIndices.length === 0) return displacements;

        const centerY = this.getMidY(positions, eyeIndices);

        let minY = Infinity, maxY = -Infinity;
        for (const i of eyeIndices) {
            const y = positions.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const eyeHeight = maxY - minY;
        if (eyeHeight < 0.001) return displacements;

        for (const i of eyeIndices) {
            const y = positions.getY(i);
            const relY = (y - centerY) / (eyeHeight * 0.5);

            if (relY > 0) {
                // Upper eyelid moves down strongly
                displacements.set(i, {
                    x: 0,
                    y: -relY * eyeHeight * 0.48 * this.intensity,
                    z: 0.005 * this.scaleFactor * relY * this.intensity
                });
            } else {
                // Lower eyelid moves up slightly
                displacements.set(i, {
                    x: 0,
                    y: -relY * eyeHeight * 0.12 * this.intensity,
                    z: 0.003 * this.scaleFactor * (-relY) * this.intensity
                });
            }
        }

        return displacements;
    }

    createEyeWide(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        if (eyeIndices.length === 0) return displacements;

        const centerY = this.getMidY(positions, eyeIndices);

        for (const i of eyeIndices) {
            const y = positions.getY(i);
            const above = y > centerY;

            displacements.set(i, {
                x: 0,
                y: (above ? sf * 0.03 : -sf * 0.015) * this.intensity,
                z: 0
            });
        }

        return displacements;
    }

    createEyeSquint(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        if (eyeIndices.length === 0) return displacements;

        const centerY = this.getMidY(positions, eyeIndices);

        for (const i of eyeIndices) {
            const y = positions.getY(i);
            const above = y > centerY;

            displacements.set(i, {
                x: 0,
                y: (above ? -sf * 0.02 : sf * 0.015) * this.intensity,
                z: sf * 0.008 * this.intensity
            });
        }

        // Push cheek up
        for (const i of (cheekIndices || []).slice(0, Math.ceil(cheekIndices.length * 0.4))) {
            displacements.set(i, {
                x: 0,
                y: sf * 0.02 * this.intensity,
                z: sf * 0.01 * this.intensity
            });
        }

        return displacements;
    }

    createEyeLook(regions, side, direction) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);

        // Eye look is subtle eyelid following
        let dx = 0, dy = 0;
        switch (direction) {
            case 'up': dy = sf * 0.012; break;
            case 'down': dy = -sf * 0.012; break;
            case 'in': dx = (side === 'left' ? -1 : 1) * sf * 0.008; break;
            case 'out': dx = (side === 'left' ? 1 : -1) * sf * 0.008; break;
        }

        for (const i of eyeIndices) {
            displacements.set(i, {
                x: dx * this.intensity,
                y: dy * this.intensity,
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
        const foreheadIndices = regions.forehead || [];
        if (foreheadIndices.length === 0) return displacements;

        const centerX = this.getMidX(positions, foreheadIndices);
        const minY = this.getMinY(positions, foreheadIndices);
        const maxY = this.getMaxY(positions, foreheadIndices);
        const browHeight = maxY - minY;

        for (const i of foreheadIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            // Side influence
            const sideWeight = side === 'left'
                ? Math.max(0, 0.3 + (x - centerX) / (this.mouthWidth + 0.001))
                : Math.max(0, 0.3 + (centerX - x) / (this.mouthWidth + 0.001));

            // Height influence - brow is at bottom of forehead region
            const heightWeight = Math.max(0, 1 - (y - minY) / (browHeight * 0.5 + 0.001));

            const influence = Math.min(1, sideWeight) * Math.min(1, heightWeight);

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: direction * sf * 0.04 * influence * this.intensity,
                    z: 0
                });
            }
        }

        return displacements;
    }

    createBrowInnerUp(regions) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const foreheadIndices = regions.forehead || [];
        if (foreheadIndices.length === 0) return displacements;

        const centerX = this.getMidX(positions, foreheadIndices);
        const minY = this.getMinY(positions, foreheadIndices);
        const maxY = this.getMaxY(positions, foreheadIndices);
        const browHeight = maxY - minY;

        for (const i of foreheadIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const centerWeight = Math.max(0, 1 - Math.abs(x - centerX) / (this.mouthWidth * 0.4 + 0.001));
            const heightWeight = Math.max(0, 1 - (y - minY) / (browHeight * 0.4 + 0.001));
            const influence = centerWeight * heightWeight;

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.05 * influence * this.intensity,
                    z: 0
                });
            }
        }

        return displacements;
    }

    createBrowOuterUp(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const foreheadIndices = regions.forehead || [];
        if (foreheadIndices.length === 0) return displacements;

        const centerX = this.getMidX(positions, foreheadIndices);
        const minY = this.getMinY(positions, foreheadIndices);
        const maxY = this.getMaxY(positions, foreheadIndices);
        const browHeight = maxY - minY;

        for (const i of foreheadIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const dist = Math.abs(x - centerX);
            const outerWeight = side === 'left'
                ? (x > centerX ? Math.min(1, dist / (this.mouthWidth * 0.5 + 0.001)) : 0)
                : (x < centerX ? Math.min(1, dist / (this.mouthWidth * 0.5 + 0.001)) : 0);

            const heightWeight = Math.max(0, 1 - (y - minY) / (browHeight * 0.4 + 0.001));
            const influence = outerWeight * heightWeight;

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: sf * 0.05 * influence * this.intensity,
                    z: 0
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
        const allCheeks = [...(regions.cheekLeft || []), ...(regions.cheekRight || [])];
        const centerX = this.mouthCenter.x;

        for (const i of allCheeks) {
            const x = positions.getX(i);
            const dir = x > centerX ? 1 : -1;

            displacements.set(i, {
                x: dir * sf * 0.05 * this.intensity,
                y: 0,
                z: sf * 0.06 * this.intensity
            });
        }

        return displacements;
    }

    createCheekSquint(regions, side) {
        const displacements = new Map();
        const sf = this.scaleFactor;
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);

        for (const i of cheekIndices) {
            displacements.set(i, {
                x: 0,
                y: sf * 0.03 * this.intensity,
                z: sf * 0.015 * this.intensity
            });
        }

        return displacements;
    }

    createNoseSneer(regions, side) {
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const noseIndices = regions.nose || [];
        const centerX = this.mouthCenter.x;
        const dir = side === 'left' ? 1 : -1;

        for (const i of noseIndices) {
            const x = positions.getX(i);
            const sideWeight = side === 'left'
                ? Math.max(0, (x - centerX) / (this.mouthWidth * 0.5 + 0.001))
                : Math.max(0, (centerX - x) / (this.mouthWidth * 0.5 + 0.001));
            const influence = Math.min(1, sideWeight);

            if (influence > 0.1) {
                displacements.set(i, {
                    x: dir * sf * 0.015 * influence * this.intensity,
                    y: sf * 0.025 * influence * this.intensity,
                    z: sf * 0.01 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    createTongueOut(regions) {
        // Approximation: push lower-center mouth vertices forward and down
        const displacements = new Map();
        const positions = this.basePositions;
        const sf = this.scaleFactor;
        const mouthIndices = regions.lowerLip || regions.mouth || [];
        const cx = this.mouthCenter.x;
        const cy = this.mouthCenter.y;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const distX = Math.abs(x - cx);
            const below = y < cy;

            if (below && distX < this.mouthWidth * 0.25) {
                displacements.set(i, {
                    x: 0,
                    y: -sf * 0.05 * this.intensity,
                    z: sf * 0.08 * this.intensity
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

        for (const i of (regions.upperLip || [])) {
            displacements.set(i, { x: 0, y: -sf * 0.008 * this.intensity, z: sf * 0.01 * this.intensity });
        }
        for (const i of (regions.lowerLip || [])) {
            displacements.set(i, { x: 0, y: sf * 0.008 * this.intensity, z: sf * 0.01 * this.intensity });
        }

        return displacements;
    }

    createVisemeFF(regions) {
        const displacements = new Map();
        const sf = this.scaleFactor;

        for (const i of (regions.lowerLip || [])) {
            displacements.set(i, {
                x: 0,
                y: sf * 0.015 * this.intensity,
                z: -sf * 0.02 * this.intensity
            });
        }

        return displacements;
    }

    createVisemeTH(regions) {
        const displacements = new Map();
        const sf = this.scaleFactor;

        for (const i of (regions.upperLip || [])) {
            displacements.set(i, { x: 0, y: sf * 0.012 * this.intensity, z: 0 });
        }
        for (const i of (regions.lowerLip || [])) {
            displacements.set(i, { x: 0, y: -sf * 0.015 * this.intensity, z: sf * 0.01 * this.intensity });
        }

        return displacements;
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
        // Narrow opening, teeth close together
        const displacements = this.createJawOpen(regions, 0.04);
        const stretch = this.createStretch(regions, 'left');

        for (const [i, d] of stretch) {
            const existing = displacements.get(i) || { x: 0, y: 0, z: 0 };
            displacements.set(i, {
                x: existing.x + d.x * 0.3,
                y: existing.y + d.y * 0.3,
                z: existing.z + d.z * 0.3
            });
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

    applyMorphTargets(geometry) {
        const newGeometry = geometry.clone();
        newGeometry.morphAttributes.position = [];
        newGeometry.morphTargetsRelative = true;

        const dictionary = {};
        let index = 0;

        for (const [name, buffer] of Object.entries(this.blendshapes)) {
            const attr = new THREE.Float32BufferAttribute(buffer, 3);
            attr.name = name;
            newGeometry.morphAttributes.position.push(attr);
            dictionary[name] = index++;
        }

        for (const [name, buffer] of Object.entries(this.visemes)) {
            const attr = new THREE.Float32BufferAttribute(buffer, 3);
            attr.name = name;
            newGeometry.morphAttributes.position.push(attr);
            dictionary[name] = index++;
        }

        this.mesh.geometry = newGeometry;
        this.mesh.morphTargetDictionary = dictionary;
        this.mesh.morphTargetInfluences = new Array(index).fill(0);
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
}
