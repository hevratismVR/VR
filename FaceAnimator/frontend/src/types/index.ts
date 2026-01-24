import type { Object3D, Mesh, SkinnedMesh, Group, AnimationClip, Bone } from 'three'

// Blend shape / morph target types
export interface BlendShapeMapping {
  name: string
  displayName: string
  category: BlendShapeCategory
  defaultValue: number
  min: number
  max: number
}

export type BlendShapeCategory = 'eyes' | 'mouth' | 'eyebrows' | 'nose' | 'cheeks' | 'other'

export interface BlendShapeValues {
  [key: string]: number
}

// Standard blend shape names (ARKit compatible)
export const STANDARD_BLEND_SHAPES: BlendShapeMapping[] = [
  // Eyes
  { name: 'eyeBlinkLeft', displayName: 'Blink Left', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeBlinkRight', displayName: 'Blink Right', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookUpLeft', displayName: 'Look Up Left', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookUpRight', displayName: 'Look Up Right', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookDownLeft', displayName: 'Look Down Left', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookDownRight', displayName: 'Look Down Right', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookInLeft', displayName: 'Look In Left', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookInRight', displayName: 'Look In Right', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookOutLeft', displayName: 'Look Out Left', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeLookOutRight', displayName: 'Look Out Right', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeWideLeft', displayName: 'Wide Left', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeWideRight', displayName: 'Wide Right', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeSquintLeft', displayName: 'Squint Left', category: 'eyes', defaultValue: 0, min: 0, max: 1 },
  { name: 'eyeSquintRight', displayName: 'Squint Right', category: 'eyes', defaultValue: 0, min: 0, max: 1 },

  // Mouth
  { name: 'jawOpen', displayName: 'Jaw Open', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'jawForward', displayName: 'Jaw Forward', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'jawLeft', displayName: 'Jaw Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'jawRight', displayName: 'Jaw Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthClose', displayName: 'Mouth Close', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthFunnel', displayName: 'Mouth Funnel', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthPucker', displayName: 'Mouth Pucker', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthLeft', displayName: 'Mouth Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthRight', displayName: 'Mouth Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthSmileLeft', displayName: 'Smile Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthSmileRight', displayName: 'Smile Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthFrownLeft', displayName: 'Frown Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthFrownRight', displayName: 'Frown Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthDimpleLeft', displayName: 'Dimple Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthDimpleRight', displayName: 'Dimple Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthStretchLeft', displayName: 'Stretch Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthStretchRight', displayName: 'Stretch Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthRollLower', displayName: 'Roll Lower', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthRollUpper', displayName: 'Roll Upper', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthShrugLower', displayName: 'Shrug Lower', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthShrugUpper', displayName: 'Shrug Upper', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthPressLeft', displayName: 'Press Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthPressRight', displayName: 'Press Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthLowerDownLeft', displayName: 'Lower Down Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthLowerDownRight', displayName: 'Lower Down Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthUpperUpLeft', displayName: 'Upper Up Left', category: 'mouth', defaultValue: 0, min: 0, max: 1 },
  { name: 'mouthUpperUpRight', displayName: 'Upper Up Right', category: 'mouth', defaultValue: 0, min: 0, max: 1 },

  // Eyebrows
  { name: 'browDownLeft', displayName: 'Down Left', category: 'eyebrows', defaultValue: 0, min: 0, max: 1 },
  { name: 'browDownRight', displayName: 'Down Right', category: 'eyebrows', defaultValue: 0, min: 0, max: 1 },
  { name: 'browInnerUp', displayName: 'Inner Up', category: 'eyebrows', defaultValue: 0, min: 0, max: 1 },
  { name: 'browOuterUpLeft', displayName: 'Outer Up Left', category: 'eyebrows', defaultValue: 0, min: 0, max: 1 },
  { name: 'browOuterUpRight', displayName: 'Outer Up Right', category: 'eyebrows', defaultValue: 0, min: 0, max: 1 },

  // Nose
  { name: 'noseSneerLeft', displayName: 'Sneer Left', category: 'nose', defaultValue: 0, min: 0, max: 1 },
  { name: 'noseSneerRight', displayName: 'Sneer Right', category: 'nose', defaultValue: 0, min: 0, max: 1 },

  // Cheeks
  { name: 'cheekPuff', displayName: 'Puff', category: 'cheeks', defaultValue: 0, min: 0, max: 1 },
  { name: 'cheekSquintLeft', displayName: 'Squint Left', category: 'cheeks', defaultValue: 0, min: 0, max: 1 },
  { name: 'cheekSquintRight', displayName: 'Squint Right', category: 'cheeks', defaultValue: 0, min: 0, max: 1 },

  // Other
  { name: 'tongueOut', displayName: 'Tongue Out', category: 'other', defaultValue: 0, min: 0, max: 1 },
]

