"use strict";
(() => {
  // ../../packages/fuse/src/client/fuse-loader.ts
  var hostScopes = /* @__PURE__ */ new WeakMap();
  var chunkModules = /* @__PURE__ */ new Map();
  function loadChunk(url) {
    let p = chunkModules.get(url);
    if (!p) {
      p = import(
        /* @vite-ignore */
        url
      );
      chunkModules.set(url, p);
    }
    return p;
  }
  function parseVal(raw, type) {
    if (raw === null || raw === void 0) {
      if (type === "number") return 0;
      if (type === "boolean") return false;
      return "";
    }
    switch (type) {
      case "number":
        return Number(raw);
      case "boolean":
        return raw === "true" || raw === "";
      case "json":
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      case "string":
      default:
        return raw;
    }
  }
  async function getOrCreateScope(host) {
    let scope = hostScopes.get(host);
    if (scope) return scope;
    const chunkUrl = host.getAttribute("data-fuse-c");
    if (!chunkUrl) throw new Error("Element is not a Fuse host");
    const mod = await loadChunk(chunkUrl);
    scope = hostScopes.get(host);
    if (scope) return scope;
    const meta = mod.$meta || { signals: [], props: [] };
    const sigs = {};
    const props = {};
    scope = {
      host,
      sig: sigs,
      props,
      chunk: mod,
      subscribers: /* @__PURE__ */ new Set()
    };
    hostScopes.set(host, scope);
    for (const p of meta.props) {
      const attrName = `data-fuse-p-${p.key}`;
      const raw = host.getAttribute(attrName);
      props[p.name] = parseVal(raw, p.type);
    }
    for (const s of meta.signals) {
      const attrName = `data-fuse-s-${s.key}`;
      const raw = host.getAttribute(attrName);
      let val = parseVal(raw, s.type);
      Object.defineProperty(sigs, s.name, {
        enumerable: true,
        get() {
          return {
            get value() {
              return val;
            },
            set value(newVal) {
              if (val !== newVal) {
                val = newVal;
                updateHostBindings(scope);
              }
            }
          };
        }
      });
    }
    return scope;
  }
  function updateHostBindings(scope) {
    const host = scope.host;
    const boundElements = host.querySelectorAll("[data-fuse-b]");
    const allElements = host.hasAttribute("data-fuse-b") ? [host, ...Array.from(boundElements)] : Array.from(boundElements);
    for (const el of allElements) {
      if (el !== host && el.closest("[data-fuse-c]") !== host) continue;
      const bAttr = el.getAttribute("data-fuse-b");
      if (!bAttr) continue;
      const pairs = bAttr.split(/\s+/).filter(Boolean);
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx === -1) continue;
        const target = pair.slice(0, eqIdx);
        const sym = pair.slice(eqIdx + 1);
        const fn = scope.chunk[sym];
        if (typeof fn !== "function") continue;
        let result;
        try {
          result = fn(scope, el);
        } catch (err) {
          console.error(`[fuse] Error evaluating binding ${sym}:`, err);
          continue;
        }
        if (target === "text") {
          el.textContent = result == null ? "" : String(result);
        } else if (target.startsWith("attr:")) {
          const attrName = target.slice(5);
          if (result === false || result === null || result === void 0) {
            el.removeAttribute(attrName);
          } else if (result === true) {
            el.setAttribute(attrName, "");
          } else {
            el.setAttribute(attrName, String(result));
          }
        }
      }
    }
  }
  var EVENT_NAMES = [
    "click",
    "dblclick",
    "input",
    "change",
    "submit",
    "keydown",
    "keyup",
    "focusin",
    "focusout",
    "pointerdown",
    "pointerup",
    "mouseover",
    "mouseout"
  ];
  function setupDelegation() {
    for (const ev of EVENT_NAMES) {
      document.addEventListener(
        ev,
        async (e) => {
          const target = e.target;
          if (!target || !(target instanceof Element)) return;
          const pdEl = target.closest(`[data-fuse-pd-${ev}]`);
          if (pdEl) {
            e.preventDefault();
          }
          let current = target.closest(`[data-fuse-on-${ev}]`);
          while (current) {
            const handlerAttr = current.getAttribute(`data-fuse-on-${ev}`);
            if (handlerAttr) {
              const syms = handlerAttr.split(/\s+/).filter(Boolean);
              const host = current.closest("[data-fuse-c]");
              if (host) {
                try {
                  const scope = await getOrCreateScope(host);
                  for (const sym of syms) {
                    const fn = scope.chunk[sym];
                    if (typeof fn === "function") {
                      await fn(e, current, scope);
                    }
                  }
                } catch (err) {
                  console.error(`[fuse] Error in ${ev} handler:`, err);
                }
              }
            }
            current = current.parentElement ? current.parentElement.closest(`[data-fuse-on-${ev}]`) : null;
          }
        },
        { capture: false, passive: false }
      );
    }
  }
  var visibleObserver = null;
  function setupVisibleTasks() {
    if (typeof IntersectionObserver === "undefined") return;
    visibleObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target;
          visibleObserver?.unobserve(el);
          const syms = (el.getAttribute("data-fuse-visible") || "").split(/\s+/).filter(Boolean);
          const host = el.closest("[data-fuse-c]");
          if (host && syms.length) {
            getOrCreateScope(host).then((scope) => {
              for (const sym of syms) {
                const fn = scope.chunk[sym];
                if (typeof fn === "function") {
                  const cleanup = fn(scope, el);
                  if (typeof cleanup === "function") {
                    scope.subscribers.add(cleanup);
                  }
                }
              }
            }).catch((err) => console.error("[fuse] visibleTask failed:", err));
          }
        }
      }
    });
    const observeAll = (root = document) => {
      const els = root.querySelectorAll("[data-fuse-visible]");
      for (const el of els) {
        visibleObserver?.observe(el);
      }
    };
    observeAll();
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.hasAttribute("data-fuse-visible")) visibleObserver?.observe(node);
            observeAll(node);
          }
        }
      }
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  function swapAwaitBlock(template) {
    const id = template.getAttribute("data-fuse-r");
    if (!id) return false;
    const isError = template.hasAttribute("data-fuse-error");
    const placeholder = document.getElementById(id);
    if (!placeholder || placeholder.tagName.toLowerCase() !== "fuse-await") return false;
    if (isError) {
      console.warn(`[fuse] Stream block #${id} failed or timed out`);
      placeholder.setAttribute("data-fuse-failed", "");
    } else {
      placeholder.replaceWith(template.content);
    }
    template.remove();
    return true;
  }
  function setupStreamingSwap() {
    const completed = /* @__PURE__ */ new Set();
    const processTemplates = () => {
      for (const marker of document.querySelectorAll("template[data-fuse-ready]")) {
        const id = marker.getAttribute("data-fuse-ready");
        if (id) completed.add(id);
        marker.remove();
      }
      let changed;
      do {
        changed = false;
        for (const template of document.querySelectorAll("template[data-fuse-r]")) {
          const id = template.getAttribute("data-fuse-r");
          if ((completed.has(id) || document.readyState !== "loading") && swapAwaitBlock(template)) {
            completed.delete(id);
            changed = true;
          }
        }
      } while (changed);
    };
    const mo = new MutationObserver(processTemplates);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    processTemplates();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", processTemplates);
    }
  }
  function initFuse() {
    if (typeof window === "undefined" || window.__FUSE_LOADED__) return;
    window.__FUSE_LOADED__ = true;
    setupDelegation();
    setupStreamingSwap();
    setupVisibleTasks();
  }
  initFuse();
})();
