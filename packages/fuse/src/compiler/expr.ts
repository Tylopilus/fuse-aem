import ts from 'typescript';
import { FuseCompileError, htlString, unwrap } from './util.js';

/* ------------------------------------------------------------------------------------------------
 * Scope model
 * --------------------------------------------------------------------------------------------- */

export type ClientType = 'string' | 'number' | 'boolean' | 'json';

export interface FieldJson {
  kind: string;
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Record<string, string>;
  root?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  fields?: Record<string, FieldJson>;
}

export interface SignalInfo {
  name: string;
  /** kebab-case attribute key */
  key: string;
  /** HTL variable that holds the initial value */
  htl: string | null;
  type: ClientType;
  /** compile-time constant initial value (if the initialiser is a literal) */
  literal?: { value: unknown };
  /** HTL expression of the initialiser */
  initHtl: string | null;
}

export type ScopeVar =
  | { kind: 'props'; fields: Record<string, FieldJson> | null; htl: string }
  | { kind: 'model'; types: Record<string, ClientType>; htl: string }
  | { kind: 'signal'; signal: SignalInfo }
  | { kind: 'item'; htl: string; fields: Record<string, FieldJson> | null }
  | { kind: 'index'; htl: string }
  | { kind: 'value'; htl: string }
  /** a partial's own props – each prop becomes an HTL template parameter */
  | { kind: 'params'; used: Set<string> };

export class Scope {
  private vars = new Map<string, ScopeVar>();
  constructor(private parent?: Scope) {}
  set(name: string, v: ScopeVar): this {
    this.vars.set(name, v);
    return this;
  }
  get(name: string): ScopeVar | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }
  child(): Scope {
    return new Scope(this);
  }
  /** true if `name` was declared inside a loop scope (= needs capturing for client code). */
  entries(): [string, ScopeVar][] {
    const all = new Map<string, ScopeVar>(this.parent ? this.parent.entries() : []);
    this.vars.forEach((v, k) => all.set(k, v));
    return [...all];
  }
}

/* ------------------------------------------------------------------------------------------------
 * JS → HTL expression translation
 * --------------------------------------------------------------------------------------------- */

export interface HtlExpr {
  /** HTL expression source (without `${}`) */
  code: string;
  /** depends on a signal → needs a client binding */
  reactive: boolean;
  /** statically known to be boolean */
  bool: boolean;
  /** contains top-level options (`@ format=…`) – cannot be combined further */
  options?: boolean;
  /** `x.length` – resolved by the parent (HTL treats empty collections as falsy) */
  lengthOf?: boolean;
  /** precedence class used for parenthesising */
  atom: boolean;
}

const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
]);

const COMPARISON: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '==',
  [ts.SyntaxKind.EqualsEqualsToken]: '==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '!=',
  [ts.SyntaxKind.ExclamationEqualsToken]: '!=',
  [ts.SyntaxKind.LessThanToken]: '<',
  [ts.SyntaxKind.LessThanEqualsToken]: '<=',
  [ts.SyntaxKind.GreaterThanToken]: '>',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
};

const paren = (e: HtlExpr): string => (e.atom ? e.code : `(${e.code})`);

export interface TranslateOptions {
  /** allow top-level template literals (`@ format`) */
  allowFormat?: boolean;
  /** boolean test position (`data-sly-test`) */
  test?: boolean;
}

export function toHtl(node: ts.Expression, scope: Scope, opts: TranslateOptions = {}): HtlExpr {
  const r = translate(node, scope, opts, true);
  if (r.lengthOf) {
    if (opts.test) return { ...r, lengthOf: false, bool: true };
    throw FuseCompileError.at(
      node,
      'HTL cannot read `.length`. Use the collection itself in conditions (empty collections are falsy in HTL) or expose a getter from the Java model.',
    );
  }
  return r;
}

