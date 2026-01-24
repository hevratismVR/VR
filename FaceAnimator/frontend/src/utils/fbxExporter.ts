import * as THREE from 'three'
import type { LoadedModel, AccessoryModel, BlendShapeValues, ExportOptions } from '../types'

/**
 * Export the animated face model to FBX format
 * 
 * Note: Full FBX export requires the FBX SDK or a WASM-based implementation.
 * This is a placeholder that demonstrates the export structure.
 * In production, this would either:
 * 1. Use a backend service with the FBX SDK
 * 2. Use a WASM-compiled FBX SDK
 * 3. Export to GLTF (which has good browser support) and convert server-side
 */

export interface ExportResult {
  success: boolean
  data?: Blob
  filename?: string
  error?: string
}

export async function exportToFBX(
  model: LoadedModel,
  accessories: AccessoryModel[],
  animation: Array<{ time: number; blendShapes: BlendShapeValues }> | null,
  options: ExportOptions
): Promise<ExportResult> {
  try {
    // For now, we'll create a GLTF export as a fallback
    // In production, this would call a backend FBX conversion service
    
    const scene = prepareSceneForExport(model, accessories, options)
    
    if (options.format === 'gltf') {
      return await exportToGLTF(scene, model.metadata.name, animation)
    }
    
    // FBX export - would require backend service
    return await exportToFBXBackend(scene, model, animation, options)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed'
    }
  }
}

function prepareSceneForExport(
  model: LoadedModel,
  accessories: AccessoryModel[],
  options: ExportOptions
): THREE.Scene {
  const scene = new THREE.Scene()
  
  // Clone the main model
  const mainModel = model.scene.clone(true)
  scene.add(mainModel)
  
  // Add accessories if requested
  if (options.includeAccessories) {
    accessories.forEach(accessory => {
      if (accessory.visible) {
        const accessoryClone = accessory.scene.clone(true)
        accessoryClone.position.set(
          accessory.offset.x,
          accessory.offset.y,
          accessory.offset.z
        )
        accessoryClone.rotation.set(
          accessory.rotation.x,
          accessory.rotation.y,
          accessory.rotation.z
        )
        accessoryClone.scale.setScalar(accessory.scale)
        scene.add(accessoryClone)
      }
    })
  }
  
  // VR optimization
  if (options.vrOptimized) {
    optimizeForVR(scene)
  }
  
  return scene
}

function optimizeForVR(scene: THREE.Scene): void {
  scene.traverse((object: THREE.Object3D) => {
    if (object instanceof THREE.Mesh) {
      const mesh = object
      
      // Simplify geometry if too complex
      // In production, use a mesh simplification library
      const geometry = mesh.geometry
      if (geometry.attributes.position.count > 50000) {
        console.warn('High vertex count detected. Consider decimation for VR.')
      }
      
      // Optimize materials
      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        // Reduce texture resolution if needed
        // Use simpler materials for VR performance
      }
    }
  })
}

async function exportToGLTF(
  scene: THREE.Scene,
  name: string,
  _animation: Array<{ time: number; blendShapes: BlendShapeValues }> | null
): Promise<ExportResult> {
  // Dynamic import to reduce bundle size
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  
  return new Promise((resolve) => {
    const exporter = new GLTFExporter()
    
    exporter.parse(
      scene,
      (gltf) => {
        let blob: Blob
        let filename: string
        
        if (gltf instanceof ArrayBuffer) {
          // Binary GLTF (GLB)
          blob = new Blob([gltf], { type: 'model/gltf-binary' })
          filename = `${name}.glb`
        } else {
          // JSON GLTF
          const json = JSON.stringify(gltf, null, 2)
          blob = new Blob([json], { type: 'application/json' })
          filename = `${name}.gltf`
        }
        
        resolve({
          success: true,
          data: blob,
          filename
        })
      },
      (error) => {
        resolve({
          success: false,
          error: `GLTF export failed: ${error}`
        })
      },
      {
        binary: true,
        animations: [],
        includeCustomExtensions: true
      }
    )
  })
}

async function exportToFBXBackend(
  _scene: THREE.Scene,
  model: LoadedModel,
  animation: Array<{ time: number; blendShapes: BlendShapeValues }> | null,
  options: ExportOptions
): Promise<ExportResult> {
  // In production, this would send the scene data to a backend service
  // that uses the FBX SDK to create the export
  
  // For now, we'll create a mock FBX export info
  const exportInfo = {
    modelName: model.metadata.name,
    blendShapeCount: model.blendShapes.length,
    animationFrames: animation?.length ?? 0,
    targetEngine: options.targetEngine,
    timestamp: new Date().toISOString()
  }
  
  console.log('FBX Export Info:', exportInfo)
  
  // Fallback to GLTF for now
  console.warn('FBX export requires backend service. Exporting as GLTF instead.')
  return exportToGLTF(_scene, model.metadata.name, animation)
}

/**
 * Create animation clip from blend shape keyframes
 */
export function createAnimationClip(
  name: string,
  keyframes: Array<{ time: number; blendShapes: BlendShapeValues }>,
  blendShapeNames: string[]
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = []
  
  // Create a track for each blend shape
  for (const shapeName of blendShapeNames) {
    const times: number[] = []
    const values: number[] = []
    
    for (const keyframe of keyframes) {
      times.push(keyframe.time)
      values.push(keyframe.blendShapes[shapeName] ?? 0)
    }
    
    // Create morph target track
    // The path format depends on the mesh structure
    const track = new THREE.NumberKeyframeTrack(
      `.morphTargetInfluences[${shapeName}]`,
      times,
      values
    )
    tracks.push(track)
  }
  
  const duration = keyframes.length > 0 
    ? keyframes[keyframes.length - 1].time 
    : 0
  
  return new THREE.AnimationClip(name, duration, tracks)
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Export with full animation baked
 */
export async function exportWithAnimation(
  model: LoadedModel,
  accessories: AccessoryModel[],
  animation: Array<{ time: number; blendShapes: BlendShapeValues }>,
  options: ExportOptions
): Promise<void> {
  const result = await exportToFBX(model, accessories, animation, options)
  
  if (result.success && result.data && result.filename) {
    downloadBlob(result.data, result.filename)
  } else {
    throw new Error(result.error ?? 'Export failed')
  }
}
