import { useCallback } from 'react'
import { useModelStore } from '../../stores/modelStore'
import type { AccessoryType, AccessoryModel } from '../../types'
import { loadModel } from '../../utils/modelLoader'

const ACCESSORY_TYPES: { type: AccessoryType; label: string; icon: string }[] = [
  { type: 'teeth_upper', label: 'Upper Teeth', icon: '🦷' },
  { type: 'teeth_lower', label: 'Lower Teeth', icon: '🦷' },
  { type: 'tongue', label: 'Tongue', icon: '👅' },
  { type: 'eyes_left', label: 'Left Eye', icon: '👁️' },
  { type: 'eyes_right', label: 'Right Eye', icon: '👁️' },
]

export default function AccessoryPanel() {
  const accessories = useModelStore(state => state.accessories)
  const addAccessory = useModelStore(state => state.addAccessory)
  const removeAccessory = useModelStore(state => state.removeAccessory)
  const updateAccessory = useModelStore(state => state.updateAccessory)

  const handleFileUpload = useCallback(async (type: AccessoryType, file: File) => {
    try {
      const model = await loadModel(file)
      
      const accessory: AccessoryModel = {
        id: `${type}-${Date.now()}`,
        type,
        scene: model.scene,
        parentBone: null,
        offset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
        visible: true
      }
      
      addAccessory(accessory)
    } catch (err) {
      console.error('Failed to load accessory:', err)
    }
  }, [addAccessory])

  const getAccessoryByType = (type: AccessoryType) => {
    return accessories.find(a => a.type === type)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-dark-200">Model Accessories</h3>
      </div>

      <p className="text-xs text-dark-500">
        Upload separate models for teeth, tongue, and eyes to integrate into the face animation.
      </p>

      <div className="space-y-3">
        {ACCESSORY_TYPES.map(({ type, label, icon }) => {
          const accessory = getAccessoryByType(type)
          
          return (
            <div key={type} className="p-3 bg-dark-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{icon}</span>
                  <span className="text-sm text-dark-200">{label}</span>
                </div>
                
                {accessory ? (
                  <button
                    onClick={() => removeAccessory(accessory.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                ) : (
                  <label className="text-xs text-primary-400 hover:text-primary-300 cursor-pointer">
                    Upload
                    <input
                      type="file"
                      accept=".fbx,.gltf,.glb,.obj"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileUpload(type, file)
                      }}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {accessory && (
                <div className="space-y-2 mt-3 pt-3 border-t border-dark-600">
                  {/* Visibility toggle */}
                  <label className="flex items-center gap-2 text-xs text-dark-400">
                    <input
                      type="checkbox"
                      checked={accessory.visible}
                      onChange={(e) => updateAccessory(accessory.id, { visible: e.target.checked })}
                      className="rounded"
                    />
                    Visible
                  </label>

                  {/* Position controls */}
                  <div className="grid grid-cols-3 gap-2">
                    {(['x', 'y', 'z'] as const).map(axis => (
                      <div key={axis}>
                        <label className="text-xs text-dark-500 uppercase">{axis}</label>
                        <input
                          type="number"
                          step={0.01}
                          value={accessory.offset[axis]}
                          onChange={(e) => updateAccessory(accessory.id, {
                            offset: { ...accessory.offset, [axis]: parseFloat(e.target.value) || 0 }
                          })}
                          className="input text-xs py-1"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Scale control */}
                  <div>
                    <label className="text-xs text-dark-500">Scale</label>
                    <input
                      type="range"
                      min={0.1}
                      max={3}
                      step={0.1}
                      value={accessory.scale}
                      onChange={(e) => updateAccessory(accessory.id, { scale: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="p-3 bg-dark-900 rounded-lg">
        <p className="text-xs text-dark-500">
          <strong className="text-dark-400">Tip:</strong> Position teeth inside the mouth area. 
          They will become visible when the jaw opens during animation.
        </p>
      </div>
    </div>
  )
}
