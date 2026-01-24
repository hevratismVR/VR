import { useModelStore } from '../../stores/modelStore'
import type { BlendShapeMapping } from '../../types'

interface Props {
  blendShape: BlendShapeMapping
}

export default function BlendShapeSlider({ blendShape }: Props) {
  const value = useModelStore(state => state.blendShapeValues[blendShape.name] ?? blendShape.defaultValue)
  const setBlendShapeValue = useModelStore(state => state.setBlendShapeValue)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBlendShapeValue(blendShape.name, parseFloat(e.target.value))
  }

  return (
    <div className="space-y-1">
      <div className="slider-label">
        <span className="text-dark-300">{blendShape.displayName}</span>
        <span className="text-primary-400 font-mono">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={blendShape.min}
        max={blendShape.max}
        step={0.01}
        value={value}
        onChange={handleChange}
        className="w-full"
      />
    </div>
  )
}
