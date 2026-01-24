import * as THREE from 'three';

/**
 * Generates blendshapes (morph targets) automatically based on detected face regions.
 * Creates ARKit-compatible 52 blendshapes + 15 viseme shapes for lip sync.
 */
export class BlendshapeGenerator {
    constructor() {
        this.blendshapes = {};
        this.visemes = {};
        this.mesh = null;
        this.basePositions = null;
        this.intensity = 1.0;
    }

    /**
     * Generate all blendshapes for the detected face.
     */
    generate(mesh, landmarks, regions, intensity = 1.0) {
        this.mesh = mesh;
        this.basePositions = mesh.geometry.attributes.position.clone();

        // Compute scale factor based on actual face size in geometry space
        this.scaleFactor = this.computeScaleFactor(regions);
        this.intensity = intensity * this.scaleFactor;

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
            morphTargetDictionary: geometry.morphTargetDictionary,
            morphTargetInfluences: mesh.morphTargetInfluences
        };
    }

    /**
     * Compute a scale factor so displacements are proportional to the face size.
     * Our base displacement values assume a face height of ~1 unit.
     */
    computeScaleFactor(regions) {
        const positions = this.basePositions;
        let minY = Infinity, maxY = -Infinity;

        // Use all face region vertices to find the face height
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

        if (allIndices.length === 0) return 1;

        for (const i of allIndices) {
            const y = positions.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        const faceHeight = maxY - minY;
        // Our displacements are designed for a face ~1 unit tall
        // Scale them to match the actual face size
        return faceHeight > 0 ? faceHeight / 1.0 : 1;
    }

    /**
     * Enable morph targets on the mesh material.
     */
    enableMorphOnMaterial(mesh) {
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => {
                mat.morphTargets = true;
                mat.needsUpdate = true;
            });
        } else if (mesh.material) {
            mesh.material.morphTargets = true;
            mesh.material.needsUpdate = true;
        }
    }

    /**
     * Generate ARKit-compatible blendshapes.
     */
    generateARKitBlendshapes(geometry, landmarks, regions) {
        const shapes = {};
        const positions = this.basePositions;
        const vertexCount = positions.count;

        // Define blendshape generators
        const shapeDefinitions = {
            // Jaw
            jawOpen: () => this.createDisplacement(regions.jaw, regions.mouth, { y: -0.15, z: 0.02 }),
            jawForward: () => this.createDisplacement(regions.jaw, regions.mouth, { z: 0.08 }),
            jawLeft: () => this.createDisplacement(regions.jaw, regions.mouth, { x: 0.05 }),
            jawRight: () => this.createDisplacement(regions.jaw, regions.mouth, { x: -0.05 }),

            // Mouth
            mouthOpen: () => this.createMouthOpen(regions, 0.12),
            mouthClose: () => this.createMouthClose(regions),
            mouthSmileLeft: () => this.createSmile(regions, 'left', 0.08),
            mouthSmileRight: () => this.createSmile(regions, 'right', 0.08),
            mouthFrownLeft: () => this.createFrown(regions, 'left', 0.06),
            mouthFrownRight: () => this.createFrown(regions, 'right', 0.06),
            mouthPucker: () => this.createPucker(regions, 0.06),
            mouthFunnel: () => this.createFunnel(regions, 0.05),
            mouthStretchLeft: () => this.createStretch(regions, 'left', 0.07),
            mouthStretchRight: () => this.createStretch(regions, 'right', 0.07),
            mouthRollUpper: () => this.createLipRoll(regions, 'upper', 0.03),
            mouthRollLower: () => this.createLipRoll(regions, 'lower', 0.04),
            mouthShrugUpper: () => this.createDisplacement(regions.upperLip, null, { y: 0.03 }),
            mouthShrugLower: () => this.createDisplacement(regions.lowerLip, null, { y: -0.02 }),
            mouthPressLeft: () => this.createLipPress(regions, 'left'),
            mouthPressRight: () => this.createLipPress(regions, 'right'),
            mouthUpperUpLeft: () => this.createUpperLipUp(regions, 'left'),
            mouthUpperUpRight: () => this.createUpperLipUp(regions, 'right'),
            mouthLowerDownLeft: () => this.createLowerLipDown(regions, 'left'),
            mouthLowerDownRight: () => this.createLowerLipDown(regions, 'right'),

            // Eyes
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
            browDownLeft: () => this.createBrowMovement(regions, 'left', -0.04),
            browDownRight: () => this.createBrowMovement(regions, 'right', -0.04),
            browInnerUp: () => this.createBrowInnerUp(regions, 0.05),
            browOuterUpLeft: () => this.createBrowOuterUp(regions, 'left', 0.05),
            browOuterUpRight: () => this.createBrowOuterUp(regions, 'right', 0.05),

            // Cheek
            cheekPuff: () => this.createCheekPuff(regions, 0.06),
            cheekSquintLeft: () => this.createCheekSquint(regions, 'left'),
            cheekSquintRight: () => this.createCheekSquint(regions, 'right'),

            // Nose
            noseSneerLeft: () => this.createNoseSneer(regions, 'left'),
            noseSneerRight: () => this.createNoseSneer(regions, 'right'),

            // Tongue (approximated)
            tongueOut: () => this.createTongueOut(regions)
        };

        for (const [name, generator] of Object.entries(shapeDefinitions)) {
            const displacement = generator();
            if (displacement) {
                shapes[name] = this.createMorphTarget(vertexCount, displacement);
            }
        }

        return shapes;
    }

    /**
     * Generate viseme shapes for lip sync.
     * Standard viseme set for speech animation.
     */
    generateVisemes(geometry, landmarks, regions) {
        const visemes = {};
        const vertexCount = this.basePositions.count;

        const visemeDefinitions = {
            // Silence
            viseme_sil: () => null, // neutral pose

            // Consonants and vowels
            viseme_PP: () => this.createVisemeClosed(regions), // P, B, M
            viseme_FF: () => this.createVisemeFF(regions), // F, V
            viseme_TH: () => this.createVisemeTH(regions), // Th
            viseme_DD: () => this.createVisemeDD(regions), // T, D, N
            viseme_kk: () => this.createVisemeKK(regions), // K, G
            viseme_CH: () => this.createVisemeCH(regions), // Ch, J, Sh
            viseme_SS: () => this.createVisemeSS(regions), // S, Z
            viseme_nn: () => this.createVisemeNN(regions), // N, L
            viseme_RR: () => this.createVisemeRR(regions), // R
            viseme_aa: () => this.createVisemeAA(regions), // A
            viseme_E: () => this.createVisemeE(regions), // E
            viseme_I: () => this.createVisemeI(regions), // I
            viseme_O: () => this.createVisemeO(regions), // O
            viseme_U: () => this.createVisemeU(regions), // U
        };

        for (const [name, generator] of Object.entries(visemeDefinitions)) {
            const displacement = generator();
            if (displacement) {
                visemes[name] = this.createMorphTarget(vertexCount, displacement);
            } else {
                // Neutral/silence viseme - zero displacement
                visemes[name] = this.createMorphTarget(vertexCount, new Map());
            }
        }

        return visemes;
    }

    /**
     * Create a displacement map for given regions.
     */
    createDisplacement(primaryRegion, secondaryRegion, offset) {
        const displacements = new Map();
        const positions = this.basePositions;

        const applyToRegion = (indices, strength) => {
            if (!indices) return;
            for (const i of indices) {
                const dx = (offset.x || 0) * strength * this.intensity;
                const dy = (offset.y || 0) * strength * this.intensity;
                const dz = (offset.z || 0) * strength * this.intensity;
                displacements.set(i, { x: dx, y: dy, z: dz });
            }
        };

        applyToRegion(primaryRegion, 1.0);
        if (secondaryRegion) {
            applyToRegion(secondaryRegion, 0.5);
        }

        return displacements;
    }

    /**
     * Create mouth open shape - jaw drops, lips separate.
     */
    createMouthOpen(regions, amount) {
        const displacements = new Map();
        const positions = this.basePositions;

        // Lower lip and jaw move down
        if (regions.lowerLip) {
            for (const i of regions.lowerLip) {
                displacements.set(i, { x: 0, y: -amount * this.intensity, z: 0.01 * this.intensity });
            }
        }
        if (regions.jaw) {
            for (const i of regions.jaw) {
                displacements.set(i, { x: 0, y: -amount * 0.8 * this.intensity, z: 0 });
            }
        }
        // Upper lip slightly up
        if (regions.upperLip) {
            for (const i of regions.upperLip) {
                displacements.set(i, { x: 0, y: amount * 0.15 * this.intensity, z: 0 });
            }
        }

        return displacements;
    }

    createMouthClose(regions) {
        const displacements = new Map();
        if (regions.upperLip) {
            for (const i of regions.upperLip) {
                displacements.set(i, { x: 0, y: -0.02 * this.intensity, z: 0 });
            }
        }
        if (regions.lowerLip) {
            for (const i of regions.lowerLip) {
                displacements.set(i, { x: 0, y: 0.02 * this.intensity, z: 0 });
            }
        }
        return displacements;
    }

    createSmile(regions, side, amount) {
        const displacements = new Map();
        const mouthIndices = [...(regions.mouth || [])];
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        const positions = this.basePositions;
        const dir = side === 'left' ? 1 : -1;

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const centerX = this.getMidX(positions, mouthIndices);
            const sideInfluence = side === 'left' ? Math.max(0, x - centerX) : Math.max(0, centerX - x);
            const normalizedInfluence = Math.min(1, sideInfluence * 10);

            displacements.set(i, {
                x: dir * amount * 0.5 * normalizedInfluence * this.intensity,
                y: amount * normalizedInfluence * this.intensity,
                z: 0
            });
        }

        for (const i of cheekIndices) {
            displacements.set(i, {
                x: dir * amount * 0.3 * this.intensity,
                y: amount * 0.5 * this.intensity,
                z: 0.02 * this.intensity
            });
        }

        return displacements;
    }

    createFrown(regions, side, amount) {
        const displacements = new Map();
        const mouthIndices = [...(regions.mouth || [])];
        const dir = side === 'left' ? 1 : -1;
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, mouthIndices);

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const sideInfluence = side === 'left' ? Math.max(0, x - centerX) : Math.max(0, centerX - x);
            const normalizedInfluence = Math.min(1, sideInfluence * 10);

            displacements.set(i, {
                x: dir * amount * 0.3 * normalizedInfluence * this.intensity,
                y: -amount * normalizedInfluence * this.intensity,
                z: 0
            });
        }

        return displacements;
    }

    createPucker(regions, amount) {
        const displacements = new Map();
        const positions = this.basePositions;
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const centerX = this.getMidX(positions, mouthIndices);
        const centerY = this.getMidY(positions, mouthIndices);

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dx = x - centerX;
            const dy = y - centerY;

            displacements.set(i, {
                x: -dx * 0.4 * this.intensity,
                y: -dy * 0.3 * this.intensity,
                z: amount * this.intensity
            });
        }

        return displacements;
    }

    createFunnel(regions, amount) {
        const displacements = new Map();
        const positions = this.basePositions;
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const centerX = this.getMidX(positions, mouthIndices);
        const centerY = this.getMidY(positions, mouthIndices);

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            displacements.set(i, {
                x: -dx * 0.25 * this.intensity,
                y: -dy * 0.2 * this.intensity,
                z: amount * (1 - dist * 5) * this.intensity
            });
        }

        return displacements;
    }

    createStretch(regions, side, amount) {
        const displacements = new Map();
        const mouthIndices = [...(regions.mouth || [])];
        const dir = side === 'left' ? 1 : -1;
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, mouthIndices);

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const sideInfluence = side === 'left' ? Math.max(0, x - centerX) : Math.max(0, centerX - x);
            const normalizedInfluence = Math.min(1, sideInfluence * 10);

            displacements.set(i, {
                x: dir * amount * normalizedInfluence * this.intensity,
                y: 0,
                z: -0.01 * normalizedInfluence * this.intensity
            });
        }

        return displacements;
    }

    createLipRoll(regions, part, amount) {
        const displacements = new Map();
        const indices = part === 'upper' ? (regions.upperLip || []) : (regions.lowerLip || []);
        const dir = part === 'upper' ? -1 : 1;

        for (const i of indices) {
            displacements.set(i, {
                x: 0,
                y: dir * amount * 0.5 * this.intensity,
                z: -amount * this.intensity
            });
        }

        return displacements;
    }

    createLipPress(regions, side) {
        const displacements = new Map();
        const mouthIndices = [...(regions.mouth || [])];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, mouthIndices);

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const sideInfluence = side === 'left' ? Math.max(0, x - centerX) : Math.max(0, centerX - x);
            const normalizedInfluence = Math.min(1, sideInfluence * 10);

            displacements.set(i, {
                x: 0,
                y: -0.01 * normalizedInfluence * this.intensity,
                z: -0.02 * normalizedInfluence * this.intensity
            });
        }

        return displacements;
    }

    createUpperLipUp(regions, side) {
        const displacements = new Map();
        const indices = regions.upperLip || [];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, indices);

        for (const i of indices) {
            const x = positions.getX(i);
            const sideInfluence = side === 'left' ? Math.max(0, (x - centerX) * 5 + 0.5) : Math.max(0, (centerX - x) * 5 + 0.5);
            const normalizedInfluence = Math.min(1, sideInfluence);

            displacements.set(i, {
                x: 0,
                y: 0.04 * normalizedInfluence * this.intensity,
                z: 0.01 * normalizedInfluence * this.intensity
            });
        }

        return displacements;
    }

    createLowerLipDown(regions, side) {
        const displacements = new Map();
        const indices = regions.lowerLip || [];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, indices);

        for (const i of indices) {
            const x = positions.getX(i);
            const sideInfluence = side === 'left' ? Math.max(0, (x - centerX) * 5 + 0.5) : Math.max(0, (centerX - x) * 5 + 0.5);
            const normalizedInfluence = Math.min(1, sideInfluence);

            displacements.set(i, {
                x: 0,
                y: -0.04 * normalizedInfluence * this.intensity,
                z: 0.01 * normalizedInfluence * this.intensity
            });
        }

        return displacements;
    }

    createBlink(regions, side) {
        const displacements = new Map();
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        const positions = this.basePositions;
        const centerY = this.getMidY(positions, eyeIndices);

        for (const i of eyeIndices) {
            const y = positions.getY(i);
            const distFromCenter = y - centerY;

            // Upper eyelid moves down, lower eyelid moves up
            const movement = distFromCenter > 0 ? -0.04 : 0.02;

            displacements.set(i, {
                x: 0,
                y: movement * this.intensity,
                z: 0
            });
        }

        return displacements;
    }

    createEyeWide(regions, side) {
        const displacements = new Map();
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        const positions = this.basePositions;
        const centerY = this.getMidY(positions, eyeIndices);

        for (const i of eyeIndices) {
            const y = positions.getY(i);
            const distFromCenter = y - centerY;
            const movement = distFromCenter > 0 ? 0.03 : -0.015;

            displacements.set(i, {
                x: 0,
                y: movement * this.intensity,
                z: 0
            });
        }

        return displacements;
    }

    createEyeSquint(regions, side) {
        const displacements = new Map();
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);
        const positions = this.basePositions;
        const centerY = this.getMidY(positions, eyeIndices);

        for (const i of eyeIndices) {
            const y = positions.getY(i);
            const distFromCenter = y - centerY;
            const movement = distFromCenter > 0 ? -0.02 : 0.015;

            displacements.set(i, {
                x: 0,
                y: movement * this.intensity,
                z: 0.01 * this.intensity
            });
        }

        for (const i of (cheekIndices || []).slice(0, Math.floor(cheekIndices.length * 0.3))) {
            displacements.set(i, { x: 0, y: 0.02 * this.intensity, z: 0.01 * this.intensity });
        }

        return displacements;
    }

    createEyeLook(regions, side, direction) {
        const displacements = new Map();
        const eyeIndices = side === 'left' ? (regions.eyeLeft || []) : (regions.eyeRight || []);

        const offset = { x: 0, y: 0, z: 0 };
        switch (direction) {
            case 'up': offset.y = 0.015; break;
            case 'down': offset.y = -0.015; break;
            case 'in': offset.x = side === 'left' ? -0.01 : 0.01; break;
            case 'out': offset.x = side === 'left' ? 0.01 : -0.01; break;
        }

        for (const i of eyeIndices) {
            displacements.set(i, {
                x: offset.x * this.intensity,
                y: offset.y * this.intensity,
                z: offset.z * this.intensity
            });
        }

        return displacements;
    }

    createBrowMovement(regions, side, amount) {
        const displacements = new Map();
        const foreheadIndices = regions.forehead || [];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, foreheadIndices);
        const minY = this.getMinY(positions, foreheadIndices);

        for (const i of foreheadIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const sideInfluence = side === 'left' ? Math.max(0, (x - centerX) * 5 + 0.3) : Math.max(0, (centerX - x) * 5 + 0.3);
            const heightInfluence = Math.max(0, 1 - (y - minY) * 5);
            const influence = Math.min(1, sideInfluence) * Math.min(1, heightInfluence);

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: amount * influence * this.intensity,
                    z: 0
                });
            }
        }

        return displacements;
    }

    createBrowInnerUp(regions, amount) {
        const displacements = new Map();
        const foreheadIndices = regions.forehead || [];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, foreheadIndices);
        const minY = this.getMinY(positions, foreheadIndices);

        for (const i of foreheadIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const centerInfluence = Math.max(0, 1 - Math.abs(x - centerX) * 8);
            const heightInfluence = Math.max(0, 1 - (y - minY) * 5);
            const influence = centerInfluence * heightInfluence;

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: amount * influence * this.intensity,
                    z: 0
                });
            }
        }

        return displacements;
    }

    createBrowOuterUp(regions, side, amount) {
        const displacements = new Map();
        const foreheadIndices = regions.forehead || [];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, foreheadIndices);
        const minY = this.getMinY(positions, foreheadIndices);

        for (const i of foreheadIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const dist = Math.abs(x - centerX);
            const sideInfluence = side === 'left' ? (x > centerX ? dist * 5 : 0) : (x < centerX ? dist * 5 : 0);
            const heightInfluence = Math.max(0, 1 - (y - minY) * 5);
            const influence = Math.min(1, sideInfluence) * heightInfluence;

            if (influence > 0.1) {
                displacements.set(i, {
                    x: 0,
                    y: amount * influence * this.intensity,
                    z: 0
                });
            }
        }

        return displacements;
    }

    createCheekPuff(regions, amount) {
        const displacements = new Map();
        const allCheeks = [...(regions.cheekLeft || []), ...(regions.cheekRight || [])];

        for (const i of allCheeks) {
            const positions = this.basePositions;
            const x = positions.getX(i);
            const centerX = this.getMidX(positions, allCheeks);
            const dir = x > centerX ? 1 : -1;

            displacements.set(i, {
                x: dir * amount * 0.5 * this.intensity,
                y: 0,
                z: amount * this.intensity
            });
        }

        return displacements;
    }

    createCheekSquint(regions, side) {
        const displacements = new Map();
        const cheekIndices = side === 'left' ? (regions.cheekLeft || []) : (regions.cheekRight || []);

        for (const i of cheekIndices) {
            displacements.set(i, {
                x: 0,
                y: 0.03 * this.intensity,
                z: 0.02 * this.intensity
            });
        }

        return displacements;
    }

    createNoseSneer(regions, side) {
        const displacements = new Map();
        const noseIndices = regions.nose || [];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, noseIndices);

        for (const i of noseIndices) {
            const x = positions.getX(i);
            const sideInfluence = side === 'left' ? Math.max(0, (x - centerX) * 8) : Math.max(0, (centerX - x) * 8);
            const influence = Math.min(1, sideInfluence);

            if (influence > 0.1) {
                const dir = side === 'left' ? 1 : -1;
                displacements.set(i, {
                    x: dir * 0.02 * influence * this.intensity,
                    y: 0.03 * influence * this.intensity,
                    z: 0.01 * influence * this.intensity
                });
            }
        }

        return displacements;
    }

    createTongueOut(regions) {
        const displacements = new Map();
        const mouthIndices = regions.lowerLip || regions.mouth || [];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, mouthIndices);
        const centerY = this.getMidY(positions, mouthIndices);

        // Compute mouth width for relative threshold
        let minX = Infinity, maxX = -Infinity;
        for (const i of mouthIndices) {
            const x = positions.getX(i);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
        }
        const mouthWidth = maxX - minX;
        const threshold = mouthWidth * 0.2;

        // Select lower-center vertices as tongue proxy
        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            if (Math.abs(x - centerX) < threshold && y < centerY) {
                displacements.set(i, {
                    x: 0,
                    y: -0.06 * this.intensity,
                    z: 0.08 * this.intensity
                });
            }
        }

        return displacements;
    }

    // Viseme shapes
    createVisemeClosed(regions) {
        // P, B, M - lips pressed together
        const displacements = new Map();
        if (regions.upperLip) {
            for (const i of regions.upperLip) {
                displacements.set(i, { x: 0, y: -0.01 * this.intensity, z: 0.01 * this.intensity });
            }
        }
        if (regions.lowerLip) {
            for (const i of regions.lowerLip) {
                displacements.set(i, { x: 0, y: 0.01 * this.intensity, z: 0.01 * this.intensity });
            }
        }
        return displacements;
    }

    createVisemeFF(regions) {
        // F, V - lower lip tucked under upper teeth
        const displacements = new Map();
        if (regions.lowerLip) {
            for (const i of regions.lowerLip) {
                displacements.set(i, { x: 0, y: 0.02 * this.intensity, z: -0.02 * this.intensity });
            }
        }
        return displacements;
    }

    createVisemeTH(regions) {
        // TH - tongue between teeth, slight mouth open
        const displacements = new Map();
        if (regions.upperLip) {
            for (const i of regions.upperLip) {
                displacements.set(i, { x: 0, y: 0.015 * this.intensity, z: 0 });
            }
        }
        if (regions.lowerLip) {
            for (const i of regions.lowerLip) {
                displacements.set(i, { x: 0, y: -0.02 * this.intensity, z: 0.01 * this.intensity });
            }
        }
        return displacements;
    }

    createVisemeDD(regions) {
        // T, D - tongue on alveolar ridge, slight open
        return this.createMouthOpen(regions, 0.03);
    }

    createVisemeKK(regions) {
        // K, G - back tongue raised, slight open
        return this.createMouthOpen(regions, 0.04);
    }

    createVisemeCH(regions) {
        // Ch, Sh - rounded lips, slight open
        const displacements = new Map();
        const mouthIndices = [...(regions.mouth || []), ...(regions.upperLip || []), ...(regions.lowerLip || [])];
        const positions = this.basePositions;
        const centerX = this.getMidX(positions, mouthIndices);
        const centerY = this.getMidY(positions, mouthIndices);

        for (const i of mouthIndices) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dx = x - centerX;
            const dy = y - centerY;

            displacements.set(i, {
                x: -dx * 0.2 * this.intensity,
                y: -dy * 0.15 * this.intensity,
                z: 0.03 * this.intensity
            });
        }

        return displacements;
    }

    createVisemeSS(regions) {
        // S, Z - narrow opening, teeth close
        return this.createMouthOpen(regions, 0.02);
    }

    createVisemeNN(regions) {
        // N, L - slight open, tongue up
        return this.createMouthOpen(regions, 0.025);
    }

    createVisemeRR(regions) {
        // R - slight open, lips slightly rounded
        const displacements = this.createMouthOpen(regions, 0.035);
        const puckerDisp = this.createPucker(regions, 0.02);
        // Merge
        for (const [i, d] of puckerDisp) {
            if (displacements.has(i)) {
                const existing = displacements.get(i);
                displacements.set(i, {
                    x: existing.x + d.x * 0.5,
                    y: existing.y + d.y * 0.5,
                    z: existing.z + d.z * 0.5
                });
            } else {
                displacements.set(i, d);
            }
        }
        return displacements;
    }

    createVisemeAA(regions) {
        // A - wide open mouth
        return this.createMouthOpen(regions, 0.1);
    }

    createVisemeE(regions) {
        // E - wide, slight open
        const displacements = this.createMouthOpen(regions, 0.04);
        const stretchL = this.createStretch(regions, 'left', 0.03);
        const stretchR = this.createStretch(regions, 'right', 0.03);

        for (const [i, d] of stretchL) {
            if (displacements.has(i)) {
                const e = displacements.get(i);
                displacements.set(i, { x: e.x + d.x, y: e.y + d.y, z: e.z + d.z });
            } else {
                displacements.set(i, d);
            }
        }
        for (const [i, d] of stretchR) {
            if (displacements.has(i)) {
                const e = displacements.get(i);
                displacements.set(i, { x: e.x + d.x, y: e.y + d.y, z: e.z + d.z });
            } else {
                displacements.set(i, d);
            }
        }

        return displacements;
    }

    createVisemeI(regions) {
        // I - narrow, wide
        const displacements = this.createMouthOpen(regions, 0.02);
        const stretchL = this.createStretch(regions, 'left', 0.04);
        const stretchR = this.createStretch(regions, 'right', 0.04);

        for (const map of [stretchL, stretchR]) {
            for (const [i, d] of map) {
                if (displacements.has(i)) {
                    const e = displacements.get(i);
                    displacements.set(i, { x: e.x + d.x, y: e.y + d.y, z: e.z + d.z });
                } else {
                    displacements.set(i, d);
                }
            }
        }

        return displacements;
    }

    createVisemeO(regions) {
        // O - rounded, open
        const displacements = this.createMouthOpen(regions, 0.07);
        const pucker = this.createPucker(regions, 0.04);

        for (const [i, d] of pucker) {
            if (displacements.has(i)) {
                const e = displacements.get(i);
                displacements.set(i, { x: e.x + d.x * 0.7, y: e.y + d.y * 0.7, z: e.z + d.z * 0.7 });
            } else {
                displacements.set(i, d);
            }
        }

        return displacements;
    }

    createVisemeU(regions) {
        // U - very rounded, small opening
        return this.createPucker(regions, 0.05);
    }

    /**
     * Create a morph target buffer from displacement map.
     */
    createMorphTarget(vertexCount, displacements) {
        const positions = new Float32Array(vertexCount * 3);

        for (const [index, offset] of displacements) {
            positions[index * 3] = offset.x;
            positions[index * 3 + 1] = offset.y;
            positions[index * 3 + 2] = offset.z;
        }

        return positions;
    }

    /**
     * Apply all generated morph targets to the mesh geometry.
     */
    applyMorphTargets(geometry) {
        geometry.morphAttributes.position = [];
        geometry.morphTargetsRelative = true;

        const dictionary = {};
        let index = 0;

        // Add blendshapes
        for (const [name, buffer] of Object.entries(this.blendshapes)) {
            const attr = new THREE.Float32BufferAttribute(buffer, 3);
            attr.name = name;
            geometry.morphAttributes.position.push(attr);
            dictionary[name] = index++;
        }

        // Add visemes
        for (const [name, buffer] of Object.entries(this.visemes)) {
            const attr = new THREE.Float32BufferAttribute(buffer, 3);
            attr.name = name;
            geometry.morphAttributes.position.push(attr);
            dictionary[name] = index++;
        }

        // Set morph target dictionary and influences on the mesh (not geometry)
        this.mesh.morphTargetDictionary = dictionary;
        this.mesh.morphTargetInfluences = new Array(index).fill(0);
    }

    // Utility methods
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

    getMinY(positions, indices) {
        if (!indices || indices.length === 0) return 0;
        let min = Infinity;
        for (const i of indices) {
            const y = positions.getY(i);
            if (y < min) min = y;
        }
        return min;
    }
}
