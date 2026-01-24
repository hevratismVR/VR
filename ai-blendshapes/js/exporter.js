import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * Exports the 3D model with blendshapes and animation as VR-ready GLB.
 */
export class Exporter {
    constructor() {
        this.exporter = new GLTFExporter();
    }

    /**
     * Export the model with blendshapes as GLB.
     * @param {Object} accessoriesInfo - Optional { accessories: {type: mesh}, blendshapeGenerator }
     */
    async exportGLB(scene, mesh, animationData = null, accessoriesInfo = null) {
        const exportScene = scene.clone(true);

        // Find all meshes with morph targets in the cloned scene
        let exportMesh = null;
        const morphMeshes = [];
        exportScene.traverse((child) => {
            if (child.isMesh && child.geometry.morphAttributes &&
                child.geometry.morphAttributes.position &&
                child.geometry.morphAttributes.position.length > 0) {
                if (!exportMesh) exportMesh = child;
                morphMeshes.push(child);
            }
        });

        // Ensure meshes have names for animation track binding
        if (exportMesh && !exportMesh.name) {
            exportMesh.name = 'FaceMesh';
        }
        for (const m of morphMeshes) {
            if (!m.name) {
                m.name = `MorphMesh_${morphMeshes.indexOf(m)}`;
            }
        }

        // Build animation clip if we have animation data
        let animations = [];
        if (animationData && exportMesh) {
            const clip = this.buildAnimationClip(animationData, exportMesh, accessoriesInfo);
            if (clip) {
                animations.push(clip);
            }
        }

        const options = {
            binary: true,
            animations: animations,
            includeCustomExtensions: true
        };

        return new Promise((resolve, reject) => {
            this.exporter.parse(
                exportScene,
                (buffer) => {
                    const blob = new Blob([buffer], { type: 'application/octet-stream' });
                    resolve(blob);
                },
                (error) => {
                    reject(error);
                },
                options
            );
        });
    }

    /**
     * Export only the animation data as a separate GLB.
     */
    async exportAnimation(mesh, animationData) {
        if (!animationData) {
            throw new Error('No animation data to export');
        }

        // Create a minimal scene with just the animated mesh
        const scene = new THREE.Scene();
        const clonedMesh = mesh.clone();
        scene.add(clonedMesh);

        const clip = this.buildAnimationClip(animationData, clonedMesh);
        const animations = clip ? [clip] : [];

        return new Promise((resolve, reject) => {
            this.exporter.parse(
                scene,
                (buffer) => {
                    const blob = new Blob([buffer], { type: 'application/octet-stream' });
                    resolve(blob);
                },
                (error) => reject(error),
                { binary: true, animations }
            );
        });
    }

    /**
     * Build a THREE.AnimationClip from our animation data.
     * Includes accessory position/rotation tracks if accessories are provided.
     */
    buildAnimationClip(animationData, mesh, accessoriesInfo = null) {
        const { tracks, duration, fps, totalFrames } = animationData;
        const dictionary = mesh.morphTargetDictionary || mesh.geometry.morphTargetDictionary;

        if (!dictionary) return null;

        const clipTracks = [];

        // Create time array
        const times = new Float32Array(totalFrames);
        for (let i = 0; i < totalFrames; i++) {
            times[i] = i / fps;
        }

        // Create a morph target influence track for each animated shape
        for (const [name, curve] of Object.entries(tracks)) {
            const morphIndex = dictionary[name];
            if (morphIndex === undefined) continue;

            // Check if this track has any non-zero values
            let hasData = false;
            for (let i = 0; i < curve.length; i++) {
                if (curve[i] > 0.001) {
                    hasData = true;
                    break;
                }
            }

            if (!hasData) continue;

            // THREE.js morph target track format
            const trackName = `${mesh.name || 'mesh'}.morphTargetInfluences[${morphIndex}]`;
            const track = new THREE.NumberKeyframeTrack(
                trackName,
                times,
                curve
            );

            clipTracks.push(track);
        }

        // Bake accessory jaw/eye tracking into position/rotation tracks
        if (accessoriesInfo) {
            const accTracks = this.buildAccessoryTracks(
                animationData, dictionary, accessoriesInfo, times
            );
            clipTracks.push(...accTracks);
        }

        if (clipTracks.length === 0) return null;

        return new THREE.AnimationClip('LipSync', duration, clipTracks);
    }

