/**
 * The Sidebar's web-design HTML preview.
 *
 * The reviewed page stays visible in the preview tab. A compact toolbar
 * switches pointer modes, and double-clicking a selected element in edit
 * mode opens its inputs in a dialog. Review state reaches the Host
 * through the injected `saveReview`/`loadReview` callbacks, which the plugin
 * body binds to the `webDesignReview` Remote.
 *
 * The component holds no subscriptions of its own: the store reaches it through
 * the framework's `useStore` seat, and everything else is owner or inject data.
 *
 * @module @guowenzhang/dsh-web-design/client/HtmlDesignBody
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Tag, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesignAnnotationDocument, DesignApplyRequest, DesignApplyResult, DesignFileRef, DesignReadResult, ElementCommentAnchor, ElementEdit } from '../types.ts'
import { buildPreviewDocument } from './document.ts'
import { CHANNEL } from './frame-runtime.ts'
import type { FrameAnchor, FrameToParent } from './frame-runtime.ts'
import { createDesignStore } from './store.ts'
import type { DesignMode } from './store.ts'
import css from './HtmlDesignBody.module.css'

/** The store handle type this preview is registered with. */
export type DesignStore = ReturnType<typeof createDesignStore>

/** Host-bound callbacks the plugin supplies through the slot's inject face. */
export interface HtmlDesignBodyInjected {
  /**
   * Read the stored review for this document.
   * @param file - Session-scoped address of the previewed file.
   * @returns the canonical Host path and stored document.
   */
  readonly loadReview: (file: DesignFileRef) => Promise<DesignReadResult>
  /**
   * Persist the review for this document.
   * @param file - Session-scoped address of the previewed file.
   * @param document - the review to store.
   * @returns once the Host has written it.
   */
  readonly saveReview: (file: DesignFileRef, document: DesignAnnotationDocument) => Promise<void>
  /**
   * Write the reviewer's edits into the document's own source file.
   * @param request - the file path, its style edits, and its text replacements.
   * @returns what the Host applied and what it could not locate.
   */
  readonly applyToFile: (request: DesignApplyRequest) => Promise<DesignApplyResult>
  /**
   * Parse the Session address of a document from its resource address.
   * @param address - the tab's `dsh-resource://file/…` address.
   * @returns the Session and path, or `undefined` when the address is not session-scoped.
   */
  readonly fileRefOf: (address: string) => DesignFileRef | undefined
}

/** Props the framework derives for the document slot. */
export type HtmlDesignBodyProps =
  DocumentPreviewProps
  & PropsLocale<'sidebarWebDesign'>
  & PropsStore<DesignStore>
  & InjectFace<HtmlDesignBodyInjected>

const MODES: readonly DesignMode[] = ['browse', 'inspect']

/** How a style value is edited, so the dialog never asks for raw CSS. */
type StyleControl =
  /** A CSS color: a visual swatch plus a plain hex field. */
  | { readonly kind: 'color' }
  /** A number and a unit, the two things a length value actually is. */
  | { readonly kind: 'length'; readonly units: readonly string[]; readonly bare?: boolean }
  /** A closed set of named values. */
  | { readonly kind: 'choice'; readonly options: readonly string[] }

/** Editable style properties, with the control that should edit each one. */
const STYLE_FIELDS: readonly {
  readonly key: string
  readonly label: 'width' | 'height' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'color' | 'background' | 'padding' | 'margin' | 'borderRadius'
  readonly control: StyleControl
}[] = [
  { key: 'width', label: 'width', control: { kind: 'length', units: ['px', '%', 'em', 'rem', 'ch', 'auto'], bare: true } },
  { key: 'height', label: 'height', control: { kind: 'length', units: ['px', '%', 'em', 'rem', 'ch', 'auto'], bare: true } },
  { key: 'font-size', label: 'fontSize', control: { kind: 'length', units: ['px', 'rem', 'em', '%', 'pt'] } },
  // line-height accepts a bare multiplier, which is why it is not a length.
  { key: 'line-height', label: 'lineHeight', control: { kind: 'length', units: ['', 'px', 'rem', 'em', '%'], bare: true } },
  { key: 'letter-spacing', label: 'letterSpacing', control: { kind: 'length', units: ['px', 'em', 'rem', 'normal'], bare: true } },
  { key: 'font-weight', label: 'fontWeight', control: { kind: 'choice', options: ['300', '400', '500', '600', '700', '800', '900'] } },
  { key: 'color', label: 'color', control: { kind: 'color' } },
  { key: 'background-color', label: 'background', control: { kind: 'color' } },
  { key: 'border-radius', label: 'borderRadius', control: { kind: 'length', units: ['px', '%', 'em', 'rem'] } },
  { key: 'padding', label: 'padding', control: { kind: 'length', units: ['px', '%', 'em', 'rem'] } },
  { key: 'margin', label: 'margin', control: { kind: 'length', units: ['px', '%', 'em', 'rem', 'auto'], bare: true } },
]

/** Tags a person can act on, as opposed to structural or content blocks. */
const INTERACTIVE_TAGS = /^(?:a|button|input|select|textarea|summary|option|label)$/iu

/** Whether the selected element is interactive rather than a content block. */
function interactiveTag(tag: string): boolean {
  return INTERACTIVE_TAGS.test(tag)
}

