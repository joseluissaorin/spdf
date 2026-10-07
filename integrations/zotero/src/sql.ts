/**
 * Small SQL helpers for the Zotero engine adapter.
 *
 * Why this exists: Zotero (and Firefox) give chrome code SQLite through
 * `Sqlite.sys.mjs`, whose rows are `mozIStorageRow` objects. A row can be read by
 * index or by a *known* name (`getResultByName`), but it cannot list its column
 * names. The `spdf-format` core expects plain objects keyed by column name, so the
 * adapter has to know the names of a statement's result columns before it can build
 * them. SQLite names a result column after its `AS` alias (the `mozIStorageRow` IDL
 * documents exactly this), after the column for a bare column reference, and after the
 * expression text otherwise; PRAGMAs have fixed column names. That is what
 * `resultColumns` reproduces. The engine then checks every inferred name against the
 * row with `getResultByName` the first time it sees a statement, so a wrong guess is
 * an explicit error, never silently mislabelled data.
 *
 * The other helpers split a script into single statements (the asynchronous
 * mozStorage API prepares one statement at a time) and turn `?` placeholders into
 * named ones (needed to bind a BLOB first, see `engine.ts`).
 */

export type TokenType = 'word' | 'ident' | 'string' | 'number' | 'param' | 'op';

export interface Token {
  type: TokenType;
  /** Source text of the token. */
  text: string;
  /** For `ident` (quoted identifiers) and `word`: the identifier itself, unquoted. */
  value: string;
  start: number;
  end: number;
}

const WORD_START = /[A-Za-z_\u0080-￿]/;
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/;
const DIGIT = /[0-9]/;
const MULTI_OPS = ['->>', '->', '||', '<=', '>=', '<>', '!=', '==', '<<', '>>'];

/** Tokenizes SQLite SQL. Comments and whitespace are skipped. Never throws. */
export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  const push = (type: TokenType, start: number, end: number, value?: string) => {
    const text = sql.slice(start, end);
    out.push({ type, text, value: value ?? text, start, end });
  };
  while (i < n) {
    const c = sql[i] as string;
    // whitespace
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // comments
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i + 2);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    // string literal (also the X'..' blob literal, see the word branch)
    if (c === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      push('string', start, i);
      continue;
    }
    // quoted identifiers: "x", `x`, [x]
    if (c === '"' || c === '`') {
      const start = i;
      i++;
      let value = '';
      while (i < n) {
        const d = sql[i] as string;
        if (d === c) {
          if (sql[i + 1] === c) {
            value += c;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += d;
        i++;
      }
      push('ident', start, i, value);
      continue;
    }
    if (c === '[') {
      const start = i;
      const close = sql.indexOf(']', i + 1);
      i = close < 0 ? n : close + 1;
      push('ident', start, i, sql.slice(start + 1, close < 0 ? n : close));
      continue;
    }
    // numbers (12, 1.5, .5, 1e-3, 0x1F)
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(sql[i + 1] ?? ''))) {
      const start = i;
      if (c === '0' && /[xX]/.test(sql[i + 1] ?? '')) {
        i += 2;
        while (i < n && /[0-9A-Fa-f]/.test(sql[i] as string)) i++;
      } else {
        while (i < n && /[0-9._]/.test(sql[i] as string)) i++;
        if (/[eE]/.test(sql[i] ?? '') && /[-+0-9]/.test(sql[i + 1] ?? '')) {
          i += 2;
          while (i < n && DIGIT.test(sql[i] as string)) i++;
        }
      }
      push('number', start, i);
      continue;
    }
    // parameters: ?, ?NNN, :name, @name, $name
    if (c === '?') {
      const start = i;
      i++;
      while (i < n && DIGIT.test(sql[i] as string)) i++;
      push('param', start, i);
      continue;
    }
    if ((c === ':' || c === '@' || c === '$') && WORD_START.test(sql[i + 1] ?? '')) {
      const start = i;
      i++;
      while (i < n && WORD_PART.test(sql[i] as string)) i++;
      push('param', start, i);
      continue;
    }
    // words (keywords and bare identifiers); X'..' is a blob literal
    if (WORD_START.test(c)) {
      const start = i;
      if ((c === 'x' || c === 'X') && sql[i + 1] === "'") {
        const close = sql.indexOf("'", i + 2);
        i = close < 0 ? n : close + 1;
        push('string', start, i);
        continue;
      }
      while (i < n && WORD_PART.test(sql[i] as string)) i++;
      push('word', start, i);
      continue;
    }
    // operators and punctuation
    const op = MULTI_OPS.find((o) => sql.startsWith(o, i));
    if (op) {
      push('op', i, i + op.length);
      i += op.length;
      continue;
    }
    push('op', i, i + 1);
    i++;
  }
  return out;
}

