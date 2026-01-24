import type { BlendShapeValues, PhonemeToBlendShape } from '../types'
import { PHONEME_MAP } from '../types'

/**
 * Get the blend shape values for a given phoneme symbol
 */
export function getBlendShapesForPhoneme(phoneme: string): BlendShapeValues {
  const mapping = PHONEME_MAP.find(p => p.phoneme === phoneme)
  return mapping?.blendShapes ?? {}
}

/**
 * Interpolate between two blend shape value sets
 */
export function interpolateBlendShapes(
  from: BlendShapeValues,
  to: BlendShapeValues,
  t: number // 0 to 1
): BlendShapeValues {
  const result: BlendShapeValues = {}
  const allKeys = new Set([...Object.keys(from), ...Object.keys(to)])

  for (const key of allKeys) {
    const fromValue = from[key] ?? 0
    const toValue = to[key] ?? 0
    result[key] = fromValue + (toValue - fromValue) * t
  }

  return result
}

/**
 * Create a smooth animation curve for lip sync
 * Uses easing for natural transitions
 */
export function createLipSyncCurve(
  phonemes: Array<{ symbol: string; start: number; end: number }>,
  sampleRate: number = 60
): Array<{ time: number; blendShapes: BlendShapeValues }> {
  if (phonemes.length === 0) return []

  const result: Array<{ time: number; blendShapes: BlendShapeValues }> = []
  const totalDuration = phonemes[phonemes.length - 1].end
  const frameCount = Math.ceil(totalDuration * sampleRate)

  for (let i = 0; i < frameCount; i++) {
    const time = i / sampleRate
    
    // Find current and next phoneme
    let currentPhoneme = phonemes.find(p => time >= p.start && time < p.end)
    let nextPhoneme = phonemes.find(p => p.start > time)
    
    if (!currentPhoneme) {
      // If no current phoneme, use rest position
      result.push({ time, blendShapes: {} })
      continue
    }

    const currentBlendShapes = getBlendShapesForPhoneme(currentPhoneme.symbol)
    
    // Calculate transition progress within the phoneme
    const phonemeDuration = currentPhoneme.end - currentPhoneme.start
    const phonemeProgress = (time - currentPhoneme.start) / phonemeDuration
    
    // If we're near the end of the phoneme and there's a next one, start transitioning
    const transitionThreshold = 0.7
    
    if (phonemeProgress > transitionThreshold && nextPhoneme) {
      const transitionProgress = (phonemeProgress - transitionThreshold) / (1 - transitionThreshold)
      const nextBlendShapes = getBlendShapesForPhoneme(nextPhoneme.symbol)
      const easedProgress = easeInOutQuad(transitionProgress)
      result.push({
        time,
        blendShapes: interpolateBlendShapes(currentBlendShapes, nextBlendShapes, easedProgress)
      })
    } else {
      // Apply easing for attack phase
      const attackThreshold = 0.3
      if (phonemeProgress < attackThreshold) {
        const attackProgress = phonemeProgress / attackThreshold
        const easedProgress = easeOutQuad(attackProgress)
        result.push({
          time,
          blendShapes: scaleBlendShapes(currentBlendShapes, easedProgress)
        })
      } else {
        result.push({ time, blendShapes: currentBlendShapes })
      }
    }
  }

  return result
}

/**
 * Scale all blend shape values by a factor
 */
function scaleBlendShapes(blendShapes: BlendShapeValues, factor: number): BlendShapeValues {
  const result: BlendShapeValues = {}
  for (const [key, value] of Object.entries(blendShapes)) {
    result[key] = value * factor
  }
  return result
}

/**
 * Easing function: ease out quad
 */
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/**
 * Easing function: ease in out quad
 */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/**
 * Map Rhubarb lip sync output to our phoneme format
 * Rhubarb uses: A, B, C, D, E, F, G, H, X
 */
export function mapRhubarbPhonemes(
  rhubarbOutput: Array<{ start: number; end: number; value: string }>
): Array<{ symbol: string; start: number; end: number }> {
  return rhubarbOutput.map(p => ({
    symbol: p.value,
    start: p.start,
    end: p.end
  }))
}

/**
 * Generate viseme (visual phoneme) sequence from text
 * This is a simplified version - production would use TTS + forced alignment
 */
export function textToVisemes(text: string): string[] {
  const visemeMap: Record<string, string> = {
    'a': 'A', 'e': 'E', 'i': 'E', 'o': 'A', 'u': 'A',
    'b': 'B', 'p': 'B', 'm': 'B',
    'f': 'F', 'v': 'F',
    'c': 'C', 'k': 'C', 'g': 'G', 'q': 'C',
    'd': 'D', 't': 'D', 'n': 'D', 'l': 'D', 's': 'D', 'z': 'D',
    'r': 'D',
    'h': 'H',
    ' ': 'X', '.': 'X', ',': 'X', '!': 'X', '?': 'X'
  }

  return text.toLowerCase().split('').map(char => visemeMap[char] || 'X')
}

/**
 * Create phoneme timeline from viseme sequence
 */
export function visemesToTimeline(
  visemes: string[],
  duration: number
): Array<{ symbol: string; start: number; end: number }> {
  const phonemeDuration = duration / visemes.length
  
  return visemes.map((symbol, i) => ({
    symbol,
    start: i * phonemeDuration,
    end: (i + 1) * phonemeDuration
  }))
}
