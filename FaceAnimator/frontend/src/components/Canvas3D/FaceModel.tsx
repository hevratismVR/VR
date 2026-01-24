import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import { applyBlendShapeValues } from '../../utils/faceDetector'

export default function FaceModel() {
  const groupRef = useRef<THREE.Group>(null)
  const model = useModelStore(state => state.model)
  const blendShapeValues = useModelStore(state => state.blendShapeValues)
  const accessories = useModelStore(state => state.accessories)
  const showWireframe = useUIStore(state => state.showWireframe)

  // Apply blend shape values to the face mesh on each frame
  useFrame(() => {
    if (model?.faceMesh) {
      applyBlendShapeValues(model.faceMesh, blendShapeValues)
    }
  })

  // Toggle wireframe mode
  useEffect(() => {
    if (!model?.scene) return

    model.scene.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        const material = object.material
        if (Array.isArray(material)) {
          material.forEach(mat => {
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.wireframe = showWireframe
            }
          })
        } else if (material instanceof THREE.MeshStandardMaterial) {
          material.wireframe = showWireframe
        }
      }
    })
  }, [model, showWireframe])

  if (!model) return null

  return (
    <group ref={groupRef}>
      {/* Main model */}
      <primitive object={model.scene} />

      {/* Accessories (teeth, tongue, eyes) */}
      {accessories.map(accessory => (
        accessory.visible && (
          <group
            key={accessory.id}
            position={[accessory.offset.x, accessory.offset.y, accessory.offset.z]}
            rotation={[accessory.rotation.x, accessory.rotation.y, accessory.rotation.z]}
            scale={accessory.scale}
          >
            <primitive object={accessory.scene} />
          </group>
        )
      ))}
    </group>
  )
}