/** Split a CSS value into the number a box should show and the unit beside it. */
function splitLength(value: string, units: readonly string[], bare: boolean): { readonly amount: string; readonly unit: string } {
  const trimmed = value.trim()
  if (trimmed === '') return { amount: '', unit: units[0] ?? 'px' }
  if (units.includes(trimmed)) return { amount: '', unit: trimmed }
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(.*)$/.exec(trimmed)
  if (match === null) return { amount: trimmed, unit: units[0] ?? 'px' }
  const unit = match[2] ?? ''
  // Keep any unit the author wrote even if it is not offered, rather than
  // silently rewriting what they typed.
  if (unit !== '' && !units.includes(unit)) return { amount: trimmed, unit: units[0] ?? 'px' }
  if (unit === '' && !bare) return { amount: trimmed, unit: units[0] ?? 'px' }
  return { amount: match[1] ?? '', unit: unit === '' ? units[0] ?? 'px' : unit }
}

/** Join a number and a unit back into one CSS value. */
function joinLength(amount: string, unit: string): string {
  if (amount.trim() === '') return ''
  return unit === '' ? amount.trim() : `${amount.trim()}${unit}`
}

/** Reduce any CSS color the browser reports to a hex swatch value. */
function toHexColor(value: string): string {
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/iu.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-f]{3}$/iu.test(trimmed)) {
    return '#' + trimmed.slice(1).split('').map(digit => digit + digit).join('')
  }
  const channel = (part: string): number => {
    const number = part.trim()
    if (number.endsWith('%')) return Math.round(Number.parseFloat(number) * 2.55)
    return Math.max(0, Math.min(255, Math.round(Number.parseFloat(number) || 0)))
  }
  const rgb = /^rgba?\(([^)]*)\)$/iu.exec(trimmed)
  if (rgb !== null) {
    const [red, green, blue] = rgb[1]?.split(/[,/\s]+/u).filter(Boolean) ?? []
    const hex = [channel(red ?? '0'), channel(green ?? '0'), channel(blue ?? '0')]
      .map(part => part.toString(16).padStart(2, '0'))
      .join('')
    return '#' + hex
  }
  // Named and other colors (oklch, color-mix, …) have no cheap conversion.
  // #000 is a neutral placeholder that leaves the author’s text intact.
  return '#000000'
}

/** Placement of the editor in the visible application viewport. */
interface EditorPlacement {
  readonly side: 'left' | 'right' | 'bottom'
  readonly left: number
  readonly top: number
  readonly width: number
  readonly maxHeight: number
}

/** A removal staged in the preview until the source file is saved. */
interface PendingDeletion {
  readonly selector: string
  readonly text: string
  readonly classes: readonly string[]
  readonly removedSelectors: readonly string[]
}

/** The selected frame instance and its original source fingerprint. */
interface SelectedSource {
  readonly selector: string
  readonly text: string
  readonly classes: readonly string[]
}

/** Everything an edit can change, captured so one undo step can put it back. */
interface DesignSnapshot {
  readonly document: DesignAnnotationDocument | null
  readonly textEdits: Readonly<Record<string, string>>
  readonly deletions: readonly PendingDeletion[]
}

/** How many undo steps to keep. Deeper than any sensible editing session. */
const HISTORY_LIMIT = 100

/** Keep an editing surface beside the Sidebar when space allows. */
function placeEditor(stage: HTMLElement): EditorPlacement {
  const rect = stage.getBoundingClientRect()
  const visual = window.visualViewport
  const viewportLeft = visual?.offsetLeft ?? 0
  const viewportTop = visual?.offsetTop ?? 0
  const viewportWidth = visual?.width ?? window.innerWidth
  const viewportHeight = visual?.height ?? window.innerHeight
  const inset = 12
  const gap = 16
  const viewportRight = viewportLeft + viewportWidth
  const viewportBottom = viewportTop + viewportHeight
  const leftRoom = rect.left - viewportLeft - inset - gap
  const rightRoom = viewportRight - rect.right - inset - gap
  const minimumSideWidth = 260
  const maxHeight = Math.max(0, Math.min(560, viewportHeight - inset * 2))

  if (leftRoom >= minimumSideWidth || rightRoom >= minimumSideWidth) {
    const side = leftRoom >= minimumSideWidth ? 'left' : 'right'
    const width = Math.min(480, side === 'left' ? leftRoom : rightRoom)
    const left = side === 'left' ? rect.left - gap - width : rect.right + gap
    const top = Math.min(Math.max(rect.top + 20, viewportTop + inset), viewportBottom - inset - maxHeight)
    return { side, left, top, width, maxHeight }
  }

  // On a narrow viewport, leave the upper half of the preview uncovered.
  const width = Math.max(0, Math.min(480, viewportWidth - inset * 2))
  const visibleStageHeight = Math.max(0, Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop))
  const maxBottomHeight = Math.max(0, Math.min(400, viewportHeight * 0.48, visibleStageHeight * 0.55))
  return {
    side: 'bottom',
    left: viewportLeft + (viewportWidth - width) / 2,
    top: viewportBottom - inset - maxBottomHeight,
    width,
    maxHeight: maxBottomHeight,
  }
}

/**
 * Render the HTML design preview.
 * @param props - document content, framework store seat, injected host callbacks, and locale.
 * @returns the preview, or the loading and failure states.
 */