function translate(node: ts.Expression, scope: Scope, opts: TranslateOptions, top: boolean): HtlExpr {
  const n = unwrap(node);
  const wasParen = n !== node && ts.isParenthesizedExpression(node);

  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
    return { code: htlString(n.text), reactive: false, bool: false, atom: true };
  }
  if (ts.isNumericLiteral(n)) return { code: n.text, reactive: false, bool: false, atom: true };
  if (n.kind === ts.SyntaxKind.TrueKeyword) return { code: 'true', reactive: false, bool: true, atom: true };
  if (n.kind === ts.SyntaxKind.FalseKeyword) return { code: 'false', reactive: false, bool: true, atom: true };
  if (n.kind === ts.SyntaxKind.NullKeyword) return { code: "''", reactive: false, bool: false, atom: true };

  if (ts.isPrefixUnaryExpression(n)) {
    if (n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) {
      return { code: `-${n.operand.text}`, reactive: false, bool: false, atom: true };
    }
    if (n.operator === ts.SyntaxKind.ExclamationToken) {
      const inner = translate(n.operand, scope, opts, false);
      const code = inner.lengthOf ? `!${paren(inner)}` : `!${paren(inner)}`;
      return { code, reactive: inner.reactive, bool: true, atom: true };
    }
    throw FuseCompileError.at(n, `Operator "${ts.tokenToString(n.operator)}" is not supported in HTL expressions.`);
  }

  if (ts.isIdentifier(n)) {
    if (n.text === 'undefined') return { code: "''", reactive: false, bool: false, atom: true };
    const v = scope.get(n.text);
    if (!v) {
      throw FuseCompileError.at(
        n,
        `Unknown identifier "${n.text}". Templates can only reference props, model, signals, loop variables and <Await> values – move other logic into the Java model.`,
      );
    }
    switch (v.kind) {
      case 'item':
      case 'value':
      case 'index':
        return { code: v.htl, reactive: false, bool: false, atom: true };
      case 'signal':
        throw FuseCompileError.at(n, `Use "${n.text}.value" to read a signal.`);
      case 'props':
      case 'model':
      case 'params':
        throw FuseCompileError.at(n, `"${n.text}" must be accessed with a property, e.g. ${n.text}.title.`);
    }
  }

  if (ts.isPropertyAccessExpression(n)) {
    const name = n.name.text;
    const base = unwrap(n.expression);
    if (ts.isIdentifier(base)) {
      const v = scope.get(base.text);
      if (v?.kind === 'signal' && name === 'value') {
        const s = v.signal;
        if (!s.htl) {
          throw FuseCompileError.at(
            n,
            `Signal "${s.name}" has no server-side initial value (only literals and props/model values can be rendered by HTL).`,
          );
        }
        return { code: s.htl, reactive: true, bool: s.type === 'boolean', atom: true };
      }
      if (v?.kind === 'props') {
        const f = v.fields?.[name];
        if (v.fields && !f) throw FuseCompileError.at(n.name, `"${name}" is not a field of the component schema.`);
        return { code: `${v.htl}.${name}`, reactive: false, bool: f?.kind === 'checkbox', atom: true };
      }
      if (v?.kind === 'params') {
        v.used.add(name);
        return { code: name, reactive: false, bool: false, atom: true };
      }
      if (v?.kind === 'model') {
        return { code: `${v.htl}.${name}`, reactive: false, bool: v.types[name] === 'boolean', atom: true };
      }
      if (v?.kind === 'item' && v.fields) {
        const f = v.fields[name];
        return { code: `${v.htl}.${name}`, reactive: false, bool: f?.kind === 'checkbox', atom: true };
      }
    }
    if (name === 'length') {
      const inner = translate(n.expression, scope, opts, false);
      return { ...inner, lengthOf: true };
    }
    const inner = translate(n.expression, scope, opts, false);
    if (inner.options) throw FuseCompileError.at(n, 'Template literals cannot be nested in other expressions.');
    return { code: `${paren(inner)}.${name}`, reactive: inner.reactive, bool: false, atom: true };
  }

  if (ts.isElementAccessExpression(n)) {
    const obj = translate(n.expression, scope, opts, false);
    const idx = translate(n.argumentExpression, scope, opts, false);
    return { code: `${paren(obj)}[${idx.code}]`, reactive: obj.reactive || idx.reactive, bool: false, atom: true };
  }

  if (ts.isBinaryExpression(n)) {
    const op = n.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      const l = translate(n.left, scope, { ...opts, test: true }, false);
      const r = translate(n.right, scope, { ...opts, test: opts.test }, false);
      const lc = l.lengthOf ? paren(l) : paren(l);
      if (r.lengthOf && !opts.test) throw FuseCompileError.at(n.right, 'HTL cannot read `.length`.');
      return {
        code: `${lc} ${op === ts.SyntaxKind.AmpersandAmpersandToken ? '&&' : '||'} ${paren(r)}`,
        reactive: l.reactive || r.reactive,
        bool: l.bool && r.bool,
        atom: false,
      };
    }
    const cmp = COMPARISON[op];
    if (cmp) {
      const l = translate(n.left, scope, opts, false);
      const r = translate(n.right, scope, opts, false);
      // `items.length > 0`, `items.length !== 0` → `items` (HTL: empty collections are falsy)
      if (l.lengthOf && ts.isNumericLiteral(unwrap(n.right)) && (unwrap(n.right) as ts.NumericLiteral).text === '0') {
        if (cmp === '>' || cmp === '!=') return { code: paren(l), reactive: l.reactive, bool: true, atom: l.atom };
        if (cmp === '==') return { code: `!${paren(l)}`, reactive: l.reactive, bool: true, atom: true };
      }
      if (l.lengthOf || r.lengthOf) throw FuseCompileError.at(n, 'HTL cannot compare `.length` (only `> 0`, `!== 0` and `=== 0`).');
      return { code: `${paren(l)} ${cmp} ${paren(r)}`, reactive: l.reactive || r.reactive, bool: true, atom: false };
    }
    if (op === ts.SyntaxKind.InKeyword) {
      const l = translate(n.left, scope, opts, false);
      const r = translate(n.right, scope, opts, false);
      return { code: `${paren(l)} in ${paren(r)}`, reactive: l.reactive || r.reactive, bool: true, atom: false };
    }
    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      const l = translate(n.left, scope, opts, false);
      const r = translate(n.right, scope, opts, false);
      return { code: `${paren(l)} || ${paren(r)}`, reactive: l.reactive || r.reactive, bool: false, atom: false };
    }
    if (ARITHMETIC.has(op)) {
      throw FuseCompileError.at(
        n,
        op === ts.SyntaxKind.PlusToken
          ? 'HTL has no string concatenation – use a template literal (`a ${b}`) or compute the value in the Java model.'
          : 'HTL has no arithmetic – compute the value in the Java model (or keep it client-side in a signal handler).',
      );
    }
    throw FuseCompileError.at(n, `Operator "${n.operatorToken.getText()}" is not supported in HTL expressions.`);
  }

  if (ts.isConditionalExpression(n)) {
    const c = translate(n.condition, scope, { ...opts, test: true }, false);
    const a = translate(n.whenTrue, scope, opts, false);
    const b = translate(n.whenFalse, scope, opts, false);
    if (a.options || b.options) throw FuseCompileError.at(n, 'Template literals cannot be used inside a ternary in HTL.');
    return {
      code: `${paren(c)} ? ${paren(a)} : ${paren(b)}`,
      reactive: c.reactive || a.reactive || b.reactive,
      bool: a.bool && b.bool,
      atom: false,
    };
  }

  if (ts.isTemplateExpression(n)) {
    if (!top || !opts.allowFormat) {
      throw FuseCompileError.at(n, 'Template literals are only supported as a complete attribute value or text expression.');
    }
    let pattern = n.head.text;
    const args: HtlExpr[] = [];
    n.templateSpans.forEach((span, i) => {
      args.push(translate(span.expression, scope, opts, false));
      pattern += `{${i}}` + span.literal.text;
    });
    return {
      code: `${htlString(pattern)} @ format=[${args.map((a) => a.code).join(', ')}]`,
      reactive: args.some((a) => a.reactive),
      bool: false,
      options: true,
      atom: false,
    };
  }

  if (ts.isCallExpression(n)) {
    throw FuseCompileError.at(
      n,
      'Function calls cannot be rendered by HTL. Move the logic into a getter of the co-located Java model and reference it via `model`.',
    );
  }

  if (wasParen) return translate(n, scope, opts, top);
  throw FuseCompileError.at(n, `Unsupported expression in template (${ts.SyntaxKind[n.kind]}).`);
}

