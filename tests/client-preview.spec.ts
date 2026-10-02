// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { createElement, useSyncExternalStore } from 'react'
import { HtmlDesignBody } from '../src/client/HtmlDesignBody.tsx'
import type { HtmlDesignBodyProps } from '../src/client/HtmlDesignBody.tsx'
import { fileRefOf } from '../src/client/index.ts'
import { createDesignStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { CHANNEL } from '../src/client/frame-runtime.ts'
import type { FrameAnchor } from '../src/client/frame-runtime.ts'
import type { DesignAnnotationDocument, DesignFileRef, DesignReadResult } from '../src/types.ts'

const PATH = 'C:/workspace/index.html'
const RESOURCE_ADDRESS = 'dsh-resource://file/session/test/workspace/index.html'
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
let nextBlobUrl = 0
const createObjectURL = vi.fn((_blob: Blob) => `blob:html-design-preview-${++nextBlobUrl}`)
const revokeObjectURL = vi.fn((_url: string) => {})
const ANCHOR: FrameAnchor = {
  selector: 'h1#headline',
  parentSelector: 'main#container',
  tag: 'h1',
  id: 'headline',
  classes: [],
  text: 'Original heading',
  sourceText: 'Original heading',
  sourceClasses: [],
  editableText: 'Original heading',
  rect: { x: 24, y: 32, width: 240, height: 48 },
  computed: { 'font-size': '16px', color: 'rgb(0, 0, 0)' },
}
const PARENT_ANCHOR: FrameAnchor = {
  selector: 'main#container',
  parentSelector: 'body',
  tag: 'main',
  id: 'container',
  classes: [],
  text: 'Original heading and child copy',
  sourceText: 'Original heading and child copy',
  sourceClasses: [],
  editableText: null,
  rect: { x: 8, y: 8, width: 320, height: 240 },
  computed: { 'font-size': '16px', color: 'rgb(0, 0, 0)' },
}

function reviewWithStyle(): DesignAnnotationDocument {
  return {
    version: 1,
    file: PATH,
    comments: [],
    edits: [{ selector: ANCHOR.selector, declarations: { 'font-size': '18px' }, updatedAt: '2026-09-23T00:00:00.000Z' }],
    updatedAt: '2026-09-23T00:00:00.000Z',
  }
}

function mountPreview(
  review: DesignAnnotationDocument | null = null,
  read?: (file: DesignFileRef) => Promise<DesignReadResult>,
) {
  const store = createDesignStore(PATH).create()
  const defaultRead = async (_file: DesignFileRef): Promise<DesignReadResult> => ({
    path: PATH, document: review, storePath: `${PATH}.design.json`,
  })
  const loadReview = vi.fn(read ?? defaultRead)
  const saveReview = vi.fn(async (_file: DesignFileRef, _document: DesignAnnotationDocument): Promise<void> => {})
  const applyToFile = vi.fn(async () => ({ path: PATH, applied: [], skipped: [], bytes: 0, changed: false }))
  const props = {
    content: { kind: 'bytes', data: new TextEncoder().encode('<!doctype html><html><body><h1 id="headline">Original heading</h1></body></html>') },
    resourceAddress: RESOURCE_ADDRESS,
    wrap: false,
    addResource: () => {},
    setResources: () => {},
    scrollportRef: () => {},
    useStore: <S,>(selector: (state: ReturnType<typeof store.getSnapshot>) => S): S =>
      selector(useSyncExternalStore(store.subscribe, store.getSnapshot)),
    actions: store.actions,
    t: (key: string) => zh[key as keyof typeof zh] ?? key,
    loadReview,
    saveReview,
    applyToFile,
    fileRefOf,
  } as HtmlDesignBodyProps
  const view = render(createElement(HtmlDesignBody, props))
  // Undo, redo and reset remount the preview (it is keyed by the reload token),
  // so callers must always talk to the window that is on screen right now.
  const liveFrame = (): HTMLIFrameElement => {
    const current = view.container.querySelector('iframe[data-html-design-preview]')
    if (!(current instanceof HTMLIFrameElement) || current.contentWindow === null) {
      throw new Error('HTML preview frame did not mount')
    }
    return current
  }
  const postMessage = vi.spyOn(liveFrame().contentWindow, 'postMessage')
  const dispatchFromFrame = (
    source: HTMLIFrameElement,
    kind: 'ready' | 'select' | 'edit' | 'move',
    anchor: FrameAnchor = ANCHOR,
    declarations: Readonly<Record<string, string>> = {},
    restore: Readonly<Record<string, string>> = { translate: '' },
  ) => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: source.contentWindow,
        data: kind === 'ready' ? { channel: CHANNEL, kind }
          : kind === 'select' || kind === 'edit' ? { channel: CHANNEL, kind, anchor }
            : { channel: CHANNEL, kind, anchor, selector: anchor.selector, declarations, restore },
      }))
    })
  }
  const select = (anchor: FrameAnchor = ANCHOR) => {
    dispatchFromFrame(liveFrame(), 'edit', anchor)
  }
  const singleSelect = (anchor: FrameAnchor = ANCHOR) => {
    dispatchFromFrame(liveFrame(), 'select', anchor)
  }
  const dispatchModeApplied = (source: HTMLIFrameElement, mode: 'browse' | 'inspect') => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: source.contentWindow,
        data: { channel: CHANNEL, kind: 'modeApplied', mode },
      }))
    })
  }
  const dispatchRemoveResult = (
    source: HTMLIFrameElement,
    selector: string,
    requestId: string,
    success: boolean,
    removedSelectors: readonly string[] = success ? [selector] : [],
  ) => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: source.contentWindow,
        data: { channel: CHANNEL, kind: 'removeResult', requestId, selector, success, removedSelectors },
      }))
    })
  }
  return { view, liveFrame, props, store, loadReview, saveReview, applyToFile, postMessage, dispatchFromFrame, dispatchModeApplied, dispatchRemoveResult, select, singleSelect }
}