const isWord = (t: Token | undefined, ...words: string[]): boolean =>
  !!t && t.type === 'word' && words.includes(t.value.toUpperCase());
const isOp = (t: Token | undefined, op: string): boolean => !!t && t.type === 'op' && t.text === op;

/**
 * Splits a script into single statements, keeping `CREATE TRIGGER … BEGIN … END;`
 * bodies whole. Quotes and comments are respected. Empty statements are dropped.
 */
export function splitStatements(script: string): string[] {
  const tokens = tokenize(script);
  const out: string[] = [];
  let first = 0; // index of the first token of the current statement
  let blockDepth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k] as Token;
    const head = tokens.slice(first, Math.min(first + 4, tokens.length));
    const isTrigger = isWord(head[0], 'CREATE') && head.slice(1).some((h) => isWord(h, 'TRIGGER'));
    if (isTrigger) {
      if (isWord(t, 'BEGIN', 'CASE')) blockDepth++;
      else if (isWord(t, 'END')) blockDepth = Math.max(0, blockDepth - 1);
    }
    if (isOp(t, ';') && blockDepth === 0) {
      if (k > first) out.push(script.slice((tokens[first] as Token).start, (tokens[k - 1] as Token).end).trim());
      first = k + 1;
    }
  }
  if (first < tokens.length) out.push(script.slice((tokens[first] as Token).start, (tokens[tokens.length - 1] as Token).end).trim());
  return out.filter((s) => s.length > 0);
}

/** Result columns of the PRAGMAs that return more than one column. */
const PRAGMA_COLUMNS: Record<string, string[]> = {
  table_info: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
  table_xinfo: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
  table_list: ['schema', 'name', 'type', 'ncol', 'wr', 'strict'],
  index_list: ['seq', 'name', 'unique', 'origin', 'partial'],
  index_info: ['seqno', 'cid', 'name'],
  index_xinfo: ['seqno', 'cid', 'name', 'desc', 'coll', 'key'],
  foreign_key_list: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
  foreign_key_check: ['table', 'rowid', 'parent', 'fkid'],
  database_list: ['seq', 'name', 'file'],
  collation_list: ['seq', 'name'],
  function_list: ['name', 'builtin', 'type', 'enc', 'narg', 'flags'],
  module_list: ['name'],
  pragma_list: ['name'],
  compile_options: ['compile_options'],
  wal_checkpoint: ['busy', 'log', 'checkpointed'],
};