/* ------------------------------------------------------------------------------------------------
 * Free-variable analysis for client code ($-handlers, bindings)
 * --------------------------------------------------------------------------------------------- */

export interface ClientRefs {
  signals: Set<string>;
  /** local name of props/model alias → accessed first-level property names */
  props: Map<string, Set<string>>;
  /** loop variable → accessed property paths ('' = the variable itself) */
  loop: Map<string, Set<string>>;
}

/** Collects references to component-scope variables inside a client function / expression. */
export function collectClientRefs(node: ts.Node, scope: Scope): ClientRefs {
  const refs: ClientRefs = { signals: new Set(), props: new Map(), loop: new Map() };
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      // only the left-most identifier is a reference
      const chain: string[] = [];
      let cur: ts.Expression = n;
      while (ts.isPropertyAccessExpression(cur)) {
        chain.unshift(cur.name.text);
        cur = cur.expression;
      }
      if (ts.isIdentifier(cur)) {
        record(cur.text, chain[0]);
        return;
      }
      visit(cur);
      return;
    }
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      if (p && (ts.isPropertyAssignment(p) && p.name === n)) return;
      if (p && (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && (p as any).name === n) return;
      if (p && ts.isBindingElement(p) && (p.name === n || p.propertyName === n)) return;
      if (p && ts.isShorthandPropertyAssignment(p)) {
        record(n.text, undefined);
        return;
      }
      record(n.text, undefined);
      return;
    }
    ts.forEachChild(n, visit);
  };
  const record = (name: string, prop: string | undefined) => {
    const v = scope.get(name);
    if (!v) return;
    switch (v.kind) {
      case 'signal':
        refs.signals.add(name);
        break;
      case 'props':
      case 'model': {
        if (!prop) throw FuseCompileError.at(node, `Client code must access "${name}" with a property (e.g. ${name}.title).`);
        if (!refs.props.has(name)) refs.props.set(name, new Set());
        refs.props.get(name)!.add(prop);
        break;
      }
      case 'item':
      case 'index': {
        if (!refs.loop.has(name)) refs.loop.set(name, new Set());
        refs.loop.get(name)!.add(prop ?? '');
        break;
      }
      case 'value':
        throw FuseCompileError.at(node, `<Await> value "${name}" cannot be captured by client code.`);
      case 'params':
        throw FuseCompileError.at(node, 'Partials (components without a schema) cannot contain client code.');
    }
  };
  visit(node);
  return refs;
}

/**
 * Evaluates a client expression at compile time when every free variable is a signal with a
 * literal initial value. Returns `undefined` if not possible.
 */
export function constantFold(node: ts.Expression, scope: Scope): { value: unknown } | undefined {
  const refs = collectClientRefs(node, scope);
  if (refs.props.size || refs.loop.size) return undefined;
  const sigs: Record<string, { value: unknown }> = {};
  for (const name of refs.signals) {
    const v = scope.get(name);
    if (v?.kind !== 'signal' || !v.signal.literal) return undefined;
    sigs[name] = { value: v.signal.literal.value };
  }
  try {
    const js = ts.transpileModule(`(${node.getText()})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(sigs), `return ${js.trim().replace(/;$/, '')}`);
    return { value: fn(...Object.values(sigs)) };
  } catch {
    return undefined;
  }
}