/**
 * Type a value into a length field the way a person does: the number box holds
 * only digits, and the unit lives in the dropdown beside it.
 */
function setLength(dialog: HTMLElement, label: string, amount: string, unit = 'px'): void {
  const field = within(dialog).getByLabelText(label).closest('div')?.parentElement
  const input = field?.querySelector('input[type="number"]')
  if (!(input instanceof HTMLElement)) throw new Error(`No length field for ${label}`)
  const select = field?.querySelector('select')
  if (select instanceof HTMLSelectElement && select.value !== unit) {
    fireEvent.change(select, { target: { value: unit } })
  }
  fireEvent.change(input, { target: { value: amount } })
}

/** Read what a length field currently shows, split into its number and unit. */
function readLength(dialog: HTMLElement, label: string): { readonly amount: string; readonly unit: string } {
  const field = within(dialog).getByLabelText(label).closest('div')?.parentElement
  const input = field?.querySelector('input[type="number"]')
  const select = field?.querySelector('select')
  return {
    amount: input instanceof HTMLInputElement ? input.value : '',
    unit: select instanceof HTMLSelectElement ? select.value : '',
  }
}

function lastRemovalRequest(postMessage: ReturnType<typeof mountPreview>['postMessage']): { selector: string; requestId: string } {
  const message: unknown = postMessage.mock.lastCall?.[0]
  if (typeof message !== 'object' || message === null
    || !('channel' in message) || message.channel !== CHANNEL
    || !('kind' in message) || message.kind !== 'removeSelected'
    || !('selector' in message) || typeof message.selector !== 'string'
    || !('requestId' in message) || typeof message.requestId !== 'string') {
    throw new Error('The frame did not receive a selected-element removal request')
  }
  return { selector: message.selector, requestId: message.requestId }
}

