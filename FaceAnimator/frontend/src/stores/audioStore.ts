import { create } from 'zustand'
import type { AudioStore, LipSyncData } from '../types'

export const useAudioStore = create<AudioStore>((set) => ({
  audioFile: null,
  audioUrl: null,
  lipSyncData: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  isProcessing: false,

  setAudioFile: (file: File) => {
    // Revoke previous URL if exists
    set(state => {
      if (state.audioUrl) {
        URL.revokeObjectURL(state.audioUrl)
      }
      return {
        audioFile: file,
        audioUrl: URL.createObjectURL(file),
        lipSyncData: null,
        currentTime: 0,
        duration: 0
      }
    })
  },

  setLipSyncData: (data: LipSyncData) => set({ lipSyncData: data }),

  setPlaying: (isPlaying: boolean) => set({ isPlaying }),

  setCurrentTime: (currentTime: number) => set({ currentTime }),

  setDuration: (duration: number) => set({ duration }),

  setProcessing: (isProcessing: boolean) => set({ isProcessing }),

  reset: () => set(state => {
    if (state.audioUrl) {
      URL.revokeObjectURL(state.audioUrl)
    }
    return {
      audioFile: null,
      audioUrl: null,
      lipSyncData: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      isProcessing: false
    }
  })
}))
