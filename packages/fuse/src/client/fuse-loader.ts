/**
 * Fuse Client Loader (~2 KB)
 *
 * Provides Qwik-style resumability (no hydration, delegated lazy loading)
 * and out-of-order streaming resolution.
 */

interface Signal<T = any> {
  value: T;
}

interface ComponentScope {
  host: HTMLElement;
  sig: Record<string, Signal>;
  props: Record<string, any>;
  chunk: any;
  subscribers: Set<() => void>;
}

const hostScopes = new WeakMap<HTMLElement, ComponentScope>();
const chunkModules = new Map<string, Promise<any>>();

function loadChunk(url: string): Promise<any> {
  let p = chunkModules.get(url);
  if (!p) {
    p = import(/* @vite-ignore */ url);
    chunkModules.set(url, p);
  }
  return p;
}

function parseVal(raw: string | null, type: string): any {
  if (raw === null || raw === undefined) {
    if (type === 'number') return 0;
    if (type === 'boolean') return false;
    return '';
  }
  switch (type) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw === 'true' || raw === '';
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    case 'string':
    default:
      return raw;
  }
}

async function getOrCreateScope(host: HTMLElement): Promise<ComponentScope> {
  let scope = hostScopes.get(host);
  if (scope) return scope;

  const chunkUrl = host.getAttribute('data-fuse-c');
  if (!chunkUrl) throw new Error('Element is not a Fuse host');

  const mod = await loadChunk(chunkUrl);
  const meta = mod.$meta || { signals: [], props: [] };

  const sigs: Record<string, Signal> = {};
  const props: Record<string, any> = {};

  scope = {
    host,
    sig: sigs,
    props,
    chunk: mod,
    subscribers: new Set(),
  };
  hostScopes.set(host, scope);

  // Initialize props
  for (const p of meta.props) {
    const attrName = `data-fuse-p-${p.key}`;
    const raw = host.getAttribute(attrName);
    props[p.name] = parseVal(raw, p.type);
  }

  // Initialize signals with reactive setters
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
          set value(newVal: any) {
            if (val !== newVal) {
              val = newVal;
              updateHostBindings(scope!);
            }
          },
        };
      },
    });
  }

  return scope;
}