export function HtmlDesignBody(props: HtmlDesignBodyProps): ReactNode {
  const { content, resourceAddress, useStore, loadReview, saveReview, applyToFile, fileRefOf, actions, t } = props
  const state = useStore(selector => selector)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const focusReturnRef = useRef<HTMLElement | null>(null)
  const [editorPlacement, setEditorPlacement] = useState<EditorPlacement | null>(null)
  const [draftStyle, setDraftStyle] = useState<Record<string, string>>({})
  const [computed, setComputed] = useState<Record<string, string>>({})
  const [draftText, setDraftText] = useState('')
  const [editableText, setEditableText] = useState<string | null>(null)
  const [selectedParentSelector, setSelectedParentSelector] = useState<string | null>(null)
  // What kind of box the selected element is, and whether the handles can act
  // on it. Kept beside the selection because the stored anchor is only about
  // locating the element for comments.
  const [traits, setTraits] = useState<{ readonly display: string; readonly resizable: boolean; readonly movable: boolean } | null>(null)
  const [locatorCopy, setLocatorCopy] = useState<{ readonly selector: string; readonly success: boolean } | null>(null)
  const selectedSource = useRef<SelectedSource | null>(null)
  const deletionRequest = useRef<{ readonly requestId: string; readonly source: SelectedSource } | null>(null)
  const nextDeletionRequest = useRef(0)
  const [deleting, setDeleting] = useState(false)
  const [deletions, setDeletions] = useState<readonly PendingDeletion[]>([])
  const deletionsRef = useRef<readonly PendingDeletion[]>([])
  // Text edits are held here rather than in the review store: they are a
  // source rewrite awaiting the explicit save, not review state to persist.
  const [textEdits, setTextEdits] = useState<Record<string, string>>({})
  // Undo/redo snapshots of everything not yet written to the file. A snapshot is
  // pushed before an edit changes it, so stepping back restores the prior state
  // without replaying anything.
  const [history, setHistory] = useState<{ readonly past: readonly DesignSnapshot[]; readonly future: readonly DesignSnapshot[] }>({ past: [], future: [] })
  const [pendingEdits, setPendingEdits] = useState(false)
  const editRevision = useRef(0)
  const [fileWrite, setFileWrite] = useState<{ readonly kind: 'idle' | 'saving' | 'saved' | 'partial' | 'failed'; readonly detail: string }>({ kind: 'idle', detail: '' })
  const [frameResource, setFrameResource] = useState<{ readonly source: string; readonly url: string } | null>(null)
  const [frameAppliedMode, setFrameAppliedMode] = useState<{ readonly source: string; readonly reloadToken: number; readonly mode: DesignMode } | null>(null)
  const [resolvedFile, setResolvedFile] = useState<{ readonly address: string; readonly path: string } | null>(null)
  const documentRef = useRef(state.document)
  documentRef.current = state.document

  useEffect(() => {
    if (locatorCopy === null) return
    const timeout = window.setTimeout(() => setLocatorCopy(null), 1600)
    return () => window.clearTimeout(timeout)
  }, [locatorCopy])

  const fileRef = useMemo(() => fileRefOf(resourceAddress), [fileRefOf, resourceAddress])
  const hostPath = resolvedFile?.address === resourceAddress ? resolvedFile.path : undefined
  const source = useMemo(
    () => content.kind === 'bytes' ? buildPreviewDocument(content.data) : undefined,
    [content],
  )

  useEffect(() => {
    if (source === undefined) return
    const url = URL.createObjectURL(new Blob([source], { type: 'text/html;charset=utf-8' }))
    setFrameResource({ source, url })
    return () => { URL.revokeObjectURL(url) }
  }, [source])

  /** Adopt a frame selection; only an explicit edit gesture opens the dialog. */
  const selectAnchor = useCallback((anchor: FrameAnchor, openEditor: boolean) => {
    selectedSource.current = { selector: anchor.selector, text: anchor.sourceText, classes: anchor.sourceClasses }
    setSelectedParentSelector(anchor.parentSelector)
    setTraits({
      display: anchor.display ?? '',
      resizable: anchor.resizable === true,
      movable: anchor.movable !== false,
    })
    const sameSelection = state.selectedSelector === anchor.selector
    if (state.open && sameSelection) {
      actions.select(toAnchor(anchor))
      return
    }
    actions.select(toAnchor(anchor))
    if (!openEditor || state.mode !== 'inspect') {
      if (state.open) actions.setOpen(false)
      return
    }
    setComputed(anchor.computed)
    focusReturnRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : frameRef.current
    setDraftStyle(state.document?.edits.find(edit => edit.selector === anchor.selector)?.declarations ?? {})
    setEditableText(anchor.editableText)
    setDraftText(anchor.editableText === null ? '' : textEdits[anchor.selector] ?? anchor.editableText)
    actions.setOpen(true)
  }, [actions, state.mode, state.document, state.open, state.selectedSelector, textEdits])

  const closeEditor = useCallback(() => {
    actions.setOpen(false)
    window.requestAnimationFrame(() => {
      const previous = focusReturnRef.current
      if (previous?.isConnected) previous.focus()
      else frameRef.current?.focus()
    })
  }, [actions])

  const cancelEditor = useCallback(() => {
    closeEditor()
  }, [closeEditor])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!state.open || stage === null) {
      setEditorPlacement(null)
      return
    }
    let frame = 0
    const update = (): void => { setEditorPlacement(placeEditor(stage)) }
    const schedule = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(update)
    }
    update()
    const observer = new ResizeObserver(schedule)
    observer.observe(stage)
    window.addEventListener('resize', schedule)
    window.document.addEventListener('scroll', schedule, true)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.document.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [state.open])

  // Push the active mode into the frame so its listeners match the switch.
  useEffect(() => {
    postToFrame(frameRef.current, { kind: 'mode', mode: state.mode, dragHandleLabel: t('dragHandle'), resizeHandleLabel: t('resizeHandle') })
  }, [state.mode, source, state.reloadToken, t])

  useEffect(() => {
    if (!state.open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        cancelEditor()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [state.open, cancelEditor])

  // Resolve the Session path on the Host before enabling any file writes.
  useEffect(() => {
    setResolvedFile(null)
    setTextEdits({})
    setDeletions([])
    deletionsRef.current = []
    selectedSource.current = null
    setSelectedParentSelector(null)
    deletionRequest.current = null
    setDeleting(false)
    setPendingEdits(false)
    editRevision.current = 0
    clearHistory()
    setFileWrite({ kind: 'idle', detail: '' })
    actions.load(null)
    actions.select(null)
    actions.setOpen(false)
    if (fileRef === undefined) {
      actions.endLoad()
      return
    }
    let active = true
    actions.beginLoad()
    void loadReview(fileRef)
      .then((result) => {
        if (!active) return
        setResolvedFile({ address: resourceAddress, path: result.path })
        actions.load(result.document)
        actions.endLoad()
      })
      .catch((error: unknown) => {
        if (!active) return
        setResolvedFile(null)
        actions.load(null)
        actions.endLoad()
        setFileWrite({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
      })
    return () => { active = false }
  }, [fileRef, resourceAddress, loadReview, actions])

  // Re-apply stored edits whenever the document reloads, so a saved style
  // survives a refresh of the reviewed document.
  useEffect(() => {
    const edits = state.document?.edits ?? []
    for (const edit of edits) {
      postToFrame(frameRef.current, { kind: 'style', selector: edit.selector, declarations: edit.declarations })
    }
  }, [state.document, state.reloadToken])

  /** Write the current review to the Host. */
  const persist = useCallback(async (next: DesignAnnotationDocument) => {
    if (fileRef === undefined || hostPath === undefined) return
    const canonical = { ...next, file: hostPath }
    actions.beginSave()
    try {
      await saveReview(fileRef, canonical)
      actions.endSave(canonical)
    } catch (error) {
      actions.failSave(error instanceof Error ? error.message : String(error))
    }
  }, [fileRef, hostPath, saveReview, actions])

  /** The document with one edit applied, replacing any prior edit for the selector. */
  const withEdit = useCallback((edit: ElementEdit, path: string): DesignAnnotationDocument => {
    const base = state.document ?? {
      version: 1 as const, file: path, comments: [], edits: [], updatedAt: edit.updatedAt,
    }
    return {
      ...base,
      edits: [...base.edits.filter(existing => existing.selector !== edit.selector), edit],
      updatedAt: edit.updatedAt,
    }
  }, [state.document])

  const snapshot = useCallback((): DesignSnapshot => ({
    document: documentRef.current,
    textEdits,
    deletions: deletionsRef.current,
  }), [textEdits])

  /** Record the state an edit is about to change, so one undo step reverses it. */
  const pushHistory = useCallback(() => {
    const entry = snapshot()
    setHistory(current => current.past.at(-1) === entry ? current : { past: [...current.past, entry].slice(-HISTORY_LIMIT), future: [] })
  }, [snapshot])

  const clearHistory = useCallback(() => {
    setHistory({ past: [], future: [] })
  }, [])

  /** Put a snapshot back into the store and the frame, without a file write. */
  const restoreSnapshot = useCallback((entry: DesignSnapshot) => {
    deletionsRef.current = entry.deletions
    setDeletions(entry.deletions)
    setTextEdits(entry.textEdits)
    actions.restore(entry.document)
    // A frame reload is the only way to un-apply a property the frame no longer
    // knows about, so replay the whole review onto the fresh document.
    actions.requestReload()
  }, [actions])

  const undo = useCallback(() => {
    setHistory(current => {
      const previous = current.past.at(-1)
      if (previous === undefined) return current
      // Capture what is on screen before restoring: the store update lands on
      // the next render, so snapshot() would otherwise read the restored state.
      const now = snapshot()
      restoreSnapshot(previous)
      return { past: current.past.slice(0, -1), future: [now, ...current.future].slice(0, HISTORY_LIMIT) }
    })
  }, [restoreSnapshot, snapshot])

  const redo = useCallback(() => {
    setHistory(current => {
      const next = current.future[0]
      if (next === undefined) return current
      const now = snapshot()
      restoreSnapshot(next)
      return { past: [...current.past, now].slice(-HISTORY_LIMIT), future: current.future.slice(1) }
    })
  }, [restoreSnapshot, snapshot])

  /**
   * Commit a finished drag or resize. The element already carries the new
   * values in the frame, so only the review document, the sidecar and the
   * history need updating.
   */
  const applyDragEdit = useCallback((selector: string, declarations: Record<string, string>) => {
    if (hostPath === undefined) return
    const previous = state.document?.edits.find(edit => edit.selector === selector)?.declarations ?? {}
    // A drag reports the properties it touched, not a whole style block, so
    // merge them over whatever the element already had and keep the rest.
    const merged = cleanDeclarations({ ...previous, ...declarations })
    if (sameDeclarations(previous, merged)) return
    pushHistory()
    if (Object.keys(merged).length > 0) {
      const edit: ElementEdit = { selector, declarations: merged, updatedAt: new Date().toISOString() }
      actions.upsertEdit(edit)
      void persist(withEdit(edit, hostPath))
    } else {
      actions.removeEdit(selector)
      void persist(withoutEdit(state.document, selector, hostPath))
    }
    editRevision.current += 1
    setPendingEdits(true)
    setFileWrite({ kind: 'idle', detail: '' })
    if (state.open && state.selectedSelector === selector) setDraftStyle(merged)
  }, [actions, hostPath, persist, pushHistory, state.document, state.open, state.selectedSelector, withEdit])

  // Cmd/Ctrl+Z anywhere in the preview steps the review history. The key is
  // handled here rather than in the frame so one stack covers every edit kind.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key !== 'z' && event.key !== 'Z') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable
        || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [redo, undo])

  // Receive hover, selection, and drag completion from the frame runtime.
  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const message = data as Partial<FrameToParent>
      if (message.channel !== CHANNEL) return
      switch (message.kind) {
        case 'ready':
          postToFrame(frameRef.current, { kind: 'mode', mode: state.mode, dragHandleLabel: t('dragHandle'), resizeHandleLabel: t('resizeHandle') })
          for (const edit of state.document?.edits ?? []) {
            postToFrame(frameRef.current, { kind: 'style', selector: edit.selector, declarations: edit.declarations })
          }
          for (const [selector, value] of Object.entries(textEdits)) {
            postToFrame(frameRef.current, { kind: 'text', selector, value })
          }
          for (const deletion of deletionsRef.current) {
            postToFrame(frameRef.current, {
              kind: 'replayRemoval', selector: deletion.selector, requestId: `replay-${++nextDeletionRequest.current}`,
            })
          }
          return
        case 'modeApplied':
          if (message.mode === state.mode && source !== undefined) {
            setFrameAppliedMode({ source, reloadToken: state.reloadToken, mode: message.mode })
          }
          return
        case 'hover':
          actions.setHovered(
            message.selector === null || message.selector === undefined || message.tag === null || message.tag === undefined
              ? null
              : { selector: message.selector, tag: message.tag },
          )
          return
        case 'select':
          if (message.anchor !== undefined) selectAnchor(message.anchor, false)
          return
        case 'edit':
          if (message.anchor !== undefined) selectAnchor(message.anchor, true)
          return
        case 'move':
          if (message.anchor === undefined || message.declarations === undefined || message.selector === undefined) return
          if (state.selectedSelector !== message.selector) return
          // A finished drag or resize is a finished edit: commit it straight to
          // the review document and the sidecar. There is no per-element save
          // step, and no reason to open the dialog the user never asked for.
          if (state.open && state.selectedSelector === message.selector) {
            actions.select(toAnchor(message.anchor))
            setComputed(message.anchor.computed)
          }
          applyDragEdit(message.selector, message.declarations)
          return
        case 'history':
          if (message.action === 'redo') redo()
          else undo()
          return
        case 'unavailable':
          // A handle that did nothing is a question the reviewer needs answered.
          setFileWrite({ kind: 'failed', detail: `${t('handleUnavailable')}: ${t(message.reason === 'resize' ? 'resizeHandle' : 'dragHandle')}` })
          return
        case 'removeResult': {
          if (typeof message.requestId !== 'string' || typeof message.selector !== 'string') return
          const request = deletionRequest.current
          if (request?.requestId === message.requestId && request.source.selector === message.selector) {
            deletionRequest.current = null
            setDeleting(false)
            const removedSelectors = Array.isArray(message.removedSelectors)
              ? message.removedSelectors.filter((selector): selector is string => typeof selector === 'string')
              : []
            if (message.success !== true || !removedSelectors.includes(message.selector)) {
              setFileWrite({ kind: 'failed', detail: t('deleteFailed') })
              return
            }
            const deletion: PendingDeletion = { ...request.source, removedSelectors }
            pushHistory()
            const next = [...deletionsRef.current.filter(current => !removedSelectors.includes(current.selector)), deletion]
            deletionsRef.current = next
            setDeletions(next)
            editRevision.current += 1
            setFileWrite({ kind: 'idle', detail: '' })
            actions.select(null)
            closeEditor()
            return
          }
          if (message.requestId.startsWith('replay-') && message.success !== true) {
            setFileWrite({ kind: 'failed', detail: `${t('deleteFailed')}: ${message.selector}` })
          }
          return
        }
        default:
          return
      }
    }
    window.addEventListener('message', listener)
    return () => { window.removeEventListener('message', listener) }
  }, [actions, applyDragEdit, closeEditor, pushHistory, redo, selectAnchor, source, state.mode, state.document, state.reloadToken, state.selectedSelector, state.open, textEdits, t, undo])



  const saveSelection = useCallback(() => {
    const selector = state.selectedSelector
    if (selector === null || hostPath === undefined) return
    const declarations = cleanDeclarations(draftStyle)
    const previous = state.document?.edits.find(edit => edit.selector === selector)
    const styleChanged = !sameDeclarations(previous?.declarations ?? {}, declarations)
    const textChanged = editableText !== null && draftText !== editableText
    if (styleChanged) {
      if (Object.keys(declarations).length > 0) {
        const edit: ElementEdit = { selector, declarations, updatedAt: new Date().toISOString() }
        actions.upsertEdit(edit)
        void persist(withEdit(edit, hostPath))
        if (previous !== undefined && Object.keys(previous.declarations).some(key => !(key in declarations))) {
          actions.requestReload()
        } else {
          postToFrame(frameRef.current, { kind: 'style', selector, declarations })
        }
      } else {
        actions.removeEdit(selector)
        void persist(withoutEdit(state.document, selector, hostPath))
        actions.requestReload()
      }
    }
    if (textChanged) {
      postToFrame(frameRef.current, { kind: 'text', selector, value: draftText })
      setTextEdits(current => ({ ...current, [selector]: draftText }))
    }
    if (styleChanged || textChanged) {
      pushHistory()
      editRevision.current += 1
      setPendingEdits(true)
    }
    setFileWrite({ kind: 'idle', detail: '' })
    closeEditor()
  }, [draftStyle, draftText, editableText, state.selectedSelector, state.document, hostPath, actions, persist, pushHistory, withEdit, closeEditor])

  /** Remove only the selected frame element and stage its source deletion. */
  const deleteSelection = useCallback(() => {
    const source = selectedSource.current
    if (hostPath === undefined || !state.open || state.mode !== 'inspect' || deleting
      || fileWrite.kind === 'saving' || source === null || source.selector !== state.selectedSelector
      || /^(?:html|head|body)$/iu.test(state.selected?.tag ?? '')) return
    const requestId = `remove-${++nextDeletionRequest.current}`
    deletionRequest.current = { requestId, source }
    setDeleting(true)
    setFileWrite({ kind: 'idle', detail: '' })
    postToFrame(frameRef.current, { kind: 'removeSelected', selector: source.selector, requestId })
  }, [deleting, fileWrite.kind, hostPath, state.mode, state.open, state.selected?.tag, state.selectedSelector])

  const resetStyle = useCallback(() => {
    setDraftStyle({})
    setFileWrite({ kind: 'idle', detail: '' })
  }, [])

  /**
   * Write the reviewer's edits into the file itself.
   *
   * This is deliberately explicit: the review sidecar accumulates edits as the
   * reviewer works, and only this action changes the artifact. The Host applies
   * each edit as a span rewrite, so the result is reported back — including any
   * selector it could not locate in the source, which the reviewer must know
   * about rather than discover later.
   */
  const saveToFile = useCallback(() => {
    if (fileRef === undefined || hostPath === undefined) return
    const edits = state.document?.edits ?? []
    if (edits.length === 0 && Object.keys(textEdits).length === 0 && deletions.length === 0) {
      setFileWrite({ kind: 'idle', detail: '' })
      return
    }
    const revision = editRevision.current
    setFileWrite({ kind: 'saving', detail: '' })
    void applyToFile({ file: fileRef, edits, textEdits, deletions: deletions.map(({ selector, text, classes }) => ({ selector, text, classes })) })
      .then((result: DesignApplyResult) => {
        const skipped = new Set(result.skipped.map(entry => entry.selector))
        const applied = new Set(result.applied)
        const writtenDeletions = deletions.filter(deletion => applied.has(deletion.selector) && !skipped.has(deletion.selector))
        const missingDeletions = deletions.filter(deletion => !applied.has(deletion.selector) && !skipped.has(deletion.selector))
        if (writtenDeletions.length > 0) {
          const written = new Set(writtenDeletions.map(deletion => deletion.selector))
          const remaining = deletionsRef.current.filter(deletion => !written.has(deletion.selector))
          deletionsRef.current = remaining
          setDeletions(remaining)
          const removedSelectors = new Set(writtenDeletions.flatMap(deletion => deletion.removedSelectors))
          setTextEdits(current => Object.fromEntries(Object.entries(current)
            .filter(([selector]) => !removedSelectors.has(selector))))
          const document = documentRef.current
          if (document !== null && document.edits.some(edit => removedSelectors.has(edit.selector))) {
            const next = {
              ...document,
              edits: document.edits.filter(edit => !removedSelectors.has(edit.selector)),
              updatedAt: new Date().toISOString(),
            }
            actions.removeEdits([...removedSelectors])
            void persist(next)
          }
        }
        if (result.skipped.length > 0 || missingDeletions.length > 0) {
          const missed = [...result.skipped.map(entry => entry.selector), ...missingDeletions.map(deletion => deletion.selector)]
          setFileWrite({ kind: 'partial', detail: missed.join(', ') })
          return
        }
        setFileWrite({ kind: 'saved', detail: String(result.bytes) })
        if (editRevision.current === revision) setPendingEdits(false)
        setTextEdits(current => Object.fromEntries(Object.entries(current)
          .filter(([selector, value]) => textEdits[selector] !== value)))
        // The file now holds everything that was pending, so it is the point
        // undo can no longer reach back across.
        clearHistory()
      })
      .catch((error: unknown) => {
        setFileWrite({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
      })
  }, [actions, applyToFile, clearHistory, deletions, fileRef, hostPath, persist, state.document, textEdits])

  const hasFileEdits = (state.document?.edits.length ?? 0) > 0 || Object.keys(textEdits).length > 0 || deletions.length > 0
  const previousStyle = state.document?.edits.find(edit => edit.selector === state.selectedSelector)?.declarations ?? {}
  const draftDirty = state.open && state.selected !== null && (
    !sameDeclarations(previousStyle, cleanDeclarations(draftStyle))
    || editableText !== null && draftText !== editableText
  )
  const statusDirty = state.dirty || draftDirty || pendingEdits || deletions.length > 0
  const rootSelected = /^(?:html|head|body)$/iu.test(state.selected?.tag ?? '')
  // "component or button" is answerable from the tag: an interactive element
  // is one the user can act on, everything else is a content block.
  const elementType = interactiveTag(state.selected?.tag ?? '') ? t('typeInteractive') : t('typeBlock')
  const displayNote = [
    traits?.display === '' ? undefined : t('displayLabel') + ' ' + traits?.display,
    traits?.resizable === false ? t('notResizable') : undefined,
  ].filter(Boolean).join(' · ')
  const frameInteractive = frameAppliedMode !== null && frameAppliedMode.source === source
    && frameAppliedMode.reloadToken === state.reloadToken && frameAppliedMode.mode === state.mode

  if (content.kind !== 'bytes') return null
  if (source === undefined) return <p className={css.status} role="alert">{t('failed')}</p>
  if (frameResource?.source !== source) return <p className={css.status} role="status">{t('loading')}</p>

  return (
    <div className={css.preview} data-html-design-surface>
      <div className={css.toolbar}>
        <div className={css.modeSwitch} role="group" aria-label={t('modes')} data-mode={state.mode}>
          {MODES.map(mode => (
            <button key={mode} type="button" className={css.modeOption} aria-pressed={state.mode === mode} title={mode === 'inspect' ? t('editGestureHint') : undefined} disabled={deleting} onClick={() => {
              if (state.mode === mode) return
              cancelEditor()
              postToFrame(frameRef.current, { kind: 'mode', mode, dragHandleLabel: t('dragHandle'), resizeHandleLabel: t('resizeHandle') })
              actions.setMode(mode)
            }}>
              {modeLabel(mode, t)}
            </button>
          ))}
        </div>
        <div className={css.toolbarEnd}>
          <Tooltip label={t('undoHint')}>
            <Button variant="ghost" size="sm" disabled={history.past.length === 0 || deleting} onClick={undo}>{t('undo')}</Button>
          </Tooltip>
          <Tooltip label={t('redoHint')}>
            <Button variant="ghost" size="sm" disabled={history.future.length === 0 || deleting} onClick={redo}>{t('redo')}</Button>
          </Tooltip>
          <Tag tone={statusDirty ? 'warning' : state.error !== null || fileWrite.kind === 'failed' ? 'danger' : 'neutral'}>
            {draftDirty ? t('unsaved') : state.saving ? t('saving') : statusDirty ? t('unsaved') : state.error !== null || fileWrite.kind === 'failed' ? t('saveFailed') : t('saved')}
          </Tag>
          <Tooltip label={t('saveToFileHint')}>
            <Button variant="primary" size="sm" disabled={hostPath === undefined || !hasFileEdits || draftDirty || deleting || state.saving || fileWrite.kind === 'saving'} onClick={saveToFile}>
              {fileWrite.kind === 'saving' ? t('saving') : t('saveToFile')}
            </Button>
          </Tooltip>
          <Button variant="ghost" size="sm" onClick={() => {
            deletionRequest.current = null
            setDeleting(false)
            cancelEditor()
            actions.requestReload()
          }}>{t('reload')}</Button>
        </div>
      </div>

      {(state.error !== null || fileWrite.kind === 'failed' || fileWrite.kind === 'partial' || fileWrite.kind === 'saved') && (
        <p className={css.notice} role={state.error !== null || fileWrite.kind === 'failed' ? 'alert' : 'status'}>
          {state.error ?? (fileWrite.kind === 'failed' ? fileWrite.detail : fileWrite.kind === 'partial' ? `${t('filePartial')}: ${fileWrite.detail}` : t('fileSaved'))}
        </p>
      )}

      <div className={css.workspace}>
        <div ref={stageRef} className={css.stage} data-html-design-stage>
          <iframe
            key={state.reloadToken}
            ref={frameRef}
            className={css.frame}
            src={frameResource.url}
            // Scripts run so the injected runtime can observe and apply edits;
            // omitting allow-same-origin gives this Blob document an opaque
            // origin, so the reviewed page cannot reach this application.
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            title={t('frame')}
            data-html-design-preview
            data-frame-mode-ready={frameInteractive ? 'true' : 'false'}
          />
        </div>

        {state.open && state.selected !== null && editorPlacement !== null && createPortal(
            <div
              className={css.editor}
              role="dialog"
              aria-label={t('editElement')}
              data-html-design-editor
              data-placement={editorPlacement.side}
              data-compact={editorPlacement.width < 390 ? '' : undefined}
              style={{
                left: editorPlacement.left,
                top: editorPlacement.top,
                width: editorPlacement.width,
                maxHeight: editorPlacement.maxHeight,
              }}
            >
              <div className={css.editorHeader}>
                <div className={css.editorIdentity}>
                  <span className={css.elementTag} title={t('elementTag')}>{state.selected.tag.toUpperCase()}</span>
                  <span className={css.locatorLabel}>{t('elementLocator')}</span>
                  <span className={css.editorSelector} title={state.selected.selector}>{state.selected.selector}</span>
                </div>
                <div className={css.editorHeaderActions}>
                  {selectedParentSelector !== null && (
                    <button type="button" className={css.editorHeaderAction} title={t('selectParentHint')} onClick={() => {
                      postToFrame(frameRef.current, { kind: 'selectParent' })
                    }}>{t('selectParent')}</button>
                  )}
                  <button type="button" className={css.editorHeaderAction} title={t('copyLocatorHint')} onClick={() => {
                    const selector = state.selected?.selector
                    if (selector === undefined) return
                    void writeClipboard(selector).then(success => setLocatorCopy({ selector, success }))
                  }}>{locatorCopy?.selector === state.selected.selector
                    ? t(locatorCopy.success ? 'locatorCopied' : 'locatorCopyFailed')
                    : t('copyLocator')}</button>
                  <Button variant="ghost" size="sm" aria-label={t('closeEditor')} onClick={cancelEditor}>×</Button>
                </div>
              </div>
              <div className={css.editorScroll}>
                <section className={css.section}>
                  <h3 className={css.sectionTitle}>{t('content')}</h3>
                  {editableText === null
                    ? <p className={css.hint}>{t('textSelectionHint')}</p>
                    : (
                      <label className={css.field}>
                        <span className={css.fieldLabel}>{t('textContent')}</span>
                        <textarea className={css.textInput} autoFocus value={draftText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                          setDraftText(event.target.value)
                          setFileWrite({ kind: 'idle', detail: '' })
                        }} />
                      </label>
                    )}
                </section>
                <section className={css.section}>
                  <h3 className={css.sectionTitle}>{t('styles')}</h3>
                  <div className={css.fields}>
                    {STYLE_FIELDS.map(field => {
                      const raw = draftStyle[field.key] ?? ''
                      // While nothing is typed the field mirrors what the page
                      // actually renders, so the reviewer sees the real value.
                      const shown = raw === '' ? computed[field.key] ?? '' : raw
                      const commit = (value: string): void => {
                        setDraftStyle(current => ({ ...current, [field.key]: value }))
                        setFileWrite({ kind: 'idle', detail: '' })
                      }
                      if (field.control.kind === 'color') {
                        const hex = toHexColor(shown)
                        return (
                          <div key={field.key} className={css.field}>
                            <label className={css.fieldLabel} htmlFor={`dsh-style-${field.key}`}>{t(field.label)}</label>
                            <div className={css.colorField}>
                              <input
                                type="color"
                                className={css.colorSwatch}
                                aria-label={t(field.label)}
                                value={hex}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => commit(event.target.value)}
                              />
                              <Input
                                id={`dsh-style-${field.key}`}
                                value={raw}
                                placeholder={hex}
                                spellCheck={false}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => commit(event.target.value.trim())}
                              />
                            </div>
                          </div>
                        )
                      }
                      if (field.control.kind === 'choice') {
                        return (
                          <div key={field.key} className={css.field}>
                            <label className={css.fieldLabel} htmlFor={`dsh-style-${field.key}`}>{t(field.label)}</label>
                            <select
                              id={`dsh-style-${field.key}`}
                              className={css.select}
                              value={raw === '' ? '' : raw}
                              onChange={(event: ChangeEvent<HTMLSelectElement>) => commit(event.target.value)}
                            >
                              <option value="">{t('inherit')}</option>
                              {field.control.options.map(option => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </div>
                        )
                      }
                      const { units, bare } = field.control
                      const { amount, unit } = splitLength(shown, units, bare === true)
                      return (
                        <div key={field.key} className={css.field}>
                          <label className={css.fieldLabel} htmlFor={`dsh-style-${field.key}`}>{t(field.label)}</label>
                          <div className={css.lengthField}>
                            <input
                              id={`dsh-style-${field.key}`}
                              type="number"
                              className={css.lengthInput}
                              // The box shows what the reviewer typed; the
                              // page's own value stays in the placeholder so
                              // resetting the draft can go back to nothing.
                              value={raw === '' ? '' : splitLength(raw, units, bare === true).amount}
                              placeholder={amount}
                              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                const text = event.target.value
                                commit(text === '' ? '' : joinLength(text, unit))
                              }}
                            />
                            <select
                              className={css.unitSelect}
                              aria-label={t('unit')}
                              value={unit}
                              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                const current = raw === '' ? amount : splitLength(raw, units, bare === true).amount
                                commit(current === '' ? '' : joinLength(current, event.target.value))
                              }}
                            >
                              {units.map(option => (
                                <option key={option === '' ? 'none' : option} value={option}>{option === '' ? t('unitless') : option}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
                <dl className={css.meta}>
                  <dt>{t('elementType')}</dt>
                  <dd>
                    <code className={css.tagCode}>{elementType}</code>
                    <span className={css.metaNote}>{displayNote}</span>
                  </dd>
                  <dt>{t('size')}</dt>
                  <dd>{Math.round(state.selected.rect.width)} × {Math.round(state.selected.rect.height)}</dd>
                </dl>
                {traits?.movable === false && <p className={css.warn}>{t('dragUnavailable')}</p>}
                <p className={css.hint}>{t('dragHint')}</p>
                <p className={css.hint}>{t(rootSelected ? 'deleteRootHint' : 'deleteHint')}</p>
              </div>
              <div className={css.editorFooter}>
                <Button variant="ghost" size="sm" onClick={resetStyle}>{t('resetStyle')}</Button>
                <Button variant="ghost" size="sm" className={css.deleteButton} disabled={hostPath === undefined || rootSelected || deleting || fileWrite.kind === 'saving'} onClick={deleteSelection}>
                  {deleting ? t('deleting') : t('deleteElement')}
                </Button>
                <span className={css.footerSpace} />
                <Button variant="outline" size="sm" disabled={deleting} onClick={cancelEditor}>{t('cancel')}</Button>
                <Button variant="primary" size="sm" disabled={hostPath === undefined || deleting} onClick={saveSelection}>{t('save')}</Button>
              </div>
            </div>,
            window.document.body,
          )}

      </div>
    </div>
  )
}

/** Post one message into the frame, tolerating a frame that is not mounted yet. */
function postToFrame(frame: HTMLIFrameElement | null, message: Record<string, unknown>): void {
  frame?.contentWindow?.postMessage({ channel: CHANNEL, ...message }, '*')
}

/** Convert a frame-reported anchor into the stored shape. */
function toAnchor(anchor: FrameAnchor): ElementCommentAnchor {
  return {
    selector: anchor.selector,
    tag: anchor.tag,
    ...anchor.id === undefined ? {} : { id: anchor.id },
    classes: anchor.classes,
    text: anchor.text,
    rect: anchor.rect,
  }
}

/** Compare editable declarations without depending on their insertion order. */
function sameDeclarations(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftKeys = Object.keys(left)
  return leftKeys.length === Object.keys(right).length && leftKeys.every(key => left[key] === right[key])
}

/** Ignore blank draft fields before comparing or persisting style edits. */
function cleanDeclarations(draft: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(draft)
    .map(([key, value]): [string, string] => [key, value.trim()])
    .filter(([, value]) => value.length > 0))
}

/** Remove a selector's edit from the sidecar when the user saves cleared style fields. */
function withoutEdit(document: DesignAnnotationDocument | null, selector: string, hostPath: string): DesignAnnotationDocument {
  const base = document ?? emptyFor(hostPath)
  return { ...base, edits: base.edits.filter(edit => edit.selector !== selector), updatedAt: new Date().toISOString() }
}

/** An empty review document for a resolved file. */
function emptyFor(hostPath: string): DesignAnnotationDocument {
  return { version: 1, file: hostPath, comments: [], edits: [], updatedAt: new Date().toISOString() }
}

/** Locale key for a mode's label. */
function modeLabel(mode: DesignMode, t: HtmlDesignBodyProps['t']): string {
  switch (mode) {
    case 'browse': return t('modeBrowse')
    case 'inspect': return t('modeInspect')
  }
}
