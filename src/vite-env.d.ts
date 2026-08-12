/// <reference types="vite/client" />

import type { ClarityCoreBridge, ClarityIngestionBridge, ClarityLifecycleBridge } from './coreClient'

declare global {
  interface Window {
    clarityCore?: ClarityCoreBridge
    clarityFiles?: ClarityIngestionBridge
    clarityLifecycle?: ClarityLifecycleBridge
  }
}

declare module '*.css'
