import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows, Grid } from '@react-three/drei'
import { useUIStore } from './stores/uiStore'
import { useModelStore } from './stores/modelStore'
import Header from './components/Header'
import ControlPanel from './components/Controls/ControlPanel'
import ModelUploader from './components/ModelUploader'
import FaceModel from './components/Canvas3D/FaceModel'
import AudioPanel from './components/Audio/AudioPanel'
import LoadingScreen from './components/LoadingScreen'

function App() {
  const showGrid = useUIStore(state => state.showGrid)
  const model = useModelStore(state => state.model)
  const isLoading = useModelStore(state => state.isLoading)

  return (
    <div className="w-full h-full flex flex-col bg-dark-900">
      <Header />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Main 3D Viewport */}
        <div className="flex-1 relative">
          <Canvas
            camera={{ position: [0, 0, 2], fov: 50 }}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            shadows
          >
            <Suspense fallback={null}>
              <ambientLight intensity={0.5} />
              <directionalLight
                position={[5, 5, 5]}
                intensity={1}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <directionalLight position={[-5, 5, -5]} intensity={0.3} />
              
              {model && <FaceModel />}
              
              {showGrid && (
                <Grid
                  args={[10, 10]}
                  cellSize={0.5}
                  cellThickness={0.5}
                  cellColor="#334155"
                  sectionSize={2}
                  sectionThickness={1}
                  sectionColor="#475569"
                  fadeDistance={10}
                  fadeStrength={1}
                  followCamera={false}
                  infiniteGrid={true}
                />
              )}
              
              <ContactShadows
                position={[0, -0.5, 0]}
                opacity={0.4}
                scale={10}
                blur={2}
                far={4}
              />
              
              <Environment preset="studio" />
              <OrbitControls
                makeDefault
                minDistance={0.5}
                maxDistance={10}
                target={[0, 0, 0]}
              />
            </Suspense>
          </Canvas>
          
          {/* Model upload overlay */}
          {!model && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <ModelUploader />
            </div>
          )}
          
          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-dark-900/80">
              <LoadingScreen />
            </div>
          )}
        </div>
        
        {/* Right Side Panel */}
        <div className="w-80 bg-dark-800 border-l border-dark-700 flex flex-col overflow-hidden">
          <ControlPanel />
        </div>
      </div>
      
      {/* Bottom Audio Panel */}
      {model && (
        <div className="h-24 bg-dark-800 border-t border-dark-700">
          <AudioPanel />
        </div>
      )}
    </div>
  )
}

export default App
