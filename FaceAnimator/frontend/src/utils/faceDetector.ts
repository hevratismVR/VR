import * as THREE from 'three'
import type { BlendShapeMapping, BlendShapeCategory } from '../types'
import { STANDARD_BLEND_SHAPES } from '../types'

interface FaceDetectionResult {
  faceMesh: THREE.SkinnedMesh | THREE.Mesh | null
  blendShapes: BlendShapeMapping[]
  bones: THREE.Bone[]
}

// Common blend shape name patterns to detect
const BLEND_SHAPE_PATTERNS: Record<string, { standardName: string; category: BlendShapeCategory }> = {
  // Eye patterns
  'blink_l': { standardName: 'eyeBlinkLeft', category: 'eyes' },
  'blink_r': { standardName: 'eyeBlinkRight', category: 'eyes' },
  'blinkleft': { standardName: 'eyeBlinkLeft', category: 'eyes' },
  'blinkright': { standardName: 'eyeBlinkRight', category: 'eyes' },
  'eye_blink_l': { standardName: 'eyeBlinkLeft', category: 'eyes' },
  'eye_blink_r': { standardName: 'eyeBlinkRight', category: 'eyes' },
  'eyeblinkleft': { standardName: 'eyeBlinkLeft', category: 'eyes' },
  'eyeblinkright': { standardName: 'eyeBlinkRight', category: 'eyes' },
  'eyelookupleft': { standardName: 'eyeLookUpLeft', category: 'eyes' },
  'eyelookupright': { standardName: 'eyeLookUpRight', category: 'eyes' },
  'eyelookdownleft': { standardName: 'eyeLookDownLeft', category: 'eyes' },
  'eyelookdownright': { standardName: 'eyeLookDownRight', category: 'eyes' },
  'eyesquintleft': { standardName: 'eyeSquintLeft', category: 'eyes' },
  'eyesquintright': { standardName: 'eyeSquintRight', category: 'eyes' },
  'eyewideleft': { standardName: 'eyeWideLeft', category: 'eyes' },
  'eyewideright': { standardName: 'eyeWideRight', category: 'eyes' },

  // Mouth patterns
  'jawopen': { standardName: 'jawOpen', category: 'mouth' },
  'jaw_open': { standardName: 'jawOpen', category: 'mouth' },
  'mouthopen': { standardName: 'jawOpen', category: 'mouth' },
  'mouth_open': { standardName: 'jawOpen', category: 'mouth' },
  'open_jaw': { standardName: 'jawOpen', category: 'mouth' },
  'mouthclose': { standardName: 'mouthClose', category: 'mouth' },
  'mouthfunnel': { standardName: 'mouthFunnel', category: 'mouth' },
  'mouthpucker': { standardName: 'mouthPucker', category: 'mouth' },
  'mouthsmileleft': { standardName: 'mouthSmileLeft', category: 'mouth' },
  'mouthsmileright': { standardName: 'mouthSmileRight', category: 'mouth' },
  'smile_l': { standardName: 'mouthSmileLeft', category: 'mouth' },
  'smile_r': { standardName: 'mouthSmileRight', category: 'mouth' },
  'mouthfrownleft': { standardName: 'mouthFrownLeft', category: 'mouth' },
  'mouthfrownright': { standardName: 'mouthFrownRight', category: 'mouth' },
  'frown_l': { standardName: 'mouthFrownLeft', category: 'mouth' },
  'frown_r': { standardName: 'mouthFrownRight', category: 'mouth' },

  // Eyebrow patterns
  'browdownleft': { standardName: 'browDownLeft', category: 'eyebrows' },
  'browdownright': { standardName: 'browDownRight', category: 'eyebrows' },
  'browinnerup': { standardName: 'browInnerUp', category: 'eyebrows' },
  'browouterupleft': { standardName: 'browOuterUpLeft', category: 'eyebrows' },
  'browouterupright': { standardName: 'browOuterUpRight', category: 'eyebrows' },
  'brow_down_l': { standardName: 'browDownLeft', category: 'eyebrows' },
  'brow_down_r': { standardName: 'browDownRight', category: 'eyebrows' },
  'brow_inner_up': { standardName: 'browInnerUp', category: 'eyebrows' },

  // Cheek patterns
  'cheekpuff': { standardName: 'cheekPuff', category: 'cheeks' },
  'cheeksquintleft': { standardName: 'cheekSquintLeft', category: 'cheeks' },
  'cheeksquintright': { standardName: 'cheekSquintRight', category: 'cheeks' },

  // Nose patterns
  'nosesneerleft': { standardName: 'noseSneerLeft', category: 'nose' },
  'nosesneerright': { standardName: 'noseSneerRight', category: 'nose' },

  // Tongue
  'tongueout': { standardName: 'tongueOut', category: 'other' },
  'tongue_out': { standardName: 'tongueOut', category: 'other' },
}

// Keywords that indicate a mesh might be a face
const FACE_MESH_KEYWORDS = [
  'face', 'head', 'facial', 'skin', 'body', 'character',
  'mesh', 'avatar', 'human', 'person'
]

// Keywords that indicate a mesh is NOT a face
const NON_FACE_KEYWORDS = [
  'hair', 'eye', 'teeth', 'tongue', 'eyeball', 'eyelash',
  'cloth', 'clothing', 'accessory', 'prop'
]

