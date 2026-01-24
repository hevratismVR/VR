import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class ModelLoader {
    constructor() {
        this.gltfLoader = new GLTFLoader();
        this.fbxLoader = null;
        this.objLoader = null;
    }

    async loadFBXLoader() {
        if (!this.fbxLoader) {
            const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
            this.fbxLoader = new FBXLoader();
        }
    }

    async loadOBJLoader() {
        if (!this.objLoader) {
            const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
            this.objLoader = new OBJLoader();
        }
    }

    async load(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        const url = URL.createObjectURL(file);

        try {
            let model;
            switch (extension) {
                case 'glb':
                case 'gltf':
                    model = await this.loadGLTF(url);
                    break;
                case 'fbx':
                    await this.loadFBXLoader();
                    model = await this.loadFBX(url);
                    break;
                case 'obj':
                    await this.loadOBJLoader();
                    model = await this.loadOBJ(url);
                    break;
                default:
                    throw new Error(`Unsupported format: ${extension}`);
            }

            URL.revokeObjectURL(url);
            return this.processModel(model);
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
    }

    loadGLTF(url) {
        return new Promise((resolve, reject) => {
            this.gltfLoader.load(url, (gltf) => {
                resolve(gltf.scene);
            }, undefined, reject);
        });
    }

    loadFBX(url) {
        return new Promise((resolve, reject) => {
            this.fbxLoader.load(url, (fbx) => {
                resolve(fbx);
            }, undefined, reject);
        });
    }

    loadOBJ(url) {
        return new Promise((resolve, reject) => {
            this.objLoader.load(url, (obj) => {
                resolve(obj);
            }, undefined, reject);
        });
    }

    processModel(scene) {
        const meshes = [];
        const skinnedMeshes = [];
        let totalVertices = 0;
        let totalFaces = 0;

        scene.traverse((child) => {
            if (child.isMesh) {
                // Ensure geometry has needed attributes
                if (!child.geometry.attributes.normal) {
                    child.geometry.computeVertexNormals();
                }

                meshes.push(child);
                totalVertices += child.geometry.attributes.position.count;
                if (child.geometry.index) {
                    totalFaces += child.geometry.index.count / 3;
                } else {
                    totalFaces += child.geometry.attributes.position.count / 3;
                }

                if (child.isSkinnedMesh) {
                    skinnedMeshes.push(child);
                }
            }
        });

        // Center and scale the model
        const box = new THREE.Box3().setFromObject(scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;

        scene.position.sub(center);
        scene.scale.multiplyScalar(scale);

        return {
            scene,
            meshes,
            skinnedMeshes,
            info: {
                vertices: totalVertices,
                faces: totalFaces,
                meshCount: meshes.length,
                hasSkinnedMesh: skinnedMeshes.length > 0,
                boundingBox: box,
                originalScale: scale
            }
        };
    }
}
