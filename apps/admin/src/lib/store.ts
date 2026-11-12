import { create } from "zustand";

// Solo estado de UI; los datos del servidor viven en TanStack Query.
// El menú lateral solo se abre y cierra bajo 60rem; arriba siempre está visible.
export const useUi = create<{ menuOpen: boolean; setMenuOpen: (v: boolean) => void }>((set) => ({
  menuOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}));
