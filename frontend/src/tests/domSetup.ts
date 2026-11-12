import { JSDOM } from "jsdom";

export const testDom = new JSDOM(
  "<!doctype html><html><body><div id='root'></div></body></html>",
  { url: "http://localhost:5173/" }
);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(globalThis, "window", {
  value: testDom.window,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "document", {
  value: testDom.window.document,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: testDom.window.navigator,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "HTMLElement", {
  value: testDom.window.HTMLElement,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "HTMLInputElement", {
  value: testDom.window.HTMLInputElement,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "Event", {
  value: testDom.window.Event,
  configurable: true,
  writable: true,
});