// Model types
export interface LoadedModel {
  scene: Group
  animations: AnimationClip[]
  faceMesh: SkinnedMesh | Mesh | null
  blendShapes: BlendShapeMapping[]
  bones: Bone[]
  metadata: ModelMetadata
}

export interface ModelMetadata {
  name: string
  format: '3D Model Format'
  fileSize: number
  vertexCount: number
  faceCount: number
  hasBlendShapes: boolean
  hasSkeleton: boolean
  loadedAt: Date
}

// Accessory model types
export interface AccessoryModel {
  id: string
  type: AccessoryType
  scene: Group
  parentBone: string | null
  offset: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: number
  visible: boolean
}

export type AccessoryType = 'teeth_upper' | 'teeth_lower' | 'tongue' | 'eyes_left' | 'eyes_right'

// Animation types
export interface AnimationKeyframe {
  time: number
  blendShapes: BlendShapeValues
}

export interface AnimationTrack {
  name: string
  keyframes: AnimationKeyframe[]
  duration: number
}

export interface RecordedAnimation {
  id: string
  name: string
  tracks: AnimationTrack[]
  duration: number
  createdAt: Date
}

// Audio lip sync types
export interface Phoneme {
  symbol: string
  start: number
  end: number
}

export interface LipSyncData {
  phonemes: Phoneme[]
  duration: number
  audioFile: string
}

export interface PhonemeToBlendShape {
  phoneme: string
  blendShapes: BlendShapeValues
}

// Phoneme to blend shape mapping
export const PHONEME_MAP: PhonemeToBlendShape[] = [
  { phoneme: 'A', blendShapes: { jawOpen: 0.7, mouthFunnel: 0.3 } },
  { phoneme: 'B', blendShapes: { mouthClose: 0.9, mouthPressLeft: 0.3, mouthPressRight: 0.3 } },
  { phoneme: 'C', blendShapes: { jawOpen: 0.3, mouthSmileLeft: 0.2, mouthSmileRight: 0.2 } },
  { phoneme: 'D', blendShapes: { jawOpen: 0.2, mouthSmileLeft: 0.1, mouthSmileRight: 0.1 } },
  { phoneme: 'E', blendShapes: { jawOpen: 0.3, mouthSmileLeft: 0.5, mouthSmileRight: 0.5 } },
  { phoneme: 'F', blendShapes: { jawOpen: 0.1, mouthFunnel: 0.5, mouthRollLower: 0.3 } },
  { phoneme: 'G', blendShapes: { jawOpen: 0.4, mouthFunnel: 0.2 } },
  { phoneme: 'H', blendShapes: { jawOpen: 0.5, mouthFunnel: 0.1 } },
  { phoneme: 'X', blendShapes: { jawOpen: 0, mouthClose: 0.5 } }, // Rest/silence
]

// Preset expressions
export interface ExpressionPreset {
  name: string
  icon: string
  blendShapes: BlendShapeValues
}

