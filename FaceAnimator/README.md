# Face Animator

A web-based 3D character face animation system that allows users to upload 3D character files, automatically detect and isolate the face, and animate facial features with manual controls and audio-driven lip sync.

## Features

- **3D Model Upload**: Support for FBX, GLTF/GLB, and OBJ formats
- **Automatic Face Detection**: Intelligent detection of face mesh and blend shapes
- **Manual Animation Controls**: Sliders for eyes, mouth, eyebrows, and more
- **Expression Presets**: One-click preset expressions (Happy, Sad, Angry, etc.)
- **Teeth/Tongue Integration**: Upload separate models for realistic mouth interior
- **Audio Lip Sync**: Phoneme-based animation from audio files
- **FBX Export**: Export animated models for Unity/Unreal Engine
- **VR-Ready**: Optimized exports for VR applications

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **3D Rendering**: Three.js, React Three Fiber, Drei
- **State Management**: Zustand
- **Styling**: TailwindCSS
- **Audio Processing**: Web Audio API

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
cd FaceAnimator/frontend
npm install
```

### Development

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

### Build

```bash
npm run build
```

## Usage

### 1. Upload a 3D Model

Drag and drop or click to upload a 3D character file (FBX, GLTF, GLB, or OBJ).
The system will automatically detect the face mesh and available blend shapes.

### 2. Animate the Face

Use the control panel on the right to animate facial features:

- **Presets Tab**: Quick expression presets
- **Eyes Tab**: Control eye blink, look direction, squint
- **Mouth Tab**: Control jaw, smile, frown, pucker
- **Brows Tab**: Control eyebrow raise, furrow
- **Other Tab**: Nose, cheeks, and custom blend shapes

### 3. Add Accessories (Optional)

Upload separate models for:
- Upper/Lower Teeth
- Tongue
- Eyes

Position them using the offset and scale controls.

### 4. Add Audio Lip Sync (Optional)

Upload an audio file to enable automatic lip synchronization.
The system analyzes phonemes and maps them to mouth shapes.

### 5. Export

Click "Export FBX" to download the animated model for use in game engines.

## Project Structure

```
FaceAnimator/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Audio/          # Audio playback and lip sync
│   │   │   ├── Canvas3D/       # 3D viewport components
│   │   │   └── Controls/       # Animation control panels
│   │   ├── stores/             # Zustand state stores
│   │   ├── types/              # TypeScript type definitions
│   │   ├── utils/              # Utility functions
│   │   │   ├── faceDetector.ts # Face mesh detection
│   │   │   ├── lipSync.ts      # Phoneme to blend shape mapping
│   │   │   ├── modelLoader.ts  # 3D file loading
│   │   │   └── fbxExporter.ts  # Export functionality
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## Supported Blend Shapes

The system supports ARKit-compatible blend shape names:

### Eyes
- eyeBlinkLeft, eyeBlinkRight
- eyeLookUpLeft, eyeLookUpRight, eyeLookDownLeft, eyeLookDownRight
- eyeLookInLeft, eyeLookInRight, eyeLookOutLeft, eyeLookOutRight
- eyeWideLeft, eyeWideRight
- eyeSquintLeft, eyeSquintRight

### Mouth
- jawOpen, jawForward, jawLeft, jawRight
- mouthClose, mouthFunnel, mouthPucker
- mouthSmileLeft, mouthSmileRight
- mouthFrownLeft, mouthFrownRight
- And more...

### Eyebrows
- browDownLeft, browDownRight
- browInnerUp
- browOuterUpLeft, browOuterUpRight

### Other
- noseSneerLeft, noseSneerRight
- cheekPuff, cheekSquintLeft, cheekSquintRight
- tongueOut

## Phoneme Mapping

Audio lip sync uses the following phoneme-to-viseme mapping:

| Phoneme | Mouth Shape |
|---------|-------------|
| A, I | Open mouth |
| E | Wide mouth |
| O | Round mouth |
| U | Small round |
| B, M, P | Closed lips |
| F, V | Lower lip in |
| X | Rest/silence |

## Export Options

- **Format**: FBX (via GLTF conversion)
- **Include Animation**: Export with recorded animation
- **Include Blend Shapes**: Export all facial blend shapes
- **Include Accessories**: Merge teeth/tongue/eyes
- **VR Optimized**: Reduce complexity for VR performance
- **Target Engine**: Unity or Unreal compatibility settings

## Known Limitations

- FBX export currently requires a backend service for full support
- Audio lip sync uses simulated phoneme detection (production would use Rhubarb)
- Blend shape auto-generation is not yet implemented

## Future Enhancements

- [ ] Real-time webcam face tracking
- [ ] Text-to-speech with lip sync
- [ ] Animation recording and playback
- [ ] Multi-character scenes
- [ ] VR preview mode
- [ ] Backend phoneme extraction service

## License

MIT

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a PR.
