import { useRef, useEffect, useCallback } from 'react'
import { useAudioStore } from '../../stores/audioStore'
import { useModelStore } from '../../stores/modelStore'
import { getBlendShapesForPhoneme } from '../../utils/lipSync'

export default function AudioPanel() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const animationFrameRef = useRef<number>()

  const audioUrl = useAudioStore(state => state.audioUrl)
  const lipSyncData = useAudioStore(state => state.lipSyncData)
  const isPlaying = useAudioStore(state => state.isPlaying)
  const currentTime = useAudioStore(state => state.currentTime)
  const duration = useAudioStore(state => state.duration)
  const isProcessing = useAudioStore(state => state.isProcessing)
  const setAudioFile = useAudioStore(state => state.setAudioFile)
  const setPlaying = useAudioStore(state => state.setPlaying)
  const setCurrentTime = useAudioStore(state => state.setCurrentTime)
  const setDuration = useAudioStore(state => state.setDuration)
  const setProcessing = useAudioStore(state => state.setProcessing)
  const setLipSyncData = useAudioStore(state => state.setLipSyncData)

  const setBlendShapeValues = useModelStore(state => state.setBlendShapeValues)
  const resetBlendShapes = useModelStore(state => state.resetBlendShapes)

  // Handle audio file upload
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setAudioFile(file)
      // Simulate phoneme extraction (in production, this would call a backend service)
      simulatePhonemeExtraction(file)
    }
  }, [setAudioFile])

  // Simulate phoneme extraction (placeholder - would normally use backend)
  const simulatePhonemeExtraction = useCallback(async (file: File) => {
    setProcessing(true)
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    // Generate mock phoneme data based on audio duration
    const audio = new Audio(URL.createObjectURL(file))
    await new Promise<void>(resolve => {
      audio.addEventListener('loadedmetadata', () => {
        const duration = audio.duration
        const phonemes = generateMockPhonemes(duration)
        setLipSyncData({
          phonemes,
          duration,
          audioFile: file.name
        })
        setProcessing(false)
        resolve()
      })
    })
  }, [setLipSyncData, setProcessing])

  // Generate mock phonemes for demo purposes
  const generateMockPhonemes = (duration: number) => {
    const phonemes = []
    const phonemeSymbols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']
    let time = 0
    
    while (time < duration) {
      const phonemeDuration = 0.1 + Math.random() * 0.2
      phonemes.push({
        symbol: phonemeSymbols[Math.floor(Math.random() * phonemeSymbols.length)],
        start: time,
        end: Math.min(time + phonemeDuration, duration)
      })
      time += phonemeDuration
    }
    
    return phonemes
  }

  // Animation loop for lip sync
  const animate = useCallback(() => {
    if (!audioRef.current || !lipSyncData) return

    const time = audioRef.current.currentTime
    setCurrentTime(time)

    // Find current phoneme
    const currentPhoneme = lipSyncData.phonemes.find(
      p => time >= p.start && time < p.end
    )

    if (currentPhoneme) {
      const blendShapes = getBlendShapesForPhoneme(currentPhoneme.symbol)
      setBlendShapeValues(blendShapes)
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }, [lipSyncData, isPlaying, setCurrentTime, setBlendShapeValues])

  // Start/stop animation loop
  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying, animate])

  // Handle audio metadata
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
    }

    const handleEnded = () => {
      setPlaying(false)
      resetBlendShapes()
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [setDuration, setPlaying, resetBlendShapes])

  // Play/pause toggle
  const togglePlayback = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current.play()
      setPlaying(true)
    }
  }

  // Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-full flex items-center px-4 gap-4">
      {/* Hidden audio element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} />}

      {/* Upload button */}
      {!audioUrl && (
        <label className="btn btn-secondary cursor-pointer flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          Upload Audio
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex items-center gap-2">
          <div className="spinner"></div>
          <span className="text-dark-400 text-sm">Analyzing audio...</span>
        </div>
      )}

      {/* Playback controls */}
      {audioUrl && !isProcessing && (
        <>
          <button
            onClick={togglePlayback}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-600 hover:bg-primary-500 text-white"
          >
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Time display */}
          <span className="text-dark-400 text-sm font-mono w-20">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Timeline */}
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.01}
              value={currentTime}
              onChange={handleSeek}
              className="w-full"
            />
            
            {/* Phoneme markers */}
            {lipSyncData && (
              <div className="absolute top-full left-0 right-0 h-4 mt-1 overflow-hidden">
                {lipSyncData.phonemes.map((p, i) => (
                  <div
                    key={i}
                    className="absolute h-full bg-primary-500/30 border-l border-primary-500/50"
                    style={{
                      left: `${(p.start / duration) * 100}%`,
                      width: `${((p.end - p.start) / duration) * 100}%`
                    }}
                    title={p.symbol}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Lip sync indicator */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${lipSyncData ? 'bg-green-500' : 'bg-dark-500'}`} />
            <span className="text-dark-400 text-xs">
              {lipSyncData ? 'Lip Sync Ready' : 'No Lip Sync'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
