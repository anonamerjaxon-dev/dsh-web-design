/**
 * Source of the design-tools runtime injected into the preview frame.
 *
 * The injected document is sandboxed with `allow-scripts` and no
 * `allow-same-origin`, so the parent cannot reach into it. Everything the
 * design tools need therefore travels over `postMessage`: the frame reports
 * hover, selection, drag moves, and geometry, and applies edits the parent asks
 * for.
 *
 * The runtime is a string rather than a module because it must be inlined into
 * the document the frame loads; it cannot import from the bundle.
 *
 * @module @guowenzhang/dsh-web-design/client/frame-runtime
 */

/** Message channel name shared with the injected runtime. */
export const CHANNEL = 'dsh-web-design'

/** A message the frame sends to the parent. */
export type FrameToParent =
  | { readonly channel: typeof CHANNEL; readonly kind: 'ready' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'modeApplied'; readonly mode: 'browse' | 'inspect' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'hover'; readonly selector: string | null; readonly tag: string | null }
  | { readonly channel: typeof CHANNEL; readonly kind: 'select'; readonly anchor: FrameAnchor }
  | { readonly channel: typeof CHANNEL; readonly kind: 'edit'; readonly anchor: FrameAnchor }
  | { readonly channel: typeof CHANNEL; readonly kind: 'move'; readonly selector: string; readonly declarations: Readonly<Record<string, string>>; readonly restore: Readonly<Record<string, string>>; readonly anchor: FrameAnchor }
  | { readonly channel: typeof CHANNEL; readonly kind: 'history'; readonly action: 'undo' | 'redo' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'unavailable'; readonly selector: string; readonly reason: 'move' | 'resize' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'removeResult'; readonly requestId: string; readonly selector: string; readonly success: boolean; readonly removedSelectors: readonly string[] }
  | { readonly channel: typeof CHANNEL; readonly kind: 'resize'; readonly height: number }

/** Element metadata the frame reports on selection. */
export interface FrameAnchor {
  /** Stable selector path from the document root. */
  readonly selector: string
  /** Selector of the immediate parent element, if one exists. */
  readonly parentSelector: string | null
  /** Element tag name, lowercased. */
  readonly tag: string
  /** Element id attribute, absent when it has none. */
  readonly id?: string
  /** Element class list. */
  readonly classes: readonly string[]
  /** Short excerpt of the element's text. */
  readonly text: string
  /** Full normalized text from the original preview document. */
  readonly sourceText: string
  /** Classes from the original preview document. */
  readonly sourceClasses: readonly string[]
  /** Exact direct text when the element has one non-blank direct text node. */
  readonly editableText: string | null
  /** Element bounds relative to the document. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  /** Computed values the editor shows as the element's current style. */
  readonly computed: Readonly<Record<string, string>>
  /** Computed display mode, so the editor can name the kind of box. */
  readonly display?: string
  /** Whether width/height would change this element's box. */
  readonly resizable?: boolean
  /** Whether a drag gesture can start on this element. */
  readonly movable?: boolean
}

/** A message the parent sends to the frame. */
export type ParentToFrame =
  | { readonly channel: typeof CHANNEL; readonly kind: 'mode'; readonly mode: string; readonly dragHandleLabel?: string; readonly resizeHandleLabel?: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'style'; readonly selector: string; readonly declarations: Readonly<Record<string, string>> }
  | { readonly channel: typeof CHANNEL; readonly kind: 'text'; readonly selector: string; readonly value: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'selectParent' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'removeSelected'; readonly selector: string; readonly requestId: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'replayRemoval'; readonly selector: string; readonly requestId: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'highlight'; readonly selectors: readonly string[] }
  | { readonly channel: typeof CHANNEL; readonly kind: 'reset' }

/**
 * Render the runtime script for one frame.
 *
 * The script is a plain function stringified into the document. It runs once,
 * installs capture-phase listeners for edit gestures, and
 * never exposes page globals to the parent.
 * @returns the complete `<script>` contents.
 */
export function frameRuntime(): string {
  return `(${runtime.toString()})(${JSON.stringify(CHANNEL)});`
}

/**
 * The runtime body. Kept as a named function so {@link frameRuntime} can
 * stringify it; it must stay self-contained — no imports, no closure values.
 * @param channel - message channel name expected on every message.
 */
