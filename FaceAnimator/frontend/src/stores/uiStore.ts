import { create } from 'zustand'
import type { UIStore } from '../types'

export const useUIStore = create<UIStore>((set) => ({
  activePanel: 'controls',
  showGrid: true,
  showWireframe: false,
  cameraMode: 'orbit',

  setActivePanel: (panel) => set({ activePanel: panel }),

  toggleGrid: () => set(state => ({ showGrid: !state.showGrid })),

  toggleWireframe: () => set(state => ({ showWireframe: !state.showWireframe })),

  setCameraMode: (mode) => set({ cameraMode: mode })
}))
