import * as THREE from 'three';

/**
 * Manages accessory models (teeth, tongue, eyeballs) that integrate with the face.
 * Accessories follow the blendshape deformations of the main face mesh.
 */
export class AccessoriesManager {
    constructor() {
        this.accessories = {
            upperTeeth: null,
            lowerTeeth: null,
            tongue: null,
            eyeLeft: null,
            eyeRight: null
        };

        // Reference positions for each accessory (set during attachment)
        this.attachments = {};

        // The face mesh these are attached to
        this.faceMesh = null;
        this.faceRegions = null;
        this.blendshapeGenerator = null;
    }

    /**
     * Set the face mesh and regions for accessory positioning.
     */
    setFace(mesh, regions, blendshapeGenerator) {
        this.faceMesh = mesh;
        this.faceRegions = regions;
        this.blendshapeGenerator = blendshapeGenerator;
    }

    /**
     * Add an accessory model.
     * type: 'upperTeeth' | 'lowerTeeth' | 'tongue' | 'eyeLeft' | 'eyeRight'
     */
    addAccessory(type, model) {
        if (!this.faceMesh || !this.faceRegions) {
            throw new Error('Face mesh must be set before adding accessories');
        }

        // Find the mesh in the model
        let accessoryMesh = null;
        model.traverse((child) => {
            if (child.isMesh && !accessoryMesh) {
                accessoryMesh = child;
            }
        });

        if (!accessoryMesh) {
            throw new Error('No mesh found in accessory model');
        }

        // Position the accessory relative to the face
        this.positionAccessory(type, accessoryMesh);

        // Store reference
        this.accessories[type] = accessoryMesh;

        // Add to scene (as child of face mesh parent)
        const parent = this.faceMesh.parent || this.faceMesh;
        parent.add(accessoryMesh);

        return accessoryMesh;
    }

