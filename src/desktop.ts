/**
 * Thin wrapper over the Electron bridge. The same build runs in a plain browser, where the bridge
 * is absent and the app falls back to `window.print()`, so every caller must tolerate `null`.
 */
export type SavePdfResult = { ok: true; filePath: string } | { ok: false; canceled?: boolean; error?: string }

export type DesktopBridge = {
  desktop: true
  savePdf: (suggestedName: string) => Promise<SavePdfResult>
  print: () => Promise<{ ok: boolean }>
  reveal: (filePath: string) => Promise<{ ok: boolean }>
  onSavePdfRequested: (handler: () => void) => () => void
}

declare global {
  interface Window {
    bandbuilder?: DesktopBridge
  }
}

export const desktop = (): DesktopBridge | null =>
  typeof window !== 'undefined' && window.bandbuilder?.desktop ? window.bandbuilder : null

export const isDesktop = () => desktop() !== null
