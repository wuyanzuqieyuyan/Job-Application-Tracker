import { computed, onBeforeUnmount, ref } from 'vue'

export type ViewMode = 'table' | 'cards'
export type ViewPreference = ViewMode | 'auto'

const STORAGE_KEY = 'jobtrack-view-preference'
const NARROW_QUERY = '(max-width: 1020px)'
const NARROW_MAX_WIDTH = 1020

function isViewMode(value: unknown): value is ViewMode {
  return value === 'table' || value === 'cards'
}

function readStoredPreference(): ViewMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isViewMode(raw) ? raw : null
  } catch {
    return null
  }
}

export function useViewMode() {
  const manualMode = ref<ViewMode | null>(readStoredPreference())
  const narrow = ref(false)
  let mediaQuery: MediaQueryList | null = null
  let resizeFrame = 0

  function syncViewport() {
    if (mediaQuery) {
      narrow.value = mediaQuery.matches
    } else if (typeof window !== 'undefined') {
      narrow.value = window.innerWidth <= NARROW_MAX_WIDTH
    }
  }

  function handleChange(event: MediaQueryListEvent) {
    narrow.value = event.matches
  }

  function handleResize() {
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      syncViewport()
    })
  }

  if (typeof window !== 'undefined') {
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia(NARROW_QUERY)
      narrow.value = mediaQuery.matches
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange)
      } else {
        mediaQuery.addListener(handleChange)
      }
    } else {
      narrow.value = window.innerWidth <= NARROW_MAX_WIDTH
    }
    // Fallback: re-evaluate on every resize in case the media query change
    // event is not delivered (some browsers/embeds). rAF-throttled.
    window.addEventListener('resize', handleResize)
  }

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize)
    }
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = 0
    }
    if (!mediaQuery) return
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', handleChange)
    } else {
      mediaQuery.removeListener(handleChange)
    }
    mediaQuery = null
  })

  const autoMode = computed<ViewMode>(() => (narrow.value ? 'cards' : 'table'))
  const viewMode = computed<ViewMode>(() => manualMode.value ?? autoMode.value)
  const isManual = computed(() => manualMode.value !== null)
  const isAuto = computed(() => manualMode.value === null)

  function setViewMode(mode: ViewMode) {
    manualMode.value = mode
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // storage unavailable: keep the in-memory choice for this session
    }
  }

  function clearPreference() {
    manualMode.value = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // storage unavailable: nothing to clear
    }
  }

  return {
    viewMode,
    autoMode,
    manualMode,
    isManual,
    isAuto,
    setViewMode,
    clearPreference,
  }
}
