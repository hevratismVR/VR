import { useCallback } from 'react'
import { useModelStore } from '../stores/modelStore'
import { loadModel } from '../utils/modelLoader'

export default function ModelUploader() {
  const setModel = useModelStore(state => state.setModel)
  const setLoading = useModelStore(state => state.setLoading)
  const setError = useModelStore(state => state.setError)

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setLoading(true)
    setError(null)

    try {
      const model = await loadModel(file)
      setModel(model)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model')
      console.error('Error loading model:', err)
    } finally {
      setLoading(false)
    }
  }, [setModel, setLoading, setError])

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const file = event.dataTransfer.files?.[0]
    if (!file) return

    setLoading(true)
    setError(null)

    try {
      const model = await loadModel(file)
      setModel(model)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model')
      console.error('Error loading model:', err)
    } finally {
      setLoading(false)
    }
  }, [setModel, setLoading, setError])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className="w-96 p-8 panel fade-in"
    >
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-dark-700 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-primary-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">
          Upload 3D Character
        </h2>
        
        <p className="text-dark-400 text-sm mb-6">
          Drag and drop your 3D model file or click to browse.
          <br />
          Supported formats: FBX, GLTF, GLB, OBJ
        </p>

        <label className="btn btn-primary cursor-pointer inline-flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          Browse Files
          <input
            type="file"
            accept=".fbx,.gltf,.glb,.obj"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        <div className="mt-6 pt-6 border-t border-dark-700">
          <p className="text-dark-500 text-xs">
            The system will automatically detect the face mesh and create animation controls.
          </p>
        </div>
      </div>
    </div>
  )
}
