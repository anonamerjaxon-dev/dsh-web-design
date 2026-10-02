window.__ModuleLoader__.load({
	id: "@guowenzhang/dsh-web-design",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
		/**
		* The `dsh-resource://file/…` address grammar: how a file is named across the
		* Sidebar and the resource model, built and parsed without touching a
		* filesystem.
		* @module
		*/
		/** The scheme and type every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Whether a decoded first path segment is a Windows drive (`C:`). */
		function isDriveSegment(segment) {
			return segment !== void 0 && /^[A-Za-z]:$/.test(segment);
		}
		/**
		* Read a file address back into its parts without resolving `.` or `..`.
		* Query and fragment suffixes are ignored; encoded path segments are decoded.
		* @param address - a candidate address.
		* @returns the parts, or `undefined` when the string is not a `dsh-resource://file/` URI in a known scope with a path, or a segment is not validly encoded.
		*/
		function parseFileAddress(address) {
			try {
				if (!address.startsWith(FILE_ADDRESS_PREFIX)) return void 0;
				const end = address.search(/[?#]/);
				const [scope, ...rest] = address.slice(20, end === -1 ? void 0 : end).split("/");
				if (scope === "session") {
					const [id, ...segments] = rest;
					if (id === void 0 || id === "" || segments.length === 0) return void 0;
					return {
						scope,
						sessionId: decodeURIComponent(id),
						path: segments.map(decodeURIComponent).join("/")
					};
				}
				if (scope === "absolute") {
					const unc = rest[0] === "" && rest.length > 1;
					const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent);
					if (segments.length === 0 || segments[0] === "") return void 0;
					if (unc) return {
						scope,
						path: `//${segments.join("/")}`
					};
					return {
						scope,
						path: isDriveSegment(segments[0]) ? segments.join("/") : `/${segments.join("/")}`
					};
				}
				return;
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/typert.ts
		/** Wire namespace and Cordis service key of the review owner. */
		const REMOTE_NAMESPACE = "webDesignReview";
		/** Permissive strict codec: accepts any value, returns it unchanged. */
		const passthrough = { parse: (value) => value };
		/**
		* One strict codec over the passthrough schema.
		*
		* Both schema seats carry the same parse contract: a Host whose Typert registry
		* materializes generated schemas requires the `create()` factory, while an
		* older one calls `schema.parse`. The published protocol release this package
		* dev-depends on declares `schema` alone, so the literal cannot satisfy those
		* types while also carrying `create`.
		* @param typeSymbol - generated-style type symbol naming this codec.
		* @returns the strict codec handed to `ctx.remote.$mount`.
		*/
		function codec(typeSymbol) {
			return {
				mode: "strict",
				typeSymbol,
				schema: passthrough,
				create: () => passthrough
			};
		}
		/** One `direct` invocation descriptor for a namespace method. */
		function descriptor(method) {
			const owner = `@guowenzhang/dsh-web-design#${`${REMOTE_NAMESPACE}/${method}`}`;
			return {
				id: owner,
				service: REMOTE_NAMESPACE,
				namespace: REMOTE_NAMESPACE,
				method,
				invocation: { kind: "direct" },
				parameters: [{
					name: "request",
					wire: "request",
					source: "json",
					codec: codec(`${owner}:request`)
				}],
				result: codec(`${owner}:result`)
			};
		}
		/** Contribution mounted by the browser half to reach the review store. */
		const TYPERT_REMOTE = {
			package: "@guowenzhang/dsh-web-design",
			descriptors: [
				descriptor("read"),
				descriptor("write"),
				descriptor("apply")
			]
		};
		//#endregion
		//#region src/client/frame-runtime.ts
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
		const CHANNEL = "dsh-web-design";
		/**
		* Render the runtime script for one frame.
		*
		* The script is a plain function stringified into the document. It runs once,
		* installs capture-phase listeners for edit gestures, and
		* never exposes page globals to the parent.
		* @returns the complete `<script>` contents.
		*/
		function frameRuntime() {
			return `(${runtime.toString()})(${JSON.stringify(CHANNEL)});`;
		}
		/**
		* The runtime body. Kept as a named function so {@link frameRuntime} can
		* stringify it; it must stay self-contained — no imports, no closure values.
		* @param channel - message channel name expected on every message.
		*/
		function runtime(channel) {
			const doc = globalThis.document;
			if (doc === void 0) return;
			let mode = "browse";
			let hovered = null;
			let selected = null;
			let selectedSelector = null;
			const originalSelectors = /* @__PURE__ */ new WeakMap();
			const originalParents = /* @__PURE__ */ new WeakMap();
			const originalTargets = /* @__PURE__ */ new Map();
			const ambiguousSelectors = /* @__PURE__ */ new Set();
			const originalSource = /* @__PURE__ */ new WeakMap();
			const editableTextTargets = /* @__PURE__ */ new WeakMap();
			let selectorsFrozen = false;
			let overlay = null;
			let box = null;
			let drag = null;
			let resize = null;
			let handle = null;
			let resizeHandles = null;
			const post = (message) => {
				try {
					globalThis.parent?.postMessage({
						channel,
						...message
					}, "*");
				} catch (error) {}
			};
			/** Build a selector path that still resolves when ids repeat or need escaping. */
			const currentSelectorFor = (element) => {
				const parts = [];
				let current = element;
				while (current !== null && current !== doc.documentElement) {
					const tag = current.tagName.toLowerCase();
					const id = current.getAttribute("id");
					if (id !== null && /^[a-z_][a-z0-9_-]*$/iu.test(id) && doc.querySelectorAll("#" + id).length === 1) {
						parts.unshift(tag + "#" + id);
						break;
					}
					const parent = current.parentElement;
					if (parent === null) {
						parts.unshift(tag);
						break;
					}
					const siblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
					const index = siblings.indexOf(current) + 1;
					parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
					current = parent;
				}
				return parts.length === 0 ? "html" : parts.join(" > ");
			};
			const selectorFor = (element) => originalSelectors.get(element) ?? currentSelectorFor(element);
			const normalizedText = (element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
			const sourceFor = (element) => {
				let source = originalSource.get(element);
				if (source === void 0) {
					source = {
						text: normalizedText(element),
						classes: Array.from(element.classList)
					};
					originalSource.set(element, source);
				}
				return source;
			};
			for (const element of doc.querySelectorAll("*")) sourceFor(element);
			/** Freeze paths before the first removal so sibling positions keep their original meaning. */
			const freezeSelectors = () => {
				if (selectorsFrozen) return;
				for (const element of doc.querySelectorAll("*")) {
					if (element.closest("[data-dsh-design-overlay],[data-dsh-design-box]") !== null) continue;
					const selector = currentSelectorFor(element);
					originalSelectors.set(element, selector);
					originalParents.set(element, element.parentElement);
					if (ambiguousSelectors.has(selector)) continue;
					try {
						const matches = doc.querySelectorAll(selector);
						if (matches.length !== 1 || matches[0] !== element || originalTargets.has(selector)) {
							originalTargets.delete(selector);
							ambiguousSelectors.add(selector);
							continue;
						}
					} catch (error) {
						ambiguousSelectors.add(selector);
						continue;
					}
					originalTargets.set(selector, element);
				}
				selectorsFrozen = true;
			};
			const resolve = (selector) => {
				if (selector === selectedSelector) return selected?.isConnected ? selected : null;
				if (selectorsFrozen) {
					const element = originalTargets.get(selector);
					return element?.isConnected ? element : null;
				}
				try {
					const matches = doc.querySelectorAll(selector);
					return matches.length === 1 ? matches[0] ?? null : null;
				} catch (error) {
					return null;
				}
			};
			const anchorFor = (element, selector = selectorFor(element)) => {
				const rect = element.getBoundingClientRect();
				const view = doc.defaultView;
				const computed = view?.getComputedStyle(element);
				const style = {};
				for (const key of [
					"font-size",
					"font-weight",
					"line-height",
					"letter-spacing",
					"color",
					"background-color",
					"padding",
					"padding-top",
					"padding-right",
					"padding-bottom",
					"padding-left",
					"margin",
					"margin-top",
					"margin-right",
					"margin-bottom",
					"margin-left",
					"border-radius",
					"width",
					"height",
					"position",
					"left",
					"top",
					"translate"
				]) {
					const value = computed?.getPropertyValue(key);
					if (typeof value === "string" && value.length > 0) style[key] = value;
				}
				const id = element.getAttribute("id");
				const source = sourceFor(element);
				return {
					selector,
					parentSelector: element.parentElement === null ? null : selectorFor(element.parentElement),
					tag: element.tagName.toLowerCase(),
					...id === null ? {} : { id },
					classes: Array.from(element.classList),
					text: textOf(element),
					sourceText: source.text,
					sourceClasses: source.classes,
					editableText: editableTextOf(element),
					rect: {
						x: rect.left + (view?.scrollX ?? 0),
						y: rect.top + (view?.scrollY ?? 0),
						width: rect.width,
						height: rect.height
					},
					computed: style,
					display: computed?.getPropertyValue("display").trim() ?? "",
					resizable: resizable(element),
					movable: movable(element)
				};
			};
			/** Why a drag gesture could not start, for the reviewer instead of silence. */
			const movable = (element) => {
				if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
				for (const property of [
					"position",
					"left",
					"top",
					"translate"
				]) if (element.style.getPropertyPriority(property) === "important") return false;
				const computed = doc.defaultView?.getComputedStyle(element);
				if (computed?.display === "inline") {
					const position = computed.getPropertyValue("position").trim() || "static";
					if (position !== "static" && position !== "relative") return false;
					const x = positionBase(computed.getPropertyValue("left"), computed.getPropertyValue("right"));
					const y = positionBase(computed.getPropertyValue("top"), computed.getPropertyValue("bottom"));
					if (x === null || y === null) return false;
					return true;
				}
				const original = element.style.getPropertyValue("translate");
				if (original !== "" && translateParts(original.trim()) === null) return false;
				return translateParts(computed?.getPropertyValue("translate").trim() || original) !== null;
			};
			/** Short text excerpt for the selected-element display. */
			const textOf = (element) => {
				const raw = normalizedText(element);
				return raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
			};
			/** Locate the only non-blank direct text node without crossing into child elements. */
			const editableTextNodeOf = (element) => {
				if (/^(?:script|style|textarea|template|noscript)$/iu.test(element.tagName)) return null;
				const previous = editableTextTargets.get(element);
				if (previous?.parentNode === element) return previous;
				const directText = Array.from(element.childNodes).filter((child) => child.nodeType === 3);
				const meaningful = directText.filter((child) => (child.textContent ?? "").trim() !== "");
				const target = meaningful.length === 1 ? meaningful[0] : directText.length === 1 ? directText[0] : void 0;
				if (target !== void 0) editableTextTargets.set(element, target);
				return target ?? null;
			};
			const editableTextOf = (element) => editableTextNodeOf(element)?.textContent ?? null;
			const lengthTerm = /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%|em|rem|vw|vh|vmin|vmax)?|calc\(.+\))$/iu;
			/** Split a computed translate value without breaking spaces inside calc(). */
			const translateParts = (value) => {
				if (value === "" || value === "none") return {
					x: "0px",
					y: "0px",
					z: null
				};
				const parts = [];
				let depth = 0;
				let start = 0;
				for (let index = 0; index < value.length; index += 1) {
					const char = value[index];
					if (char === "(") depth += 1;
					else if (char === ")") depth -= 1;
					else if (depth === 0 && /\s/u.test(char ?? "")) {
						if (index > start) parts.push(value.slice(start, index));
						start = index + 1;
					}
					if (depth < 0) return null;
				}
				if (depth !== 0) return null;
				if (start < value.length) parts.push(value.slice(start));
				if (parts.length < 1 || parts.length > 3) return null;
				if (!parts.every((part) => lengthTerm.test(part))) return null;
				return {
					x: parts[0],
					y: parts[1] ?? "0px",
					z: parts[2] ?? null
				};
			};
			/** Join translate axes, keeping both in the same notation. jsdom's cssstyle
			*  silently drops a `translate` that mixes `calc()` with a plain length, so a
			*  plain axis is lifted into `calc(base + 0px)` whenever the other is calc. */
			const translateValue = (x, y, z) => {
				const xCalc = x.startsWith("calc(");
				const yCalc = y.startsWith("calc(");
				const left = yCalc && !xCalc ? "calc(" + x + " + 0px)" : x;
				const right = xCalc && !yCalc ? "calc(" + y + " + 0px)" : y;
				return left + " " + right + (z === null ? "" : " " + z);
			};
			/** Resolve one side of a relatively positioned inline element. */
			const positionBase = (leading, trailing) => {
				if (leading !== "" && leading !== "auto") return lengthTerm.test(leading) ? leading : null;
				if (trailing !== "" && trailing !== "auto") return lengthTerm.test(trailing) ? "calc(0px - " + trailing + ")" : null;
				return "0px";
			};
			const offset = (base, delta) => {
				if (delta === 0) return base;
				if (base === "0px") return delta + "px";
				return "calc(" + base + (delta < 0 ? " - " : " + ") + Math.abs(delta) + "px)";
			};
			const restoreInlineStyles = (element, restore, priorities) => {
				for (const [property, value] of Object.entries(restore)) if (value === "") element.style.removeProperty(property);
				else element.style.setProperty(property, value, priorities[property] ?? "");
			};
			const stopDrag = (commit) => {
				const active = drag;
				if (active === null) return;
				drag = null;
				if (handle !== null) handle.style.cursor = "grab";
				if (!commit || active.declarations === null) {
					restoreInlineStyles(active.element, active.restore, active.priorities);
					place(box, selected?.isConnected ? selected : null);
					return;
				}
				post({
					kind: "move",
					selector: active.selector,
					declarations: active.declarations,
					restore: active.restore,
					anchor: anchorFor(active.element, active.selector)
				});
			};
			/** Elements whose inline `width`/`height` declarations change their box. */
			const resizable = (element) => {
				if (!(element instanceof HTMLElement)) return false;
				const display = (doc.defaultView?.getComputedStyle(element).getPropertyValue("display") ?? "").trim();
				return display !== "inline" && display !== "inline-run-in" && display !== "contents" && display !== "none";
			};
			/** Sum computed box-model lengths, tolerating a stylesheet that omits them. */
			const lengthSum = (computed, names) => {
				let total = 0;
				for (const name of names) {
					const value = Number.parseFloat(computed?.getPropertyValue(name) ?? "");
					if (Number.isFinite(value)) total += value;
				}
				return total;
			};
			/** Begin a resize gesture from one outline handle. */
			const beginResize = (event, name) => {
				if (mode !== "inspect" || drag !== null || resize !== null) return;
				const element = selected;
				if (element === null || !element.isConnected) return;
				if (!resizable(element)) {
					event.preventDefault();
					event.stopPropagation();
					post({
						kind: "unavailable",
						selector: selectedSelector ?? selectorFor(element),
						reason: "resize"
					});
					return;
				}
				if (!movable(element)) {
					event.preventDefault();
					event.stopPropagation();
					post({
						kind: "unavailable",
						selector: selectedSelector ?? selectorFor(element),
						reason: "move"
					});
					return;
				}
				const computed = doc.defaultView?.getComputedStyle(element);
				const restore = {};
				const priorities = {};
				for (const property of [
					"width",
					"height",
					"translate"
				]) {
					restore[property] = element.style.getPropertyValue(property);
					priorities[property] = element.style.getPropertyPriority(property);
				}
				if (Object.values(priorities).some((priority) => priority === "important")) return;
				const original = restore.translate ?? "";
				if (original !== "" && translateParts(original.trim()) === null) return;
				const baseline = translateParts(computed?.getPropertyValue("translate").trim() || original);
				if (baseline === null) return;
				const rect = element.getBoundingClientRect();
				event.preventDefault();
				event.stopPropagation();
				resize = {
					pointerId: event.pointerId,
					element,
					selector: selectedSelector ?? selectorFor(element),
					west: name.includes("w"),
					east: name.includes("e"),
					north: name.includes("n"),
					south: name.includes("s"),
					x: event.clientX,
					y: event.clientY,
					startW: rect.width,
					startH: rect.height,
					contentBox: computed?.getPropertyValue("box-sizing").trim() === "content-box",
					insetX: lengthSum(computed, [
						"padding-left",
						"padding-right",
						"border-left-width",
						"border-right-width"
					]),
					insetY: lengthSum(computed, [
						"padding-top",
						"padding-bottom",
						"border-top-width",
						"border-bottom-width"
					]),
					baseX: baseline.x,
					baseY: baseline.y,
					baseZ: baseline.z,
					restore,
					priorities,
					declarations: null
				};
			};
			const stopResize = (commit) => {
				const active = resize;
				if (active === null) return;
				resize = null;
				if (!commit || active.declarations === null) {
					restoreInlineStyles(active.element, active.restore, active.priorities);
					place(box, selected?.isConnected ? selected : null);
					return;
				}
				post({
					kind: "move",
					selector: active.selector,
					declarations: active.declarations,
					restore: active.restore,
					anchor: anchorFor(active.element, active.selector)
				});
			};
			const removable = (element) => element.isConnected && element.ownerDocument === doc && element.parentElement !== null && !/^(?:html|head|body)$/iu.test(element.tagName) && element.closest("[data-dsh-design-overlay],[data-dsh-design-box]") === null;
			const originallyWithin = (element, ancestor) => {
				let current = element;
				while (current !== null) {
					if (current === ancestor) return true;
					current = originalParents.get(current) ?? null;
				}
				return false;
			};
			const removeElement = (element) => {
				stopResize(false);
				stopDrag(false);
				const removedSelectors = /* @__PURE__ */ new Set();
				for (const [selector, original] of originalTargets) if (originallyWithin(original, element)) removedSelectors.add(selector);
				for (const descendant of [element, ...element.querySelectorAll("*")]) {
					const selector = originalSelectors.get(descendant);
					if (selector !== void 0) removedSelectors.add(selector);
				}
				if (selected !== null && (element === selected || element.contains(selected))) {
					selected = null;
					selectedSelector = null;
					if (box !== null) place(box, null);
				}
				if (hovered !== null && (element === hovered || element.contains(hovered))) {
					hovered = null;
					if (overlay !== null) place(overlay, null);
					post({
						kind: "hover",
						selector: null,
						tag: null
					});
				}
				element.remove();
				return Array.from(removedSelectors);
			};
			const handleRemoval = (data, selectedOnly) => {
				const payload = data;
				if (typeof payload.requestId !== "string" || typeof payload.selector !== "string") return;
				let element = null;
				if (selectedOnly) {
					if (mode === "inspect" && selected !== null && removable(selected) && selectedSelector === payload.selector) {
						freezeSelectors();
						if (originalTargets.get(payload.selector) === selected) element = selected;
					}
				} else {
					freezeSelectors();
					const original = originalTargets.get(payload.selector);
					if (original !== void 0 && removable(original)) element = original;
				}
				const removedSelectors = element === null ? [] : removeElement(element);
				post({
					kind: "removeResult",
					requestId: payload.requestId,
					selector: payload.selector,
					success: element !== null,
					removedSelectors
				});
			};
			const ensureChrome = () => {
				if (overlay !== null && box !== null) return;
				overlay = doc.createElement("div");
				overlay.setAttribute("data-dsh-design-overlay", "");
				overlay.style.cssText = "position:absolute;z-index:2147483646;pointer-events:none;border:1px solid #4c8dff;background:rgba(76,141,255,0.12);border-radius:2px;transition:all 60ms linear;display:none";
				box = doc.createElement("div");
				box.setAttribute("data-dsh-design-box", "");
				box.style.cssText = "position:absolute;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;box-shadow:0 0 0 1px rgba(255,255,255,0.6) inset;display:none";
				handle = doc.createElement("button");
				handle.type = "button";
				handle.setAttribute("data-dsh-design-drag-handle", "");
				handle.textContent = "✥";
				handle.style.cssText = "position:absolute;top:-32px;right:0;width:26px;height:26px;display:grid;place-items:center;padding:0;border:2px solid #4c8dff;border-radius:6px;background:#fff;color:#2459c7;font:18px/1 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:grab;pointer-events:auto;touch-action:none;user-select:none";
				handle.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
				});
				handle.addEventListener("pointerdown", (event) => {
					if (mode !== "inspect" || drag !== null || resize !== null || selected === null || !selected.isConnected || !(selected instanceof HTMLElement || selected instanceof SVGElement)) return;
					const element = selected;
					if (!movable(element)) {
						event.preventDefault();
						event.stopPropagation();
						post({
							kind: "unavailable",
							selector: selectedSelector ?? selectorFor(element),
							reason: "move"
						});
						return;
					}
					const computed = doc.defaultView?.getComputedStyle(element);
					const strategy = element instanceof HTMLElement && computed?.display === "inline" ? "inline" : "translate";
					const properties = strategy === "inline" ? [
						"position",
						"left",
						"top"
					] : ["translate"];
					const restore = {};
					const priorities = {};
					for (const property of properties) {
						restore[property] = element.style.getPropertyValue(property);
						priorities[property] = element.style.getPropertyPriority(property);
					}
					if (Object.values(priorities).some((priority) => priority === "important")) return;
					let baseX;
					let baseY;
					let baseZ = null;
					if (strategy === "inline") {
						const position = computed?.getPropertyValue("position") || "static";
						if (position !== "static" && position !== "relative") return;
						const x = position === "static" ? "0px" : positionBase(computed?.getPropertyValue("left") ?? "", computed?.getPropertyValue("right") ?? "");
						const y = position === "static" ? "0px" : positionBase(computed?.getPropertyValue("top") ?? "", computed?.getPropertyValue("bottom") ?? "");
						if (x === null || y === null) return;
						baseX = x;
						baseY = y;
					} else {
						const original = restore.translate ?? "";
						if (original !== "" && translateParts(original.trim()) === null) return;
						const baseline = translateParts(computed?.getPropertyValue("translate").trim() || original);
						if (baseline === null) return;
						baseX = baseline.x;
						baseY = baseline.y;
						baseZ = baseline.z;
					}
					event.preventDefault();
					event.stopPropagation();
					drag = {
						pointerId: event.pointerId,
						element,
						selector: selectedSelector ?? selectorFor(element),
						x: event.clientX,
						y: event.clientY,
						strategy,
						baseX,
						baseY,
						baseZ,
						restore,
						priorities,
						declarations: null
					};
					if (handle !== null) handle.style.cursor = "grabbing";
				});
				resizeHandles = doc.createElement("div");
				resizeHandles.setAttribute("data-dsh-design-resize-handles", "");
				resizeHandles.style.cssText = "position:absolute;inset:0;pointer-events:none;display:none";
				const names = [
					"nw",
					"n",
					"ne",
					"e",
					"se",
					"s",
					"sw",
					"w"
				];
				const geometry = {
					nw: {
						at: "left:-7px;top:-7px",
						cursor: "nwse-resize"
					},
					n: {
						at: "left:calc(50% - 5px);top:-7px",
						cursor: "ns-resize"
					},
					ne: {
						at: "right:-7px;top:-7px",
						cursor: "nesw-resize"
					},
					e: {
						at: "right:-7px;top:calc(50% - 5px)",
						cursor: "ew-resize"
					},
					se: {
						at: "right:-7px;bottom:-7px",
						cursor: "nwse-resize"
					},
					s: {
						at: "left:calc(50% - 5px);bottom:-7px",
						cursor: "ns-resize"
					},
					sw: {
						at: "left:-7px;bottom:-7px",
						cursor: "nesw-resize"
					},
					w: {
						at: "left:-7px;top:calc(50% - 5px)",
						cursor: "ew-resize"
					}
				};
				for (const name of names) {
					const corner = doc.createElement("button");
					corner.type = "button";
					corner.setAttribute("data-dsh-design-resize", name);
					corner.style.cssText = "position:absolute;width:11px;height:11px;padding:0;box-sizing:border-box;border:2px solid #4c8dff;border-radius:2px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:auto;touch-action:none;user-select:none;cursor:" + geometry[name].cursor + ";" + geometry[name].at;
					corner.addEventListener("click", (event) => {
						event.preventDefault();
						event.stopPropagation();
					});
					corner.addEventListener("pointerdown", (event) => {
						beginResize(event, name);
					});
					resizeHandles.append(corner);
				}
				box.append(handle, resizeHandles);
				doc.body.append(overlay, box);
			};
			const place = (node, element) => {
				if (element === null) {
					node.style.display = "none";
					if (node === box && resizeHandles !== null) resizeHandles.style.display = "none";
					return;
				}
				const rect = element.getBoundingClientRect();
				const view = doc.defaultView;
				node.style.display = "block";
				if (node === box && handle !== null) {
					handle.style.display = mode === "inspect" && movable(element) ? "grid" : "none";
					handle.style.top = rect.top < 34 ? rect.height + 6 + "px" : "-32px";
				}
				if (node === box && resizeHandles !== null) resizeHandles.style.display = mode === "inspect" && resizable(element) ? "block" : "none";
				node.style.left = rect.left + (view?.scrollX ?? 0) + "px";
				node.style.top = rect.top + (view?.scrollY ?? 0) + "px";
				node.style.width = rect.width + "px";
				node.style.height = rect.height + "px";
			};
			const interactive = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return false;
				return target.closest("[data-dsh-design-overlay],[data-dsh-design-box]") === null;
			};
			/** A transparent control covers its label; use the pointer position to distinguish text from the box. */
			const editTargetFor = (target, event) => {
				if (!(target instanceof HTMLInputElement) || !/^(?:radio|checkbox)$/iu.test(target.type)) return target;
				const computed = doc.defaultView?.getComputedStyle(target);
				const opacity = Number.parseFloat(computed?.opacity ?? "");
				if (computed?.position !== "absolute" || !Number.isFinite(opacity) || opacity > .01) return target;
				const label = target.closest("label");
				if (label === null) return target;
				const leaves = Array.from(label.querySelectorAll("*")).filter((element) => element.closest("label") === label && editableTextNodeOf(element) !== null && normalizedText(element) !== "");
				if (leaves.length === 0) return label;
				if (event.type !== "mousemove" && event.detail === 0 && leaves.length === 1) return leaves[0];
				const hits = leaves.filter((leaf) => {
					const rect = leaf.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
				});
				if (hits.length === 1) return hits[0];
				return label;
			};
			const selectTarget = (target, kind) => {
				selected = target;
				selectedSelector = selectorFor(target);
				ensureChrome();
				place(box, target);
				post({
					kind,
					anchor: anchorFor(target, selectedSelector)
				});
			};
			doc.addEventListener("mousemove", (event) => {
				if (mode !== "inspect" || drag !== null || resize !== null) return;
				if (!interactive(event)) return;
				const rawTarget = event.target;
				if (!(rawTarget instanceof Element)) return;
				const target = editTargetFor(rawTarget, event);
				if (target === hovered) return;
				hovered = target;
				ensureChrome();
				place(overlay, target);
				post({
					kind: "hover",
					selector: selectorFor(target),
					tag: target.tagName.toLowerCase()
				});
			}, true);
			doc.addEventListener("mouseleave", () => {
				hovered = null;
				if (overlay !== null) place(overlay, null);
				post({
					kind: "hover",
					selector: null,
					tag: null
				});
			}, true);
			doc.addEventListener("pointerdown", (event) => {
				if (mode !== "inspect" || !interactive(event)) return;
				event.preventDefault();
				event.stopPropagation();
			}, true);
			doc.addEventListener("click", (event) => {
				if (mode !== "inspect") return;
				if (!interactive(event)) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				event.preventDefault();
				event.stopPropagation();
				selectTarget(editTargetFor(target, event), "select");
			}, true);
			doc.addEventListener("dblclick", (event) => {
				if (mode !== "inspect" || !interactive(event)) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				event.preventDefault();
				event.stopPropagation();
				selectTarget(editTargetFor(target, event), "edit");
			}, true);
			doc.addEventListener("pointermove", (event) => {
				const active = drag;
				if (active === null || active.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				if (!active.element.isConnected) {
					stopDrag(false);
					return;
				}
				const dx = Math.round(event.clientX - active.x);
				const dy = Math.round(event.clientY - active.y);
				if (dx === 0 && dy === 0) {
					if (active.declarations !== null) {
						restoreInlineStyles(active.element, active.restore, active.priorities);
						active.declarations = null;
						place(box, active.element);
					}
					return;
				}
				const x = offset(active.baseX, dx);
				const y = offset(active.baseY, dy);
				const declarations = active.strategy === "inline" ? {
					position: "relative",
					left: x,
					top: y
				} : { translate: translateValue(x, y, active.baseZ) };
				for (const [property, value] of Object.entries(declarations)) active.element.style.setProperty(property, value);
				active.declarations = declarations;
				place(box, active.element);
			}, true);
			doc.addEventListener("pointermove", (event) => {
				const active = resize;
				if (active === null || active.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				if (!active.element.isConnected) {
					stopResize(false);
					return;
				}
				const dx = Math.round(event.clientX - active.x);
				const dy = Math.round(event.clientY - active.y);
				restoreInlineStyles(active.element, active.restore, active.priorities);
				const declarations = {};
				const deltaW = (active.east ? dx : 0) + (active.west ? -dx : 0);
				const deltaH = (active.south ? dy : 0) + (active.north ? -dy : 0);
				if (deltaW !== 0) {
					const visual = Math.max(0, active.startW + deltaW);
					const value = active.contentBox ? visual - active.insetX : visual;
					declarations.width = Math.max(0, Math.round(value)) + "px";
				}
				if (deltaH !== 0) {
					const visual = Math.max(0, active.startH + deltaH);
					const value = active.contentBox ? visual - active.insetY : visual;
					declarations.height = Math.max(0, Math.round(value)) + "px";
				}
				const offsetX = active.west ? dx : 0;
				const offsetY = active.north ? dy : 0;
				if (offsetX !== 0 || offsetY !== 0) {
					const x = offset(active.baseX, offsetX);
					const y = offset(active.baseY, offsetY);
					declarations.translate = translateValue(x, y, active.baseZ);
				}
				if (Object.keys(declarations).length > 0) {
					for (const [property, value] of Object.entries(declarations)) active.element.style.setProperty(property, value);
					active.declarations = declarations;
				} else active.declarations = null;
				place(box, active.element);
			}, true);
			doc.addEventListener("pointerup", (event) => {
				if (resize !== null && resize.pointerId === event.pointerId) {
					event.preventDefault();
					event.stopPropagation();
					stopResize(true);
					return;
				}
				if (drag === null || drag.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				stopDrag(true);
			}, true);
			doc.addEventListener("pointercancel", (event) => {
				if (resize !== null && resize.pointerId === event.pointerId) {
					event.preventDefault();
					event.stopPropagation();
					stopResize(false);
					return;
				}
				if (drag === null || drag.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				stopDrag(false);
			}, true);
			globalThis.addEventListener("message", (event) => {
				const data = event.data;
				if (typeof data !== "object" || data === null) return;
				const message = data;
				if (message.channel !== channel) return;
				ensureChrome();
				switch (message.kind) {
					case "mode": {
						mode = data.mode === "inspect" ? "inspect" : "browse";
						const label = data.dragHandleLabel;
						if (typeof label === "string" && handle !== null) {
							if (label.trim() === "") {
								handle.removeAttribute("aria-label");
								handle.removeAttribute("title");
							} else {
								handle.setAttribute("aria-label", label);
								handle.title = label;
							}
						}
						const resizeLabel = data.resizeHandleLabel;
						if (typeof resizeLabel === "string" && resizeHandles !== null) for (const button of resizeHandles.querySelectorAll("button")) if (resizeLabel.trim() === "") {
							button.removeAttribute("aria-label");
							button.removeAttribute("title");
						} else {
							button.setAttribute("aria-label", resizeLabel);
							button.title = resizeLabel;
						}
						if (mode === "browse") {
							stopResize(false);
							stopDrag(false);
							selected = null;
							selectedSelector = null;
							hovered = null;
							place(box, null);
							place(overlay, null);
							post({
								kind: "hover",
								selector: null,
								tag: null
							});
						}
						post({
							kind: "modeApplied",
							mode
						});
						return;
					}
					case "style": {
						const payload = data;
						const element = resolve(payload.selector);
						if (element instanceof HTMLElement || element instanceof SVGElement) {
							for (const [property, value] of Object.entries(payload.declarations)) if (value === "") element.style.removeProperty(property);
							else element.style.setProperty(property, value);
							if (element === selected) place(box, element);
						}
						return;
					}
					case "text": {
						const payload = data;
						const element = resolve(payload.selector);
						const textNode = element === null ? null : editableTextNodeOf(element);
						if (textNode !== null) textNode.textContent = payload.value;
						return;
					}
					case "selectParent": {
						const parent = selected?.parentElement;
						if (mode === "inspect" && parent !== null && parent !== void 0) selectTarget(parent, "edit");
						return;
					}
					case "removeSelected":
						handleRemoval(data, true);
						return;
					case "replayRemoval":
						handleRemoval(data, false);
						return;
					case "highlight": {
						const first = data.selectors.map(resolve).find((element) => element !== null) ?? null;
						place(box, first);
						return;
					}
					case "reset":
						selected = null;
						selectedSelector = null;
						hovered = null;
						stopResize(false);
						stopDrag(false);
						place(box, null);
						place(overlay, null);
						return;
					default: return;
				}
			});
			doc.addEventListener("keydown", (event) => {
				if (mode !== "inspect" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
				if (event.key !== "z" && event.key !== "Z") return;
				const target = event.target;
				if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
				event.preventDefault();
				event.stopPropagation();
				post({
					kind: "history",
					action: event.shiftKey ? "redo" : "undo"
				});
			}, true);
			post({ kind: "ready" });
		}
		//#endregion
		//#region src/client/document.ts
		/**
		* Build the preview document from a file's bytes.
		*
		* The preview needs scripts to run (an injected runtime observes hover and
		* selection and applies edits), so the frame is sandboxed with `allow-scripts`
		* but without `allow-same-origin`. That gives the page a unique opaque origin:
		* it cannot read the parent document, cookies, or storage, while the runtime
		* still reaches the parent over `postMessage`.
		*
		* The file's own markup is preserved. The runtime is appended as the last node
		* in the body so the page's DOM is complete before it installs its listeners.
		*
		* @module @guowenzhang/dsh-web-design/client/document
		*/
		/**
		* Decode a file's bytes as UTF-8 text.
		* @param data - the file's complete bytes.
		* @returns the decoded source, or `undefined` when the bytes are not valid UTF-8.
		*/
		function decodeSource(data) {
			try {
				return new TextDecoder("utf-8", { fatal: true }).decode(data);
			} catch {
				return;
			}
		}
		/**
		* Inject the design-tools runtime into an HTML source.
		*
		* A document with no `<body>` gets one appended rather than rejected: partial
		* fragments are common while an agent is still writing the file, and a preview
		* that refuses to open them is useless for reviewing work in progress.
		* @param source - the file's decoded HTML source.
		* @returns a complete document carrying the runtime.
		*/
		function withRuntime(source) {
			const script = `<script data-dsh-design-runtime>${frameRuntime()}<\/script>`;
			const bodyClose = source.lastIndexOf("</body>");
			if (bodyClose >= 0) return `${source.slice(0, bodyClose)}${script}${source.slice(bodyClose)}`;
			const htmlClose = source.lastIndexOf("</html>");
			if (htmlClose >= 0) return `${source.slice(0, htmlClose)}${script}${source.slice(htmlClose)}`;
			return `${source}${script}`;
		}
		/**
		* Build the complete preview document for one file.
		* @param data - the file's complete bytes.
		* @returns the document source, or `undefined` when the bytes are not text.
		*/
		function buildPreviewDocument(data) {
			const source = decodeSource(data);
			return source === void 0 ? void 0 : withRuntime(source);
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* Client-side review state for one previewed document.
		*
		* The store holds what the preview renders: the selected element, the review
		* document loaded from the Host, and whether the document has unsaved changes.
		* It is a snapshot store so the render path
		* subscribes instead of mirroring, and it is created per registration so two
		* previewed files never share state.
		*
		* @module @guowenzhang/dsh-web-design/client/store
		*/
		/**
		* Create the store for one previewed document.
		* @param file - absolute path of the previewed file, recorded in new documents.
		* @returns the store handle the component reads through `useStore`.
		*/
		function createDesignStore(file) {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({
					mode: "browse",
					selectedSelector: null,
					selected: null,
					hovered: null,
					document: null,
					loading: true,
					dirty: false,
					saving: false,
					error: null,
					open: false,
					reloadToken: 0
				}),
				actions: {
					setMode: (state, mode) => {
						state.mode = mode;
						if (mode !== "inspect") state.open = false;
					},
					setHovered: (state, hovered) => {
						state.hovered = hovered;
					},
					select: (state, anchor) => {
						state.selected = anchor;
						state.selectedSelector = anchor?.selector ?? null;
					},
					load: (state, document) => {
						state.document = document;
						state.dirty = false;
						state.error = null;
					},
					restore: (state, document) => {
						state.document = document;
						state.dirty = true;
					},
					upsertEdit: (state, edit) => {
						const current = state.document ?? emptyDocument(file);
						const others = current.edits.filter((existing) => existing.selector !== edit.selector);
						state.document = {
							...current,
							edits: [...others, edit],
							updatedAt: edit.updatedAt
						};
						state.dirty = true;
					},
					removeEdit: (state, selector) => {
						const current = state.document;
						if (current === null) return;
						state.document = {
							...current,
							edits: current.edits.filter((edit) => edit.selector !== selector),
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						state.dirty = true;
					},
					removeEdits: (state, selectors) => {
						const current = state.document;
						if (current === null) return;
						const removed = new Set(selectors);
						const edits = current.edits.filter((edit) => !removed.has(edit.selector));
						if (edits.length === current.edits.length) return;
						state.document = {
							...current,
							edits,
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						state.dirty = true;
					},
					clearEdits: (state) => {
						const current = state.document;
						if (current === null) return;
						state.document = {
							...current,
							edits: [],
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						state.dirty = true;
					},
					beginLoad: (state) => {
						state.loading = true;
					},
					endLoad: (state) => {
						state.loading = false;
					},
					beginSave: (state) => {
						state.saving = true;
						state.error = null;
					},
					endSave: (state, document) => {
						state.saving = false;
						state.document = document;
						state.dirty = false;
						state.error = null;
					},
					failSave: (state, message) => {
						state.saving = false;
						state.error = message;
					},
					setOpen: (state, open) => {
						state.open = open;
					},
					requestReload: (state) => {
						state.reloadToken += 1;
					}
				}
			});
		}
		/** An empty review document, kept local so the store never imports the Host half. */
		function emptyDocument(file) {
			return {
				version: 1,
				file,
				comments: [],
				edits: [],
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		//#endregion
		//#region \0dsh-css:/Users/jackson/Desktop/work related/claude/dsh-web-design/src/client/HtmlDesignBody.module.css.mjs
		const css = ".b5DOnG_preview{box-sizing:border-box;width:100%;height:100%;min-height:300px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui, sans-serif);white-space:normal;flex-direction:column;display:flex;container-type:inline-size}.b5DOnG_toolbar{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap;flex:none;justify-content:space-between;align-items:center;gap:8px 12px;padding:8px 10px;display:flex}.b5DOnG_toolbarEnd{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.b5DOnG_modeSwitch{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;flex:none;grid-template-columns:repeat(2,minmax(0,1fr));min-width:158px;padding:3px;display:grid;position:relative}.b5DOnG_modeSwitch:before{background:var(--dsw-alias-bg-layer-2);content:\"\";border-radius:999px;width:calc(50% - 3px);height:calc(100% - 6px);transition:transform .16s;position:absolute;top:3px;left:3px;box-shadow:0 1px 5px #00000021}.b5DOnG_modeSwitch[data-mode=inspect]:before{transform:translate(100%)}.b5DOnG_modeOption{z-index:1;min-height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;background:0 0;border:0;border-radius:999px;padding:0 14px;font-size:12px;font-weight:600;position:relative}.b5DOnG_modeOption[aria-pressed=true]{color:var(--dsw-alias-label-primary)}.b5DOnG_modeOption:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}@media (prefers-reduced-motion:reduce){.b5DOnG_modeSwitch:before{transition:none}}.b5DOnG_workspace{background:var(--dsw-alias-interactive-bg-hover-solid);flex:auto;min-height:0;position:relative;overflow:hidden}.b5DOnG_stage{box-sizing:border-box;min-width:0;padding:18px;display:flex;position:absolute;inset:0}.b5DOnG_frame{border:1px solid var(--dsw-alias-border-l2);background:#fff;border-radius:8px;flex:auto;width:100%;min-width:0;height:100%;min-height:0;display:block;box-shadow:0 14px 38px #00000021}.b5DOnG_frame[data-frame-mode-ready=false]{pointer-events:none}.b5DOnG_editor{z-index:1150;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui, sans-serif);white-space:normal;border-radius:16px;flex-direction:column;display:flex;position:fixed;overflow:hidden;box-shadow:0 18px 52px #00000040}.b5DOnG_editorHeader,.b5DOnG_editorFooter{flex:none;align-items:center;gap:8px;padding:12px 16px;display:flex}.b5DOnG_editorHeader{border-bottom:1px solid var(--dsw-alias-border-l2)}.b5DOnG_editorHeaderActions{flex:none;justify-content:flex-end;align-items:center;gap:10px;display:flex}.b5DOnG_editorHeaderAction{min-height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-decoration:underline;text-decoration-color:var(--dsw-alias-border-l2);text-underline-offset:3px;white-space:nowrap;background:0 0;border:0;padding:0;font-size:12px;font-weight:600}.b5DOnG_editorHeaderAction:hover{text-decoration-color:currentColor}.b5DOnG_editorHeaderAction:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.b5DOnG_editorIdentity{flex:auto;align-items:center;gap:8px;min-width:0;display:flex}.b5DOnG_elementTag{background:var(--dsw-alias-interactive-bg-hover);font-family:var(--dsw-font-mono,ui-monospace, monospace);border-radius:6px;flex:none;padding:4px 7px;font-size:11px;font-weight:700}.b5DOnG_editorSelector{min-width:0;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace, monospace);text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}.b5DOnG_locatorLabel{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px}.b5DOnG_editorScroll{overscroll-behavior:contain;flex-direction:column;gap:16px;min-height:0;padding:16px;display:flex;overflow-y:auto}.b5DOnG_editorFooter{border-top:1px solid var(--dsw-alias-border-l2)}.b5DOnG_footerSpace{flex:auto}.b5DOnG_deleteButton{color:var(--dsw-alias-state-error-primary)}.b5DOnG_deleteButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}.b5DOnG_section{flex-direction:column;gap:8px;display:flex}.b5DOnG_sectionTitle{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;margin:0;font-size:12px;font-weight:650;display:flex}.b5DOnG_meta{grid-template-columns:auto minmax(0,1fr);gap:3px 8px;margin:0;font-size:12px;display:grid}.b5DOnG_meta dt{color:var(--dsw-alias-label-tertiary)}.b5DOnG_meta dd{overflow-wrap:anywhere;margin:0}.b5DOnG_tagCode{border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:1px 5px;font-size:11px}.b5DOnG_metaNote{color:var(--dsw-alias-label-tertiary);margin-left:6px;font-size:11px}.b5DOnG_warn{color:var(--dsw-alias-label-warning,#b4690e);margin:0;font-size:12px}.b5DOnG_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.b5DOnG_fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;display:grid}.b5DOnG_field{flex-direction:column;gap:4px;min-width:0;display:flex}.b5DOnG_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.b5DOnG_lengthField{gap:6px;min-width:0;display:flex}.b5DOnG_colorField{align-items:center;gap:6px;min-width:0;display:flex}.b5DOnG_colorSwatch{border:1px solid var(--dsw-alias-border-l2);cursor:pointer;background:0 0;border-radius:5px;flex:none;width:26px;height:26px;padding:0}.b5DOnG_lengthInput,.b5DOnG_unitSelect,.b5DOnG_select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);min-height:26px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:5px;padding:2px 6px;font-size:12px}.b5DOnG_lengthInput{width:100%;min-width:0}.b5DOnG_unitSelect{flex:none}.b5DOnG_select{width:100%}.b5DOnG_textInput{box-sizing:border-box;resize:vertical;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:100%;min-height:78px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.45}.b5DOnG_notice{overflow-wrap:anywhere;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0;padding:7px 12px;font-size:12px}.b5DOnG_status{color:var(--dsw-alias-label-tertiary);margin:0;padding:12px;font-size:12px}@container (width<=430px){.b5DOnG_stage{padding:8px}}.b5DOnG_editor[data-compact] .b5DOnG_fields{grid-template-columns:minmax(0,1fr)}.b5DOnG_editor[data-compact] .b5DOnG_editorHeader,.b5DOnG_editor[data-compact] .b5DOnG_editorFooter{padding:10px 12px}.b5DOnG_editor[data-compact] .b5DOnG_editorFooter{flex-wrap:wrap}.b5DOnG_editor[data-compact] .b5DOnG_footerSpace{flex-basis:100%;height:0}.b5DOnG_editor[data-compact] .b5DOnG_editorScroll{padding:12px}";
		const tagId = "@guowenzhang/dsh-web-design/HtmlDesignBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var HtmlDesignBody_module_css_default = {
			"colorField": "b5DOnG_colorField",
			"colorSwatch": "b5DOnG_colorSwatch",
			"deleteButton": "b5DOnG_deleteButton",
			"editor": "b5DOnG_editor",
			"editorFooter": "b5DOnG_editorFooter",
			"editorHeader": "b5DOnG_editorHeader",
			"editorHeaderAction": "b5DOnG_editorHeaderAction",
			"editorHeaderActions": "b5DOnG_editorHeaderActions",
			"editorIdentity": "b5DOnG_editorIdentity",
			"editorScroll": "b5DOnG_editorScroll",
			"editorSelector": "b5DOnG_editorSelector",
			"elementTag": "b5DOnG_elementTag",
			"field": "b5DOnG_field",
			"fieldLabel": "b5DOnG_fieldLabel",
			"fields": "b5DOnG_fields",
			"footerSpace": "b5DOnG_footerSpace",
			"frame": "b5DOnG_frame",
			"hint": "b5DOnG_hint",
			"lengthField": "b5DOnG_lengthField",
			"lengthInput": "b5DOnG_lengthInput",
			"locatorLabel": "b5DOnG_locatorLabel",
			"meta": "b5DOnG_meta",
			"metaNote": "b5DOnG_metaNote",
			"modeOption": "b5DOnG_modeOption",
			"modeSwitch": "b5DOnG_modeSwitch",
			"notice": "b5DOnG_notice",
			"preview": "b5DOnG_preview",
			"section": "b5DOnG_section",
			"sectionTitle": "b5DOnG_sectionTitle",
			"select": "b5DOnG_select",
			"stage": "b5DOnG_stage",
			"status": "b5DOnG_status",
			"tagCode": "b5DOnG_tagCode",
			"textInput": "b5DOnG_textInput",
			"toolbar": "b5DOnG_toolbar",
			"toolbarEnd": "b5DOnG_toolbarEnd",
			"unitSelect": "b5DOnG_unitSelect",
			"warn": "b5DOnG_warn",
			"workspace": "b5DOnG_workspace"
		};
		//#endregion
		//#region src/client/HtmlDesignBody.tsx
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
		const MODES = ["browse", "inspect"];
		/** Editable style properties, with the control that should edit each one. */
		const STYLE_FIELDS = [
			{
				key: "width",
				label: "width",
				control: {
					kind: "length",
					units: [
						"px",
						"%",
						"em",
						"rem",
						"ch",
						"auto"
					],
					bare: true
				}
			},
			{
				key: "height",
				label: "height",
				control: {
					kind: "length",
					units: [
						"px",
						"%",
						"em",
						"rem",
						"ch",
						"auto"
					],
					bare: true
				}
			},
			{
				key: "font-size",
				label: "fontSize",
				control: {
					kind: "length",
					units: [
						"px",
						"rem",
						"em",
						"%",
						"pt"
					]
				}
			},
			{
				key: "line-height",
				label: "lineHeight",
				control: {
					kind: "length",
					units: [
						"",
						"px",
						"rem",
						"em",
						"%"
					],
					bare: true
				}
			},
			{
				key: "letter-spacing",
				label: "letterSpacing",
				control: {
					kind: "length",
					units: [
						"px",
						"em",
						"rem",
						"normal"
					],
					bare: true
				}
			},
			{
				key: "font-weight",
				label: "fontWeight",
				control: {
					kind: "choice",
					options: [
						"300",
						"400",
						"500",
						"600",
						"700",
						"800",
						"900"
					]
				}
			},
			{
				key: "color",
				label: "color",
				control: { kind: "color" }
			},
			{
				key: "background-color",
				label: "background",
				control: { kind: "color" }
			},
			{
				key: "border-radius",
				label: "borderRadius",
				control: {
					kind: "length",
					units: [
						"px",
						"%",
						"em",
						"rem"
					]
				}
			},
			{
				key: "padding",
				label: "padding",
				control: {
					kind: "length",
					units: [
						"px",
						"%",
						"em",
						"rem"
					]
				}
			},
			{
				key: "margin",
				label: "margin",
				control: {
					kind: "length",
					units: [
						"px",
						"%",
						"em",
						"rem",
						"auto"
					],
					bare: true
				}
			}
		];
		/** Tags a person can act on, as opposed to structural or content blocks. */
		const INTERACTIVE_TAGS = /^(?:a|button|input|select|textarea|summary|option|label)$/iu;
		/** Whether the selected element is interactive rather than a content block. */
		function interactiveTag(tag) {
			return INTERACTIVE_TAGS.test(tag);
		}
		/** Split a CSS value into the number a box should show and the unit beside it. */
		function splitLength(value, units, bare) {
			const trimmed = value.trim();
			if (trimmed === "") return {
				amount: "",
				unit: units[0] ?? "px"
			};
			if (units.includes(trimmed)) return {
				amount: "",
				unit: trimmed
			};
			const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(.*)$/.exec(trimmed);
			if (match === null) return {
				amount: trimmed,
				unit: units[0] ?? "px"
			};
			const unit = match[2] ?? "";
			if (unit !== "" && !units.includes(unit)) return {
				amount: trimmed,
				unit: units[0] ?? "px"
			};
			if (unit === "" && !bare) return {
				amount: trimmed,
				unit: units[0] ?? "px"
			};
			return {
				amount: match[1] ?? "",
				unit: unit === "" ? units[0] ?? "px" : unit
			};
		}
		/** Join a number and a unit back into one CSS value. */
		function joinLength(amount, unit) {
			if (amount.trim() === "") return "";
			return unit === "" ? amount.trim() : `${amount.trim()}${unit}`;
		}
		/** Reduce any CSS color the browser reports to a hex swatch value. */
		function toHexColor(value) {
			const trimmed = value.trim();
			if (/^#[0-9a-f]{6}$/iu.test(trimmed)) return trimmed.toLowerCase();
			if (/^#[0-9a-f]{3}$/iu.test(trimmed)) return "#" + trimmed.slice(1).split("").map((digit) => digit + digit).join("");
			const channel = (part) => {
				const number = part.trim();
				if (number.endsWith("%")) return Math.round(Number.parseFloat(number) * 2.55);
				return Math.max(0, Math.min(255, Math.round(Number.parseFloat(number) || 0)));
			};
			const rgb = /^rgba?\(([^)]*)\)$/iu.exec(trimmed);
			if (rgb !== null) {
				const [red, green, blue] = rgb[1]?.split(/[,/\s]+/u).filter(Boolean) ?? [];
				return "#" + [
					channel(red ?? "0"),
					channel(green ?? "0"),
					channel(blue ?? "0")
				].map((part) => part.toString(16).padStart(2, "0")).join("");
			}
			return "#000000";
		}
		/** How many undo steps to keep. Deeper than any sensible editing session. */
		const HISTORY_LIMIT = 100;
		/** Keep an editing surface beside the Sidebar when space allows. */
		function placeEditor(stage) {
			const rect = stage.getBoundingClientRect();
			const visual = window.visualViewport;
			const viewportLeft = visual?.offsetLeft ?? 0;
			const viewportTop = visual?.offsetTop ?? 0;
			const viewportWidth = visual?.width ?? window.innerWidth;
			const viewportHeight = visual?.height ?? window.innerHeight;
			const inset = 12;
			const gap = 16;
			const viewportRight = viewportLeft + viewportWidth;
			const viewportBottom = viewportTop + viewportHeight;
			const leftRoom = rect.left - viewportLeft - inset - gap;
			const rightRoom = viewportRight - rect.right - inset - gap;
			const minimumSideWidth = 260;
			const maxHeight = Math.max(0, Math.min(560, viewportHeight - 24));
			if (leftRoom >= minimumSideWidth || rightRoom >= minimumSideWidth) {
				const side = leftRoom >= minimumSideWidth ? "left" : "right";
				const width = Math.min(480, side === "left" ? leftRoom : rightRoom);
				return {
					side,
					left: side === "left" ? rect.left - gap - width : rect.right + gap,
					top: Math.min(Math.max(rect.top + 20, viewportTop + inset), viewportBottom - inset - maxHeight),
					width,
					maxHeight
				};
			}
			const width = Math.max(0, Math.min(480, viewportWidth - 24));
			const visibleStageHeight = Math.max(0, Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop));
			const maxBottomHeight = Math.max(0, Math.min(400, viewportHeight * .48, visibleStageHeight * .55));
			return {
				side: "bottom",
				left: viewportLeft + (viewportWidth - width) / 2,
				top: viewportBottom - inset - maxBottomHeight,
				width,
				maxHeight: maxBottomHeight
			};
		}
		/**
		* Render the HTML design preview.
		* @param props - document content, framework store seat, injected host callbacks, and locale.
		* @returns the preview, or the loading and failure states.
		*/
		function HtmlDesignBody(props) {
			const { content, resourceAddress, useStore, loadReview, saveReview, applyToFile, fileRefOf, actions, t } = props;
			const state = useStore((selector) => selector);
			const frameRef = (0, react.useRef)(null);
			const stageRef = (0, react.useRef)(null);
			const focusReturnRef = (0, react.useRef)(null);
			const [editorPlacement, setEditorPlacement] = (0, react.useState)(null);
			const [draftStyle, setDraftStyle] = (0, react.useState)({});
			const [computed, setComputed] = (0, react.useState)({});
			const [draftText, setDraftText] = (0, react.useState)("");
			const [editableText, setEditableText] = (0, react.useState)(null);
			const [selectedParentSelector, setSelectedParentSelector] = (0, react.useState)(null);
			const [traits, setTraits] = (0, react.useState)(null);
			const [locatorCopy, setLocatorCopy] = (0, react.useState)(null);
			const selectedSource = (0, react.useRef)(null);
			const deletionRequest = (0, react.useRef)(null);
			const nextDeletionRequest = (0, react.useRef)(0);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [deletions, setDeletions] = (0, react.useState)([]);
			const deletionsRef = (0, react.useRef)([]);
			const [textEdits, setTextEdits] = (0, react.useState)({});
			const [history, setHistory] = (0, react.useState)({
				past: [],
				future: []
			});
			const [pendingEdits, setPendingEdits] = (0, react.useState)(false);
			const editRevision = (0, react.useRef)(0);
			const [fileWrite, setFileWrite] = (0, react.useState)({
				kind: "idle",
				detail: ""
			});
			const [frameResource, setFrameResource] = (0, react.useState)(null);
			const [frameAppliedMode, setFrameAppliedMode] = (0, react.useState)(null);
			const [resolvedFile, setResolvedFile] = (0, react.useState)(null);
			const documentRef = (0, react.useRef)(state.document);
			documentRef.current = state.document;
			(0, react.useEffect)(() => {
				if (locatorCopy === null) return;
				const timeout = window.setTimeout(() => setLocatorCopy(null), 1600);
				return () => window.clearTimeout(timeout);
			}, [locatorCopy]);
			const fileRef = (0, react.useMemo)(() => fileRefOf(resourceAddress), [fileRefOf, resourceAddress]);
			const hostPath = resolvedFile?.address === resourceAddress ? resolvedFile.path : void 0;
			const source = (0, react.useMemo)(() => content.kind === "bytes" ? buildPreviewDocument(content.data) : void 0, [content]);
			(0, react.useEffect)(() => {
				if (source === void 0) return;
				const url = URL.createObjectURL(new Blob([source], { type: "text/html;charset=utf-8" }));
				setFrameResource({
					source,
					url
				});
				return () => {
					URL.revokeObjectURL(url);
				};
			}, [source]);
			/** Adopt a frame selection; only an explicit edit gesture opens the dialog. */
			const selectAnchor = (0, react.useCallback)((anchor, openEditor) => {
				selectedSource.current = {
					selector: anchor.selector,
					text: anchor.sourceText,
					classes: anchor.sourceClasses
				};
				setSelectedParentSelector(anchor.parentSelector);
				setTraits({
					display: anchor.display ?? "",
					resizable: anchor.resizable === true,
					movable: anchor.movable !== false
				});
				const sameSelection = state.selectedSelector === anchor.selector;
				if (state.open && sameSelection) {
					actions.select(toAnchor(anchor));
					return;
				}
				actions.select(toAnchor(anchor));
				if (!openEditor || state.mode !== "inspect") {
					if (state.open) actions.setOpen(false);
					return;
				}
				setComputed(anchor.computed);
				focusReturnRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : frameRef.current;
				setDraftStyle(state.document?.edits.find((edit) => edit.selector === anchor.selector)?.declarations ?? {});
				setEditableText(anchor.editableText);
				setDraftText(anchor.editableText === null ? "" : textEdits[anchor.selector] ?? anchor.editableText);
				actions.setOpen(true);
			}, [
				actions,
				state.mode,
				state.document,
				state.open,
				state.selectedSelector,
				textEdits
			]);
			const closeEditor = (0, react.useCallback)(() => {
				actions.setOpen(false);
				window.requestAnimationFrame(() => {
					const previous = focusReturnRef.current;
					if (previous?.isConnected) previous.focus();
					else frameRef.current?.focus();
				});
			}, [actions]);
			const cancelEditor = (0, react.useCallback)(() => {
				closeEditor();
			}, [closeEditor]);
			(0, react.useLayoutEffect)(() => {
				const stage = stageRef.current;
				if (!state.open || stage === null) {
					setEditorPlacement(null);
					return;
				}
				let frame = 0;
				const update = () => {
					setEditorPlacement(placeEditor(stage));
				};
				const schedule = () => {
					window.cancelAnimationFrame(frame);
					frame = window.requestAnimationFrame(update);
				};
				update();
				const observer = new ResizeObserver(schedule);
				observer.observe(stage);
				window.addEventListener("resize", schedule);
				window.document.addEventListener("scroll", schedule, true);
				window.visualViewport?.addEventListener("resize", schedule);
				window.visualViewport?.addEventListener("scroll", schedule);
				return () => {
					observer.disconnect();
					window.cancelAnimationFrame(frame);
					window.removeEventListener("resize", schedule);
					window.document.removeEventListener("scroll", schedule, true);
					window.visualViewport?.removeEventListener("resize", schedule);
					window.visualViewport?.removeEventListener("scroll", schedule);
				};
			}, [state.open]);
			(0, react.useEffect)(() => {
				postToFrame(frameRef.current, {
					kind: "mode",
					mode: state.mode,
					dragHandleLabel: t("dragHandle"),
					resizeHandleLabel: t("resizeHandle")
				});
			}, [
				state.mode,
				source,
				state.reloadToken,
				t
			]);
			(0, react.useEffect)(() => {
				if (!state.open) return;
				const closeOnEscape = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						cancelEditor();
					}
				};
				window.addEventListener("keydown", closeOnEscape);
				return () => {
					window.removeEventListener("keydown", closeOnEscape);
				};
			}, [state.open, cancelEditor]);
			(0, react.useEffect)(() => {
				setResolvedFile(null);
				setTextEdits({});
				setDeletions([]);
				deletionsRef.current = [];
				selectedSource.current = null;
				setSelectedParentSelector(null);
				deletionRequest.current = null;
				setDeleting(false);
				setPendingEdits(false);
				editRevision.current = 0;
				clearHistory();
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				actions.load(null);
				actions.select(null);
				actions.setOpen(false);
				if (fileRef === void 0) {
					actions.endLoad();
					return;
				}
				let active = true;
				actions.beginLoad();
				loadReview(fileRef).then((result) => {
					if (!active) return;
					setResolvedFile({
						address: resourceAddress,
						path: result.path
					});
					actions.load(result.document);
					actions.endLoad();
				}).catch((error) => {
					if (!active) return;
					setResolvedFile(null);
					actions.load(null);
					actions.endLoad();
					setFileWrite({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				});
				return () => {
					active = false;
				};
			}, [
				fileRef,
				resourceAddress,
				loadReview,
				actions
			]);
			(0, react.useEffect)(() => {
				const edits = state.document?.edits ?? [];
				for (const edit of edits) postToFrame(frameRef.current, {
					kind: "style",
					selector: edit.selector,
					declarations: edit.declarations
				});
			}, [state.document, state.reloadToken]);
			/** Write the current review to the Host. */
			const persist = (0, react.useCallback)(async (next) => {
				if (fileRef === void 0 || hostPath === void 0) return;
				const canonical = {
					...next,
					file: hostPath
				};
				actions.beginSave();
				try {
					await saveReview(fileRef, canonical);
					actions.endSave(canonical);
				} catch (error) {
					actions.failSave(error instanceof Error ? error.message : String(error));
				}
			}, [
				fileRef,
				hostPath,
				saveReview,
				actions
			]);
			/** The document with one edit applied, replacing any prior edit for the selector. */
			const withEdit = (0, react.useCallback)((edit, path) => {
				const base = state.document ?? {
					version: 1,
					file: path,
					comments: [],
					edits: [],
					updatedAt: edit.updatedAt
				};
				return {
					...base,
					edits: [...base.edits.filter((existing) => existing.selector !== edit.selector), edit],
					updatedAt: edit.updatedAt
				};
			}, [state.document]);
			const snapshot = (0, react.useCallback)(() => ({
				document: documentRef.current,
				textEdits,
				deletions: deletionsRef.current
			}), [textEdits]);
			/** Record the state an edit is about to change, so one undo step reverses it. */
			const pushHistory = (0, react.useCallback)(() => {
				const entry = snapshot();
				setHistory((current) => current.past.at(-1) === entry ? current : {
					past: [...current.past, entry].slice(-100),
					future: []
				});
			}, [snapshot]);
			const clearHistory = (0, react.useCallback)(() => {
				setHistory({
					past: [],
					future: []
				});
			}, []);
			/** Put a snapshot back into the store and the frame, without a file write. */
			const restoreSnapshot = (0, react.useCallback)((entry) => {
				deletionsRef.current = entry.deletions;
				setDeletions(entry.deletions);
				setTextEdits(entry.textEdits);
				actions.restore(entry.document);
				actions.requestReload();
			}, [actions]);
			const undo = (0, react.useCallback)(() => {
				setHistory((current) => {
					const previous = current.past.at(-1);
					if (previous === void 0) return current;
					const now = snapshot();
					restoreSnapshot(previous);
					return {
						past: current.past.slice(0, -1),
						future: [now, ...current.future].slice(0, HISTORY_LIMIT)
					};
				});
			}, [restoreSnapshot, snapshot]);
			const redo = (0, react.useCallback)(() => {
				setHistory((current) => {
					const next = current.future[0];
					if (next === void 0) return current;
					const now = snapshot();
					restoreSnapshot(next);
					return {
						past: [...current.past, now].slice(-100),
						future: current.future.slice(1)
					};
				});
			}, [restoreSnapshot, snapshot]);
			/**
			* Commit a finished drag or resize. The element already carries the new
			* values in the frame, so only the review document, the sidecar and the
			* history need updating.
			*/
			const applyDragEdit = (0, react.useCallback)((selector, declarations) => {
				if (hostPath === void 0) return;
				const previous = state.document?.edits.find((edit) => edit.selector === selector)?.declarations ?? {};
				const merged = cleanDeclarations({
					...previous,
					...declarations
				});
				if (sameDeclarations(previous, merged)) return;
				pushHistory();
				if (Object.keys(merged).length > 0) {
					const edit = {
						selector,
						declarations: merged,
						updatedAt: (/* @__PURE__ */ new Date()).toISOString()
					};
					actions.upsertEdit(edit);
					persist(withEdit(edit, hostPath));
				} else {
					actions.removeEdit(selector);
					persist(withoutEdit(state.document, selector, hostPath));
				}
				editRevision.current += 1;
				setPendingEdits(true);
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				if (state.open && state.selectedSelector === selector) setDraftStyle(merged);
			}, [
				actions,
				hostPath,
				persist,
				pushHistory,
				state.document,
				state.open,
				state.selectedSelector,
				withEdit
			]);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey) return;
					if (event.key !== "z" && event.key !== "Z") return;
					const target = event.target;
					if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
					event.preventDefault();
					event.stopPropagation();
					if (event.shiftKey) redo();
					else undo();
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, [redo, undo]);
			(0, react.useEffect)(() => {
				const listener = (event) => {
					if (event.source !== frameRef.current?.contentWindow) return;
					const data = event.data;
					if (typeof data !== "object" || data === null) return;
					const message = data;
					if (message.channel !== "dsh-web-design") return;
					switch (message.kind) {
						case "ready":
							postToFrame(frameRef.current, {
								kind: "mode",
								mode: state.mode,
								dragHandleLabel: t("dragHandle"),
								resizeHandleLabel: t("resizeHandle")
							});
							for (const edit of state.document?.edits ?? []) postToFrame(frameRef.current, {
								kind: "style",
								selector: edit.selector,
								declarations: edit.declarations
							});
							for (const [selector, value] of Object.entries(textEdits)) postToFrame(frameRef.current, {
								kind: "text",
								selector,
								value
							});
							for (const deletion of deletionsRef.current) postToFrame(frameRef.current, {
								kind: "replayRemoval",
								selector: deletion.selector,
								requestId: `replay-${++nextDeletionRequest.current}`
							});
							return;
						case "modeApplied":
							if (message.mode === state.mode && source !== void 0) setFrameAppliedMode({
								source,
								reloadToken: state.reloadToken,
								mode: message.mode
							});
							return;
						case "hover":
							actions.setHovered(message.selector === null || message.selector === void 0 || message.tag === null || message.tag === void 0 ? null : {
								selector: message.selector,
								tag: message.tag
							});
							return;
						case "select":
							if (message.anchor !== void 0) selectAnchor(message.anchor, false);
							return;
						case "edit":
							if (message.anchor !== void 0) selectAnchor(message.anchor, true);
							return;
						case "move":
							if (message.anchor === void 0 || message.declarations === void 0 || message.selector === void 0) return;
							if (state.selectedSelector !== message.selector) return;
							if (state.open && state.selectedSelector === message.selector) {
								actions.select(toAnchor(message.anchor));
								setComputed(message.anchor.computed);
							}
							applyDragEdit(message.selector, message.declarations);
							return;
						case "history":
							if (message.action === "redo") redo();
							else undo();
							return;
						case "unavailable":
							setFileWrite({
								kind: "failed",
								detail: `${t("handleUnavailable")}: ${t(message.reason === "resize" ? "resizeHandle" : "dragHandle")}`
							});
							return;
						case "removeResult": {
							if (typeof message.requestId !== "string" || typeof message.selector !== "string") return;
							const request = deletionRequest.current;
							if (request?.requestId === message.requestId && request.source.selector === message.selector) {
								deletionRequest.current = null;
								setDeleting(false);
								const removedSelectors = Array.isArray(message.removedSelectors) ? message.removedSelectors.filter((selector) => typeof selector === "string") : [];
								if (message.success !== true || !removedSelectors.includes(message.selector)) {
									setFileWrite({
										kind: "failed",
										detail: t("deleteFailed")
									});
									return;
								}
								const deletion = {
									...request.source,
									removedSelectors
								};
								pushHistory();
								const next = [...deletionsRef.current.filter((current) => !removedSelectors.includes(current.selector)), deletion];
								deletionsRef.current = next;
								setDeletions(next);
								editRevision.current += 1;
								setFileWrite({
									kind: "idle",
									detail: ""
								});
								actions.select(null);
								closeEditor();
								return;
							}
							if (message.requestId.startsWith("replay-") && message.success !== true) setFileWrite({
								kind: "failed",
								detail: `${t("deleteFailed")}: ${message.selector}`
							});
							return;
						}
						default: return;
					}
				};
				window.addEventListener("message", listener);
				return () => {
					window.removeEventListener("message", listener);
				};
			}, [
				actions,
				applyDragEdit,
				closeEditor,
				pushHistory,
				redo,
				selectAnchor,
				source,
				state.mode,
				state.document,
				state.reloadToken,
				state.selectedSelector,
				state.open,
				textEdits,
				t,
				undo
			]);
			const saveSelection = (0, react.useCallback)(() => {
				const selector = state.selectedSelector;
				if (selector === null || hostPath === void 0) return;
				const declarations = cleanDeclarations(draftStyle);
				const previous = state.document?.edits.find((edit) => edit.selector === selector);
				const styleChanged = !sameDeclarations(previous?.declarations ?? {}, declarations);
				const textChanged = editableText !== null && draftText !== editableText;
				if (styleChanged) {
					if (Object.keys(declarations).length > 0) {
						const edit = {
							selector,
							declarations,
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						actions.upsertEdit(edit);
						persist(withEdit(edit, hostPath));
						if (previous !== void 0 && Object.keys(previous.declarations).some((key) => !(key in declarations))) actions.requestReload();
						else postToFrame(frameRef.current, {
							kind: "style",
							selector,
							declarations
						});
					} else {
						actions.removeEdit(selector);
						persist(withoutEdit(state.document, selector, hostPath));
						actions.requestReload();
					}
				}
				if (textChanged) {
					postToFrame(frameRef.current, {
						kind: "text",
						selector,
						value: draftText
					});
					setTextEdits((current) => ({
						...current,
						[selector]: draftText
					}));
				}
				if (styleChanged || textChanged) {
					pushHistory();
					editRevision.current += 1;
					setPendingEdits(true);
				}
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				closeEditor();
			}, [
				draftStyle,
				draftText,
				editableText,
				state.selectedSelector,
				state.document,
				hostPath,
				actions,
				persist,
				pushHistory,
				withEdit,
				closeEditor
			]);
			/** Remove only the selected frame element and stage its source deletion. */
			const deleteSelection = (0, react.useCallback)(() => {
				const source = selectedSource.current;
				if (hostPath === void 0 || !state.open || state.mode !== "inspect" || deleting || fileWrite.kind === "saving" || source === null || source.selector !== state.selectedSelector || /^(?:html|head|body)$/iu.test(state.selected?.tag ?? "")) return;
				const requestId = `remove-${++nextDeletionRequest.current}`;
				deletionRequest.current = {
					requestId,
					source
				};
				setDeleting(true);
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				postToFrame(frameRef.current, {
					kind: "removeSelected",
					selector: source.selector,
					requestId
				});
			}, [
				deleting,
				fileWrite.kind,
				hostPath,
				state.mode,
				state.open,
				state.selected?.tag,
				state.selectedSelector
			]);
			const resetStyle = (0, react.useCallback)(() => {
				setDraftStyle({});
				setFileWrite({
					kind: "idle",
					detail: ""
				});
			}, []);
			/**
			* Write the reviewer's edits into the file itself.
			*
			* This is deliberately explicit: the review sidecar accumulates edits as the
			* reviewer works, and only this action changes the artifact. The Host applies
			* each edit as a span rewrite, so the result is reported back — including any
			* selector it could not locate in the source, which the reviewer must know
			* about rather than discover later.
			*/
			const saveToFile = (0, react.useCallback)(() => {
				if (fileRef === void 0 || hostPath === void 0) return;
				const edits = state.document?.edits ?? [];
				if (edits.length === 0 && Object.keys(textEdits).length === 0 && deletions.length === 0) {
					setFileWrite({
						kind: "idle",
						detail: ""
					});
					return;
				}
				const revision = editRevision.current;
				setFileWrite({
					kind: "saving",
					detail: ""
				});
				applyToFile({
					file: fileRef,
					edits,
					textEdits,
					deletions: deletions.map(({ selector, text, classes }) => ({
						selector,
						text,
						classes
					}))
				}).then((result) => {
					const skipped = new Set(result.skipped.map((entry) => entry.selector));
					const applied = new Set(result.applied);
					const writtenDeletions = deletions.filter((deletion) => applied.has(deletion.selector) && !skipped.has(deletion.selector));
					const missingDeletions = deletions.filter((deletion) => !applied.has(deletion.selector) && !skipped.has(deletion.selector));
					if (writtenDeletions.length > 0) {
						const written = new Set(writtenDeletions.map((deletion) => deletion.selector));
						const remaining = deletionsRef.current.filter((deletion) => !written.has(deletion.selector));
						deletionsRef.current = remaining;
						setDeletions(remaining);
						const removedSelectors = new Set(writtenDeletions.flatMap((deletion) => deletion.removedSelectors));
						setTextEdits((current) => Object.fromEntries(Object.entries(current).filter(([selector]) => !removedSelectors.has(selector))));
						const document = documentRef.current;
						if (document !== null && document.edits.some((edit) => removedSelectors.has(edit.selector))) {
							const next = {
								...document,
								edits: document.edits.filter((edit) => !removedSelectors.has(edit.selector)),
								updatedAt: (/* @__PURE__ */ new Date()).toISOString()
							};
							actions.removeEdits([...removedSelectors]);
							persist(next);
						}
					}
					if (result.skipped.length > 0 || missingDeletions.length > 0) {
						const missed = [...result.skipped.map((entry) => entry.selector), ...missingDeletions.map((deletion) => deletion.selector)];
						setFileWrite({
							kind: "partial",
							detail: missed.join(", ")
						});
						return;
					}
					setFileWrite({
						kind: "saved",
						detail: String(result.bytes)
					});
					if (editRevision.current === revision) setPendingEdits(false);
					setTextEdits((current) => Object.fromEntries(Object.entries(current).filter(([selector, value]) => textEdits[selector] !== value)));
					clearHistory();
				}).catch((error) => {
					setFileWrite({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				});
			}, [
				actions,
				applyToFile,
				clearHistory,
				deletions,
				fileRef,
				hostPath,
				persist,
				state.document,
				textEdits
			]);
			const hasFileEdits = (state.document?.edits.length ?? 0) > 0 || Object.keys(textEdits).length > 0 || deletions.length > 0;
			const previousStyle = state.document?.edits.find((edit) => edit.selector === state.selectedSelector)?.declarations ?? {};
			const draftDirty = state.open && state.selected !== null && (!sameDeclarations(previousStyle, cleanDeclarations(draftStyle)) || editableText !== null && draftText !== editableText);
			const statusDirty = state.dirty || draftDirty || pendingEdits || deletions.length > 0;
			const rootSelected = /^(?:html|head|body)$/iu.test(state.selected?.tag ?? "");
			const elementType = interactiveTag(state.selected?.tag ?? "") ? t("typeInteractive") : t("typeBlock");
			const displayNote = [traits?.display === "" ? void 0 : t("displayLabel") + " " + traits?.display, traits?.resizable === false ? t("notResizable") : void 0].filter(Boolean).join(" · ");
			const frameInteractive = frameAppliedMode !== null && frameAppliedMode.source === source && frameAppliedMode.reloadToken === state.reloadToken && frameAppliedMode.mode === state.mode;
			if (content.kind !== "bytes") return null;
			if (source === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: HtmlDesignBody_module_css_default.status,
				role: "alert",
				children: t("failed")
			});
			if (frameResource?.source !== source) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: HtmlDesignBody_module_css_default.status,
				role: "status",
				children: t("loading")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: HtmlDesignBody_module_css_default.preview,
				"data-html-design-surface": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: HtmlDesignBody_module_css_default.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: HtmlDesignBody_module_css_default.modeSwitch,
							role: "group",
							"aria-label": t("modes"),
							"data-mode": state.mode,
							children: MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: HtmlDesignBody_module_css_default.modeOption,
								"aria-pressed": state.mode === mode,
								title: mode === "inspect" ? t("editGestureHint") : void 0,
								disabled: deleting,
								onClick: () => {
									if (state.mode === mode) return;
									cancelEditor();
									postToFrame(frameRef.current, {
										kind: "mode",
										mode,
										dragHandleLabel: t("dragHandle"),
										resizeHandleLabel: t("resizeHandle")
									});
									actions.setMode(mode);
								},
								children: modeLabel(mode, t)
							}, mode))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: HtmlDesignBody_module_css_default.toolbarEnd,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("undoHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										disabled: history.past.length === 0 || deleting,
										onClick: undo,
										children: t("undo")
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("redoHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										disabled: history.future.length === 0 || deleting,
										onClick: redo,
										children: t("redo")
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: statusDirty ? "warning" : state.error !== null || fileWrite.kind === "failed" ? "danger" : "neutral",
									children: draftDirty ? t("unsaved") : state.saving ? t("saving") : statusDirty ? t("unsaved") : state.error !== null || fileWrite.kind === "failed" ? t("saveFailed") : t("saved")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("saveToFileHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										size: "sm",
										disabled: hostPath === void 0 || !hasFileEdits || draftDirty || deleting || state.saving || fileWrite.kind === "saving",
										onClick: saveToFile,
										children: fileWrite.kind === "saving" ? t("saving") : t("saveToFile")
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									onClick: () => {
										deletionRequest.current = null;
										setDeleting(false);
										cancelEditor();
										actions.requestReload();
									},
									children: t("reload")
								})
							]
						})]
					}),
					(state.error !== null || fileWrite.kind === "failed" || fileWrite.kind === "partial" || fileWrite.kind === "saved") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: HtmlDesignBody_module_css_default.notice,
						role: state.error !== null || fileWrite.kind === "failed" ? "alert" : "status",
						children: state.error ?? (fileWrite.kind === "failed" ? fileWrite.detail : fileWrite.kind === "partial" ? `${t("filePartial")}: ${fileWrite.detail}` : t("fileSaved"))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: HtmlDesignBody_module_css_default.workspace,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							ref: stageRef,
							className: HtmlDesignBody_module_css_default.stage,
							"data-html-design-stage": true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
								ref: frameRef,
								className: HtmlDesignBody_module_css_default.frame,
								src: frameResource.url,
								sandbox: "allow-scripts allow-forms allow-popups allow-modals",
								title: t("frame"),
								"data-html-design-preview": true,
								"data-frame-mode-ready": frameInteractive ? "true" : "false"
							}, state.reloadToken)
						}), state.open && state.selected !== null && editorPlacement !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: HtmlDesignBody_module_css_default.editor,
							role: "dialog",
							"aria-label": t("editElement"),
							"data-html-design-editor": true,
							"data-placement": editorPlacement.side,
							"data-compact": editorPlacement.width < 390 ? "" : void 0,
							style: {
								left: editorPlacement.left,
								top: editorPlacement.top,
								width: editorPlacement.width,
								maxHeight: editorPlacement.maxHeight
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: HtmlDesignBody_module_css_default.editorHeader,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: HtmlDesignBody_module_css_default.editorIdentity,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.elementTag,
												title: t("elementTag"),
												children: state.selected.tag.toUpperCase()
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.locatorLabel,
												children: t("elementLocator")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.editorSelector,
												title: state.selected.selector,
												children: state.selected.selector
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: HtmlDesignBody_module_css_default.editorHeaderActions,
										children: [
											selectedParentSelector !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: HtmlDesignBody_module_css_default.editorHeaderAction,
												title: t("selectParentHint"),
												onClick: () => {
													postToFrame(frameRef.current, { kind: "selectParent" });
												},
												children: t("selectParent")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: HtmlDesignBody_module_css_default.editorHeaderAction,
												title: t("copyLocatorHint"),
												onClick: () => {
													const selector = state.selected?.selector;
													if (selector === void 0) return;
													(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(selector).then((success) => setLocatorCopy({
														selector,
														success
													}));
												},
												children: locatorCopy?.selector === state.selected.selector ? t(locatorCopy.success ? "locatorCopied" : "locatorCopyFailed") : t("copyLocator")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "ghost",
												size: "sm",
												"aria-label": t("closeEditor"),
												onClick: cancelEditor,
												children: "×"
											})
										]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: HtmlDesignBody_module_css_default.editorScroll,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
											className: HtmlDesignBody_module_css_default.section,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												className: HtmlDesignBody_module_css_default.sectionTitle,
												children: t("content")
											}), editableText === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: HtmlDesignBody_module_css_default.hint,
												children: t("textSelectionHint")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: HtmlDesignBody_module_css_default.field,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: HtmlDesignBody_module_css_default.fieldLabel,
													children: t("textContent")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
													className: HtmlDesignBody_module_css_default.textInput,
													autoFocus: true,
													value: draftText,
													onChange: (event) => {
														setDraftText(event.target.value);
														setFileWrite({
															kind: "idle",
															detail: ""
														});
													}
												})]
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
											className: HtmlDesignBody_module_css_default.section,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												className: HtmlDesignBody_module_css_default.sectionTitle,
												children: t("styles")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: HtmlDesignBody_module_css_default.fields,
												children: STYLE_FIELDS.map((field) => {
													const raw = draftStyle[field.key] ?? "";
													const shown = raw === "" ? computed[field.key] ?? "" : raw;
													const commit = (value) => {
														setDraftStyle((current) => ({
															...current,
															[field.key]: value
														}));
														setFileWrite({
															kind: "idle",
															detail: ""
														});
													};
													if (field.control.kind === "color") {
														const hex = toHexColor(shown);
														return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: HtmlDesignBody_module_css_default.field,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
																className: HtmlDesignBody_module_css_default.fieldLabel,
																htmlFor: `dsh-style-${field.key}`,
																children: t(field.label)
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																className: HtmlDesignBody_module_css_default.colorField,
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																	type: "color",
																	className: HtmlDesignBody_module_css_default.colorSwatch,
																	"aria-label": t(field.label),
																	value: hex,
																	onChange: (event) => commit(event.target.value)
																}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
																	id: `dsh-style-${field.key}`,
																	value: raw,
																	placeholder: hex,
																	spellCheck: false,
																	onChange: (event) => commit(event.target.value.trim())
																})]
															})]
														}, field.key);
													}
													if (field.control.kind === "choice") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: HtmlDesignBody_module_css_default.field,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
															className: HtmlDesignBody_module_css_default.fieldLabel,
															htmlFor: `dsh-style-${field.key}`,
															children: t(field.label)
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
															id: `dsh-style-${field.key}`,
															className: HtmlDesignBody_module_css_default.select,
															value: raw === "" ? "" : raw,
															onChange: (event) => commit(event.target.value),
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: "",
																children: t("inherit")
															}), field.control.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: option,
																children: option
															}, option))]
														})]
													}, field.key);
													const { units, bare } = field.control;
													const { amount, unit } = splitLength(shown, units, bare === true);
													return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: HtmlDesignBody_module_css_default.field,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
															className: HtmlDesignBody_module_css_default.fieldLabel,
															htmlFor: `dsh-style-${field.key}`,
															children: t(field.label)
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: HtmlDesignBody_module_css_default.lengthField,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																id: `dsh-style-${field.key}`,
																type: "number",
																className: HtmlDesignBody_module_css_default.lengthInput,
																value: raw === "" ? "" : splitLength(raw, units, bare === true).amount,
																placeholder: amount,
																onChange: (event) => {
																	const text = event.target.value;
																	commit(text === "" ? "" : joinLength(text, unit));
																}
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
																className: HtmlDesignBody_module_css_default.unitSelect,
																"aria-label": t("unit"),
																value: unit,
																onChange: (event) => {
																	const current = raw === "" ? amount : splitLength(raw, units, bare === true).amount;
																	commit(current === "" ? "" : joinLength(current, event.target.value));
																},
																children: units.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																	value: option,
																	children: option === "" ? t("unitless") : option
																}, option === "" ? "none" : option))
															})]
														})]
													}, field.key);
												})
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
											className: HtmlDesignBody_module_css_default.meta,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("elementType") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
													className: HtmlDesignBody_module_css_default.tagCode,
													children: elementType
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: HtmlDesignBody_module_css_default.metaNote,
													children: displayNote
												})] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("size") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
													Math.round(state.selected.rect.width),
													" × ",
													Math.round(state.selected.rect.height)
												] })
											]
										}),
										traits?.movable === false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: HtmlDesignBody_module_css_default.warn,
											children: t("dragUnavailable")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: HtmlDesignBody_module_css_default.hint,
											children: t("dragHint")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: HtmlDesignBody_module_css_default.hint,
											children: t(rootSelected ? "deleteRootHint" : "deleteHint")
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: HtmlDesignBody_module_css_default.editorFooter,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "ghost",
											size: "sm",
											onClick: resetStyle,
											children: t("resetStyle")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "ghost",
											size: "sm",
											className: HtmlDesignBody_module_css_default.deleteButton,
											disabled: hostPath === void 0 || rootSelected || deleting || fileWrite.kind === "saving",
											onClick: deleteSelection,
											children: deleting ? t("deleting") : t("deleteElement")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: HtmlDesignBody_module_css_default.footerSpace }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "outline",
											size: "sm",
											disabled: deleting,
											onClick: cancelEditor,
											children: t("cancel")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "primary",
											size: "sm",
											disabled: hostPath === void 0 || deleting,
											onClick: saveSelection,
											children: t("save")
										})
									]
								})
							]
						}), window.document.body)]
					})
				]
			});
		}
		/** Post one message into the frame, tolerating a frame that is not mounted yet. */
		function postToFrame(frame, message) {
			frame?.contentWindow?.postMessage({
				channel: CHANNEL,
				...message
			}, "*");
		}
		/** Convert a frame-reported anchor into the stored shape. */
		function toAnchor(anchor) {
			return {
				selector: anchor.selector,
				tag: anchor.tag,
				...anchor.id === void 0 ? {} : { id: anchor.id },
				classes: anchor.classes,
				text: anchor.text,
				rect: anchor.rect
			};
		}
		/** Compare editable declarations without depending on their insertion order. */
		function sameDeclarations(left, right) {
			const leftKeys = Object.keys(left);
			return leftKeys.length === Object.keys(right).length && leftKeys.every((key) => left[key] === right[key]);
		}
		/** Ignore blank draft fields before comparing or persisting style edits. */
		function cleanDeclarations(draft) {
			return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value.length > 0));
		}
		/** Remove a selector's edit from the sidecar when the user saves cleared style fields. */
		function withoutEdit(document, selector, hostPath) {
			const base = document ?? emptyFor(hostPath);
			return {
				...base,
				edits: base.edits.filter((edit) => edit.selector !== selector),
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		/** An empty review document for a resolved file. */
		function emptyFor(hostPath) {
			return {
				version: 1,
				file: hostPath,
				comments: [],
				edits: [],
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		/** Locale key for a mode's label. */
		function modeLabel(mode, t) {
			switch (mode) {
				case "browse": return t("modeBrowse");
				case "inspect": return t("modeInspect");
			}
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Copy for the Sidebar HTML design preview.
		*
		* Every product-visible string the preview renders lives here; components read
		* them through the slot's `t` seat. Values are plain strings because the locale
		* dictionary contract is `Record<key, string>`.
		*
		* @module @guowenzhang/dsh-web-design/client/locales
		*/
		/** Copy namespace of this preview. */
		const NS = "sidebarWebDesign";
		/** Simplified Chinese copy. */
		const zh = {
			title: "网页设计预览",
			editElement: "编辑元素",
			elementTag: "HTML 标签",
			elementLocator: "定位",
			selectParent: "父级",
			selectParentHint: "选中当前元素的外层区块；可连续点击向上定位",
			closeEditor: "关闭编辑弹窗",
			content: "内容",
			cancel: "取消",
			save: "保存",
			deleteElement: "删除元素",
			deleteHint: "删除会移除所选元素及其内部所有内容。保存到文件后才会改动 HTML。",
			deleteRootHint: "页面结构元素不可删除。请选择页面内的具体区块。",
			deleting: "正在删除…",
			deleteFailed: "无法删除所选元素",
			undo: "撤销",
			undoHint: "撤销上一步修改（Command+Z）",
			redo: "重做",
			redoHint: "重做（Command+Shift+Z）",
			modes: "预览工具",
			loading: "正在打开预览…",
			failed: "无法渲染这个 HTML 文件。",
			frame: "网页设计预览",
			modeBrowse: "预览",
			modeInspect: "编辑",
			editGestureHint: "单击选中元素，双击打开编辑弹窗",
			reload: "重新加载",
			saveToFile: "保存到文件",
			saveToFileHint: "把样式与文本修改写入这个 HTML 文件本身",
			fileSaved: "已写入文件。",
			filePartial: "部分修改未能定位",
			saving: "正在保存…",
			saved: "已保存",
			unsaved: "未保存",
			saveFailed: "保存失败",
			size: "尺寸",
			textContent: "文本内容",
			copyLocator: "复制",
			copyLocatorHint: "复制当前元素的 CSS 定位到剪贴板",
			locatorCopied: "已复制",
			locatorCopyFailed: "复制失败",
			textSelectionHint: "此元素没有唯一的直属文字。请双击具体的文字元素。",
			dragHint: "拖动选中框的手柄可以移动元素；拖动四角或四边可以调整大小。",
			dragHandle: "拖动选中元素",
			resizeHandle: "调整元素大小",
			fontSize: "字号",
			fontWeight: "字重",
			lineHeight: "行高",
			letterSpacing: "字距",
			color: "文字颜色",
			background: "背景色",
			padding: "内边距",
			margin: "外边距",
			borderRadius: "圆角",
			resetStyle: "重置",
			styles: "样式修改",
			width: "宽度",
			height: "高度",
			inherit: "默认",
			unit: "单位",
			unitless: "倍数",
			elementType: "元素类型",
			typeInteractive: "可交互元素",
			typeBlock: "内容区块",
			displayLabel: "布局：",
			notResizable: "不可调整大小",
			dragUnavailable: "这个元素无法这样移动：可能带有 !important，或使用了无法识别的位移值。",
			handleUnavailable: "所选元素不支持这个操作"
		};
		/** English copy. */
		const en = {
			title: "Web design preview",
			editElement: "Edit element",
			elementTag: "HTML tag",
			elementLocator: "Selector",
			selectParent: "Parent",
			selectParentHint: "Select the containing element; click again to move up",
			closeEditor: "Close edit dialog",
			content: "Content",
			cancel: "Cancel",
			save: "Save",
			deleteElement: "Delete element",
			deleteHint: "Deleting removes the selected element and everything inside it. Save to file to change the HTML.",
			deleteRootHint: "Page structure elements cannot be deleted. Select a block inside the page.",
			deleting: "Deleting…",
			deleteFailed: "Could not delete the selected element",
			undo: "Undo",
			undoHint: "Undo the last change (Command+Z)",
			redo: "Redo",
			redoHint: "Redo (Command+Shift+Z)",
			modes: "Preview tools",
			loading: "Opening preview…",
			failed: "This HTML file could not be rendered.",
			frame: "Web design preview",
			modeBrowse: "Preview",
			modeInspect: "Edit",
			editGestureHint: "Click to select an element; double-click to open the editor",
			reload: "Reload",
			saveToFile: "Save to file",
			saveToFileHint: "Write the style and text edits into this HTML file",
			fileSaved: "Written to the file.",
			filePartial: "Some edits could not be located",
			saving: "Saving…",
			saved: "Saved",
			unsaved: "Unsaved",
			saveFailed: "Save failed",
			size: "Size",
			textContent: "Text content",
			copyLocator: "Copy",
			copyLocatorHint: "Copy this element’s CSS selector to the clipboard",
			locatorCopied: "Copied",
			locatorCopyFailed: "Copy failed",
			textSelectionHint: "This element has no unique direct text. Double-click the exact text element instead.",
			dragHint: "Drag the outline handle to move the element; drag a corner or edge to resize it.",
			dragHandle: "Drag selected element",
			resizeHandle: "Resize selected element",
			fontSize: "Font size",
			fontWeight: "Font weight",
			lineHeight: "Line height",
			letterSpacing: "Letter spacing",
			color: "Text color",
			background: "Background",
			padding: "Padding",
			margin: "Margin",
			borderRadius: "Corner radius",
			resetStyle: "Reset",
			styles: "Style edits",
			width: "Width",
			height: "Height",
			inherit: "Default",
			unit: "Unit",
			unitless: "Ratio",
			elementType: "Element type",
			typeInteractive: "Interactive element",
			typeBlock: "Content block",
			displayLabel: "Layout:",
			notResizable: "not resizable",
			dragUnavailable: "This element cannot be moved that way: it may use !important, or a position value that cannot be read.",
			handleUnavailable: "The selected element does not support that action"
		};
		//#endregion
		//#region src/client/index.ts
		/** Implementation identity, shared by the registry entry and the keyed slot. */
		const HTML_DESIGN_ID = "@guowenzhang/dsh-web-design/html";
		/** Required browser services: the slot registry, the document registry, copy, and the Remote. */
		const inject = [
			"slots",
			"locale",
			"documentPreviews",
			"remote"
		];
		/** Unwrap a Typert `RemoteResult` or surface the Host failure. */
		async function unwrapRemote(call) {
			const result = await call();
			if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
			return result.value;
		}
		/**
		* Mount the review Remote, register the dictionary, the document metadata, and
		* the preview body.
		* @param ctx - client root context carrying the registries and copy.
		* @returns once every registration is installed.
		*/
		async function apply(ctx) {
			const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE);
			ctx.effect(() => () => disposeMount(), "dsh-web-design: remote mount");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-web-design: dictionaries");
			const t = ctx.locale.bind(NS);
			const namespace = () => {
				const mounted = ctx.get(`remote.${REMOTE_NAMESPACE}`);
				if (mounted === void 0) throw new Error(`${REMOTE_NAMESPACE} namespace service is not mounted`);
				return mounted;
			};
			ctx.effect(() => ctx.documentPreviews.register({
				id: HTML_DESIGN_ID,
				extensions: ["html", "htm"],
				priority: "extension",
				title: () => t("title"),
				loading: "bytes-complete",
				wrap: false
			}), "dsh-web-design: document metadata");
			const store = createDesignStore("");
			ctx.effect(() => ctx.slots.inject("sidebar.right.tab.document", () => ctx.slots.register({
				name: "sidebar.right.tab.document",
				key: HTML_DESIGN_ID,
				locale: NS,
				store,
				inject: () => ({
					loadReview: async (file) => await unwrapRemote(() => namespace().read({ file })),
					saveReview: async (file, document) => {
						await unwrapRemote(() => namespace().write({
							file,
							document
						}));
					},
					applyToFile: async (request) => await unwrapRemote(() => namespace().apply(request)),
					fileRefOf
				})
			}, HtmlDesignBody)), "dsh-web-design: preview body");
		}
		/**
		* Parse the Session address of one previewed file.
		*
		* The Host uses the Session to resolve a relative path; an absolute address
		* carries no Session and leaves this preview read-only.
		* @param address - the tab's resource address.
		* @returns the Session and path the Host receives, or `undefined`.
		*/
		function fileRefOf(address) {
			const parsed = parseFileAddress(address);
			if (parsed?.scope !== "session") return void 0;
			return {
				sessionId: parsed.sessionId,
				path: parsed.path
			};
		}
		//#endregion
		exports.HTML_DESIGN_ID = HTML_DESIGN_ID;
		exports.NS = NS;
		exports.apply = apply;
		exports.createDesignStore = createDesignStore;
		exports.fileRefOf = fileRefOf;
		exports.inject = inject;
		return module.exports;
	}
});