export function detectFaceAndBlendShapes(scene: THREE.Group): FaceDetectionResult {
  let faceMesh: THREE.SkinnedMesh | THREE.Mesh | null = null
  const blendShapes: BlendShapeMapping[] = []
  const bones: THREE.Bone[] = []
  const foundBlendShapeNames = new Set<string>()

  // First pass: collect all meshes and find potential face meshes
  const meshCandidates: Array<{ mesh: THREE.Mesh | THREE.SkinnedMesh; score: number }> = []

  scene.traverse((object: THREE.Object3D) => {
    // Collect bones
    if (object instanceof THREE.Bone) {
      bones.push(object)
    }

    // Check for meshes
    if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
      const mesh = object as THREE.Mesh | THREE.SkinnedMesh
      let score = 0

      // Check if mesh has morph targets (blend shapes)
      if (mesh.morphTargetDictionary && Object.keys(mesh.morphTargetDictionary).length > 0) {
        score += 50 // High priority for meshes with blend shapes
      }

      // Check name for face-related keywords
      const nameLower = mesh.name.toLowerCase()
      
      for (const keyword of FACE_MESH_KEYWORDS) {
        if (nameLower.includes(keyword)) {
          score += 10
        }
      }

      for (const keyword of NON_FACE_KEYWORDS) {
        if (nameLower.includes(keyword)) {
          score -= 20
        }
      }

      // Check vertex count (faces typically have moderate vertex counts)
      const vertexCount = mesh.geometry.attributes.position?.count || 0
      if (vertexCount > 1000 && vertexCount < 100000) {
        score += 5
      }

      // Skinned meshes are more likely to be animated faces
      if (mesh instanceof THREE.SkinnedMesh) {
        score += 15
      }

      if (score > 0) {
        meshCandidates.push({ mesh, score })
      }
    }
  })

  // Sort by score and pick the best candidate
  meshCandidates.sort((a, b) => b.score - a.score)

  if (meshCandidates.length > 0) {
    faceMesh = meshCandidates[0].mesh

    // Extract blend shapes from the face mesh
    if (faceMesh.morphTargetDictionary) {
      for (const [name, _index] of Object.entries(faceMesh.morphTargetDictionary)) {
        const normalizedName = name.toLowerCase().replace(/[_\s-]/g, '')
        
        // Try to match to standard blend shape
        let matched = false
        
        // Check exact matches first
        const standardShape = STANDARD_BLEND_SHAPES.find(
          bs => bs.name.toLowerCase() === normalizedName
        )
        
        if (standardShape && !foundBlendShapeNames.has(standardShape.name)) {
          blendShapes.push({
            ...standardShape,
            name: name // Keep original name for morphTargetInfluences
          })
          foundBlendShapeNames.add(standardShape.name)
          matched = true
        }
        
        // Check pattern matches
        if (!matched) {
          const pattern = BLEND_SHAPE_PATTERNS[normalizedName]
          if (pattern && !foundBlendShapeNames.has(pattern.standardName)) {
            blendShapes.push({
              name: name,
              displayName: formatDisplayName(name),
              category: pattern.category,
              defaultValue: 0,
              min: 0,
              max: 1
            })
            foundBlendShapeNames.add(pattern.standardName)
            matched = true
          }
        }

        // If no match found, add as custom blend shape
        if (!matched && !foundBlendShapeNames.has(name)) {
          const category = guessCategory(name)
          blendShapes.push({
            name: name,
            displayName: formatDisplayName(name),
            category,
            defaultValue: 0,
            min: 0,
            max: 1
          })
          foundBlendShapeNames.add(name)
        }
      }
    }
  }

  // Sort blend shapes by category
  blendShapes.sort((a, b) => {
    const categoryOrder = ['eyes', 'mouth', 'eyebrows', 'nose', 'cheeks', 'other']
    return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
  })

  return { faceMesh, blendShapes, bones }
}

function formatDisplayName(name: string): string {
  // Convert camelCase or snake_case to Title Case
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function guessCategory(name: string): BlendShapeCategory {
  const nameLower = name.toLowerCase()
  
  if (nameLower.includes('eye') || nameLower.includes('blink') || nameLower.includes('look')) {
    return 'eyes'
  }
  if (nameLower.includes('mouth') || nameLower.includes('jaw') || nameLower.includes('lip') || 
      nameLower.includes('smile') || nameLower.includes('frown')) {
    return 'mouth'
  }
  if (nameLower.includes('brow')) {
    return 'eyebrows'
  }
  if (nameLower.includes('nose') || nameLower.includes('sneer')) {
    return 'nose'
  }
  if (nameLower.includes('cheek')) {
    return 'cheeks'
  }
  
  return 'other'
}

// Helper function to apply blend shape values to a mesh
export function applyBlendShapeValues(
  mesh: THREE.Mesh | THREE.SkinnedMesh,
  values: Record<string, number>
): void {
  if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) {
    return
  }

  for (const [name, value] of Object.entries(values)) {
    const index = mesh.morphTargetDictionary[name]
    if (index !== undefined) {
      mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, value))
    }
  }
}