beforeEach(() => {
  nextBlobUrl = 0
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalCreateObjectURL === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
  else Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
  if (originalRevokeObjectURL === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
  else Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
  vi.unstubAllGlobals()
})

describe('HTML design preview interactions', () => {
  it('selects on one click and opens the exact element editor only on a double-click', async () => {
    const { view, store, select, singleSelect } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))

    singleSelect(ANCHOR)
    expect(store.getSnapshot().selectedSelector).toBe(ANCHOR.selector)
    expect(view.queryByRole('dialog')).toBeNull()

    select(ANCHOR)
    expect(view.getByRole('dialog', { name: zh.editElement })).toBeDefined()
    singleSelect(PARENT_ANCHOR)
    expect(store.getSnapshot().selectedSelector).toBe(PARENT_ANCHOR.selector)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('copies the selected element locator without changing its text draft', async () => {
    const { view, store, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)

    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByTitle(zh.elementTag).textContent).toBe('H1')
    expect(within(dialog).getByText(zh.elementLocator)).toBeDefined()
    expect(within(dialog).getByTitle(ANCHOR.selector).textContent).toBe(ANCHOR.selector)
    const input = within(dialog).getByRole('textbox', { name: zh.textContent }) as HTMLTextAreaElement
    expect(input.value).toBe(ANCHOR.editableText)

    fireEvent.change(input, { target: { value: 'Draft heading' } })
    expect(view.getByText(zh.unsaved)).toBeDefined()
    const writeText = vi.fn(async (_text: string): Promise<void> => {})
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      fireEvent.click(within(dialog).getByRole('button', { name: zh.copyLocator }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(ANCHOR.selector))
      expect(input.value).toBe('Draft heading')
      expect(view.getByText(zh.unsaved)).toBeDefined()
    } finally {
      if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
      else Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }
  })

  it('can select the containing block from the dialog without guessing its thin border', async () => {
    const { view, postMessage, store, select, dispatchFromFrame, liveFrame } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement }))
      .getByRole('button', { name: zh.selectParent }))
    expect(postMessage).toHaveBeenCalledWith({ channel: CHANNEL, kind: 'selectParent' }, '*')

    dispatchFromFrame(liveFrame(), 'edit', PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText('MAIN')).toBeDefined()
    expect(within(dialog).getByTitle(PARENT_ANCHOR.selector).textContent).toBe(PARENT_ANCHOR.selector)
  })

  it('holds frame pointer input until the requested mode is applied', () => {
    const { view, liveFrame, dispatchModeApplied } = mountPreview()
    expect(liveFrame().getAttribute('data-frame-mode-ready')).toBe('false')
    dispatchModeApplied(liveFrame(), 'browse')
    expect(liveFrame().getAttribute('data-frame-mode-ready')).toBe('true')

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    expect(liveFrame().getAttribute('data-frame-mode-ready')).toBe('false')
    dispatchModeApplied(liveFrame(), 'browse')
    expect(liveFrame().getAttribute('data-frame-mode-ready')).toBe('false')
    dispatchModeApplied(liveFrame(), 'inspect')
    expect(liveFrame().getAttribute('data-frame-mode-ready')).toBe('true')
  })

  it('shows the page frame with only preview and edit modes and localized frame messages', () => {
    const { view, liveFrame, postMessage, dispatchFromFrame } = mountPreview()
    expect(liveFrame().getAttribute('src')).toMatch(/^blob:html-design-preview-/)
    expect(liveFrame().hasAttribute('srcdoc')).toBe(false)
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByRole('button', { name: zh.modeBrowse }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByRole('button', { name: zh.modeInspect }).getAttribute('aria-pressed')).toBe('false')
    expect(view.getAllByRole('button').filter(button => button.getAttribute('aria-pressed') !== null)).toHaveLength(2)
    dispatchFromFrame(liveFrame(), 'ready')
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'mode', mode: 'browse', dragHandleLabel: zh.dragHandle, resizeHandleLabel: zh.resizeHandle,
    }, '*')

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    expect(view.getByRole('button', { name: zh.modeInspect }).getAttribute('aria-pressed')).toBe('true')
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'mode', mode: 'inspect', dragHandleLabel: zh.dragHandle, resizeHandleLabel: zh.resizeHandle,
    }, '*')
    fireEvent.click(view.getByRole('button', { name: zh.modeBrowse }))
    expect(view.getByRole('button', { name: zh.modeBrowse }).getAttribute('aria-pressed')).toBe('true')
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(liveFrame())
  })

  it('releases each Blob URL when the document changes and the preview unmounts', () => {
    const { view, liveFrame, props } = mountPreview()
    const firstUrl = liveFrame().getAttribute('src')
    expect(firstUrl).toMatch(/^blob:html-design-preview-/)

    view.rerender(createElement(HtmlDesignBody, {
      ...props,
      content: { kind: 'bytes', data: new TextEncoder().encode('<html><body>Updated page</body></html>') },
    }))
    const updatedFrame = view.container.querySelector('iframe[data-html-design-preview]')
    expect(updatedFrame).toBeInstanceOf(HTMLIFrameElement)
    const secondUrl = updatedFrame?.getAttribute('src')
    expect(secondUrl).toMatch(/^blob:html-design-preview-/)
    expect(secondUrl).not.toBe(firstUrl)
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl)

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith(secondUrl)
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('places the editor outside a narrow Sidebar preview when the viewport has room', () => {
    vi.stubGlobal('visualViewport', undefined)
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('innerHeight', 800)
    const { view, liveFrame, select } = mountPreview()
    const stage = view.container.querySelector('[data-html-design-stage]')
    if (!(stage instanceof HTMLElement)) throw new Error('HTML preview stage did not mount')
    const sidebarBounds = new DOMRect(1000, 80, 260, 650)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(sidebarBounds)

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(dialog.getAttribute('data-html-design-editor')).not.toBeNull()
    expect(dialog.getAttribute('data-placement')).toBe('left')
    expect(document.body.contains(dialog)).toBe(true)
    expect(view.container.contains(dialog)).toBe(false)
    expect(Number.parseFloat(dialog.style.left) + Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(sidebarBounds.left - 16)
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(liveFrame())
  })

  it('uses a short bottom editor when neither side of the preview has room', () => {
    vi.stubGlobal('visualViewport', undefined)
    vi.stubGlobal('innerWidth', 600)
    vi.stubGlobal('innerHeight', 800)
    const { view, liveFrame, select } = mountPreview()
    const stage = view.container.querySelector('[data-html-design-stage]')
    if (!(stage instanceof HTMLElement)) throw new Error('HTML preview stage did not mount')
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(170, 80, 260, 660))

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(dialog.getAttribute('data-placement')).toBe('bottom')
    expect(view.container.contains(dialog)).toBe(false)
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(80 + 660 / 2)
    expect(Number.parseFloat(dialog.style.maxHeight)).toBeLessThanOrEqual(800 * 0.48)
    expect(Number.parseFloat(dialog.style.maxHeight)).toBeLessThanOrEqual(660 * 0.55)
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(liveFrame())
  })

  it('opens the floating editor only after inspect selection and discards a cancelled draft', () => {
    const { view, liveFrame, postMessage, saveReview, select } = mountPreview()
    select()
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByText(zh.saved)).toBeDefined()

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(liveFrame())
    const initialFontSize = readLength(dialog, zh.fontSize)
    const initialText = (within(dialog).getByLabelText(zh.textContent) as HTMLInputElement).value
    setLength(dialog, zh.fontSize, '22')
    fireEvent.change(within(dialog).getByLabelText(zh.textContent), { target: { value: 'Changed heading' } })
    expect(view.getByText(zh.unsaved)).toBeDefined()

    expect(saveReview).not.toHaveBeenCalled()
    expect(postMessage.mock.calls.map(([message]) => message).filter(message =>
      typeof message === 'object' && message !== null && ('kind' in message) &&
      (message.kind === 'style' || message.kind === 'text'))).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByText(zh.saved)).toBeDefined()
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(liveFrame())
    expect(saveReview).not.toHaveBeenCalled()
    expect(postMessage.mock.calls.map(([message]) => message).filter(message =>
      typeof message === 'object' && message !== null && ('kind' in message) &&
      (message.kind === 'style' || message.kind === 'text'))).toEqual([])

    select()
    const reopened = view.getByRole('dialog', { name: zh.editElement })
    expect(readLength(reopened, zh.fontSize)).toEqual(initialFontSize)
    expect((within(reopened).getByLabelText(zh.textContent) as HTMLInputElement).value).toBe(initialText)
  })

  it('does not offer aggregate child text when a parent block is selected', async () => {
    const { view, store, postMessage, saveReview, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText(zh.textSelectionHint)).toBeDefined()
    expect(within(dialog).queryByRole('textbox', { name: zh.textContent })).toBeNull()
    expect(within(dialog).getByRole('button', { name: zh.copyLocator })).toBeDefined()

    setLength(dialog, zh.fontSize, '24')
    fireEvent.click(within(dialog).getByRole('button', { name: zh.save }))
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      edits: [expect.objectContaining({ selector: PARENT_ANCHOR.selector, declarations: { 'font-size': '24px' } })],
    }))
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'style', selector: PARENT_ANCHOR.selector, declarations: { 'font-size': '24px' },
    }, '*')
    expect(postMessage.mock.calls.some(([message]) =>
      typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'text')).toBe(false)
  })

  it('stages only the selected element for deletion and writes its original identity on explicit file save', async () => {
    const { view, liveFrame, store, postMessage, saveReview, applyToFile, dispatchRemoveResult, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText(zh.deleteHint)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: zh.deleteElement }))
    const request = lastRemovalRequest(postMessage)
    expect(request.selector).toBe(ANCHOR.selector)
    expect(applyToFile).not.toHaveBeenCalled()
    expect(saveReview).not.toHaveBeenCalled()

    dispatchRemoveResult(liveFrame(), request.selector, request.requestId, true)
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect(store.getSnapshot().selected).toBeNull()
    expect(applyToFile).not.toHaveBeenCalled()

    applyToFile.mockResolvedValue({ path: PATH, applied: [ANCHOR.selector], skipped: [], bytes: 75, changed: true })
    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    expect(saveFile.disabled).toBe(false)
    fireEvent.click(saveFile)
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith({
      file: fileRefOf(RESOURCE_ADDRESS),
      edits: [],
      textEdits: {},
      deletions: [{ selector: ANCHOR.selector, text: ANCHOR.sourceText, classes: ANCHOR.sourceClasses }],
    })
    await waitFor(() => expect(view.getByText(zh.saved)).toBeDefined())
    expect(saveFile.disabled).toBe(true)
    expect(saveReview).not.toHaveBeenCalled()
  })

  it('identifies the entire selected parent block and disables deletion of page roots', async () => {
    const { view, store, postMessage, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText('MAIN')).toBeDefined()
    expect(within(dialog).getByText(PARENT_ANCHOR.selector)).toBeDefined()
    expect(within(dialog).getByText(zh.deleteHint)).toBeDefined()
    expect((within(dialog).getByRole('button', { name: zh.deleteElement }) as HTMLButtonElement).disabled).toBe(false)

    const bodyAnchor: FrameAnchor = {
      selector: 'html > body', parentSelector: 'html', tag: 'body', classes: [], text: 'Page content',
      sourceText: 'Page content', sourceClasses: [], editableText: null,
      rect: { x: 0, y: 0, width: 320, height: 240 }, computed: {},
    }
    select(bodyAnchor)
    expect(within(dialog).getByText('BODY')).toBeDefined()
    expect(within(dialog).getByText(bodyAnchor.selector)).toBeDefined()
    expect(within(dialog).getByText(zh.deleteRootHint)).toBeDefined()
    expect((within(dialog).getByRole('button', { name: zh.deleteElement }) as HTMLButtonElement).disabled).toBe(true)
    expect(postMessage.mock.calls.some(([message]) =>
      typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'removeSelected')).toBe(false)
  })

  it('replays a pending deletion into a refreshed frame', async () => {
    const { view, liveFrame, store, postMessage, dispatchFromFrame, dispatchRemoveResult, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.deleteElement }))
    const request = lastRemovalRequest(postMessage)
    dispatchRemoveResult(liveFrame(), request.selector, request.requestId, true)

    act(() => store.actions.requestReload())
    const refreshedFrame = view.container.querySelector('iframe[data-html-design-preview]')
    if (!(refreshedFrame instanceof HTMLIFrameElement) || refreshedFrame.contentWindow === null) {
      throw new Error('Refreshed HTML preview frame did not mount')
    }
    const refreshedMessages = vi.spyOn(refreshedFrame.contentWindow, 'postMessage')
    dispatchFromFrame(refreshedFrame, 'ready')
    expect(refreshedMessages).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'replayRemoval', selector: ANCHOR.selector,
      requestId: expect.stringMatching(/^replay-\d+$/u),
    }, '*')
    expect(view.getByText(zh.unsaved)).toBeDefined()
  })

  it('undoes a pending deletion with the history control and omits it from the next file save', async () => {
    const { view, liveFrame, store, postMessage, applyToFile, dispatchFromFrame, dispatchRemoveResult, select } = mountPreview(reviewWithStyle())
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.deleteElement }))
    const request = lastRemovalRequest(postMessage)
    dispatchRemoveResult(liveFrame(), request.selector, request.requestId, true)
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect(applyToFile).not.toHaveBeenCalled()

    const frameBeforeUndo = liveFrame()
    fireEvent.click(view.getByRole('button', { name: zh.undo }))
    // Undoing a deletion has to rebuild the page, or the element the reviewer
    // deleted would still be missing.
    const refreshedFrame = liveFrame()
    expect(refreshedFrame).not.toBe(frameBeforeUndo)
    // The stored style edit that was there before the deletion is back, so the
    // review is unsaved again rather than silently reverted.
    expect(store.getSnapshot().document?.edits).toEqual(reviewWithStyle().edits)
    const refreshedMessages = vi.spyOn(refreshedFrame.contentWindow, 'postMessage')
    dispatchFromFrame(refreshedFrame, 'ready')
    expect(refreshedMessages.mock.calls.some(([message]) =>
      typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'replayRemoval')).toBe(false)

    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    expect(saveFile.disabled).toBe(false)
    fireEvent.click(saveFile)
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith({
      file: fileRefOf(RESOURCE_ADDRESS),
      edits: reviewWithStyle().edits,
      textEdits: {},
      deletions: [],
    })
  })

  it('keeps earlier staged deletions when a later frame removal fails', async () => {
    const { view, liveFrame, store, postMessage, applyToFile, dispatchRemoveResult, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.deleteElement }))
    const first = lastRemovalRequest(postMessage)
    dispatchRemoveResult(liveFrame(), first.selector, first.requestId, true)
    expect(view.getByText(zh.unsaved)).toBeDefined()

    select(PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.deleteElement }))
    const second = lastRemovalRequest(postMessage)
    dispatchRemoveResult(liveFrame(), second.selector, second.requestId, false)
    expect(view.getByRole('dialog', { name: zh.editElement })).toBe(dialog)
    expect(view.getByRole('alert').textContent).toContain(zh.deleteFailed)
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect((view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(dialog).getByRole('button', { name: zh.deleteElement }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
    fireEvent.click(view.getByRole('button', { name: zh.saveToFile }))
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith(expect.objectContaining({
      deletions: [{ selector: ANCHOR.selector, text: ANCHOR.sourceText, classes: ANCHOR.sourceClasses }],
    }))
  })

  it('commits a drag immediately and keeps it through cancel', async () => {
    const { view, liveFrame, store, postMessage, saveReview, applyToFile, dispatchFromFrame, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })

    dispatchFromFrame(liveFrame(), 'move', ANCHOR, { translate: '30px 40px' })
    // The drag is already written to the sidecar: there is no per-element step.
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      edits: [expect.objectContaining({ selector: ANCHOR.selector, declarations: { translate: '30px 40px' } })],
    }))

    // Closing the dialog must not undo what was already committed.
    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
    expect(postMessage).not.toHaveBeenCalledWith(
      { channel: CHANNEL, kind: 'style', selector: ANCHOR.selector, declarations: { translate: '' } }, '*')
    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    await waitFor(() => expect(saveFile.disabled).toBe(false))
    fireEvent.click(saveFile)
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith({
      file: fileRefOf(RESOURCE_ADDRESS),
      edits: [expect.objectContaining({ selector: ANCHOR.selector, declarations: { translate: '30px 40px' } })],
      textEdits: {},
      deletions: [],
    })
  })

  it('merges a later drag into the declarations the element already had', async () => {
    const { view, liveFrame, store, saveReview, dispatchFromFrame, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()

    dispatchFromFrame(liveFrame(), 'move', ANCHOR, { translate: '30px 40px' })
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    dispatchFromFrame(liveFrame(), 'move', ANCHOR, { width: '320px' })
    await waitFor(() => expect(saveReview).toHaveBeenCalledTimes(2))
    expect(saveReview).toHaveBeenLastCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      edits: [expect.objectContaining({
        selector: ANCHOR.selector,
        declarations: { translate: '30px 40px', width: '320px' },
      })],
    }))
  })

  it('undoes and redoes a committed drag, and forgets history after saving to file', async () => {
    const { view, liveFrame, store, saveReview, applyToFile, dispatchFromFrame, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    dispatchFromFrame(liveFrame(), 'move', ANCHOR, { translate: '30px 40px' })
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(store.getSnapshot().document?.edits).toHaveLength(1)

    fireEvent.click(view.getByRole('button', { name: zh.undo }))
    // The very first snapshot predates any document at all, so undoing the
    // first edit leaves an empty review rather than a document with no edits.
    expect(store.getSnapshot().document?.edits ?? []).toHaveLength(0)
    fireEvent.click(view.getByRole('button', { name: zh.redo }))
    expect(store.getSnapshot().document?.edits).toEqual([
      expect.objectContaining({ selector: ANCHOR.selector, declarations: { translate: '30px 40px' } }),
    ])

    fireEvent.click(view.getByRole('button', { name: zh.undo }))
    expect(store.getSnapshot().document?.edits ?? []).toHaveLength(0)
    // Undoing has no file edits left to write, so make one more change that
    // survives the undo, and write that to the file.
    select()
    dispatchFromFrame(liveFrame(), 'move', ANCHOR, { width: '320px' })
    await waitFor(() => expect(saveReview).toHaveBeenCalledTimes(2))
    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    fireEvent.click(saveFile)
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    // The file now holds the truth, so nothing is left to step back across.
    expect((view.getByRole('button', { name: zh.undo }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: zh.redo }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('answers Cmd+Z in the preview with a history step', async () => {
    const { view, liveFrame, store, saveReview, dispatchFromFrame, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    dispatchFromFrame(liveFrame(), 'move', ANCHOR, { translate: '30px 40px' })
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    })
    expect(store.getSnapshot().document?.edits ?? []).toHaveLength(0)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }))
    })
    expect(store.getSnapshot().document?.edits).toHaveLength(1)
  })

  it('reports a handle that cannot act on the selected element', async () => {
    const { view, liveFrame, store, dispatchFromFrame, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: liveFrame().contentWindow,
        data: { channel: CHANNEL, kind: 'unavailable', selector: ANCHOR.selector, reason: 'resize' },
      }))
    })
    expect(view.getByText(`${zh.handleUnavailable}: ${zh.resizeHandle}`)).toBeDefined()
  })

  it('offers a colour swatch beside the hex box instead of asking anyone to type rgb()', async () => {
    const { view, liveFrame, store, saveReview, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })

    // The page computes rgb(0, 0, 0); the hex box shows the same colour as a
    // hint, and the swatch beside it is what a person actually clicks.
    const hex = within(dialog).getByLabelText(zh.color, { selector: 'input:not([type="color"])' }) as HTMLInputElement
    expect(hex.placeholder).toBe('#000000')
    const swatch = within(dialog).getByLabelText(zh.color, { selector: 'input[type="color"]' }) as HTMLInputElement
    expect(swatch.value).toBe('#000000')

    fireEvent.change(swatch, { target: { value: '#1a73e8' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.save }))
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      edits: [expect.objectContaining({ selector: ANCHOR.selector, declarations: { color: '#1a73e8' } })],
    }))
  })

  it('turns rgb() computed values into hex for every colour field', async () => {
    const { view, liveFrame, store, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select({ ...ANCHOR, computed: { color: 'rgb(0, 128, 255)', 'background-color': 'rgb(255, 255, 255)' } })
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    const hexOf = (label: string): string => {
      const box = within(dialog).getByLabelText(label, { selector: 'input:not([type="color"])' }) as HTMLInputElement
      return box.placeholder
    }
    expect(hexOf(zh.color)).toBe('#0080ff')
    expect(hexOf(zh.background)).toBe('#ffffff')
  })

  it('separates a length from its unit and offers only the units that field allows', async () => {
    const { view, liveFrame, store, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })

    // letter-spacing has a keyword too, so its box can be left empty.
    const spacing = within(dialog).getByLabelText(zh.letterSpacing).closest('div')?.parentElement
    const options = [...(spacing?.querySelector('select')?.options ?? [])].map(option => option.value)
    expect(options).toContain('normal')
    expect(options).toContain('em')
    // width takes a percentage but has no "normal".
    const width = within(dialog).getByLabelText(zh.width).closest('div')?.parentElement
    expect([...(width?.querySelector('select')?.options ?? [])].map(option => option.value)).toContain('%')
    expect([...(width?.querySelector('select')?.options ?? [])].map(option => option.value)).not.toContain('normal')
  })

  it('offers font weight as a list of real weights rather than a free-text box', async () => {
    const { view, liveFrame, store, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    const weight = within(dialog).getByLabelText(zh.fontWeight) as HTMLSelectElement
    expect(weight.tagName).toBe('SELECT')
    // The page has no font-weight set, so the list starts on "inherit".
    expect(weight.value).toBe('')
    expect([...weight.options].map(option => option.value)).toEqual(['', '300', '400', '500', '600', '700', '800', '900'])
    expect(weight.options[0]?.textContent).toBe(zh.inherit)
  })

  it('names the kind of element the reviewer picked', async () => {
    const { view, liveFrame, store, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select({ ...ANCHOR, tag: 'button', selector: 'button#headline' })
    const typeOf = (): string =>
      view.getByRole('dialog', { name: zh.editElement }).querySelector('code')?.textContent ?? ''
    expect(within(view.getByRole('dialog', { name: zh.editElement })).getByText(zh.elementType)).toBeDefined()
    expect(typeOf()).toBe(zh.typeInteractive)

    // A heading is a plain block, and it says so.
    select()
    expect(typeOf()).toBe(zh.typeBlock)
  })

  it('warns that an element cannot be dragged instead of letting it snap back', async () => {
    const { view, liveFrame, store, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select({ ...ANCHOR, movable: false, display: 'inline' })
    expect(view.getByText(zh.dragUnavailable)).toBeDefined()
  })

  it('waits for the review write before enabling Save to file', async () => {
    const { view, store, saveReview, applyToFile, select } = mountPreview()
    let finishSave!: () => void
    saveReview.mockImplementation(() => new Promise<void>(resolve => { finishSave = resolve }))
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    setLength(view.getByRole('dialog', { name: zh.editElement }), zh.fontSize, '22')
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.save }))
    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    expect(saveFile.disabled).toBe(true)
    fireEvent.click(saveFile)
    expect(applyToFile).not.toHaveBeenCalled()
    await act(async () => { finishSave() })
    await waitFor(() => expect(saveFile.disabled).toBe(false))
  })

  it('keeps an existing style edit when reset is cancelled', async () => {
    const { view, store, postMessage, saveReview, select } = mountPreview(reviewWithStyle())
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    postMessage.mockClear()
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    // 18 is the stored edit; 16 is what the page itself renders.
    expect(readLength(dialog, zh.fontSize).amount).toBe('18')

    fireEvent.click(within(dialog).getByRole('button', { name: zh.resetStyle }))
    expect(readLength(dialog, zh.fontSize)).toEqual({ amount: '', unit: 'px' })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))

    expect(saveReview).not.toHaveBeenCalled()
    expect(store.getSnapshot().document?.edits).toEqual(reviewWithStyle().edits)
    expect(postMessage.mock.calls.map(([message]) => message).filter(message =>
      typeof message === 'object' && message !== null && ('kind' in message) &&
      (message.kind === 'style' || message.kind === 'text'))).toEqual([])
    select()
    expect(readLength(view.getByRole('dialog', { name: zh.editElement }), zh.fontSize).amount).toBe('18')
  })

  it('replays mode, stored styles, and pending text when a refreshed frame becomes ready', async () => {
    const { view, liveFrame, store, saveReview, dispatchFromFrame, select } = mountPreview(reviewWithStyle())
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    fireEvent.change(within(dialog).getByLabelText(zh.textContent), { target: { value: 'Pending heading' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.save }))
    expect(saveReview).not.toHaveBeenCalled()

    const frameBeforeReload = liveFrame()
    act(() => store.actions.requestReload())
    const refreshedFrame = liveFrame()
    expect(refreshedFrame).not.toBe(frameBeforeReload)
    const refreshedMessages = vi.spyOn(refreshedFrame.contentWindow, 'postMessage')
    dispatchFromFrame(refreshedFrame, 'ready')

    expect(refreshedMessages.mock.calls).toEqual([
      [{ channel: CHANNEL, kind: 'mode', mode: 'inspect', dragHandleLabel: zh.dragHandle, resizeHandleLabel: zh.resizeHandle }, '*'],
      [{ channel: CHANNEL, kind: 'style', selector: ANCHOR.selector, declarations: { 'font-size': '18px' } }, '*'],
      [{ channel: CHANNEL, kind: 'text', selector: ANCHOR.selector, value: 'Pending heading' }, '*'],
    ])
  })

  it('enables element saving only after the Host returns the canonical file path', async () => {
    let resolveRead!: (result: DesignReadResult) => void
    const pendingRead = new Promise<DesignReadResult>(resolve => { resolveRead = resolve })
    const { view, loadReview, saveReview, select } = mountPreview(null, async () => pendingRead)
    expect(loadReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    const save = within(dialog).getByRole('button', { name: zh.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    act(() => resolveRead({ path: PATH, document: null, storePath: `${PATH}.design.json` }))
    await waitFor(() => expect(save.disabled).toBe(false))
    setLength(dialog, zh.fontSize, '22')
    fireEvent.click(save)

    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      file: PATH,
      edits: [expect.objectContaining({ selector: ANCHOR.selector })],
    }))
  })

  it('keeps file and element saving disabled when the Host read fails', async () => {
    const { view, store, saveReview, applyToFile, select } = mountPreview(null, async () => {
      throw new Error('Host read failed')
    })
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    expect(view.getByRole('alert').textContent).toContain('Host read failed')
    act(() => store.actions.upsertEdit({
      selector: ANCHOR.selector, declarations: { 'font-size': '22px' }, updatedAt: '2026-09-23T00:00:00.000Z',
    }))
    expect((view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const save = within(view.getByRole('dialog', { name: zh.editElement }))
      .getByRole('button', { name: zh.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(saveReview).not.toHaveBeenCalled()
    expect(applyToFile).not.toHaveBeenCalled()

  })

  it('sends saved style and text to the mounted page and persists the style review', async () => {
    const { view, liveFrame, store, postMessage, saveReview, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    setLength(dialog, zh.fontSize, '22')
    fireEvent.change(within(dialog).getByLabelText(zh.textContent), { target: { value: 'Changed heading' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.save }))

    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      file: PATH,
      edits: [expect.objectContaining({ selector: ANCHOR.selector, declarations: { 'font-size': '22px' } })],
    }))
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'style', selector: ANCHOR.selector, declarations: { 'font-size': '22px' },
    }, '*')
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'text', selector: ANCHOR.selector, value: 'Changed heading',
    }, '*')
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(liveFrame())
  })
})