export const EXPRESSION_PRESETS: ExpressionPreset[] = [
  {
    name: 'Neutral',
    icon: '😐',
    blendShapes: {}
  },
  {
    name: 'Happy',
    icon: '😊',
    blendShapes: {
      mouthSmileLeft: 0.8,
      mouthSmileRight: 0.8,
      cheekSquintLeft: 0.3,
      cheekSquintRight: 0.3,
      eyeSquintLeft: 0.2,
      eyeSquintRight: 0.2
    }
  },
  {
    name: 'Sad',
    icon: '😢',
    blendShapes: {
      mouthFrownLeft: 0.7,
      mouthFrownRight: 0.7,
      browInnerUp: 0.6,
      browDownLeft: 0.3,
      browDownRight: 0.3
    }
  },
  {
    name: 'Angry',
    icon: '😠',
    blendShapes: {
      browDownLeft: 0.8,
      browDownRight: 0.8,
      eyeSquintLeft: 0.4,
      eyeSquintRight: 0.4,
      jawOpen: 0.2,
      mouthFrownLeft: 0.5,
      mouthFrownRight: 0.5
    }
  },
  {
    name: 'Surprised',
    icon: '😮',
    blendShapes: {
      browInnerUp: 0.9,
      browOuterUpLeft: 0.7,
      browOuterUpRight: 0.7,
      eyeWideLeft: 0.8,
      eyeWideRight: 0.8,
      jawOpen: 0.5,
      mouthFunnel: 0.4
    }
  },
  {
    name: 'Wink',
    icon: '😉',
    blendShapes: {
      eyeBlinkLeft: 1,
      mouthSmileLeft: 0.5,
      mouthSmileRight: 0.3
    }
  },
  {
    name: 'Thinking',
    icon: '🤔',
    blendShapes: {
      browDownLeft: 0.5,
      browOuterUpRight: 0.6,
      eyeLookUpLeft: 0.3,
      eyeLookUpRight: 0.3,
      mouthPucker: 0.3,
      mouthLeft: 0.3
    }
  },
  {
    name: 'Scared',
    icon: '😨',
    blendShapes: {
      browInnerUp: 1,
      eyeWideLeft: 0.9,
      eyeWideRight: 0.9,
      jawOpen: 0.3,
      mouthStretchLeft: 0.4,
      mouthStretchRight: 0.4
    }
  }
]

// Export types
export interface ExportOptions {
  format: 'fbx' | 'gltf'
  includeAnimation: boolean
  includeBlendShapes: boolean
  includeAccessories: boolean
  vrOptimized: boolean
  targetEngine: 'unity' | 'unreal' | 'generic'
}

// Store types
export interface ModelStore {
  model: LoadedModel | null
  accessories: AccessoryModel[]
  blendShapeValues: BlendShapeValues
  isLoading: boolean
  error: string | null
  setModel: (model: LoadedModel | null) => void
  addAccessory: (accessory: AccessoryModel) => void
  removeAccessory: (id: string) => void
  updateAccessory: (id: string, updates: Partial<AccessoryModel>) => void
  setBlendShapeValue: (name: string, value: number) => void
  setBlendShapeValues: (values: BlendShapeValues) => void
  resetBlendShapes: () => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export interface AudioStore {
  audioFile: File | null
  audioUrl: string | null
  lipSyncData: LipSyncData | null
  isPlaying: boolean
  currentTime: number
  duration: number
  isProcessing: boolean
  setAudioFile: (file: File) => void
  setLipSyncData: (data: LipSyncData) => void
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setProcessing: (processing: boolean) => void
  reset: () => void
}

export interface UIStore {
  activePanel: 'controls' | 'models' | 'audio' | 'export'
  showGrid: boolean
  showWireframe: boolean
  cameraMode: 'orbit' | 'front' | 'side' | 'top'
  setActivePanel: (panel: 'controls' | 'models' | 'audio' | 'export') => void
  toggleGrid: () => void
  toggleWireframe: () => void
  setCameraMode: (mode: 'orbit' | 'front' | 'side' | 'top') => void
}
