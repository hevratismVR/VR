import * as THREE from 'three'
import type { BlendShapeMapping, BlendShapeCategory } from '../types'

interface FaceRegion {
  center: THREE.Vector3
  bounds: THREE.Box3
  jawCenter: THREE.Vector3
  leftEyeCenter: THREE.Vector3
  rightEyeCenter: THREE.Vector3
  mouthCenter: THREE.Vector3
  noseCenter: THREE.Vector3
  foreheadCenter: THREE.Vector3
}

interface GeneratedBlendShapes {
  blendShapes: BlendShapeMapping[]
  morphTargets: Map<string, Float32Array>
}

/**
 * Generates procedural blend shapes for meshes that don't have them
 */
export function generateBlendShapes(mesh: THREE.Mesh | THREE.SkinnedMesh): GeneratedBlendShapes {
  const geometry = mesh.geometry
  const positionAttribute = geometry.attributes.position
  
  if (!positionAttribute) {
    return { blendShapes: [], morphTargets: new Map() }
  }

  // Detect face region
  const faceRegion = detectFaceRegion(geometry)
  
  // Generate morph targets
  const morphTargets = new Map<string, Float32Array>()
  const blendShapes: BlendShapeMapping[] = []

  // Generate jaw open blend shape
  const jawOpen = generateJawOpen(positionAttribute, faceRegion)
  morphTargets.set('jawOpen', jawOpen)
  blendShapes.push({
    name: 'jawOpen',
    displayName: 'Jaw Open',
    category: 'mouth',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  // Generate mouth smile blend shapes
  const smileLeft = generateSmile(positionAttribute, faceRegion, 'left')
  morphTargets.set('mouthSmileLeft', smileLeft)
  blendShapes.push({
    name: 'mouthSmileLeft',
    displayName: 'Smile Left',
    category: 'mouth',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  const smileRight = generateSmile(positionAttribute, faceRegion, 'right')
  morphTargets.set('mouthSmileRight', smileRight)
  blendShapes.push({
    name: 'mouthSmileRight',
    displayName: 'Smile Right',
    category: 'mouth',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  // Generate mouth pucker
  const pucker = generatePucker(positionAttribute, faceRegion)
  morphTargets.set('mouthPucker', pucker)
  blendShapes.push({
    name: 'mouthPucker',
    displayName: 'Mouth Pucker',
    category: 'mouth',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  // Generate eye blink blend shapes
  const blinkLeft = generateEyeBlink(positionAttribute, faceRegion, 'left')
  morphTargets.set('eyeBlinkLeft', blinkLeft)
  blendShapes.push({
    name: 'eyeBlinkLeft',
    displayName: 'Blink Left',
    category: 'eyes',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  const blinkRight = generateEyeBlink(positionAttribute, faceRegion, 'right')
  morphTargets.set('eyeBlinkRight', blinkRight)
  blendShapes.push({
    name: 'eyeBlinkRight',
    displayName: 'Blink Right',
    category: 'eyes',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  // Generate eyebrow raise blend shapes
  const browUpLeft = generateBrowRaise(positionAttribute, faceRegion, 'left')
  morphTargets.set('browOuterUpLeft', browUpLeft)
  blendShapes.push({
    name: 'browOuterUpLeft',
    displayName: 'Brow Up Left',
    category: 'eyebrows',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  const browUpRight = generateBrowRaise(positionAttribute, faceRegion, 'right')
  morphTargets.set('browOuterUpRight', browUpRight)
  blendShapes.push({
    name: 'browOuterUpRight',
    displayName: 'Brow Up Right',
    category: 'eyebrows',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  // Generate brow down (frown)
  const browDownLeft = generateBrowDown(positionAttribute, faceRegion, 'left')
  morphTargets.set('browDownLeft', browDownLeft)
  blendShapes.push({
    name: 'browDownLeft',
    displayName: 'Brow Down Left',
    category: 'eyebrows',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  const browDownRight = generateBrowDown(positionAttribute, faceRegion, 'right')
  morphTargets.set('browDownRight', browDownRight)
  blendShapes.push({
    name: 'browDownRight',
    displayName: 'Brow Down Right',
    category: 'eyebrows',
    defaultValue: 0,
    min: 0,
    max: 1
  })

  // Apply morph targets to geometry
  applyMorphTargetsToGeometry(geometry, morphTargets)

  return { blendShapes, morphTargets }
}

/**
 * Detect face region by analyzing mesh geometry
 */
function detectFaceRegion(geometry: THREE.BufferGeometry): FaceRegion {
  const position = geometry.attributes.position
  const bounds = new THREE.Box3()
  
  // Calculate bounding box
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    bounds.expandByPoint(new THREE.Vector3(x, y, z))
  }

  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())

  // Estimate face feature positions based on typical human proportions
  // These are relative to the bounding box
  const faceHeight = size.y
  const faceWidth = size.x

  return {
    center,
    bounds,
    // Jaw is at the bottom 20% of the face
    jawCenter: new THREE.Vector3(
      center.x,
      bounds.min.y + faceHeight * 0.15,
      center.z + size.z * 0.3
    ),
    // Eyes are at about 60% height from bottom
    leftEyeCenter: new THREE.Vector3(
      center.x - faceWidth * 0.15,
      bounds.min.y + faceHeight * 0.65,
      center.z + size.z * 0.3
    ),
    rightEyeCenter: new THREE.Vector3(
      center.x + faceWidth * 0.15,
      bounds.min.y + faceHeight * 0.65,
      center.z + size.z * 0.3
    ),
    // Mouth is at about 30% height
    mouthCenter: new THREE.Vector3(
      center.x,
      bounds.min.y + faceHeight * 0.3,
      center.z + size.z * 0.35
    ),
    // Nose is at about 45% height
    noseCenter: new THREE.Vector3(
      center.x,
      bounds.min.y + faceHeight * 0.45,
      center.z + size.z * 0.4
    ),
    // Forehead/brows at about 75% height
    foreheadCenter: new THREE.Vector3(
      center.x,
      bounds.min.y + faceHeight * 0.75,
      center.z + size.z * 0.25
    )
  }
}

/**
 * Generate jaw open morph target
 */
function generateJawOpen(position: THREE.BufferAttribute, face: FaceRegion): Float32Array {
  const morphData = new Float32Array(position.count * 3)
  const jawRadius = face.bounds.getSize(new THREE.Vector3()).y * 0.25

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)

    const vertex = new THREE.Vector3(x, y, z)
    const distToJaw = vertex.distanceTo(face.jawCenter)

    if (distToJaw < jawRadius && y < face.mouthCenter.y) {
      // Vertices near jaw move down and slightly forward
      const influence = 1 - (distToJaw / jawRadius)
      const smoothInfluence = smoothstep(influence)
      
      morphData[i * 3] = 0 // x stays same
      morphData[i * 3 + 1] = -0.1 * smoothInfluence // y moves down
      morphData[i * 3 + 2] = 0.02 * smoothInfluence // z moves forward slightly
    } else {
      morphData[i * 3] = 0
      morphData[i * 3 + 1] = 0
      morphData[i * 3 + 2] = 0
    }
  }

  return morphData
}

/**
 * Generate smile morph target
 */
function generateSmile(
  position: THREE.BufferAttribute, 
  face: FaceRegion, 
  side: 'left' | 'right'
): Float32Array {
  const morphData = new Float32Array(position.count * 3)
  const mouthRadius = face.bounds.getSize(new THREE.Vector3()).x * 0.2
  const mouthCorner = face.mouthCenter.clone()
  
  // Offset to mouth corner
  mouthCorner.x += (side === 'left' ? -1 : 1) * mouthRadius * 0.5

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)

    const vertex = new THREE.Vector3(x, y, z)
    const distToCorner = vertex.distanceTo(mouthCorner)
    
    // Check if vertex is on the correct side
    const isCorrectSide = side === 'left' ? x < face.center.x : x >= face.center.x

    if (distToCorner < mouthRadius && isCorrectSide) {
      const influence = 1 - (distToCorner / mouthRadius)
      const smoothInfluence = smoothstep(influence)
      
      // Move corner up and outward
      morphData[i * 3] = (side === 'left' ? -0.02 : 0.02) * smoothInfluence // x outward
      morphData[i * 3 + 1] = 0.03 * smoothInfluence // y up
      morphData[i * 3 + 2] = 0.01 * smoothInfluence // z slightly forward
    } else {
      morphData[i * 3] = 0
      morphData[i * 3 + 1] = 0
      morphData[i * 3 + 2] = 0
    }
  }

  return morphData
}

/**
 * Generate mouth pucker morph target
 */
function generatePucker(position: THREE.BufferAttribute, face: FaceRegion): Float32Array {
  const morphData = new Float32Array(position.count * 3)
  const mouthRadius = face.bounds.getSize(new THREE.Vector3()).x * 0.15

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)

    const vertex = new THREE.Vector3(x, y, z)
    const distToMouth = vertex.distanceTo(face.mouthCenter)

    if (distToMouth < mouthRadius) {
      const influence = 1 - (distToMouth / mouthRadius)
      const smoothInfluence = smoothstep(influence)
      
      // Pull vertices toward center and forward
      const dirToCenter = face.mouthCenter.clone().sub(vertex).normalize()
      
      morphData[i * 3] = dirToCenter.x * 0.02 * smoothInfluence
      morphData[i * 3 + 1] = dirToCenter.y * 0.01 * smoothInfluence
      morphData[i * 3 + 2] = 0.03 * smoothInfluence // push forward
    } else {
      morphData[i * 3] = 0
      morphData[i * 3 + 1] = 0
      morphData[i * 3 + 2] = 0
    }
  }

  return morphData
}

/**
 * Generate eye blink morph target
 */
function generateEyeBlink(
  position: THREE.BufferAttribute, 
  face: FaceRegion, 
  side: 'left' | 'right'
): Float32Array {
  const morphData = new Float32Array(position.count * 3)
  const eyeCenter = side === 'left' ? face.leftEyeCenter : face.rightEyeCenter
  const eyeRadius = face.bounds.getSize(new THREE.Vector3()).x * 0.08

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)

    const vertex = new THREE.Vector3(x, y, z)
    const distToEye = vertex.distanceTo(eyeCenter)

    if (distToEye < eyeRadius) {
      const influence = 1 - (distToEye / eyeRadius)
      const smoothInfluence = smoothstep(influence)
      
      // Move eyelid vertices down (closing eye)
      // Only affect vertices above eye center
      const isUpperLid = y > eyeCenter.y
      
      if (isUpperLid) {
        morphData[i * 3] = 0
        morphData[i * 3 + 1] = -0.02 * smoothInfluence // move down
        morphData[i * 3 + 2] = 0
      } else {
        // Lower lid moves up slightly
        morphData[i * 3] = 0
        morphData[i * 3 + 1] = 0.005 * smoothInfluence
        morphData[i * 3 + 2] = 0
      }
    } else {
      morphData[i * 3] = 0
      morphData[i * 3 + 1] = 0
      morphData[i * 3 + 2] = 0
    }
  }

  return morphData
}

/**
 * Generate eyebrow raise morph target
 */
function generateBrowRaise(
  position: THREE.BufferAttribute, 
  face: FaceRegion, 
  side: 'left' | 'right'
): Float32Array {
  const morphData = new Float32Array(position.count * 3)
  const browCenter = face.foreheadCenter.clone()
  browCenter.x += (side === 'left' ? -1 : 1) * face.bounds.getSize(new THREE.Vector3()).x * 0.15
  const browRadius = face.bounds.getSize(new THREE.Vector3()).x * 0.12

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)

    const vertex = new THREE.Vector3(x, y, z)
    const distToBrow = vertex.distanceTo(browCenter)
    
    const isCorrectSide = side === 'left' ? x < face.center.x : x >= face.center.x

    if (distToBrow < browRadius && isCorrectSide && y > face.leftEyeCenter.y) {
      const influence = 1 - (distToBrow / browRadius)
      const smoothInfluence = smoothstep(influence)
      
      morphData[i * 3] = 0
      morphData[i * 3 + 1] = 0.025 * smoothInfluence // move up
      morphData[i * 3 + 2] = 0.005 * smoothInfluence // slightly forward
    } else {
      morphData[i * 3] = 0
      morphData[i * 3 + 1] = 0
      morphData[i * 3 + 2] = 0
    }
  }

  return morphData
}

/**
 * Generate eyebrow down (frown) morph target
 */
function generateBrowDown(
  position: THREE.BufferAttribute, 
  face: FaceRegion, 
  side: 'left' | 'right'
): Float32Array {
  const morphData = new Float32Array(position.count * 3)
  const browCenter = face.foreheadCenter.clone()
  browCenter.x += (side === 'left' ? -1 : 1) * face.bounds.getSize(new THREE.Vector3()).x * 0.12
  browCenter.y -= face.bounds.getSize(new THREE.Vector3()).y * 0.05 // Slightly lower for inner brow
  const browRadius = face.bounds.getSize(new THREE.Vector3()).x * 0.1

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)

    const vertex = new THREE.Vector3(x, y, z)
    const distToBrow = vertex.distanceTo(browCenter)
    
    const isCorrectSide = side === 'left' ? x < face.center.x : x >= face.center.x

    if (distToBrow < browRadius && isCorrectSide && y > face.leftEyeCenter.y) {
      const influence = 1 - (distToBrow / browRadius)
      const smoothInfluence = smoothstep(influence)
      
      // Move inner brow down and inward
      morphData[i * 3] = (side === 'left' ? 0.01 : -0.01) * smoothInfluence // inward
      morphData[i * 3 + 1] = -0.015 * smoothInfluence // down
      morphData[i * 3 + 2] = 0
    } else {
      morphData[i * 3] = 0
      morphData[i * 3 + 1] = 0
      morphData[i * 3 + 2] = 0
    }
  }

  return morphData
}

/**
 * Apply generated morph targets to the geometry
 */
function applyMorphTargetsToGeometry(
  geometry: THREE.BufferGeometry, 
  morphTargets: Map<string, Float32Array>
): void {
  const morphAttributes: { position: THREE.BufferAttribute[] } = { position: [] }
  const morphTargetDictionary: Record<string, number> = {}

  let index = 0
  for (const [name, data] of morphTargets) {
    const attribute = new THREE.BufferAttribute(data, 3)
    attribute.name = name
    morphAttributes.position.push(attribute)
    morphTargetDictionary[name] = index
    index++
  }

  geometry.morphAttributes = morphAttributes
  geometry.morphTargetsRelative = true
  
  // Store the dictionary for later use
  ;(geometry as any).morphTargetDictionary = morphTargetDictionary
}

/**
 * Smoothstep function for smooth falloff
 */
function smoothstep(x: number): number {
  x = Math.max(0, Math.min(1, x))
  return x * x * (3 - 2 * x)
}

/**
 * Apply generated blend shapes to a mesh that doesn't have them
 */
export function applyGeneratedBlendShapes(mesh: THREE.Mesh | THREE.SkinnedMesh): GeneratedBlendShapes {
  const result = generateBlendShapes(mesh)
  
  // Set up morph target influences array
  if (result.morphTargets.size > 0) {
    mesh.morphTargetInfluences = new Array(result.morphTargets.size).fill(0)
    mesh.morphTargetDictionary = {}
    
    let index = 0
    for (const [name] of result.morphTargets) {
      mesh.morphTargetDictionary[name] = index
      index++
    }
  }
  
  return result
}
