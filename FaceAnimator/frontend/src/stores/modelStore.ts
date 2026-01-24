import { create } from 'zustand'
import type { ModelStore, LoadedModel, AccessoryModel, BlendShapeValues } from '../types'

export const useModelStore = create<ModelStore>((set, get) => ({
  model: null,
  accessories: [],
  blendShapeValues: {},
  isLoading: false,
  error: null,

  setModel: (model: LoadedModel | null) => {
    // Initialize blend shape values when model is loaded
    const blendShapeValues: BlendShapeValues = {}
    if (model) {
      model.blendShapes.forEach(bs => {
        blendShapeValues[bs.name] = bs.defaultValue
      })
    }
    set({ model, blendShapeValues, error: null })
  },

  addAccessory: (accessory: AccessoryModel) => {
    set(state => ({
      accessories: [...state.accessories, accessory]
    }))
  },

  removeAccessory: (id: string) => {
    set(state => ({
      accessories: state.accessories.filter(a => a.id !== id)
    }))
  },

  updateAccessory: (id: string, updates: Partial<AccessoryModel>) => {
    set(state => ({
      accessories: state.accessories.map(a =>
        a.id === id ? { ...a, ...updates } : a
      )
    }))
  },

  setBlendShapeValue: (name: string, value: number) => {
    set(state => ({
      blendShapeValues: {
        ...state.blendShapeValues,
        [name]: value
      }
    }))
  },

  setBlendShapeValues: (values: BlendShapeValues) => {
    set(state => ({
      blendShapeValues: {
        ...state.blendShapeValues,
        ...values
      }
    }))
  },

  resetBlendShapes: () => {
    const { model } = get()
    if (!model) return

    const blendShapeValues: BlendShapeValues = {}
    model.blendShapes.forEach(bs => {
      blendShapeValues[bs.name] = bs.defaultValue
    })
    set({ blendShapeValues })
  },

  setLoading: (isLoading: boolean) => set({ isLoading }),

  setError: (error: string | null) => set({ error })
}))