/** Words that end a SELECT result list at the top level. */
const LIST_END = ['FROM', 'WHERE', 'GROUP', 'HAVING', 'WINDOW', 'ORDER', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT'];

/** Keywords that can never be an implicit alias (`SELECT expr alias`). */
const NOT_ALIAS = new Set([
  'AND', 'OR', 'NOT', 'IS', 'IN', 'LIKE', 'GLOB', 'MATCH', 'REGEXP', 'BETWEEN', 'ESCAPE', 'COLLATE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'DISTINCT', 'ALL', 'AS', 'CAST', 'EXISTS', 'ISNULL',
  'NOTNULL', 'OVER', 'FILTER', 'ASC', 'DESC', 'CURRENT_TIME', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
]);

/** Index of the token after the parenthesized group that starts at `k` (`tokens[k]` is `(`). */
function skipGroup(tokens: Token[], k: number): number {
  let depth = 0;
  for (let j = k; j < tokens.length; j++) {
    const t = tokens[j] as Token;
    if (isOp(t, '(')) depth++;
    else if (isOp(t, ')')) {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return tokens.length;
}

/** Splits `tokens[from, to)` at top-level commas. */
function splitList(tokens: Token[], from: number, to: number): Token[][] {
  const items: Token[][] = [];
  let cur: Token[] = [];
  let depth = 0;
  for (let j = from; j < to; j++) {
    const t = tokens[j] as Token;
    if (isOp(t, '(')) depth++;
    else if (isOp(t, ')')) depth--;
    if (depth === 0 && isOp(t, ',')) {
      items.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  items.push(cur);
  return items;
}

const isName = (t: Token | undefined): boolean => !!t && (t.type === 'ident' || (t.type === 'word' && !NOT_ALIAS.has(t.value.toUpperCase())));

/** The name SQLite gives one result column, or null if it cannot be told from the SQL (`*`). */
function itemName(item: Token[], sql: string): string | null {
  if (item.length === 0) return null;
  const last = item[item.length - 1] as Token;
  const prev = item[item.length - 2];
  if (isOp(last, '*')) return null;
  // expr AS alias
  if (item.length >= 3 && isWord(prev, 'AS') && (last.type === 'ident' || last.type === 'word' || last.type === 'string')) {
    return last.type === 'string' ? last.text.slice(1, -1).replace(/''/g, "'") : last.value;
  }
  // bare column reference: col, tbl.col, schema.tbl.col
  const isColumnRef =
    item.length % 2 === 1 && item.every((t, idx) => (idx % 2 === 0 ? t.type === 'ident' || (t.type === 'word' && !NOT_ALIAS.has(t.value.toUpperCase())) : isOp(t, '.')));
  if (isColumnRef) return last.value;
  // expr alias (implicit AS)
  if (item.length >= 2 && isName(last) && prev && !isOp(prev, '.') && (isName(prev) || prev.type === 'number' || prev.type === 'string' || isOp(prev, ')'))) {
    return last.value;
  }
  // any other expression: SQLite uses its source text
  return sql.slice((item[0] as Token).start, last.end).trim();
}

/**
 * The result column names of one statement, or null when they cannot be inferred
 * (`SELECT *`). Statements that return no rows give `[]`.
 */
export function resultColumns(sql: string): string[] | null {
  const all = tokenize(sql);
  const semi = all.findIndex((t) => isOp(t, ';'));
  const tokens = semi >= 0 ? all.slice(0, semi) : all;
  const first = tokens[0];
  if (!first) return [];
  if (isWord(first, 'EXPLAIN')) {
    return isWord(tokens[1], 'QUERY') ? ['id', 'parent', 'notused', 'detail'] : ['addr', 'opcode', 'p1', 'p2', 'p3', 'p4', 'p5', 'comment'];
  }
  if (isWord(first, 'PRAGMA')) {
    let nameTok = tokens[1];
    if (isOp(tokens[2], '.')) nameTok = tokens[3];
    if (!nameTok) return [];
    const name = nameTok.value.toLowerCase();
    return PRAGMA_COLUMNS[name] ?? [name];
  }
  let k = 0;
  if (isWord(first, 'WITH')) {
    k = 1;
    if (isWord(tokens[k], 'RECURSIVE')) k++;
    // name [(cols)] AS [NOT] [MATERIALIZED] ( select ) [, …]
    for (;;) {
      k++; // past the CTE name
      if (isOp(tokens[k], '(')) k = skipGroup(tokens, k);
      if (isWord(tokens[k], 'AS')) k++;
      if (isWord(tokens[k], 'NOT')) k++;
      if (isWord(tokens[k], 'MATERIALIZED')) k++;
      if (isOp(tokens[k], '(')) k = skipGroup(tokens, k);
      if (!isOp(tokens[k], ',')) break;
      k++; // now at the next CTE name, skipped at the top of the loop
    }
  }
  const head = tokens[k];
  if (isWord(head, 'VALUES')) {
    if (!isOp(tokens[k + 1], '(')) return null;
    const end = skipGroup(tokens, k + 1);
    return splitList(tokens, k + 2, end - 1).map((_, i) => `column${i + 1}`);
  }
  if (isWord(head, 'SELECT')) {
    let from = k + 1;
    if (isWord(tokens[from], 'DISTINCT', 'ALL')) from++;
    let to = from;
    let depth = 0;
    for (; to < tokens.length; to++) {
      const t = tokens[to] as Token;
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')')) depth--;
      else if (depth === 0 && t.type === 'word' && LIST_END.includes(t.value.toUpperCase())) break;
    }
    const names: string[] = [];
    for (const item of splitList(tokens, from, to)) {
      const name = itemName(item, sql);
      if (name === null) return null;
      names.push(name);
    }
    return names;
  }
  // INSERT / UPDATE / DELETE … RETURNING
  const ret = tokens.findIndex((t) => isWord(t, 'RETURNING'));
  if (ret >= 0) {
    const names: string[] = [];
    for (const item of splitList(tokens, ret + 1, tokens.length)) {
      const name = itemName(item, sql);
      if (name === null) return null;
      names.push(name);
    }
    return names;
  }
  return [];
}

/**
 * Rewrites anonymous `?` placeholders as `:p1`, `:p2`… (outside strings and comments).
 * Returns null when the statement mixes in other placeholder styles.
 */
export function namePlaceholders(sql: string): { sql: string; names: string[] } | null {
  const tokens = tokenize(sql).filter((t) => t.type === 'param');
  if (tokens.some((t) => t.text !== '?')) return null;
  let out = '';
  let last = 0;
  const names: string[] = [];
  for (const t of tokens) {
    const name = `p${names.length + 1}`;
    names.push(name);
    out += sql.slice(last, t.start) + `:${name}`;
    last = t.end;
  }
  return { sql: out + sql.slice(last), names };
}