    /**
     * Bake accessory movements into animation tracks.
     * Computes per-frame position/rotation from morph target influences.
     */
    buildAccessoryTracks(animationData, dictionary, accessoriesInfo, times) {
        const { tracks, totalFrames } = animationData;
        const { accessories, attachments, blendshapeGenerator } = accessoriesInfo;
        const accTracks = [];

        if (!blendshapeGenerator) return accTracks;
        const sf = blendshapeGenerator.scaleFactor;

        for (const [type, mesh] of Object.entries(accessories)) {
            if (!mesh) continue;
            const attachment = attachments[type];
            if (!attachment) continue;

            // Ensure accessory has a name for track binding
            if (!mesh.name) mesh.name = type;

            if (attachment.followsJaw) {
                // Build position track from jawOpen/mouthOpen influences
                const positions = new Float32Array(totalFrames * 3);
                const basePos = attachment.basePosition;

                for (let f = 0; f < totalFrames; f++) {
                    let dropY = 0, dropZ = 0, slideX = 0;

                    // jawOpen contribution
                    const jawCurve = tracks['jawOpen'];
                    if (jawCurve && jawCurve[f] > 0.001) {
                        dropY += sf * 0.18 * 0.85 * jawCurve[f];
                        dropZ += sf * 0.03 * 0.85 * jawCurve[f];
                    }

                    // mouthOpen contribution
                    const mouthCurve = tracks['mouthOpen'];
                    if (mouthCurve && mouthCurve[f] > 0.001) {
                        dropY += sf * 0.18 * 0.65 * mouthCurve[f];
                        dropZ += sf * 0.03 * 0.65 * mouthCurve[f];
                    }

                    // jawForward
                    const jawFwdCurve = tracks['jawForward'];
                    if (jawFwdCurve && jawFwdCurve[f] > 0.001) {
                        dropZ -= sf * 0.12 * jawFwdCurve[f]; // forward = +z
                    }

                    // jawLeft/jawRight
                    const jawLeftCurve = tracks['jawLeft'];
                    const jawRightCurve = tracks['jawRight'];
                    if (jawLeftCurve && jawLeftCurve[f] > 0.001) {
                        slideX += sf * 0.08 * jawLeftCurve[f];
                    }
                    if (jawRightCurve && jawRightCurve[f] > 0.001) {
                        slideX -= sf * 0.08 * jawRightCurve[f];
                    }

                    positions[f * 3] = basePos.x + slideX;
                    positions[f * 3 + 1] = basePos.y - dropY;
                    positions[f * 3 + 2] = basePos.z - dropZ;
                }

                accTracks.push(new THREE.VectorKeyframeTrack(
                    `${mesh.name}.position`,
                    times,
                    positions
                ));
            }

            if (attachment.isEye) {
                // Build rotation track from eye look blendshapes
                const side = attachment.region === 'eyeLeft' ? 'Left' : 'Right';
                const rotations = new Float32Array(totalFrames * 4); // quaternion

                for (let f = 0; f < totalFrames; f++) {
                    let rotX = attachment.baseRotation.x;
                    let rotY = attachment.baseRotation.y;

                    const upCurve = tracks[`eyeLookUp${side}`];
                    const downCurve = tracks[`eyeLookDown${side}`];
                    const inCurve = tracks[`eyeLookIn${side}`];
                    const outCurve = tracks[`eyeLookOut${side}`];

                    if (upCurve) rotX -= (upCurve[f] || 0) * 0.35;
                    if (downCurve) rotX += (downCurve[f] || 0) * 0.35;

                    const inDir = side === 'Left' ? 1 : -1;
                    if (inCurve) rotY += (inCurve[f] || 0) * 0.3 * inDir;
                    if (outCurve) rotY -= (outCurve[f] || 0) * 0.3 * inDir;

                    // Convert Euler to quaternion
                    const q = new THREE.Quaternion().setFromEuler(
                        new THREE.Euler(rotX, rotY, attachment.baseRotation.z)
                    );
                    rotations[f * 4] = q.x;
                    rotations[f * 4 + 1] = q.y;
                    rotations[f * 4 + 2] = q.z;
                    rotations[f * 4 + 3] = q.w;
                }

                accTracks.push(new THREE.QuaternionKeyframeTrack(
                    `${mesh.name}.quaternion`,
                    times,
                    rotations
                ));
            }
        }

        return accTracks;
    }

    /**
     * Download a blob as a file.
     */
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Export blendshape data as JSON (for custom engines).
     * Includes both position and normal deltas for proper rendering.
     */
    exportBlendshapeJSON(mesh) {
        const dictionary = mesh.morphTargetDictionary || mesh.geometry.morphTargetDictionary;
        const morphPositions = mesh.geometry.morphAttributes.position;
        const morphNormals = mesh.geometry.morphAttributes.normal;

        if (!dictionary || !morphPositions) {
            throw new Error('No blendshape data to export');
        }

        const hasNormals = morphNormals && morphNormals.length === morphPositions.length;

        const data = {
            version: '1.1',
            generator: 'AI Blendshapes Generator',
            vertexCount: mesh.geometry.attributes.position.count,
            hasNormals,
            blendshapes: {}
        };

        for (const [name, index] of Object.entries(dictionary)) {
            const posAttr = morphPositions[index];
            const normAttr = hasNormals ? morphNormals[index] : null;
            const deltas = [];

            // Only store non-zero deltas for efficiency
            for (let i = 0; i < posAttr.count; i++) {
                const px = posAttr.getX(i);
                const py = posAttr.getY(i);
                const pz = posAttr.getZ(i);

                if (Math.abs(px) > 0.0001 || Math.abs(py) > 0.0001 || Math.abs(pz) > 0.0001) {
                    const entry = { index: i, x: px, y: py, z: pz };

                    if (normAttr) {
                        const nx = normAttr.getX(i);
                        const ny = normAttr.getY(i);
                        const nz = normAttr.getZ(i);
                        if (Math.abs(nx) > 0.0001 || Math.abs(ny) > 0.0001 || Math.abs(nz) > 0.0001) {
                            entry.nx = nx;
                            entry.ny = ny;
                            entry.nz = nz;
                        }
                    }

                    deltas.push(entry);
                }
            }

            data.blendshapes[name] = {
                deltaCount: deltas.length,
                deltas
            };
        }

        return JSON.stringify(data, null, 2);
    }
}
