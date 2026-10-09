import ts from 'typescript';
import path from 'node:path';

/** A compile error pointing at a location in a component source file. */
export class FuseCompileError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
    public readonly line?: number,
    public readonly column?: number,
    public readonly frame?: string,
  ) {
    super(message);
    this.name = 'FuseCompileError';
  }

  static at(node: ts.Node, message: string): FuseCompileError {
    const sf = node.getSourceFile();
    if (!sf) return new FuseCompileError(message);
    const start = node.getStart(sf);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const lines = sf.text.split(/\r?\n/);
    const src = lines[line] ?? '';
    const width = Math.max(1, Math.min(node.getEnd() - start, src.length - character));
    const frame = `${String(line + 1).padStart(4)} | ${src}\n     | ${' '.repeat(character)}${'^'.repeat(width)}`;
    return new FuseCompileError(message, sf.fileName, line + 1, character + 1, frame);
  }

  format(cwd = process.cwd()): string {
    const loc = this.file ? `${path.relative(cwd, this.file)}:${this.line}:${this.column}` : '';
    return `${loc ? loc + ' – ' : ''}${this.message}${this.frame ? '\n' + this.frame : ''}`;
  }
}

export const kebab = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

export const pascal = (s: string): string =>
  s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');

export const camel = (s: string): string => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};

/** Java package segment for a component name (`stock-ticker` → `stockticker`). */
export const javaSegment = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

export const xmlAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escape static text so HTL does not interpret `${`. */
export const htlText = (s: string): string => s.replace(/\$\{/g, '\\${');

/** Escape a static attribute value for HTML + HTL. */
export const htlAttrValue = (s: string): string => htlText(s.replace(/"/g, '&quot;'));

/** HTL string literal. */
export const htlString = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

export const BOOLEAN_ATTRIBUTES = new Set([
  'hidden', 'disabled', 'checked', 'selected', 'readonly', 'required', 'open', 'multiple', 'autofocus',
  'novalidate', 'inert', 'async', 'defer', 'controls', 'loop', 'muted', 'playsinline', 'reversed',
]);

/** Unwrap parentheses and TS-only wrappers (`as`, `!`, `satisfies`). */
export function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n)) n = n.expression;
    else if (ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
    else if (ts.isSatisfiesExpression(n)) n = n.expression;
    else return n;
  }
}

/**
 * JSX whitespace semantics (same algorithm as Babel/TypeScript): trims lines, drops
 * whitespace-only lines and joins the remaining lines with a single space.
 */
export function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) lastNonEmpty = i;
  });
  let out = '';
  lines.forEach((line, i) => {
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    let t = line.replace(/\t/g, ' ');
    if (!isFirst) t = t.replace(/^[ ]+/, '');
    if (!isLast) t = t.replace(/[ ]+$/, '');
    if (t) {
      if (i !== lastNonEmpty) t += ' ';
      out += t;
    }
  });
  return out;
}
