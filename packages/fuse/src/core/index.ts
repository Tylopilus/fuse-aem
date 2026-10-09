/**
 * Fuse – public authoring API.
 *
 * Everything exported here is used inside `*.tsx` component files. Note that the
 * component function body is **never executed** – neither on the server nor in the
 * browser. The Fuse compiler statically analyses it and turns it into:
 *
 *  - an HTL script (rendered by AEM),
 *  - a Touch UI dialog (from `schema`),
 *  - a generated Java Sling Model (`<Name>Props`),
 *  - lazily loaded client chunks for `$`-suffixed handlers (resumability, no hydration).
 *
 * The runtime implementations below only exist so that schema evaluation and
 * type-checking work; calling the hooks at runtime throws.
 */

/* ------------------------------------------------------------------------------------------------
 * Dialog schema
 * --------------------------------------------------------------------------------------------- */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'path'
  | 'link'
  | 'image'
  | 'multifield';

export interface BaseField<K extends FieldKind, T> {
  kind: K;
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: T;
  /** Phantom – carries the TypeScript value type of the field. */
  readonly __type?: T;
}

export type TextField = BaseField<'text', string> & { maxLength?: number };
export type TextareaField = BaseField<'textarea', string>;
export type RichtextField = BaseField<'richtext', string>;
export type NumberField = BaseField<'number', number> & { min?: number; max?: number; step?: number };
export type CheckboxField = BaseField<'checkbox', boolean>;
export type SelectField<O extends string = string> = BaseField<'select', O> & { options: Record<O, string> };
export type PathField = BaseField<'path', string> & { root?: string };
export type LinkField = BaseField<'link', string> & { root?: string };
export type ImageField = BaseField<'image', string> & { root?: string };
export type MultifieldField<F extends Fields = Fields> = BaseField<'multifield', PropsOfFields<F>[]> & {
  fields: F;
};

export type Field =
  | TextField
  | TextareaField
  | RichtextField
  | NumberField
  | CheckboxField
  | SelectField<any>
  | PathField
  | LinkField
  | ImageField
  | MultifieldField<any>;

export type Fields = Record<string, Field>;

export type FieldValue<F> = F extends MultifieldField<infer Sub>
  ? PropsOfFields<Sub>[]
  : F extends SelectField<infer O>
    ? O
    : F extends BaseField<any, infer T>
      ? T
      : never;

export type PropsOfFields<F extends Fields> = { readonly [K in keyof F]: FieldValue<F[K]> };

type Opts<F> = Omit<F, 'kind' | '__type'>;

/** Field builders – each call produces a plain, serialisable description. */
export const field = {
  text: (o: Opts<TextField> = {}): TextField => ({ kind: 'text', ...o }),
  textarea: (o: Opts<TextareaField> = {}): TextareaField => ({ kind: 'textarea', ...o }),
  richtext: (o: Opts<RichtextField> = {}): RichtextField => ({ kind: 'richtext', ...o }),
  number: (o: Opts<NumberField> = {}): NumberField => ({ kind: 'number', ...o }),
  checkbox: (o: Opts<CheckboxField> = {}): CheckboxField => ({ kind: 'checkbox', ...o }),
  select: <O extends string>(o: Opts<SelectField<O>>): SelectField<O> => ({ kind: 'select', ...o }),
  path: (o: Opts<PathField> = {}): PathField => ({ kind: 'path', ...o }),
  link: (o: Opts<LinkField> = {}): LinkField => ({ kind: 'link', ...o }),
  image: (o: Opts<ImageField> = {}): ImageField => ({ kind: 'image', ...o }),
  multifield: <F extends Fields>(o: Opts<MultifieldField<F>>): MultifieldField<F> => ({ kind: 'multifield', ...o }),
};

export interface DialogDefinition<F extends Fields> {
  /** `jcr:title` of the component and the dialog. */
  title: string;
  /** `componentGroup` – shown in the editor's component browser. */
  group?: string;
  description?: string;
  fields: F;
}

