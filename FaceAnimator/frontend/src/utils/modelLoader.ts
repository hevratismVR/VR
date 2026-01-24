import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { LoadedModel, BlendShapeMapping, ModelMetadata } from '../types'
import { detectFaceAndBlendShapes } from './faceDetector'

export async function loadModel(file: File): Promise<LoadedModel> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  const url = URL.createObjectURL(file)

  try {
    let scene: THREE.Group
    let animations: THREE.AnimationClip[] = []

    switch (extension) {
      case 'gltf':
      case 'glb':
        const gltfResult = await loadGLTF(url)
        scene = gltfResult.scene
        animations = gltfResult.animations
        break
      case 'fbx':
        const fbxResult = await loadFBX(url)
        scene = fbxResult.scene
        animations = fbxResult.animations
        break
      case 'obj':
        scene = await loadOBJ(url)
        break
      default:
        throw new Error(`Unsupported file format: ${extension}`)
    }

    // Analyze the model and detect face
    const { faceMesh, blendShapes, bones } = detectFaceAndBlendShapes(scene)

    // Calculate model metadata
    const metadata = calculateMetadata(file, scene, blendShapes.length > 0, bones.length > 0)

    // Center and scale the model
    centerAndScaleModel(scene)

    return {
      scene,
      animations,
      faceMesh,
      blendShapes,
      bones,
      metadata
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function loadGLTF(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const loader = new GLTFLoader()
  
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        resolve({
          scene: gltf.scene,
          animations: gltf.animations || []
        })
      },
      undefined,
      (error) => reject(new Error(`Failed to load GLTF: ${error}`))
    )
  })
}

async function loadFBX(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const loader = new FBXLoader()
  
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (fbx) => {
        resolve({
          scene: fbx,
          animations: fbx.animations || []
        })
      },
      undefined,
      (error) => reject(new Error(`Failed to load FBX: ${error}`))
    )
  })
}

async function loadOBJ(url: string): Promise<THREE.Group> {
  const loader = new OBJLoader()
  
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (obj) => resolve(obj),
      undefined,
      (error) => reject(new Error(`Failed to load OBJ: ${error}`))
    )
  })
}

function calculateMetadata(
  file: File,
  scene: THREE.Group,
  hasBlendShapes: boolean,
  hasSkeleton: boolean
): ModelMetadata {
  let vertexCount = 0
  let faceCount = 0

  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const geometry = object.geometry
      if (geometry.attributes.position) {
        vertexCount += geometry.attributes.position.count
      }
      if (geometry.index) {
        faceCount += geometry.index.count / 3
      } else if (geometry.attributes.position) {
        faceCount += geometry.attributes.position.count / 3
      }
    }
  })

  return {
    name: file.name,
    format: '3D Model Format',
    fileSize: file.size,
    vertexCount,
    faceCount: Math.floor(faceCount),
    hasBlendShapes,
    hasSkeleton,
    loadedAt: new Date()
  }
}

function centerAndScaleModel(scene: THREE.Group): void {
  // Calculate bounding box
  const box = new THREE.Box3().setFromObject(scene)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  // Center the model
  scene.position.sub(center)

  // Scale to fit in a unit sphere
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim > 0) {
    const scale = 1.5 / maxDim
    scene.scale.multiplyScalar(scale)
  }

  // Adjust position so face is at eye level
  scene.position.y += 0.2
}