function updateHostBindings(scope: ComponentScope) {
  const host = scope.host;
  const boundElements = host.querySelectorAll<HTMLElement>('[data-fuse-b]');
  const allElements = host.hasAttribute('data-fuse-b')
    ? [host, ...Array.from(boundElements)]
    : Array.from(boundElements);

  for (const el of allElements) {
    // Only update elements that belong to this host directly (not nested components)
    if (el !== host && el.closest('[data-fuse-c]') !== host) continue;

    const bAttr = el.getAttribute('data-fuse-b');
    if (!bAttr) continue;

    const pairs = bAttr.split(/\s+/).filter(Boolean);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const target = pair.slice(0, eqIdx);
      const sym = pair.slice(eqIdx + 1);

      const fn = scope.chunk[sym];
      if (typeof fn !== 'function') continue;

      let result: any;
      try {
        result = fn(scope, el);
      } catch (err) {
        console.error(`[fuse] Error evaluating binding ${sym}:`, err);
        continue;
      }

      if (target === 'text') {
        el.textContent = result == null ? '' : String(result);
      } else if (target.startsWith('attr:')) {
        const attrName = target.slice(5);
        if (result === false || result === null || result === undefined) {
          el.removeAttribute(attrName);
        } else if (result === true) {
          el.setAttribute(attrName, '');
        } else {
          el.setAttribute(attrName, String(result));
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Event Delegation
// ------------------------------------------------------------------------------------------------

const EVENT_NAMES = [
  'click',
  'dblclick',
  'input',
  'change',
  'submit',
  'keydown',
  'keyup',
  'focusin',
  'focusout',
  'pointerdown',
  'pointerup',
  'mouseover',
  'mouseout',
];

function setupDelegation() {
  for (const ev of EVENT_NAMES) {
    document.addEventListener(
      ev,
      async (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (!target || !(target instanceof Element)) return;

        // Check synchronous preventDefault
        const pdEl = target.closest<HTMLElement>(`[data-fuse-pd-${ev}]`);
        if (pdEl) {
          e.preventDefault();
        }

        // Find elements listening to this event up the DOM tree
        let current: HTMLElement | null = target.closest<HTMLElement>(`[data-fuse-on-${ev}]`);
        while (current) {
          const handlerAttr = current.getAttribute(`data-fuse-on-${ev}`);
          if (handlerAttr) {
            const syms = handlerAttr.split(/\s+/).filter(Boolean);
            const host = current.closest<HTMLElement>('[data-fuse-c]');
            if (host) {
              try {
                const scope = await getOrCreateScope(host);
                for (const sym of syms) {
                  const fn = scope.chunk[sym];
                  if (typeof fn === 'function') {
                    await fn(e, current, scope);
                  }
                }
              } catch (err) {
                console.error(`[fuse] Error in ${ev} handler:`, err);
              }
            }
          }
          current = current.parentElement
            ? current.parentElement.closest<HTMLElement>(`[data-fuse-on-${ev}]`)
            : null;
        }
      },
      { capture: false, passive: false },
    );
  }
}

// ------------------------------------------------------------------------------------------------
// useVisibleTask$ Intersection Observer
// ------------------------------------------------------------------------------------------------

let visibleObserver: IntersectionObserver | null = null;

function setupVisibleTasks() {
  if (typeof IntersectionObserver === 'undefined') return;

  visibleObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const el = entry.target as HTMLElement;
        visibleObserver?.unobserve(el);
        const syms = (el.getAttribute('data-fuse-visible') || '').split(/\s+/).filter(Boolean);
        const host = el.closest<HTMLElement>('[data-fuse-c]');
        if (host && syms.length) {
          getOrCreateScope(host)
            .then((scope) => {
              for (const sym of syms) {
                const fn = scope.chunk[sym];
                if (typeof fn === 'function') {
                  const cleanup = fn(scope, el);
                  if (typeof cleanup === 'function') {
                    scope.subscribers.add(cleanup);
                  }
                }
              }
            })
            .catch((err) => console.error('[fuse] visibleTask failed:', err));
        }
      }
    }
  });

  const observeAll = (root: ParentNode = document) => {
    const els = root.querySelectorAll<HTMLElement>('[data-fuse-visible]');
    for (const el of els) {
      visibleObserver?.observe(el);
    }
  };

  observeAll();

  // Watch for dynamically added elements
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node.hasAttribute('data-fuse-visible')) visibleObserver?.observe(node);
          observeAll(node);
        }
      }
    }
  });
  mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

// ------------------------------------------------------------------------------------------------
// Out-of-Order Streaming Resolution (<fuse-await> swap)
// ------------------------------------------------------------------------------------------------

function swapAwaitBlock(template: HTMLTemplateElement) {
  const id = template.getAttribute('data-fuse-r');
  if (!id) return;

  const isError = template.hasAttribute('data-fuse-error');
  const placeholder = document.getElementById(id);

  if (placeholder && placeholder.tagName.toLowerCase() === 'fuse-await') {
    if (isError) {
      console.warn(`[fuse] Stream block #${id} failed or timed out`);
      placeholder.setAttribute('data-fuse-failed', '');
    } else {
      const content = template.content;
      // Replace fuse-await element with resolved template content
      placeholder.parentNode?.replaceChild(content, placeholder);
    }
  }

  // Remove the consumed template from DOM
  template.remove();
}

function setupStreamingSwap() {
  const processTemplates = () => {
    const templates = document.querySelectorAll<HTMLTemplateElement>('template[data-fuse-r]');
    for (const t of templates) {
      swapAwaitBlock(t);
    }
  };

  processTemplates();

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLTemplateElement && node.hasAttribute('data-fuse-r')) {
          swapAwaitBlock(node);
        } else if (node instanceof HTMLElement) {
          const tpls = node.querySelectorAll<HTMLTemplateElement>('template[data-fuse-r]');
          for (const t of tpls) {
            swapAwaitBlock(t);
          }
        }
      }
    }
  });

  mo.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processTemplates);
  }
}

// Initialize Fuse client runtime
export function initFuse() {
  if (typeof window === 'undefined' || (window as any).__FUSE_LOADED__) return;
  (window as any).__FUSE_LOADED__ = true;

  setupDelegation();
  setupStreamingSwap();
  setupVisibleTasks();
}

initFuse();