export interface Schema<F extends Fields = Fields> extends DialogDefinition<F> {
  readonly __fuse: 'schema';
}

/** Declares the authoring dialog of a component. Must be exported as `schema`. */
export function dialog<F extends Fields>(def: DialogDefinition<F>): Schema<F> {
  return { __fuse: 'schema', ...def };
}

export type PropsOf<S> = S extends Schema<infer F> ? PropsOfFields<F> : S extends Record<string, any> ? S : {};

/* ------------------------------------------------------------------------------------------------
 * Components
 * --------------------------------------------------------------------------------------------- */

export type JSXChild = JSX.Element | string | number | boolean | null | undefined | JSXChild[];

export interface ComponentContext<P, M> {
  /** Dialog values (typed from `schema`) – rendered by AEM through the generated `*Props` Sling Model. */
  props: P;
  /** Getters of the co-located `<Name>Model.java` (types generated from the Java source). */
  model: M;
}

export interface FuseComponent<P = any> {
  readonly __fuse: 'component';
  /** Only for use as a JSX tag (partials) or as `type` of `<Include>`. */
  (props: P): JSX.Element;
}

/**
 * Declares a component. The first type argument is either `typeof schema` (an authorable
 * AEM component) or a plain props type (a *partial* that compiles to an HTL template).
 */
export function component$<S = {}, M = {}>(
  _render: (ctx: ComponentContext<PropsOf<S>, M>) => JSX.Element,
): FuseComponent<PropsOf<S>> {
  const c = (() => {
    throw new Error('Fuse components are compiled to HTL and cannot be called at runtime.');
  }) as unknown as FuseComponent<PropsOf<S>>;
  (c as any).__fuse = 'component';
  return c;
}

/* ------------------------------------------------------------------------------------------------
 * Hooks (compiled away)
 * --------------------------------------------------------------------------------------------- */

export interface Signal<T> {
  value: T;
}

function compiledAway(name: string): never {
  throw new Error(`${name}() is compiled by Fuse and must only be used inside component$().`);
}

/** Reactive state. The initial value is rendered by AEM; the browser resumes from the HTML. */
export function useSignal<T>(_initial: T): Signal<T> {
  return compiledAway('useSignal');
}

/** Registers component CSS. Collected into the `clientlib-fuse` CSS at build time. */
export function useStyles$(_css: string): void {
  return compiledAway('useStyles$');
}

/** Runs in the browser once the component's root element becomes visible. May return a cleanup function. */
export function useVisibleTask$(_task: () => void | (() => void)): void {
  return compiledAway('useVisibleTask$');
}

/** Marks a function as a lazily loaded client symbol (like Qwik's `$()`). */
export function $<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}

/** Tagged template helper for CSS – only for editor syntax highlighting. */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), '');
}

/* ------------------------------------------------------------------------------------------------
 * Built-in elements (compiled away)
 * --------------------------------------------------------------------------------------------- */

/**
 * Out-of-order streaming boundary. `value` is a model getter returning a `CompletableFuture`.
 * AEM renders `fallback` immediately, flushes the page and streams the resolved block later.
 */
export function Await<T>(_props: {
  value: Promise<T> | T;
  fallback?: JSX.Element;
  children: (value: T) => JSX.Element;
}): JSX.Element {
  return compiledAway('Await');
}

/** An authorable container (parsys) stored in the child node `name`. */
export function Container(_props: { name: string; class?: string; resourceType?: string }): JSX.Element {
  return compiledAway('Container');
}

/** Includes a child component resource of a fixed type, stored in the child node `name`. */
export function Include(_props: { name: string; type: FuseComponent<any> | string }): JSX.Element {
  return compiledAway('Include');
}

export type { JSX } from './jsx-runtime.js';
import type { JSX } from './jsx-runtime.js';