    /**
     * Position an accessory based on type and face landmarks.
     */
    positionAccessory(type, mesh) {
        const positions = this.faceMesh.geometry.attributes.position;
        const gen = this.blendshapeGenerator;
        const regions = this.faceRegions;

        // Get accessory bounds
        mesh.geometry.computeBoundingBox();
        const accBox = mesh.geometry.boundingBox;
        const accSize = new THREE.Vector3();
        accBox.getSize(accSize);
        const accCenter = new THREE.Vector3();
        accBox.getCenter(accCenter);

        // Get face reference points
        const mouthCenter = gen.mouthCenter;
        const sf = gen.scaleFactor;

        switch (type) {
            case 'upperTeeth': {
                // Position at upper mouth area, slightly behind lips
                const targetY = mouthCenter.y + sf * 0.01;
                const targetZ = mouthCenter.z - sf * 0.02;

                // Scale to fit mouth width
                const targetWidth = gen.mouthWidth * 0.85;
                const scale = targetWidth / (accSize.x || 1);

                mesh.scale.setScalar(scale);
                mesh.position.set(
                    mouthCenter.x - accCenter.x * scale,
                    targetY - accCenter.y * scale,
                    targetZ - accCenter.z * scale
                );

                this.attachments[type] = {
                    basePosition: mesh.position.clone(),
                    baseRotation: mesh.rotation.clone(),
                    followsJaw: false,
                    region: 'upperLip'
                };
                break;
            }

            case 'lowerTeeth': {
                // Position at lower mouth area
                const targetY = mouthCenter.y - sf * 0.02;
                const targetZ = mouthCenter.z - sf * 0.02;

                const targetWidth = gen.mouthWidth * 0.80;
                const scale = targetWidth / (accSize.x || 1);

                mesh.scale.setScalar(scale);
                mesh.position.set(
                    mouthCenter.x - accCenter.x * scale,
                    targetY - accCenter.y * scale,
                    targetZ - accCenter.z * scale
                );

                this.attachments[type] = {
                    basePosition: mesh.position.clone(),
                    baseRotation: mesh.rotation.clone(),
                    followsJaw: true,
                    region: 'lowerLip',
                    pivotY: gen.jawPivot.y,
                    pivotZ: gen.jawPivot.z
                };
                break;
            }

            case 'tongue': {
                // Position inside mouth, lower center
                const targetY = mouthCenter.y - sf * 0.015;
                const targetZ = mouthCenter.z - sf * 0.04;

                const targetWidth = gen.mouthWidth * 0.5;
                const scale = targetWidth / (accSize.x || 1);

                mesh.scale.setScalar(scale);
                mesh.position.set(
                    mouthCenter.x - accCenter.x * scale,
                    targetY - accCenter.y * scale,
                    targetZ - accCenter.z * scale
                );

                this.attachments[type] = {
                    basePosition: mesh.position.clone(),
                    baseRotation: mesh.rotation.clone(),
                    followsJaw: true,
                    region: 'lowerLip',
                    pivotY: gen.jawPivot.y,
                    pivotZ: gen.jawPivot.z
                };
                break;
            }

            case 'eyeLeft':
            case 'eyeRight': {
                const side = type === 'eyeLeft' ? 'eyeLeft' : 'eyeRight';
                const eyeIndices = regions[side] || [];

                if (eyeIndices.length === 0) {
                    console.warn(`No ${side} region found`);
                    return;
                }

                // Find eye center
                const eyeCenterX = gen.getMidX(positions, eyeIndices);
                const eyeCenterY = gen.getMidY(positions, eyeIndices);
                const eyeCenterZ = gen.getMidZ(positions, eyeIndices);

                // Find eye dimensions
                let minY = Infinity, maxY = -Infinity;
                for (const i of eyeIndices) {
                    const y = positions.getY(i);
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
                const eyeHeight = maxY - minY;

                // Scale eyeball to fit eye opening
                const targetSize = eyeHeight * 1.2;
                const scale = targetSize / (Math.max(accSize.x, accSize.y, accSize.z) || 1);

                mesh.scale.setScalar(scale);
                mesh.position.set(
                    eyeCenterX - accCenter.x * scale,
                    eyeCenterY - accCenter.y * scale,
                    eyeCenterZ - accCenter.z * scale - eyeHeight * 0.3
                );

                this.attachments[type] = {
                    basePosition: mesh.position.clone(),
                    baseRotation: mesh.rotation.clone(),
                    followsJaw: false,
                    isEye: true,
                    region: side
                };
                break;
            }
        }
    }

    /**
     * Update accessory positions based on current morph target influences.
     * Call this on each frame during animation.
     */
    update() {
        if (!this.faceMesh) return;

        const influences = this.faceMesh.morphTargetInfluences;
        const dictionary = this.faceMesh.morphTargetDictionary;
        if (!influences || !dictionary) return;

        for (const [type, mesh] of Object.entries(this.accessories)) {
            if (!mesh) continue;
            const attachment = this.attachments[type];
            if (!attachment) continue;

            // Reset to base position
            mesh.position.copy(attachment.basePosition);
            mesh.rotation.copy(attachment.baseRotation);

            if (attachment.followsJaw) {
                this.updateJawFollower(mesh, attachment, influences, dictionary);
            }

            if (attachment.isEye) {
                this.updateEyeFollower(mesh, attachment, influences, dictionary);
            }
        }
    }

    /**
     * Update accessories that follow jaw rotation.
     */
    updateJawFollower(mesh, attachment, influences, dictionary) {
        const gen = this.blendshapeGenerator;
        if (!gen) return;

        // Get jaw open amount
        const jawOpenIdx = dictionary['jawOpen'];
        const mouthOpenIdx = dictionary['mouthOpen'];
        let jawAngle = 0;

        if (jawOpenIdx !== undefined) {
            jawAngle += (influences[jawOpenIdx] || 0) * 0.45;
        }
        if (mouthOpenIdx !== undefined) {
            jawAngle += (influences[mouthOpenIdx] || 0) * 0.35;
        }

        if (jawAngle > 0.001) {
            // Rotate around jaw pivot
            const pivotY = attachment.pivotY;
            const pivotZ = attachment.pivotZ;

            const posY = mesh.position.y;
            const posZ = mesh.position.z;

            const dy = posY - pivotY;
            const dz = posZ - pivotZ;
            const dist = Math.sqrt(dy * dy + dz * dz);

            if (dist > 0.001) {
                const currentAngle = Math.atan2(dy, dz);
                const newAngle = currentAngle - jawAngle;

                mesh.position.y = pivotY + dist * Math.sin(newAngle);
                mesh.position.z = pivotZ + dist * Math.cos(newAngle);
                mesh.rotation.x -= jawAngle;
            }
        }

        // Jaw forward
        const jawFwdIdx = dictionary['jawForward'];
        if (jawFwdIdx !== undefined && influences[jawFwdIdx] > 0.001) {
            mesh.position.z += gen.scaleFactor * 0.12 * influences[jawFwdIdx];
        }

        // Jaw slide
        const jawLeftIdx = dictionary['jawLeft'];
        const jawRightIdx = dictionary['jawRight'];
        if (jawLeftIdx !== undefined && influences[jawLeftIdx] > 0.001) {
            mesh.position.x += gen.scaleFactor * 0.08 * influences[jawLeftIdx];
        }
        if (jawRightIdx !== undefined && influences[jawRightIdx] > 0.001) {
            mesh.position.x -= gen.scaleFactor * 0.08 * influences[jawRightIdx];
        }
    }

    /**
     * Update eyeball accessories based on eye look directions.
     */
    updateEyeFollower(mesh, attachment, influences, dictionary) {
        const side = attachment.region === 'eyeLeft' ? 'Left' : 'Right';
        const sf = this.blendshapeGenerator ? this.blendshapeGenerator.scaleFactor : 1;

        // Eye rotations based on look directions
        const lookUpIdx = dictionary[`eyeLookUp${side}`];
        const lookDownIdx = dictionary[`eyeLookDown${side}`];
        const lookInIdx = dictionary[`eyeLookIn${side}`];
        const lookOutIdx = dictionary[`eyeLookOut${side}`];

        let rotX = 0, rotY = 0;

        if (lookUpIdx !== undefined) rotX -= (influences[lookUpIdx] || 0) * 0.35;
        if (lookDownIdx !== undefined) rotX += (influences[lookDownIdx] || 0) * 0.35;

        const inDir = side === 'Left' ? 1 : -1;
        if (lookInIdx !== undefined) rotY += (influences[lookInIdx] || 0) * 0.3 * inDir;
        if (lookOutIdx !== undefined) rotY -= (influences[lookOutIdx] || 0) * 0.3 * inDir;

        mesh.rotation.x = attachment.baseRotation.x + rotX;
        mesh.rotation.y = attachment.baseRotation.y + rotY;
    }

    /**
     * Remove an accessory.
     */
    removeAccessory(type) {
        const mesh = this.accessories[type];
        if (mesh && mesh.parent) {
            mesh.parent.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        }
        this.accessories[type] = null;
        delete this.attachments[type];
    }

    /**
     * Get all current accessories for export.
     */
    getAccessories() {
        const result = {};
        for (const [type, mesh] of Object.entries(this.accessories)) {
            if (mesh) result[type] = mesh;
        }
        return result;
    }

    /**
     * Check if any accessories are loaded.
     */
    hasAccessories() {
        return Object.values(this.accessories).some(m => m !== null);
    }
}