function runtime(channel: string): void {
  // These declarations exist only inside the stringified function body; the
  // outer TypeScript compile sees a DOM-free function and must not narrow them.
  const doc = (globalThis as { document?: Document }).document
  if (doc === undefined) return

  let mode = 'browse'
  let hovered: Element | null = null
  let selected: Element | null = null
  let selectedSelector: string | null = null
  const originalSelectors = new WeakMap<Element, string>()
  const originalParents = new WeakMap<Element, Element | null>()
  const originalTargets = new Map<string, Element>()
  const ambiguousSelectors = new Set<string>()
  const originalSource = new WeakMap<Element, { text: string; classes: string[] }>()
  const editableTextTargets = new WeakMap<Element, Node>()
  let selectorsFrozen = false
  let overlay: HTMLDivElement | null = null
  let box: HTMLDivElement | null = null
  let drag: {
    pointerId: number; element: HTMLElement | SVGElement; selector: string; x: number; y: number
    strategy: 'inline' | 'translate'; baseX: string; baseY: string; baseZ: string | null
    restore: Record<string, string>; priorities: Record<string, string>; declarations: Record<string, string> | null
  } | null = null
  let resize: {
    pointerId: number; element: HTMLElement; selector: string
    west: boolean; east: boolean; north: boolean; south: boolean
    x: number; y: number; startW: number; startH: number
    contentBox: boolean; insetX: number; insetY: number
    baseX: string; baseY: string; baseZ: string | null
    restore: Record<string, string>; priorities: Record<string, string>; declarations: Record<string, string> | null
  } | null = null
  let handle: HTMLButtonElement | null = null
  let resizeHandles: HTMLDivElement | null = null

  const post = (message: Record<string, unknown>): void => {
    try {
      ;(globalThis as { parent?: { postMessage(data: unknown, target: string): void } }).parent
        ?.postMessage({ channel, ...message }, '*')
    } catch (error) {
      // A frame detached mid-message has no parent to notify.
      void error
    }
  }

  /** Build a selector path that still resolves when ids repeat or need escaping. */
  const currentSelectorFor = (element: Element): string => {
    const parts: string[] = []
    let current: Element | null = element
    while (current !== null && current !== doc.documentElement) {
      const tag = current.tagName.toLowerCase()
      const id = current.getAttribute('id')
      if (id !== null && /^[a-z_][a-z0-9_-]*$/iu.test(id) && doc.querySelectorAll('#' + id).length === 1) {
        parts.unshift(tag + '#' + id)
        break
      }
      const parent: Element | null = current.parentElement
      if (parent === null) {
        parts.unshift(tag)
        break
      }
      const siblings = Array.from(parent.children).filter(child => child.tagName === current?.tagName)
      const index = siblings.indexOf(current) + 1
      parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + index + ')' : tag)
      current = parent
    }
    return parts.length === 0 ? 'html' : parts.join(' > ')
  }

  const selectorFor = (element: Element): string => originalSelectors.get(element) ?? currentSelectorFor(element)

  const normalizedText = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim()

  const sourceFor = (element: Element): { text: string; classes: string[] } => {
    let source = originalSource.get(element)
    if (source === undefined) {
      source = { text: normalizedText(element), classes: Array.from(element.classList) }
      originalSource.set(element, source)
    }
    return source
  }

  for (const element of doc.querySelectorAll('*')) sourceFor(element)

  /** Freeze paths before the first removal so sibling positions keep their original meaning. */
  const freezeSelectors = (): void => {
    if (selectorsFrozen) return
    for (const element of doc.querySelectorAll('*')) {
      if (element.closest('[data-dsh-design-overlay],[data-dsh-design-box]') !== null) continue
      const selector = currentSelectorFor(element)
      originalSelectors.set(element, selector)
      originalParents.set(element, element.parentElement)
      if (ambiguousSelectors.has(selector)) continue
      try {
        const matches = doc.querySelectorAll(selector)
        if (matches.length !== 1 || matches[0] !== element || originalTargets.has(selector)) {
          originalTargets.delete(selector)
          ambiguousSelectors.add(selector)
          continue
        }
      } catch (error) {
        // Invalid page-authored ids may make a selector unfit for replay.
        void error
        ambiguousSelectors.add(selector)
        continue
      }
      originalTargets.set(selector, element)
    }
    selectorsFrozen = true
  }

  const resolve = (selector: string): Element | null => {
    if (selector === selectedSelector) return selected?.isConnected ? selected : null
    if (selectorsFrozen) {
      const element = originalTargets.get(selector)
      return element?.isConnected ? element : null
    }
    try {
      const matches = doc.querySelectorAll(selector)
      return matches.length === 1 ? matches[0] ?? null : null
    } catch (error) {
      // A selector the page's own DOM made invalid simply resolves to nothing.
      void error
      return null
    }
  }

  const anchorFor = (element: Element, selector = selectorFor(element)): Record<string, unknown> => {
    const rect = element.getBoundingClientRect()
    const view = doc.defaultView
    const computed = view?.getComputedStyle(element)
    const style: Record<string, string> = {}
    for (const key of ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color',
      'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right',
      'margin-bottom', 'margin-left', 'border-radius', 'width', 'height', 'position', 'left', 'top', 'translate'] as const) {
      const value = computed?.getPropertyValue(key)
      if (typeof value === 'string' && value.length > 0) style[key] = value
    }
    const id = element.getAttribute('id')
    const source = sourceFor(element)
    return {
      selector,
      parentSelector: element.parentElement === null ? null : selectorFor(element.parentElement),
      tag: element.tagName.toLowerCase(),
      ...(id === null ? {} : { id }),
      classes: Array.from(element.classList),
      text: textOf(element),
      sourceText: source.text,
      sourceClasses: source.classes,
      editableText: editableTextOf(element),
      rect: {
        x: rect.left + (view?.scrollX ?? 0),
        y: rect.top + (view?.scrollY ?? 0),
        width: rect.width,
        height: rect.height,
      },
      computed: style,
      // What kind of box this is, and whether the handles can move it at all.
      // A silent no-op handle is worse than no handle.
      display: computed?.getPropertyValue('display').trim() ?? '',
      resizable: resizable(element),
      movable: movable(element),
    }
  }

  /** Why a drag gesture could not start, for the reviewer instead of silence. */
  const movable = (element: Element): boolean => {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false
    for (const property of ['position', 'left', 'top', 'translate']) {
      if (element.style.getPropertyPriority(property) === 'important') return false
    }
    const computed = doc.defaultView?.getComputedStyle(element)
    if (computed?.display === 'inline') {
      const position = computed.getPropertyValue('position').trim() || 'static'
      if (position !== 'static' && position !== 'relative') return false
      const x = positionBase(computed.getPropertyValue('left'), computed.getPropertyValue('right'))
      const y = positionBase(computed.getPropertyValue('top'), computed.getPropertyValue('bottom'))
      if (x === null || y === null) return false
      return true
    }
    const original = element.style.getPropertyValue('translate')
    if (original !== '' && translateParts(original.trim()) === null) return false
    return translateParts(computed?.getPropertyValue('translate').trim() || original) !== null
  }

  /** Short text excerpt for the selected-element display. */
  const textOf = (element: Element): string => {
    const raw = normalizedText(element)
    return raw.length > 160 ? raw.slice(0, 160) + '…' : raw
  }

  /** Locate the only non-blank direct text node without crossing into child elements. */
  const editableTextNodeOf = (element: Element): Node | null => {
    if (/^(?:script|style|textarea|template|noscript)$/iu.test(element.tagName)) return null
    const previous = editableTextTargets.get(element)
    if (previous?.parentNode === element) return previous
    const directText = Array.from(element.childNodes).filter(child => child.nodeType === 3)
    const meaningful = directText.filter(child => (child.textContent ?? '').trim() !== '')
    const target = meaningful.length === 1 ? meaningful[0] : directText.length === 1 ? directText[0] : undefined
    if (target !== undefined) editableTextTargets.set(element, target)
    return target ?? null
  }

  const editableTextOf = (element: Element): string | null => editableTextNodeOf(element)?.textContent ?? null

  const lengthTerm = /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%|em|rem|vw|vh|vmin|vmax)?|calc\(.+\))$/iu

  /** Split a computed translate value without breaking spaces inside calc(). */
  const translateParts = (value: string): { x: string; y: string; z: string | null } | null => {
    if (value === '' || value === 'none') return { x: '0px', y: '0px', z: null }
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index]
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      else if (depth === 0 && /\s/u.test(char ?? '')) {
        if (index > start) parts.push(value.slice(start, index))
        start = index + 1
      }
      if (depth < 0) return null
    }
    if (depth !== 0) return null
    if (start < value.length) parts.push(value.slice(start))
    if (parts.length < 1 || parts.length > 3) return null
    if (!parts.every(part => lengthTerm.test(part))) return null
    return { x: parts[0] as string, y: parts[1] ?? '0px', z: parts[2] ?? null }
  }

  /** Join translate axes, keeping both in the same notation. jsdom's cssstyle
   *  silently drops a `translate` that mixes `calc()` with a plain length, so a
   *  plain axis is lifted into `calc(base + 0px)` whenever the other is calc. */
  const translateValue = (x: string, y: string, z: string | null): string => {
    const xCalc = x.startsWith('calc(')
    const yCalc = y.startsWith('calc(')
    const left = yCalc && !xCalc ? 'calc(' + x + ' + 0px)' : x
    const right = xCalc && !yCalc ? 'calc(' + y + ' + 0px)' : y
    return left + ' ' + right + (z === null ? '' : ' ' + z)
  }

  /** Resolve one side of a relatively positioned inline element. */
  const positionBase = (leading: string, trailing: string): string | null => {
    if (leading !== '' && leading !== 'auto') return lengthTerm.test(leading) ? leading : null
    if (trailing !== '' && trailing !== 'auto') return lengthTerm.test(trailing) ? 'calc(0px - ' + trailing + ')' : null
    return '0px'
  }

  const offset = (base: string, delta: number): string => {
    if (delta === 0) return base
    if (base === '0px') return delta + 'px'
    return 'calc(' + base + (delta < 0 ? ' - ' : ' + ') + Math.abs(delta) + 'px)'
  }

  const restoreInlineStyles = (element: HTMLElement | SVGElement, restore: Record<string, string>, priorities: Record<string, string>): void => {
    for (const [property, value] of Object.entries(restore)) {
      if (value === '') element.style.removeProperty(property)
      else element.style.setProperty(property, value, priorities[property] ?? '')
    }
  }

  const stopDrag = (commit: boolean): void => {
    const active = drag
    if (active === null) return
    drag = null
    if (handle !== null) handle.style.cursor = 'grab'
    if (!commit || active.declarations === null) {
      restoreInlineStyles(active.element, active.restore, active.priorities)
      place(box as HTMLDivElement, selected?.isConnected ? selected : null)
      return
    }
    post({ kind: 'move', selector: active.selector, declarations: active.declarations, restore: active.restore, anchor: anchorFor(active.element, active.selector) })
  }

  /** Elements whose inline `width`/`height` declarations change their box. */
  const resizable = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false
    const display = (doc.defaultView?.getComputedStyle(element).getPropertyValue('display') ?? '').trim()
    // Inline boxes ignore width/height entirely, so a resize handle on one
    // would drag without resizing anything.
    return display !== 'inline' && display !== 'inline-run-in' && display !== 'contents' && display !== 'none'
  }

  /** Sum computed box-model lengths, tolerating a stylesheet that omits them. */
  const lengthSum = (computed: CSSStyleDeclaration | undefined, names: readonly string[]): number => {
    let total = 0
    for (const name of names) {
      const value = Number.parseFloat(computed?.getPropertyValue(name) ?? '')
      if (Number.isFinite(value)) total += value
    }
    return total
  }

  /** Begin a resize gesture from one outline handle. */
  const beginResize = (event: PointerEvent, name: string): void => {
    if (mode !== 'inspect' || drag !== null || resize !== null) return
    const element = selected
    if (element === null || !element.isConnected) return
    if (!resizable(element)) {
      event.preventDefault()
      event.stopPropagation()
      post({ kind: 'unavailable', selector: selectedSelector ?? selectorFor(element), reason: 'resize' })
      return
    }
    if (!movable(element)) {
      event.preventDefault()
      event.stopPropagation()
      post({ kind: 'unavailable', selector: selectedSelector ?? selectorFor(element), reason: 'move' })
      return
    }
    const computed = doc.defaultView?.getComputedStyle(element)
    const restore: Record<string, string> = {}
    const priorities: Record<string, string> = {}
    for (const property of ['width', 'height', 'translate']) {
      restore[property] = element.style.getPropertyValue(property)
      priorities[property] = element.style.getPropertyPriority(property)
    }
    if (Object.values(priorities).some(priority => priority === 'important')) return
    const original = restore.translate ?? ''
    if (original !== '' && translateParts(original.trim()) === null) return
    const baseline = translateParts(computed?.getPropertyValue('translate').trim() || original)
    if (baseline === null) return
    const rect = element.getBoundingClientRect()
    event.preventDefault()
    event.stopPropagation()
    resize = {
      pointerId: event.pointerId, element, selector: selectedSelector ?? selectorFor(element),
      west: name.includes('w'), east: name.includes('e'), north: name.includes('n'), south: name.includes('s'),
      x: event.clientX, y: event.clientY, startW: rect.width, startH: rect.height,
      contentBox: computed?.getPropertyValue('box-sizing').trim() === 'content-box',
      insetX: lengthSum(computed, ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']),
      insetY: lengthSum(computed, ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width']),
      baseX: baseline.x, baseY: baseline.y, baseZ: baseline.z,
      restore, priorities, declarations: null,
    }
  }

  const stopResize = (commit: boolean): void => {
    const active = resize
    if (active === null) return
    resize = null
    if (!commit || active.declarations === null) {
      restoreInlineStyles(active.element, active.restore, active.priorities)
      place(box as HTMLDivElement, selected?.isConnected ? selected : null)
      return
    }
    post({ kind: 'move', selector: active.selector, declarations: active.declarations, restore: active.restore, anchor: anchorFor(active.element, active.selector) })
  }

  const removable = (element: Element): boolean => element.isConnected && element.ownerDocument === doc
    && element.parentElement !== null && !/^(?:html|head|body)$/iu.test(element.tagName)
    && element.closest('[data-dsh-design-overlay],[data-dsh-design-box]') === null

  const originallyWithin = (element: Element, ancestor: Element): boolean => {
    let current: Element | null = element
    while (current !== null) {
      if (current === ancestor) return true
      current = originalParents.get(current) ?? null
    }
    return false
  }

  const removeElement = (element: Element): string[] => {
    stopResize(false)
    stopDrag(false)
    const removedSelectors = new Set<string>()
    for (const [selector, original] of originalTargets) {
      if (originallyWithin(original, element)) removedSelectors.add(selector)
    }
    for (const descendant of [element, ...element.querySelectorAll('*')]) {
      const selector = originalSelectors.get(descendant)
      if (selector !== undefined) removedSelectors.add(selector)
    }
    if (selected !== null && (element === selected || element.contains(selected))) {
      selected = null
      selectedSelector = null
      if (box !== null) place(box, null)
    }
    if (hovered !== null && (element === hovered || element.contains(hovered))) {
      hovered = null
      if (overlay !== null) place(overlay, null)
      post({ kind: 'hover', selector: null, tag: null })
    }
    element.remove()
    return Array.from(removedSelectors)
  }

  const handleRemoval = (data: unknown, selectedOnly: boolean): void => {
    const payload = data as { requestId?: unknown; selector?: unknown }
    if (typeof payload.requestId !== 'string' || typeof payload.selector !== 'string') return
    let element: Element | null = null
    if (selectedOnly) {
      if (mode === 'inspect' && selected !== null && removable(selected) && selectedSelector === payload.selector) {
        freezeSelectors()
        if (originalTargets.get(payload.selector) === selected) element = selected
      }
    } else {
      freezeSelectors()
      const original = originalTargets.get(payload.selector)
      if (original !== undefined && removable(original)) element = original
    }
    const removedSelectors = element === null ? [] : removeElement(element)
    post({ kind: 'removeResult', requestId: payload.requestId, selector: payload.selector,
      success: element !== null, removedSelectors })
  }

  const ensureChrome = (): void => {
    if (overlay !== null && box !== null) return
    overlay = doc.createElement('div')
    overlay.setAttribute('data-dsh-design-overlay', '')
    overlay.style.cssText = 'position:absolute;z-index:2147483646;pointer-events:none;border:1px solid #4c8dff;background:rgba(76,141,255,0.12);border-radius:2px;transition:all 60ms linear;display:none'
    box = doc.createElement('div')
    box.setAttribute('data-dsh-design-box', '')
    box.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;box-shadow:0 0 0 1px rgba(255,255,255,0.6) inset;display:none'
    handle = doc.createElement('button')
    handle.type = 'button'
    handle.setAttribute('data-dsh-design-drag-handle', '')
    handle.textContent = '✥'
    handle.style.cssText = 'position:absolute;top:-32px;right:0;width:26px;height:26px;display:grid;place-items:center;padding:0;border:2px solid #4c8dff;border-radius:6px;background:#fff;color:#2459c7;font:18px/1 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:grab;pointer-events:auto;touch-action:none;user-select:none'
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation() })
    handle.addEventListener('pointerdown', event => {
      if (mode !== 'inspect' || drag !== null || resize !== null || selected === null || !selected.isConnected || !(selected instanceof HTMLElement || selected instanceof SVGElement)) return
      const element = selected
      // A gesture that cannot work is reported instead of silently snapping the
      // element back where it was, which reads as the handle being broken.
      if (!movable(element)) {
        event.preventDefault()
        event.stopPropagation()
        post({ kind: 'unavailable', selector: selectedSelector ?? selectorFor(element), reason: 'move' })
        return
      }
      const computed = doc.defaultView?.getComputedStyle(element)
      const strategy = element instanceof HTMLElement && computed?.display === 'inline' ? 'inline' : 'translate'
      const properties = strategy === 'inline' ? ['position', 'left', 'top'] : ['translate']
      const restore: Record<string, string> = {}
      const priorities: Record<string, string> = {}
      for (const property of properties) {
        restore[property] = element.style.getPropertyValue(property)
        priorities[property] = element.style.getPropertyPriority(property)
      }
      if (Object.values(priorities).some(priority => priority === 'important')) return
      let baseX: string
      let baseY: string
      let baseZ: string | null = null
      if (strategy === 'inline') {
        const position = computed?.getPropertyValue('position') || 'static'
        if (position !== 'static' && position !== 'relative') return
        const x = position === 'static' ? '0px' : positionBase(computed?.getPropertyValue('left') ?? '', computed?.getPropertyValue('right') ?? '')
        const y = position === 'static' ? '0px' : positionBase(computed?.getPropertyValue('top') ?? '', computed?.getPropertyValue('bottom') ?? '')
        if (x === null || y === null) return
        baseX = x
        baseY = y
      } else {
        const original = restore.translate ?? ''
        if (original !== '' && translateParts(original.trim()) === null) return
        const baseline = translateParts(computed?.getPropertyValue('translate').trim() || original)
        if (baseline === null) return
        baseX = baseline.x
        baseY = baseline.y
        baseZ = baseline.z
      }
      event.preventDefault()
      event.stopPropagation()
      drag = {
        pointerId: event.pointerId, element, selector: selectedSelector ?? selectorFor(element), x: event.clientX, y: event.clientY,
        strategy, baseX, baseY, baseZ, restore, priorities, declarations: null,
      }
      if (handle !== null) handle.style.cursor = 'grabbing'
    })
    resizeHandles = doc.createElement('div')
    resizeHandles.setAttribute('data-dsh-design-resize-handles', '')
    resizeHandles.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none'
    const names = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
    const geometry: Record<(typeof names)[number], { readonly at: string; readonly cursor: string }> = {
      nw: { at: 'left:-7px;top:-7px', cursor: 'nwse-resize' },
      n: { at: 'left:calc(50% - 5px);top:-7px', cursor: 'ns-resize' },
      ne: { at: 'right:-7px;top:-7px', cursor: 'nesw-resize' },
      e: { at: 'right:-7px;top:calc(50% - 5px)', cursor: 'ew-resize' },
      se: { at: 'right:-7px;bottom:-7px', cursor: 'nwse-resize' },
      s: { at: 'left:calc(50% - 5px);bottom:-7px', cursor: 'ns-resize' },
      sw: { at: 'left:-7px;bottom:-7px', cursor: 'nesw-resize' },
      w: { at: 'left:-7px;top:calc(50% - 5px)', cursor: 'ew-resize' },
    }
    for (const name of names) {
      const corner = doc.createElement('button')
      corner.type = 'button'
      corner.setAttribute('data-dsh-design-resize', name)
      corner.style.cssText = 'position:absolute;width:11px;height:11px;padding:0;box-sizing:border-box;'
        + 'border:2px solid #4c8dff;border-radius:2px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);'
        + 'pointer-events:auto;touch-action:none;user-select:none;cursor:' + geometry[name].cursor + ';' + geometry[name].at
      corner.addEventListener('click', event => { event.preventDefault(); event.stopPropagation() })
      corner.addEventListener('pointerdown', event => { beginResize(event, name) })
      resizeHandles.append(corner)
    }
    box.append(handle, resizeHandles)
    doc.body.append(overlay, box)
  }

  const place = (node: HTMLDivElement, element: Element | null): void => {
    if (element === null) {
      node.style.display = 'none'
      if (node === box && resizeHandles !== null) resizeHandles.style.display = 'none'
      return
    }
    const rect = element.getBoundingClientRect()
    const view = doc.defaultView
    node.style.display = 'block'
    if (node === box && handle !== null) {
      // A handle that sits under the fixed page header cannot be grabbed, and a
      // handle on an element that cannot move does nothing at all. Show only
      // the handles that will actually work.
      handle.style.display = mode === 'inspect' && movable(element) ? 'grid' : 'none'
      handle.style.top = rect.top < 34 ? rect.height + 6 + 'px' : '-32px'
    }
    if (node === box && resizeHandles !== null) {
      resizeHandles.style.display = mode === 'inspect' && resizable(element) ? 'block' : 'none'
    }
    node.style.left = (rect.left + (view?.scrollX ?? 0)) + 'px'
    node.style.top = (rect.top + (view?.scrollY ?? 0)) + 'px'
    node.style.width = rect.width + 'px'
    node.style.height = rect.height + 'px'
  }

  const interactive = (event: Event): boolean => {
    const target = event.target
    if (!(target instanceof Element)) return false
    return target.closest('[data-dsh-design-overlay],[data-dsh-design-box]') === null
  }

  /** A transparent control covers its label; use the pointer position to distinguish text from the box. */
  const editTargetFor = (target: Element, event: MouseEvent): Element => {
    if (!(target instanceof HTMLInputElement) || !/^(?:radio|checkbox)$/iu.test(target.type)) return target
    const computed = doc.defaultView?.getComputedStyle(target)
    const opacity = Number.parseFloat(computed?.opacity ?? '')
    if (computed?.position !== 'absolute' || !Number.isFinite(opacity) || opacity > 0.01) return target
    const label = target.closest('label')
    if (label === null) return target
    const leaves = Array.from(label.querySelectorAll('*')).filter(element =>
      element.closest('label') === label && editableTextNodeOf(element) !== null && normalizedText(element) !== '')
    if (leaves.length === 0) return label
    if (event.type !== 'mousemove' && event.detail === 0 && leaves.length === 1) return leaves[0] as Element
    const hits = leaves.filter(leaf => {
      const rect = leaf.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
        && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom
    })
    if (hits.length === 1) return hits[0] as Element
    return label
  }

  const selectTarget = (target: Element, kind: 'select' | 'edit'): void => {
    selected = target
    selectedSelector = selectorFor(target)
    ensureChrome()
    place(box as HTMLDivElement, target)
    post({ kind, anchor: anchorFor(target, selectedSelector) })
  }

  doc.addEventListener('mousemove', (event) => {
    if (mode !== 'inspect' || drag !== null || resize !== null) return
    if (!interactive(event)) return
    const rawTarget = event.target
    if (!(rawTarget instanceof Element)) return
    const target = editTargetFor(rawTarget, event)
    if (target === hovered) return
    hovered = target
    ensureChrome()
    place(overlay as HTMLDivElement, target)
    post({ kind: 'hover', selector: selectorFor(target), tag: target.tagName.toLowerCase() })
  }, true)

  doc.addEventListener('mouseleave', () => {
    hovered = null
    if (overlay !== null) place(overlay, null)
    post({ kind: 'hover', selector: null, tag: null })
  }, true)

  doc.addEventListener('pointerdown', (event) => {
    if (mode !== 'inspect' || !interactive(event)) return
    event.preventDefault()
    event.stopPropagation()
  }, true)

  doc.addEventListener('click', (event) => {
    if (mode !== 'inspect') return
    if (!interactive(event)) return
    const target = event.target
    if (!(target instanceof Element)) return
    // The tools own the gesture: a page link must not navigate mid-review.
    event.preventDefault()
    event.stopPropagation()
    selectTarget(editTargetFor(target, event), 'select')
  }, true)

  doc.addEventListener('dblclick', (event) => {
    if (mode !== 'inspect' || !interactive(event)) return
    const target = event.target
    if (!(target instanceof Element)) return
    event.preventDefault()
    event.stopPropagation()
    selectTarget(editTargetFor(target, event), 'edit')
  }, true)

  doc.addEventListener('pointermove', (event) => {
    const active = drag
    if (active === null || active.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (!active.element.isConnected) {
      stopDrag(false)
      return
    }
    const dx = Math.round(event.clientX - active.x)
    const dy = Math.round(event.clientY - active.y)
    if (dx === 0 && dy === 0) {
      if (active.declarations !== null) {
        restoreInlineStyles(active.element, active.restore, active.priorities)
        active.declarations = null
        place(box as HTMLDivElement, active.element)
      }
      return
    }
    const x = offset(active.baseX, dx)
    const y = offset(active.baseY, dy)
    const declarations = active.strategy === 'inline'
      ? { position: 'relative', left: x, top: y }
      : { translate: translateValue(x, y, active.baseZ) }
    for (const [property, value] of Object.entries(declarations)) active.element.style.setProperty(property, value)
    active.declarations = declarations
    place(box as HTMLDivElement, active.element)
  }, true)

  doc.addEventListener('pointermove', (event) => {
    const active = resize
    if (active === null || active.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (!active.element.isConnected) {
      stopResize(false)
      return
    }
    const dx = Math.round(event.clientX - active.x)
    const dy = Math.round(event.clientY - active.y)
    // Recompute from the gesture baseline every frame so a stale axis never
    // survives the pointer crossing back over its origin.
    restoreInlineStyles(active.element, active.restore, active.priorities)
    const declarations: Record<string, string> = {}
    const deltaW = (active.east ? dx : 0) + (active.west ? -dx : 0)
    const deltaH = (active.south ? dy : 0) + (active.north ? -dy : 0)
    if (deltaW !== 0) {
      const visual = Math.max(0, active.startW + deltaW)
      const value = active.contentBox ? visual - active.insetX : visual
      declarations.width = Math.max(0, Math.round(value)) + 'px'
    }
    if (deltaH !== 0) {
      const visual = Math.max(0, active.startH + deltaH)
      const value = active.contentBox ? visual - active.insetY : visual
      declarations.height = Math.max(0, Math.round(value)) + 'px'
    }
    const offsetX = active.west ? dx : 0
    const offsetY = active.north ? dy : 0
    if (offsetX !== 0 || offsetY !== 0) {
      const x = offset(active.baseX, offsetX)
      const y = offset(active.baseY, offsetY)
      declarations.translate = translateValue(x, y, active.baseZ)
    }
    const changed = Object.keys(declarations).length > 0
    if (changed) {
      for (const [property, value] of Object.entries(declarations)) active.element.style.setProperty(property, value)
      active.declarations = declarations
    } else {
      active.declarations = null
    }
    place(box as HTMLDivElement, active.element)
  }, true)

  doc.addEventListener('pointerup', event => {
    if (resize !== null && resize.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      stopResize(true)
      return
    }
    if (drag === null || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    stopDrag(true)
  }, true)

  doc.addEventListener('pointercancel', event => {
    if (resize !== null && resize.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      stopResize(false)
      return
    }
    if (drag === null || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    stopDrag(false)
  }, true)

  globalThis.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null) return
    const message = data as { channel?: unknown; kind?: unknown }
    if (message.channel !== channel) return
    ensureChrome()
    switch (message.kind) {
      case 'mode': {
        mode = (data as { mode?: unknown }).mode === 'inspect' ? 'inspect' : 'browse'
        const label = (data as { dragHandleLabel?: unknown }).dragHandleLabel
        if (typeof label === 'string' && handle !== null) {
          if (label.trim() === '') {
            handle.removeAttribute('aria-label')
            handle.removeAttribute('title')
          } else {
            handle.setAttribute('aria-label', label)
            handle.title = label
          }
        }
        const resizeLabel = (data as { resizeHandleLabel?: unknown }).resizeHandleLabel
        if (typeof resizeLabel === 'string' && resizeHandles !== null) {
          for (const button of resizeHandles.querySelectorAll('button')) {
            if (resizeLabel.trim() === '') {
              button.removeAttribute('aria-label')
              button.removeAttribute('title')
            } else {
              button.setAttribute('aria-label', resizeLabel)
              button.title = resizeLabel
            }
          }
        }
        if (mode === 'browse') {
          stopResize(false)
          stopDrag(false)
          selected = null
          selectedSelector = null
          hovered = null
          place(box as HTMLDivElement, null)
          place(overlay as HTMLDivElement, null)
          post({ kind: 'hover', selector: null, tag: null })
        }
        post({ kind: 'modeApplied', mode })
        return
      }
      case 'style': {
        const payload = data as { selector: string; declarations: Record<string, string> }
        const element = resolve(payload.selector)
        if (element instanceof HTMLElement || element instanceof SVGElement) {
          for (const [property, value] of Object.entries(payload.declarations)) {
            if (value === '') element.style.removeProperty(property)
            else element.style.setProperty(property, value)
          }
          if (element === selected) place(box as HTMLDivElement, element)
        }
        return
      }
      case 'text': {
        const payload = data as { selector: string; value: string }
        const element = resolve(payload.selector)
        const textNode = element === null ? null : editableTextNodeOf(element)
        if (textNode !== null) textNode.textContent = payload.value
        return
      }
      case 'selectParent': {
        const parent = selected?.parentElement
        if (mode === 'inspect' && parent !== null && parent !== undefined) selectTarget(parent, 'edit')
        return
      }
      case 'removeSelected':
        handleRemoval(data, true)
        return
      case 'replayRemoval':
        handleRemoval(data, false)
        return
      case 'highlight': {
        const payload = data as { selectors: readonly string[] }
        const first = payload.selectors.map(resolve).find((element: Element | null) => element !== null) ?? null
        place(box as HTMLDivElement, first)
        return
      }
      case 'reset':
        selected = null
        selectedSelector = null
        hovered = null
        stopResize(false)
        stopDrag(false)
        place(box as HTMLDivElement, null)
        place(overlay as HTMLDivElement, null)
        return
      default:
        return
    }
  })

  // Forward the review history shortcut. The previewed page owns its own
  // editing keys, so only hand over Cmd/Ctrl+Z while no field of the page has
  // focus; the Host decides what to step back.
  doc.addEventListener('keydown', (event: KeyboardEvent) => {
    if (mode !== 'inspect' || !(event.metaKey || event.ctrlKey) || event.altKey) return
    if (event.key !== 'z' && event.key !== 'Z') return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable
      || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
    event.preventDefault()
    event.stopPropagation()
    post({ kind: 'history', action: event.shiftKey ? 'redo' : 'undo' })
  }, true)

  post({ kind: 'ready' })
}
