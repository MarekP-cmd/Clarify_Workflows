import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})

class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => undefined
if (typeof Element !== 'undefined' && !Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:clarity-workflows-test'
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined
