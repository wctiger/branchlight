import "./setup-css";
import { Window } from "happy-dom";
const browser = new Window({ url: "http://localhost" });
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "HTMLPreElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "Node",
  "Element",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "CustomEvent",
  "MutationObserver",
  "DocumentFragment",
  "Document",
  "ShadowRoot",
  "customElements",
  "CSSStyleSheet",
  "IntersectionObserver",
  "DOMRect",
  "NodeFilter",
  "HTMLFormElement",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value:
      key === "window"
        ? browser
        : (browser as unknown as Record<string, unknown>)[key],
  });
}
Object.assign(globalThis, {
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
  matchMedia: browser.matchMedia.bind(browser),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(browser.HTMLElement.prototype, "scrollIntoView", {
  value() {},
  configurable: true,
});
