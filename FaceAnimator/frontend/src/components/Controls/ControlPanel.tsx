import { useState } from 'react'
import { useModelStore } from '../../stores/modelStore'
import type { BlendShapeCategory } from '../../types'
import { EXPRESSION_PRESETS } from '../../types'
import BlendShapeSlider from './BlendShapeSlider'
import AccessoryPanel from './AccessoryPanel'

type TabType = 'expressions' | 'eyes' | 'mouth' | 'eyebrows' | 'other' | 'accessories'

export default function ControlPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('expressions')
  const model = useModelStore(state => state.model)
  const blendShapeValues = useModelStore(state => state.blendShapeValues)
  const setBlendShapeValues = useModelStore(state => state.setBlendShapeValues)
  const resetBlendShapes = useModelStore(state => state.resetBlendShapes)

  if (!model) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-dark-500 text-sm text-center">
          Upload a 3D model to access animation controls
        </p>
      </div>
    )
  }

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'expressions', label: 'Presets', icon: '😊' },
    { id: 'eyes', label: 'Eyes', icon: '👁️' },
    { id: 'mouth', label: 'Mouth', icon: '👄' },
    { id: 'eyebrows', label: 'Brows', icon: '🤨' },
    { id: 'other', label: 'Other', icon: '✨' },
    { id: 'accessories', label: 'Models', icon: '🦷' },
  ]

  const getBlendShapesByCategory = (category: BlendShapeCategory) => {
    return model.blendShapes.filter(bs => bs.category === category)
  }

  const applyPreset = (blendShapes: Record<string, number>) => {
    // Reset all blend shapes first
    resetBlendShapes()
    // Apply the preset values
    setBlendShapeValues(blendShapes)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab Navigation */}
      <div className="flex border-b border-dark-700 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-2 py-3 text-xs font-medium transition-colors min-w-0 ${
              activeTab === tab.id
                ? 'text-primary-400 border-b-2 border-primary-400 bg-dark-700/50'
                : 'text-dark-400 hover:text-dark-200 hover:bg-dark-700/30'
            }`}
          >
            <span className="block text-base mb-0.5">{tab.icon}</span>
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'expressions' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium text-dark-200">Expression Presets</h3>
              <button
                onClick={resetBlendShapes}
                className="text-xs text-dark-400 hover:text-dark-200"
              >
                Reset All
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              {EXPRESSION_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset.blendShapes)}
                  className="flex items-center gap-2 p-3 rounded-lg bg-dark-700 hover:bg-dark-600 transition-colors text-left"
                >
                  <span className="text-2xl">{preset.icon}</span>
                  <span className="text-sm text-dark-200">{preset.name}</span>
                </button>
              ))}
            </div>

            {/* Quick sliders for common expressions */}
            <div className="mt-6 space-y-3">
              <h4 className="text-xs font-medium text-dark-400 uppercase">Quick Controls</h4>
              {model.blendShapes.slice(0, 6).map(bs => (
                <BlendShapeSlider key={bs.name} blendShape={bs} />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'eyes' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium text-dark-200">Eye Controls</h3>
              <span className="text-xs text-dark-500">
                {getBlendShapesByCategory('eyes').length} controls
              </span>
            </div>
            {getBlendShapesByCategory('eyes').length > 0 ? (
              getBlendShapesByCategory('eyes').map(bs => (
                <BlendShapeSlider key={bs.name} blendShape={bs} />
              ))
            ) : (
              <p className="text-dark-500 text-sm">No eye blend shapes detected</p>
            )}
          </div>
        )}

        {activeTab === 'mouth' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium text-dark-200">Mouth Controls</h3>
              <span className="text-xs text-dark-500">
                {getBlendShapesByCategory('mouth').length} controls
              </span>
            </div>
            {getBlendShapesByCategory('mouth').length > 0 ? (
              getBlendShapesByCategory('mouth').map(bs => (
                <BlendShapeSlider key={bs.name} blendShape={bs} />
              ))
            ) : (
              <p className="text-dark-500 text-sm">No mouth blend shapes detected</p>
            )}
          </div>
        )}

        {activeTab === 'eyebrows' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium text-dark-200">Eyebrow Controls</h3>
              <span className="text-xs text-dark-500">
                {getBlendShapesByCategory('eyebrows').length} controls
              </span>
            </div>
            {getBlendShapesByCategory('eyebrows').length > 0 ? (
              getBlendShapesByCategory('eyebrows').map(bs => (
                <BlendShapeSlider key={bs.name} blendShape={bs} />
              ))
            ) : (
              <p className="text-dark-500 text-sm">No eyebrow blend shapes detected</p>
            )}
          </div>
        )}

        {activeTab === 'other' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium text-dark-200">Other Controls</h3>
              <span className="text-xs text-dark-500">
                {getBlendShapesByCategory('nose').length + 
                 getBlendShapesByCategory('cheeks').length + 
                 getBlendShapesByCategory('other').length} controls
              </span>
            </div>
            {[...getBlendShapesByCategory('nose'), 
              ...getBlendShapesByCategory('cheeks'), 
              ...getBlendShapesByCategory('other')].map(bs => (
              <BlendShapeSlider key={bs.name} blendShape={bs} />
            ))}
          </div>
        )}

        {activeTab === 'accessories' && <AccessoryPanel />}
      </div>

      {/* Model Info Footer */}
      <div className="p-3 border-t border-dark-700 bg-dark-800/50">
        <div className="text-xs text-dark-500 space-y-1">
          <div className="flex justify-between">
            <span>Model:</span>
            <span className="text-dark-300 truncate ml-2">{model.metadata.name}</span>
          </div>
          <div className="flex justify-between">
            <span>Blend Shapes:</span>
            <span className="text-dark-300">{model.blendShapes.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Vertices:</span>
            <span className="text-dark-300">{model.metadata.vertexCount.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
