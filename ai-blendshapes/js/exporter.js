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
     */
    async exportGLB(scene, mesh, animationData = null) {
        const exportScene = scene.clone(true);

        // Find the mesh with morph targets in the cloned scene
        let exportMesh = null;
        exportScene.traverse((child) => {
            if (child.isMesh && child.geometry.morphAttributes &&
                child.geometry.morphAttributes.position &&
                child.geometry.morphAttributes.position.length > 0) {
                exportMesh = child;
            }
        });

        // Ensure mesh has a name for animation track binding
        if (exportMesh && !exportMesh.name) {
            exportMesh.name = 'FaceMesh';
        }

        // Build animation clip if we have animation data
        let animations = [];
        if (animationData && exportMesh) {
            const clip = this.buildAnimationClip(animationData, exportMesh);
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
     */
    buildAnimationClip(animationData, mesh) {
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

        if (clipTracks.length === 0) return null;

        return new THREE.AnimationClip('LipSync', duration, clipTracks);
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
