/**
 * JSX typings for Fuse components (`"jsxImportSource": "@fuse-aem/fuse"`).
 *
 * The runtime functions exist only so that component modules can be imported for schema
 * evaluation; JSX is compiled to HTL by the Fuse compiler and never executed.
 */

type EventHandler$<E extends Event = Event> = (event: E, element: HTMLElement) => void | Promise<void>;

type Booleanish = boolean | 'true' | 'false';

type ClassValue = string | undefined | null | false | Record<string, unknown> | ClassValue[];

interface FuseAttributes {
  class?: ClassValue;
  className?: ClassValue;
  style?: string;
  id?: string;
  title?: string;
  role?: string;
  hidden?: boolean;
  tabIndex?: number | string;
  /** Inner HTML – rendered with HTL `context='html'` (XSS-filtered by AEM). */
  html?: string;
  dangerouslySetInnerHTML?: { __html: string };
  key?: string | number;
  children?: any;

  onClick$?: EventHandler$<MouseEvent>;
  onDblClick$?: EventHandler$<MouseEvent>;
  onInput$?: EventHandler$<InputEvent>;
  onChange$?: EventHandler$<Event>;
  onSubmit$?: EventHandler$<SubmitEvent>;
  onKeyDown$?: EventHandler$<KeyboardEvent>;
  onKeyUp$?: EventHandler$<KeyboardEvent>;
  onFocusIn$?: EventHandler$<FocusEvent>;
  onFocusOut$?: EventHandler$<FocusEvent>;
  onPointerDown$?: EventHandler$<PointerEvent>;
  onPointerUp$?: EventHandler$<PointerEvent>;
  onMouseOver$?: EventHandler$<MouseEvent>;
  onMouseOut$?: EventHandler$<MouseEvent>;

  [attr: `aria-${string}`]: string | number | Booleanish | undefined;
  [attr: `data-${string}`]: string | number | boolean | undefined;
  [attr: `preventdefault:${string}`]: boolean | undefined;
}

type AnyAttributes = FuseAttributes & { [attr: string]: any };

export namespace JSX {
  export type Element = { readonly __fuseJsx: true };
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicAttributes {
    key?: string | number;
  }
  export type IntrinsicElements = { [tag: string]: AnyAttributes };
}

const make = (type: unknown, props: unknown) => ({ __fuseJsx: true, type, props }) as unknown as JSX.Element;

export const jsx = make;
export const jsxs = make;
export const jsxDEV = make;
export const Fragment = Symbol.for('fuse.fragment');
