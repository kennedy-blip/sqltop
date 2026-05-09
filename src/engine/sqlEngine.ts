import type {
  ColumnDef,
  ColumnType,
  ForeignKeyDef,
  QueryResult,
  RowObject,
  SqlValue,
  TableSchema,
} from "./types";

/* ============================================================
   QueryPulse In-Memory Relational Engine
   A dependency-free SQL evaluator: tokenizer + recursive-descent
   parser + executor. Supports SELECT (JOIN, WHERE, GROUP BY,
   HAVING, ORDER BY, LIMIT), CREATE/DROP/ALTER, INSERT/UPDATE/DELETE.
   ============================================================ */

interface Token {
  v: string;
  kind: "word" | "str" | "num" | "op" | "punct";
  quoted?: boolean;
}

interface TableData {
  schema: TableSchema;
  rows: RowObject[];
  autoInc: number;
}

// ---------- expressions ----------
type ExprNode =
  | { kind: "col"; table?: string; name: string }
  | { kind: "lit"; value: SqlValue }
  | { kind: "star" }
  | { kind: "tstar"; table: string }
  | { kind: "func"; name: string; args: ExprNode[]; distinct?: boolean }
  | { kind: "binary"; op: string; left: ExprNode; right: ExprNode }
  | { kind: "unary"; op: string; expr: ExprNode }
  | { kind: "cast"; expr: ExprNode; asType: string };

type CondNode =
  | { t: "and"; left: CondNode; right: CondNode }
  | { t: "or"; left: CondNode; right: CondNode }
  | { t: "not"; expr: CondNode }
  | { t: "cmp"; op: string; left: ExprNode; right: ExprNode }
  | { t: "isnull"; expr: ExprNode; negated: boolean }
  | { t: "in"; expr: ExprNode; list: ExprNode[]; negated: boolean }
  | { t: "between"; expr: ExprNode; low: ExprNode; high: ExprNode; negated: boolean };

interface SelectItem {
  expr: ExprNode;
  alias: string;
  raw: string;
}

interface JoinClause {
  table: string;
  alias: string;
  type: "INNER" | "LEFT" | "CROSS";
  on?: CondNode;
}

interface SelectAST {
  distinct: boolean;
  items: SelectItem[];
  from?: { table: string; alias: string };
  joins: JoinClause[];
  where?: CondNode;
  groupBy: ExprNode[];
  having?: CondNode;
  orderBy: { expr: ExprNode; dir: "ASC" | "DESC" }[];
  limit?: number;
  offset?: number;
}

const AGGS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);
const SCALAR_FUNCS = new Set([
  "UPPER",
  "LOWER",
  "LENGTH",
  "TRIM",
  "LTRIM",
  "RTRIM",
  "COALESCE",
  "ROUND",
  "ABS",
  "SUBSTR",
  "SUBSTRING",
  "IFNULL",
  "NULLIF",
]);
const KEYWORDS = new Set([
  "SELECT", "DISTINCT", "ALL", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER",
  "LIMIT", "OFFSET", "AS", "AND", "OR", "NOT", "NULL", "TRUE", "FALSE",
  "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "JOIN", "ON", "CROSS", "NATURAL",
  "UNION", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE",
  "TABLE", "DROP", "ALTER", "ADD", "COLUMN", "PRIMARY", "KEY", "FOREIGN",
  "REFERENCES", "UNIQUE", "DEFAULT", "NOT", "CONSTRAINT", "INDEX", "IF",
  "EXISTS", "LIKE", "ILIKE", "GLOB", "IN", "BETWEEN", "IS", "CASE", "WHEN",
  "THEN", "ELSE", "END", "ASC", "DESC", "CAST", "BEGIN", "COMMIT", "ROLLBACK",
  "TRANSACTION", "PRAGMA", "EXPLAIN", "QUERY", "PLAN", "SHOW", "TABLES",
  "DESCRIBE", "DESC", "INTEGER", "INT", "TEXT", "VARCHAR", "CHAR", "REAL",
  "FLOAT", "DOUBLE", "NUMERIC", "BLOB", "BOOLEAN", "BOOL", "DATE", "DATETIME",
  "AUTOINCREMENT", "CHECK", "COLLATE",
]);

// ---------------- tokenizer ----------------
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    // line comment --
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // block comment /* */
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // string '...'
    if (c === "'") {
      let j = i + 1;
      let out = "";
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          out += "'";
          j += 2;
        } else if (sql[j] === "'") {
          j++;
          break;
        } else {
          out += sql[j];
          j++;
        }
      }
      tokens.push({ v: out, kind: "str" });
      i = j;
      continue;
    }
    // quoted identifiers "..." `...` [...]
    if (c === '"' || c === "`") {
      const q = c;
      let j = i + 1;
      let out = "";
      while (j < n && sql[j] !== q) {
        out += sql[j];
        j++;
      }
      j++;
      tokens.push({ v: out, kind: "word", quoted: true });
      i = j;
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      let out = "";
      while (j < n && sql[j] !== "]") {
        out += sql[j];
        j++;
      }
      j++;
      tokens.push({ v: out, kind: "word", quoted: true });
      i = j;
      continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i;
      let hasDot = false;
      while (j < n && (/[0-9]/.test(sql[j]) || (sql[j] === "." && !hasDot))) {
        if (sql[j] === ".") hasDot = true;
        j++;
      }
      if ((sql[j] === "e" || sql[j] === "E") && /[0-9+-]/.test(sql[j + 1] ?? "")) {
        j++;
        if (sql[j] === "+" || sql[j] === "-") j++;
        while (j < n && /[0-9]/.test(sql[j])) j++;
      }
      tokens.push({ v: sql.slice(i, j), kind: "num" });
      i = j;
      continue;
    }
    // word / keyword
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      tokens.push({ v: sql.slice(i, j), kind: "word" });
      i = j;
      continue;
    }
    // ops: ||, <=, >=, <>, !=, ==
    const two = sql.slice(i, i + 2);
    if (two === "||" || two === "<=" || two === ">=" || two === "<>" || two === "!=" || two === "==") {
      tokens.push({ v: two, kind: "op" });
      i += 2;
      continue;
    }
    if ("=<>+-*/%".includes(c)) {
      tokens.push({ v: c, kind: "op" });
      i++;
      continue;
    }
    if ("(),;.".includes(c)) {
      tokens.push({ v: c, kind: "punct" });
      i++;
      continue;
    }
    // unknown char — skip
    i++;
  }
  return tokens;
}

// ---------------- cursor ----------------
class Cur {
  pos = 0;
  constructor(public tokens: Token[]) {}
  peek(off = 0): Token | undefined {
    return this.tokens[this.pos + off];
  }
  next(): Token | undefined {
    return this.tokens[this.pos++];
  }
  eof(): boolean {
    return this.pos >= this.tokens.length;
  }
  kw(word: string): boolean {
    const t = this.peek();
    return !!t && t.kind === "word" && !t.quoted && t.v.toUpperCase() === word;
  }
  matchKw(word: string): boolean {
    if (this.kw(word)) {
      this.pos++;
      return true;
    }
    return false;
  }
  expectKw(word: string): void {
    if (!this.matchKw(word)) throw new Error(`Expected keyword ${word}`);
  }
  matchPunct(v: string): boolean {
    const t = this.peek();
    if (t && t.kind === "punct" && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }
  matchOp(v: string): boolean {
    const t = this.peek();
    if (t && t.kind === "op" && t.v.toUpperCase() === v) {
      this.pos++;
      return true;
    }
    return false;
  }
  isWord(): boolean {
    const t = this.peek();
    return !!t && t.kind === "word";
  }
  readIdent(): string {
    const t = this.next();
    if (!t || t.kind !== "word") throw new Error("Expected identifier");
    return t.v;
  }
}

function isKwToken(t: Token | undefined, w: string): boolean {
  return !!t && t.kind === "word" && !t.quoted && t.v.toUpperCase() === w;
}

// ---------------- parsing helpers ----------------
function parseValueLiteral(cur: Cur): ExprNode {
  const t = cur.peek();
  if (!t) throw new Error("Unexpected end of expression");
  if (t.kind === "str") {
    cur.next();
    return { kind: "lit", value: t.v };
  }
  if (t.kind === "num") {
    cur.next();
    return { kind: "lit", value: Number(t.v) };
  }
  if (t.kind === "word" && !t.quoted) {
    const up = t.v.toUpperCase();
    if (up === "NULL") {
      cur.next();
      return { kind: "lit", value: null };
    }
    if (up === "TRUE") {
      cur.next();
      return { kind: "lit", value: 1 };
    }
    if (up === "FALSE") {
      cur.next();
      return { kind: "lit", value: 0 };
    }
    if (up === "CURRENT_TIMESTAMP" || up === "CURRENT_DATE" || up === "CURRENT_TIME") {
      cur.next();
      return { kind: "lit", value: new Date().toISOString() };
    }
  }
  throw new Error(`Expected value but found '${t.v}'`);
}

function parsePrimary(cur: Cur): ExprNode {
  const t = cur.peek();
  if (!t) throw new Error("Unexpected end of expression");
  // paren
  if (t.kind === "punct" && t.v === "(") {
    cur.next();
    const e = parseAddSub(cur);
    if (!cur.matchPunct(")")) throw new Error("Expected ')'");
    return e;
  }
  // unary
  if (t.kind === "op" && (t.v === "-" || t.v === "+")) {
    cur.next();
    const e = parsePrimary(cur);
    if (e.kind === "lit" && typeof e.value === "number") {
      return { kind: "lit", value: t.v === "-" ? -e.value : e.value };
    }
    return { kind: "unary", op: t.v, expr: e };
  }
  // star
  if (t.kind === "op" && t.v === "*") {
    cur.next();
    return { kind: "star" };
  }
  // number / string
  if (t.kind === "str" || t.kind === "num") return parseValueLiteral(cur);
  if (t.kind === "word" && !t.quoted) {
    const up = t.v.toUpperCase();
    if (up === "NULL" || up === "TRUE" || up === "FALSE" || up === "CURRENT_TIMESTAMP" || up === "CURRENT_DATE" || up === "CURRENT_TIME") {
      return parseValueLiteral(cur);
    }
    if (up === "CAST") {
      cur.next();
      if (!cur.matchPunct("(")) throw new Error("Expected '(' after CAST");
      const e = parseAddSub(cur);
      cur.expectKw("AS");
      const typeTok = cur.next();
      if (!typeTok) throw new Error("Expected type in CAST");
      const asType = typeTok.v;
      if (!cur.matchPunct(")")) throw new Error("Expected ')' in CAST");
      return { kind: "cast", expr: e, asType };
    }
    if (up === "CASE") {
      return parseCase(cur);
    }
    // function call or column
    const next2 = cur.peek(1);
    if (next2 && next2.kind === "punct" && next2.v === "(") {
      const fname = t.v.toUpperCase();
      cur.next();
      cur.next(); // (
      const args: ExprNode[] = [];
      let distinct = false;
      if (isKwToken(cur.peek(), "DISTINCT")) {
        cur.next();
        distinct = true;
      }
      if (!(cur.peek()?.kind === "punct" && cur.peek()?.v === ")")) {
        // COUNT(*) special
        const p = cur.peek();
        if (p && p.kind === "op" && p.v === "*") {
          cur.next();
          args.push({ kind: "star" });
        } else {
          args.push(parseAddSub(cur));
          while (cur.matchPunct(",")) {
            args.push(parseAddSub(cur));
          }
        }
      }
      if (!cur.matchPunct(")")) throw new Error(`Expected ')' after function ${fname}`);
      return { kind: "func", name: fname, args, distinct };
    }
    // column ref [table.]col
    const first = cur.next()!.v;
    const dot = cur.peek();
    if (dot && dot.kind === "punct" && dot.v === ".") {
      cur.next();
      const nxt = cur.peek();
      if (nxt && nxt.kind === "op" && nxt.v === "*") {
        cur.next();
        return { kind: "tstar", table: first };
      }
      const col = cur.readIdent();
      return { kind: "col", table: first, name: col };
    }
    return { kind: "col", name: first };
  }
  if (t.kind === "word" && t.quoted) {
    const first = cur.next()!.v;
    const dot = cur.peek();
    if (dot && dot.kind === "punct" && dot.v === ".") {
      cur.next();
      const col = cur.readIdent();
      return { kind: "col", table: first, name: col };
    }
    return { kind: "col", name: first };
  }
  throw new Error(`Unexpected token '${t.v}' in expression`);
}

function parseCase(cur: Cur): ExprNode {
  // CASE WHEN c THEN a [WHEN ...] [ELSE b] END -> emulate via nested func
  cur.next(); // CASE
  // Collect whens; we lower to nested COALESCE-like func "CASEEVAL" handled in evaluator
  const args: ExprNode[] = [];
  let hasWhen = false;
  while (isKwToken(cur.peek(), "WHEN")) {
    hasWhen = true;
    cur.next();
    const cond = parseCondition(cur);
    cur.expectKw("THEN");
    const val = parseAddSub(cur);
    // encode condition as string? Instead encode as func args pair using sentinel:
    // We'll push a special func node for condition by converting cond back: use binary trick.
    // Simpler: store WHEN as func CASEWHEN(condExpr...) — we need cond->expr conversion.
    // Convert simple conditions to expr via helper: wrap in func __COND__ with serialized parts is complex.
    // Alternative: evaluate CASE at condition level is hard; so support only simple equality WHENs
    // by converting cond node to an expr: left = right etc.
    args.push(condToExpr(cond));
    args.push(val);
  }
  if (!hasWhen) throw new Error("CASE requires WHEN");
  if (isKwToken(cur.peek(), "ELSE")) {
    cur.next();
    args.push(parseAddSub(cur));
  } else {
    args.push({ kind: "lit", value: null });
  }
  cur.expectKw("END");
  return { kind: "func", name: "CASEEVAL", args };
}

function condToExpr(c: CondNode): ExprNode {
  if (c.t === "cmp") return { kind: "binary", op: c.op === "=" ? "==" : c.op, left: c.left, right: c.right };
  if (c.t === "and") return { kind: "binary", op: "AND", left: condToExpr(c.left), right: condToExpr(c.right) };
  if (c.t === "or") return { kind: "binary", op: "OR", left: condToExpr(c.left), right: condToExpr(c.right) };
  if (c.t === "not") return { kind: "unary", op: "NOT", expr: condToExpr(c.expr) };
  if (c.t === "isnull") return { kind: "func", name: c.negated ? "ISNOTNULL" : "ISNULL", args: [c.expr] };
  if (c.t === "in") return { kind: "func", name: c.negated ? "NOTIN" : "IN", args: [c.expr, ...c.list] };
  if (c.t === "between") return { kind: "func", name: c.negated ? "NOTBETWEEN" : "BETWEEN", args: [c.expr, c.low, c.high] };
  return { kind: "lit", value: 0 };
}

function parseMulDiv(cur: Cur): ExprNode {
  let left = parsePrimary(cur);
  for (;;) {
    const t = cur.peek();
    if (t && t.kind === "op" && (t.v === "*" || t.v === "/" || t.v === "%")) {
      cur.next();
      const right = parsePrimary(cur);
      left = { kind: "binary", op: t.v, left, right };
    } else break;
  }
  return left;
}

function parseAddSub(cur: Cur): ExprNode {
  let left = parseMulDiv(cur);
  for (;;) {
    const t = cur.peek();
    if (t && t.kind === "op" && (t.v === "+" || t.v === "-" || t.v === "||")) {
      cur.next();
      const right = parseMulDiv(cur);
      left = { kind: "binary", op: t.v, left, right };
    } else break;
  }
  return left;
}

function parseCondition(cur: Cur): CondNode {
  return parseOr(cur);
}

function parseOr(cur: Cur): CondNode {
  let left = parseAnd(cur);
  while (isKwToken(cur.peek(), "OR")) {
    cur.next();
    const right = parseAnd(cur);
    left = { t: "or", left, right };
  }
  return left;
}

function parseAnd(cur: Cur): CondNode {
  let left = parseNot(cur);
  while (isKwToken(cur.peek(), "AND")) {
    cur.next();
    const right = parseNot(cur);
    left = { t: "and", left, right };
  }
  return left;
}

function parseNot(cur: Cur): CondNode {
  if (isKwToken(cur.peek(), "NOT")) {
    cur.next();
    const e = parseNot(cur);
    return { t: "not", expr: e };
  }
  return parsePredicate(cur);
}

function parsePredicate(cur: Cur): CondNode {
  const t = cur.peek();
  if (t && t.kind === "punct" && t.v === "(") {
    // Could be grouped condition — peek ahead: parse inner as condition
    cur.next();
    const inner = parseCondition(cur);
    if (!cur.matchPunct(")")) throw new Error("Expected ')'");
    return inner;
  }
  const left = parseAddSub(cur);
  const nxt = cur.peek();
  if (!nxt) throw new Error("Unexpected end in WHERE clause");
  // IS [NOT] NULL
  if (nxt.kind === "word" && !nxt.quoted && nxt.v.toUpperCase() === "IS") {
    cur.next();
    let negated = false;
    if (isKwToken(cur.peek(), "NOT")) {
      cur.next();
      negated = true;
    }
    cur.expectKw("NULL");
    return { t: "isnull", expr: left, negated };
  }
  // [NOT] BETWEEN / IN / LIKE
  let negated = false;
  if (nxt.kind === "word" && !nxt.quoted && nxt.v.toUpperCase() === "NOT") {
    // check if followed by BETWEEN/IN/LIKE/ILIKE
    const after = cur.peek(1);
    if (after && after.kind === "word" && ["BETWEEN", "IN", "LIKE", "ILIKE", "GLOB"].includes(after.v.toUpperCase())) {
      cur.next();
      negated = true;
    }
  }
  const op2 = cur.peek();
  if (op2 && op2.kind === "word" && !op2.quoted) {
    const up = op2.v.toUpperCase();
    if (up === "BETWEEN") {
      cur.next();
      const low = parseAddSub(cur);
      cur.expectKw("AND");
      const high = parseAddSub(cur);
      return { t: "between", expr: left, low, high, negated };
    }
    if (up === "IN") {
      cur.next();
      if (!cur.matchPunct("(")) throw new Error("Expected '(' after IN");
      const list: ExprNode[] = [];
      // support empty? no
      if (!(cur.peek()?.kind === "punct" && cur.peek()?.v === ")")) {
        // check for SELECT subquery — unsupported
        if (isKwToken(cur.peek(), "SELECT")) throw new Error("Subqueries in IN (...) are not supported in this engine version");
        list.push(parseAddSub(cur));
        while (cur.matchPunct(",")) list.push(parseAddSub(cur));
      }
      if (!cur.matchPunct(")")) throw new Error("Expected ')' after IN list");
      return { t: "in", expr: left, list, negated };
    }
    if (up === "LIKE" || up === "ILIKE" || up === "GLOB") {
      cur.next();
      const right = parseAddSub(cur);
      const op = up === "GLOB" ? "GLOB" : "LIKE";
      const cmp: CondNode = { t: "cmp", op, left, right };
      return negated ? { t: "not", expr: cmp } : cmp;
    }
  }
  // comparison ops
  if (op2 && op2.kind === "op" && ["=", "==", "!=", "<>", "<", ">", "<=", ">="].includes(op2.v)) {
    cur.next();
    const right = parseAddSub(cur);
    const cmp: CondNode = { t: "cmp", op: op2.v, left, right };
    return negated ? { t: "not", expr: cmp } : cmp;
  }
  throw new Error(`Expected comparison operator after '${exprToString(left)}'`);
}

function exprToString(e: ExprNode): string {
  if (e.kind === "col") return e.table ? `${e.table}.${e.name}` : e.name;
  if (e.kind === "lit") return e.value === null ? "NULL" : String(e.value);
  if (e.kind === "star") return "*";
  if (e.kind === "tstar") return `${e.table}.*`;
  if (e.kind === "func") return `${e.name}(...)`;
  if (e.kind === "binary") return `${exprToString(e.left)} ${e.op} ${exprToString(e.right)}`;
  if (e.kind === "unary") return `${e.op}${exprToString(e.expr)}`;
  if (e.kind === "cast") return `CAST(...)`;
  return "?";
}

// ---------------- SELECT parsing ----------------
function parseSelect(cur: Cur): SelectAST {
  cur.expectKw("SELECT");
  let distinct = false;
  if (isKwToken(cur.peek(), "DISTINCT")) {
    cur.next();
    distinct = true;
  } else if (isKwToken(cur.peek(), "ALL")) {
    cur.next();
  }
  const items: SelectItem[] = [];
  if (cur.peek()?.kind === "op" && cur.peek()?.v === "*") {
    cur.next();
    items.push({ expr: { kind: "star" }, alias: "*", raw: "*" });
  } else {
    for (;;) {
      const expr = parseAddSub(cur);
      let alias = "";
      if (isKwToken(cur.peek(), "AS")) {
        cur.next();
        alias = cur.readIdent();
      } else {
        const p = cur.peek();
        if (p && p.kind === "word" && !KEYWORDS.has(p.v.toUpperCase())) {
          // bare alias (but not if next is keyword-ish clause starter)
          const up = p.v.toUpperCase();
          if (!["FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "ON", "AND", "OR", "UNION"].includes(up)) {
            alias = cur.readIdent();
          }
        }
      }
      if (!alias) {
        if (expr.kind === "col") alias = expr.name;
        else if (expr.kind === "func") alias = `${expr.name.toLowerCase()}${expr.args.length ? `_${exprToString(expr.args[0]).replace(/[^a-zA-Z0-9_]/g, "")}` : ""}` || expr.name;
        else alias = exprToString(expr);
      }
      items.push({ expr, alias, raw: exprToString(expr) });
      if (cur.matchPunct(",")) continue;
      break;
    }
  }

  let from: SelectAST["from"];
  const joins: JoinClause[] = [];
  if (isKwToken(cur.peek(), "FROM")) {
    cur.next();
    const table = cur.readIdent();
    let alias = table;
    if (isKwToken(cur.peek(), "AS")) {
      cur.next();
      alias = cur.readIdent();
    } else {
      const p = cur.peek();
      if (p && p.kind === "word" && !KEYWORDS.has(p.v.toUpperCase())) alias = cur.readIdent();
    }
    from = { table, alias };
    // comma cross joins
    while (cur.matchPunct(",")) {
      const t2 = cur.readIdent();
      let a2 = t2;
      if (isKwToken(cur.peek(), "AS")) {
        cur.next();
        a2 = cur.readIdent();
      } else {
        const p = cur.peek();
        if (p && p.kind === "word" && !KEYWORDS.has(p.v.toUpperCase())) a2 = cur.readIdent();
      }
      joins.push({ table: t2, alias: a2, type: "CROSS" });
    }
    // explicit joins
    for (;;) {
      let jtype: JoinClause["type"] | null = null;
      if (isKwToken(cur.peek(), "JOIN")) {
        cur.next();
        jtype = "INNER";
      } else if (isKwToken(cur.peek(), "INNER")) {
        cur.next();
        cur.expectKw("JOIN");
        jtype = "INNER";
      } else if (isKwToken(cur.peek(), "LEFT")) {
        cur.next();
        if (isKwToken(cur.peek(), "OUTER")) cur.next();
        cur.expectKw("JOIN");
        jtype = "LEFT";
      } else if (isKwToken(cur.peek(), "CROSS")) {
        cur.next();
        cur.expectKw("JOIN");
        jtype = "CROSS";
      } else break;
      if (!jtype) break;
      const jt = cur.readIdent();
      let ja = jt;
      if (isKwToken(cur.peek(), "AS")) {
        cur.next();
        ja = cur.readIdent();
      } else {
        const p = cur.peek();
        if (p && p.kind === "word" && !KEYWORDS.has(p.v.toUpperCase())) ja = cur.readIdent();
      }
      let on: CondNode | undefined;
      if (jtype !== "CROSS") {
        if (isKwToken(cur.peek(), "ON")) {
          cur.next();
          on = parseCondition(cur);
        } else if (jtype === "INNER") {
          // allow JOIN without ON as cross
          jtype = "CROSS";
        } else {
          throw new Error("LEFT JOIN requires ON clause");
        }
      }
      joins.push({ table: jt, alias: ja, type: jtype, on });
    }
  }

  let where: CondNode | undefined;
  if (isKwToken(cur.peek(), "WHERE")) {
    cur.next();
    where = parseCondition(cur);
  }
  const groupBy: ExprNode[] = [];
  if (isKwToken(cur.peek(), "GROUP")) {
    cur.next();
    cur.expectKw("BY");
    groupBy.push(parseAddSub(cur));
    while (cur.matchPunct(",")) groupBy.push(parseAddSub(cur));
  }
  let having: CondNode | undefined;
  if (isKwToken(cur.peek(), "HAVING")) {
    cur.next();
    having = parseCondition(cur);
  }
  const orderBy: SelectAST["orderBy"] = [];
  if (isKwToken(cur.peek(), "ORDER")) {
    cur.next();
    cur.expectKw("BY");
    for (;;) {
      // ordinal?
      const p = cur.peek();
      let expr: ExprNode;
      if (p && p.kind === "num") {
        cur.next();
        expr = { kind: "lit", value: Number(p.v) };
        // mark ordinal by wrapping
        expr = { kind: "func", name: "__ORDINAL__", args: [expr] };
      } else {
        expr = parseAddSub(cur);
      }
      let dir: "ASC" | "DESC" = "ASC";
      if (isKwToken(cur.peek(), "ASC")) {
        cur.next();
        dir = "ASC";
      } else if (isKwToken(cur.peek(), "DESC")) {
        cur.next();
        dir = "DESC";
      }
      orderBy.push({ expr, dir });
      if (cur.matchPunct(",")) continue;
      break;
    }
  }
  let limit: number | undefined;
  let offset: number | undefined;
  if (isKwToken(cur.peek(), "LIMIT")) {
    cur.next();
    const t = cur.next();
    if (!t || t.kind !== "num") throw new Error("LIMIT requires a number");
    limit = Number(t.v);
    if (isKwToken(cur.peek(), "OFFSET")) {
      cur.next();
      const t2 = cur.next();
      if (!t2 || t2.kind !== "num") throw new Error("OFFSET requires a number");
      offset = Number(t2.v);
    } else if (cur.matchPunct(",")) {
      // LIMIT offset, count (mysql style)
      const t2 = cur.next();
      if (!t2 || t2.kind !== "num") throw new Error("LIMIT requires a number");
      offset = limit;
      limit = Number(t2.v);
    }
  }
  if (isKwToken(cur.peek(), "OFFSET")) {
    cur.next();
    const t = cur.next();
    if (!t || t.kind !== "num") throw new Error("OFFSET requires a number");
    offset = Number(t.v);
  }

  return { distinct, items, from, joins, where, groupBy, having, orderBy, limit, offset };
}

// ============================================================
//  Database class
// ============================================================
type JoinedRow = Map<string, SqlValue>; // lowercase "alias.col" -> value

export class InMemoryDB {
  tables = new Map<string, TableData>(); // lowercase name -> data

  getTable(name: string): TableData | undefined {
    return this.tables.get(name.toLowerCase());
  }

  listSchemas(): TableSchema[] {
    return [...this.tables.values()].map((t) => t.schema);
  }

  rowCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [, d] of this.tables) out[d.schema.name] = d.rows.length;
    return out;
  }

  totalRows(): number {
    let n = 0;
    for (const [, d] of this.tables) n += d.rows.length;
    return n;
  }

  dropAll(): void {
    this.tables.clear();
  }

  createTable(schema: TableSchema): void {
    const key = schema.name.toLowerCase();
    if (this.tables.has(key)) throw new Error(`Table '${schema.name}' already exists`);
    this.validateSchema(schema);
    this.tables.set(key, { schema: JSON.parse(JSON.stringify(schema)), rows: [], autoInc: 1 });
  }

  createTableIfNotExists(schema: TableSchema): boolean {
    if (this.tables.has(schema.name.toLowerCase())) return false;
    this.createTable(schema);
    return true;
  }

  dropTable(name: string, ifExists = false): void {
    const key = name.toLowerCase();
    if (!this.tables.has(key)) {
      if (ifExists) return;
      throw new Error(`Table '${name}' does not exist`);
    }
    this.tables.delete(key);
  }

  private validateSchema(schema: TableSchema): void {
    if (!schema.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema.name))
      throw new Error(`Invalid table name '${schema.name}'`);
    if (schema.columns.length === 0) throw new Error("Table must have at least one column");
    const seen = new Set<string>();
    for (const c of schema.columns) {
      const lc = c.name.toLowerCase();
      if (seen.has(lc)) throw new Error(`Duplicate column '${c.name}'`);
      seen.add(lc);
    }
  }

  insertRows(tableName: string, cols: string[] | null, valueSets: SqlValue[][]): number {
    const td = this.getTable(tableName);
    if (!td) throw new Error(`Table '${tableName}' does not exist`);
    const targetCols = cols ?? td.schema.columns.map((c) => c.name);
    // validate cols
    const colMap = new Map(td.schema.columns.map((c) => [c.name.toLowerCase(), c]));
    for (const c of targetCols) {
      if (!colMap.has(c.toLowerCase())) throw new Error(`Table '${tableName}' has no column '${c}'`);
    }
    let count = 0;
    for (const vs of valueSets) {
      if (vs.length !== targetCols.length)
        throw new Error(`Column count (${targetCols.length}) does not match value count (${vs.length})`);
      const row: RowObject = {};
      for (const c of td.schema.columns) {
        row[c.name] = c.defaultValue !== undefined ? c.defaultValue : null;
      }
      // autoincrement PK handling: if INTEGER PK missing or null -> assign
      for (let k = 0; k < targetCols.length; k++) {
        const def = colMap.get(targetCols[k].toLowerCase())!;
        let v = vs[k];
        v = coerceValue(v, def.type);
        row[def.name] = v;
      }
      // auto assign integer PK if null
      for (const c of td.schema.columns) {
        if (c.primaryKey && c.type === "INTEGER" && (row[c.name] === null || row[c.name] === undefined)) {
          row[c.name] = td.autoInc++;
        }
      }
      // bump autoInc past explicit ids
      for (const c of td.schema.columns) {
        if (c.primaryKey && c.type === "INTEGER" && typeof row[c.name] === "number") {
          if ((row[c.name] as number) >= td.autoInc) td.autoInc = (row[c.name] as number) + 1;
        }
      }
      this.checkConstraints(td, row, -1);
      td.rows.push(row);
      count++;
    }
    return count;
  }

  private checkConstraints(td: TableData, row: RowObject, skipIndex: number): void {
    for (const c of td.schema.columns) {
      const v = row[c.name];
      if ((c.notNull || c.primaryKey) && (v === null || v === undefined))
        throw new Error(`NOT NULL constraint failed: ${td.schema.name}.${c.name}`);
      if ((c.unique || c.primaryKey) && v !== null) {
        for (let i = 0; i < td.rows.length; i++) {
          if (i === skipIndex) continue;
          if (td.rows[i][c.name] === v)
            throw new Error(`UNIQUE constraint failed: ${td.schema.name}.${c.name} = ${formatVal(v)}`);
        }
      }
    }
  }

  // ---------------- main execute ----------------
  execute(sql: string): QueryResult[] {
    const tokens = tokenize(sql);
    const cur = new Cur(tokens);
    const results: QueryResult[] = [];
    let idx = 0;
    while (!cur.eof()) {
      // skip stray semicolons
      while (cur.peek()?.kind === "punct" && cur.peek()?.v === ";") cur.next();
      if (cur.eof()) break;
      const start = performance.now();
      try {
        const res = this.executeOne(cur);
        const end = performance.now();
        res.statementIndex = idx;
        res.executionTimeMs = Math.max(0.1, end - start);
        results.push(res);
      } catch (e) {
        const end = performance.now();
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          statementIndex: idx,
          statementType: "OTHER",
          columns: [],
          rows: [],
          rowCount: 0,
          executionTimeMs: Math.max(0.1, end - start),
          message: `Error: ${msg}`,
          success: false,
          error: msg,
        });
        // skip to next semicolon to recover
        while (!cur.eof() && !(cur.peek()?.kind === "punct" && cur.peek()?.v === ";")) cur.next();
      }
      // consume semicolon
      if (cur.peek()?.kind === "punct" && cur.peek()?.v === ";") cur.next();
      idx++;
      if (idx > 200) break; // safety
    }
    if (results.length === 0) {
      results.push({
        statementIndex: 0,
        statementType: "OTHER",
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0.1,
        message: "Empty statement",
        success: true,
      });
    }
    return results;
  }

  private executeOne(cur: Cur): QueryResult {
    const t = cur.peek();
    if (!t) throw new Error("Empty statement");
    const up = t.kind === "word" && !t.quoted ? t.v.toUpperCase() : "";
    if (up === "SELECT" || up === "WITH") {
      if (up === "WITH") throw new Error("WITH/CTE queries are not supported in this engine version");
      const ast = parseSelect(cur);
      return this.runSelect(ast);
    }
    if (up === "CREATE") return this.parseCreate(cur);
    if (up === "INSERT") return this.parseInsert(cur);
    if (up === "UPDATE") return this.parseUpdate(cur);
    if (up === "DELETE") return this.parseDelete(cur);
    if (up === "DROP") return this.parseDrop(cur);
    if (up === "ALTER") return this.parseAlter(cur);
    if (up === "EXPLAIN") {
      cur.next();
      if (isKwToken(cur.peek(), "QUERY")) {
        cur.next();
        cur.expectKw("PLAN");
      }
      // consume rest of statement tokens for display
      const rest: string[] = [];
      while (!cur.eof() && !(cur.peek()?.kind === "punct" && cur.peek()?.v === ";")) {
        rest.push(cur.next()!.v);
      }
      return {
        statementIndex: 0,
        statementType: "OTHER",
        columns: ["id", "parent", "detail"],
        rows: [
          [0, 0, "QUERY PLAN (in-memory engine)"],
          [1, 0, `SCAN: ${rest.slice(0, 12).join(" ")}${rest.length > 12 ? " …" : ""}`],
          [2, 1, "EXECUTE IN MEMORY — no disk I/O"],
        ],
        rowCount: 3,
        executionTimeMs: 0,
        message: "EXPLAIN QUERY PLAN — 3 rows",
        success: true,
      };
    }
    if (up === "PRAGMA") {
      cur.next();
      const name = cur.readIdent().toLowerCase();
      let arg = "";
      if (cur.matchPunct("(")) {
        const a = cur.next();
        arg = a ? a.v : "";
        cur.matchPunct(")");
      } else if (cur.matchOp("=")) {
        const a = cur.next();
        arg = a ? a.v : "";
      }
      if (name === "table_info" && arg) {
        const clean = arg.replace(/['"]/g, "");
        const td = this.getTable(clean);
        if (!td) throw new Error(`Table '${clean}' does not exist`);
        const rows = td.schema.columns.map((c, i) => [
          i,
          c.name,
          c.type,
          c.notNull || c.primaryKey ? 1 : 0,
          c.defaultValue ?? null,
          c.primaryKey ? 1 : 0,
        ] as SqlValue[]);
        return {
          statementIndex: 0,
          statementType: "SELECT",
          columns: ["cid", "name", "type", "notnull", "dflt_value", "pk"],
          rows,
          rowCount: rows.length,
          executionTimeMs: 0,
          message: `${rows.length} columns`,
          success: true,
        };
      }
      return {
        statementIndex: 0,
        statementType: "OTHER",
        columns: ["pragma"],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        message: `PRAGMA ${name} OK`,
        success: true,
      };
    }
    if (up === "SHOW") {
      cur.next();
      cur.expectKw("TABLES");
      const rows = this.listSchemas().map((s) => [s.name] as SqlValue[]);
      return {
        statementIndex: 0,
        statementType: "SELECT",
        columns: ["table_name"],
        rows,
        rowCount: rows.length,
        executionTimeMs: 0,
        message: `${rows.length} tables`,
        success: true,
      };
    }
    if (up === "DESCRIBE" || up === "DESC") {
      cur.next();
      const name = cur.readIdent();
      const td = this.getTable(name);
      if (!td) throw new Error(`Table '${name}' does not exist`);
      const rows = td.schema.columns.map((c) => [
        c.name,
        c.type,
        c.primaryKey ? "PRI" : c.notNull ? "NOT NULL" : "YES",
        c.defaultValue ?? null,
      ] as SqlValue[]);
      return {
        statementIndex: 0,
        statementType: "SELECT",
        columns: ["Field", "Type", "Null", "Default"],
        rows,
        rowCount: rows.length,
        executionTimeMs: 0,
        message: `${rows.length} columns`,
        success: true,
      };
    }
    if (up === "BEGIN" || up === "COMMIT" || up === "ROLLBACK") {
      cur.next();
      if (isKwToken(cur.peek(), "TRANSACTION")) cur.next();
      return {
        statementIndex: 0,
        statementType: "OTHER",
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        message: `${up} OK (in-memory, auto-commit)`,
        success: true,
      };
    }
    throw new Error(`Unsupported statement '${t.v}'. Supported: SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, DROP TABLE, ALTER TABLE, EXPLAIN, PRAGMA.`);
  }

  // ---------------- DDL/DML parsers ----------------
  private parseCreate(cur: Cur): QueryResult {
    cur.next(); // CREATE
    // UNIQUE INDEX etc -> unsupported message
    if (isKwToken(cur.peek(), "UNIQUE")) {
      throw new Error("CREATE UNIQUE INDEX is not supported — use UNIQUE column constraint instead");
    }
    if (isKwToken(cur.peek(), "INDEX")) throw new Error("CREATE INDEX is not needed — in-memory engine scans are instant");
    cur.expectKw("TABLE");
    let ifNotExists = false;
    if (isKwToken(cur.peek(), "IF")) {
      cur.next();
      cur.expectKw("NOT");
      cur.expectKw("EXISTS");
      ifNotExists = true;
    }
    const tableName = cur.readIdent();
    if (!cur.matchPunct("(")) throw new Error("Expected '(' after table name");
    const columns: ColumnDef[] = [];
    const fks: ForeignKeyDef[] = [];
    const pkTableCols: string[] = [];
    for (;;) {
      if (cur.peek()?.kind === "punct" && cur.peek()?.v === ")") break;
      // table constraints
      if (isKwToken(cur.peek(), "PRIMARY")) {
        cur.next();
        cur.expectKw("KEY");
        if (!cur.matchPunct("(")) throw new Error("Expected '(' after PRIMARY KEY");
        pkTableCols.push(cur.readIdent());
        while (cur.matchPunct(",")) pkTableCols.push(cur.readIdent());
        if (!cur.matchPunct(")")) throw new Error("Expected ')' after PRIMARY KEY columns");
      } else if (isKwToken(cur.peek(), "FOREIGN")) {
        cur.next();
        cur.expectKw("KEY");
        if (!cur.matchPunct("(")) throw new Error("Expected '(' after FOREIGN KEY");
        const col = cur.readIdent();
        if (!cur.matchPunct(")")) throw new Error("Expected ')' after FOREIGN KEY column");
        cur.expectKw("REFERENCES");
        const refTable = cur.readIdent();
        let refCol = "id";
        if (cur.matchPunct("(")) {
          refCol = cur.readIdent();
          if (!cur.matchPunct(")")) throw new Error("Expected ')' after REFERENCES column");
        }
        fks.push({ column: col, referencesTable: refTable, referencesColumn: refCol });
      } else if (isKwToken(cur.peek(), "UNIQUE")) {
        cur.next();
        if (cur.matchPunct("(")) {
          const ucol = cur.readIdent();
          if (!cur.matchPunct(")")) throw new Error("Expected ')' after UNIQUE");
          const existing = columns.find((c) => c.name.toLowerCase() === ucol.toLowerCase());
          if (existing) existing.unique = true;
        }
      } else if (isKwToken(cur.peek(), "CONSTRAINT") || isKwToken(cur.peek(), "CHECK")) {
        // skip constraint/check clause
        while (!cur.eof()) {
          const p = cur.peek()!;
          if (p.kind === "punct" && (p.v === "," || p.v === ")")) break;
          if (p.kind === "punct" && p.v === "(") {
            // skip balanced
            let depth = 0;
            while (!cur.eof()) {
              const q = cur.next()!;
              if (q.kind === "punct" && q.v === "(") depth++;
              if (q.kind === "punct" && q.v === ")") {
                depth--;
                if (depth <= 0) break;
              }
            }
          } else cur.next();
        }
      } else {
        // column def
        const colName = cur.readIdent();
        let type: ColumnType = "TEXT";
        const tp = cur.peek();
        if (tp && tp.kind === "word") {
          const up = tp.v.toUpperCase();
          if (["INTEGER", "INT", "BOOLEAN", "BOOL"].includes(up)) {
            type = "INTEGER";
            cur.next();
          } else if (["TEXT", "VARCHAR", "CHAR", "DATE", "DATETIME"].includes(up)) {
            type = "TEXT";
            cur.next();
            if (cur.matchPunct("(")) {
              // varchar(n)
              cur.next();
              cur.matchPunct(")");
            }
          } else if (["REAL", "FLOAT", "DOUBLE", "NUMERIC"].includes(up)) {
            type = up === "NUMERIC" ? "NUMERIC" : "REAL";
            cur.next();
          } else if (up === "BLOB") {
            type = "BLOB";
            cur.next();
          }
        }
        const col: ColumnDef = { name: colName, type };
        // column constraints loop
        for (;;) {
          if (isKwToken(cur.peek(), "PRIMARY")) {
            cur.next();
            cur.expectKw("KEY");
            if (isKwToken(cur.peek(), "AUTOINCREMENT")) cur.next();
            col.primaryKey = true;
            col.notNull = true;
          } else if (isKwToken(cur.peek(), "NOT")) {
            cur.next();
            cur.expectKw("NULL");
            col.notNull = true;
          } else if (isKwToken(cur.peek(), "NULL")) {
            cur.next();
          } else if (isKwToken(cur.peek(), "UNIQUE")) {
            cur.next();
            col.unique = true;
          } else if (isKwToken(cur.peek(), "DEFAULT")) {
            cur.next();
            const d = cur.peek();
            if (!d) throw new Error("Expected DEFAULT value");
            if (d.kind === "str") {
              cur.next();
              col.defaultValue = d.v;
            } else if (d.kind === "num") {
              cur.next();
              col.defaultValue = Number(d.v);
            } else if (d.kind === "word" && !d.quoted && d.v.toUpperCase() === "NULL") {
              cur.next();
              col.defaultValue = null;
            } else if (d.kind === "word" && !d.quoted && ["TRUE", "FALSE"].includes(d.v.toUpperCase())) {
              cur.next();
              col.defaultValue = d.v.toUpperCase() === "TRUE" ? 1 : 0;
            } else if (d.kind === "op" && d.v === "-") {
              cur.next();
              const n2 = cur.next();
              col.defaultValue = n2 && n2.kind === "num" ? -Number(n2.v) : 0;
            } else if (d.kind === "punct" && d.v === "(") {
              // DEFAULT (expr) — take inner literal
              cur.next();
              const inner = cur.next();
              col.defaultValue = inner?.kind === "num" ? Number(inner.v) : inner?.kind === "str" ? inner.v : null;
              cur.matchPunct(")");
            } else {
              cur.next();
              col.defaultValue = d.v as string;
            }
          } else if (isKwToken(cur.peek(), "REFERENCES")) {
            cur.next();
            const refTable = cur.readIdent();
            let refCol = "id";
            if (cur.matchPunct("(")) {
              refCol = cur.readIdent();
              if (!cur.matchPunct(")")) throw new Error("Expected ')'");
            }
            fks.push({ column: colName, referencesTable: refTable, referencesColumn: refCol });
          } else if (isKwToken(cur.peek(), "AUTOINCREMENT")) {
            cur.next();
            col.primaryKey = true;
          } else if (isKwToken(cur.peek(), "CHECK") || isKwToken(cur.peek(), "COLLATE")) {
            cur.next();
            // skip `(...)` or value
            if (cur.matchPunct("(")) {
              let depth = 1;
              while (!cur.eof() && depth > 0) {
                const q = cur.next()!;
                if (q.kind === "punct" && q.v === "(") depth++;
                if (q.kind === "punct" && q.v === ")") depth--;
              }
            } else cur.next();
          } else break;
        }
        columns.push(col);
      }
      if (cur.matchPunct(",")) {
        if (cur.peek()?.kind === "punct" && cur.peek()?.v === ")") break;
        continue;
      }
      break;
    }
    if (!cur.matchPunct(")")) throw new Error("Expected ')' to close CREATE TABLE");
    // apply table-level PKs
    for (const pk of pkTableCols) {
      const c = columns.find((x) => x.name.toLowerCase() === pk.toLowerCase());
      if (c) {
        c.primaryKey = true;
        c.notNull = true;
      }
    }
    if (ifNotExists && this.getTable(tableName)) {
      return {
        statementIndex: 0,
        statementType: "CREATE",
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        message: `Table '${tableName}' already exists — skipped`,
        success: true,
      };
    }
    this.createTable({ name: tableName, columns, foreignKeys: fks });
    return {
      statementIndex: 0,
      statementType: "CREATE",
      columns: [],
      rows: [],
      rowCount: 0,
      executionTimeMs: 0,
      message: `Table '${tableName}' created (${columns.length} columns)`,
      success: true,
    };
  }

  private parseInsert(cur: Cur): QueryResult {
    cur.next(); // INSERT
    if (isKwToken(cur.peek(), "OR")) {
      cur.next();
      // OR IGNORE / OR REPLACE
      cur.next();
    }
    cur.expectKw("INTO");
    const table = cur.readIdent();
    let cols: string[] | null = null;
    if (cur.matchPunct("(")) {
      cols = [cur.readIdent()];
      while (cur.matchPunct(",")) cols.push(cur.readIdent());
      if (!cur.matchPunct(")")) throw new Error("Expected ')' after column list");
    }
    // INSERT INTO t SELECT ... — support simple form
    if (isKwToken(cur.peek(), "SELECT")) {
      const ast = parseSelect(cur);
      const sel = this.runSelect(ast);
      if (!sel.success) throw new Error(sel.error ?? "SELECT failed");
      const td = this.getTable(table);
      if (!td) throw new Error(`Table '${table}' does not exist`);
      const targetCols = cols ?? td.schema.columns.map((c) => c.name);
      const n = this.insertRows(table, targetCols, sel.rows);
      return {
        statementIndex: 0,
        statementType: "INSERT",
        columns: [],
        rows: [],
        rowCount: n,
        affectedRows: n,
        executionTimeMs: 0,
        message: `${n} row${n === 1 ? "" : "s"} inserted into '${table}' (from SELECT)`,
        success: true,
      };
    }
    // DEFAULT VALUES
    if (isKwToken(cur.peek(), "DEFAULT")) {
      cur.next();
      cur.expectKw("VALUES");
      const td = this.getTable(table);
      if (!td) throw new Error(`Table '${table}' does not exist`);
      const targetCols = cols ?? td.schema.columns.map((c) => c.name);
      const vals = targetCols.map(() => null as SqlValue);
      const n = this.insertRows(table, targetCols, [vals]);
      return {
        statementIndex: 0,
        statementType: "INSERT",
        columns: [],
        rows: [],
        rowCount: n,
        affectedRows: n,
        executionTimeMs: 0,
        message: `${n} row inserted into '${table}'`,
        success: true,
      };
    }
    cur.expectKw("VALUES");
    const sets: SqlValue[][] = [];
    for (;;) {
      if (!cur.matchPunct("(")) throw new Error("Expected '(' in VALUES");
      const rowVals: SqlValue[] = [];
      if (!(cur.peek()?.kind === "punct" && cur.peek()?.v === ")")) {
        rowVals.push(this.evalValueExpr(parseAddSub(cur)));
        while (cur.matchPunct(",")) rowVals.push(this.evalValueExpr(parseAddSub(cur)));
      }
      if (!cur.matchPunct(")")) throw new Error("Expected ')' in VALUES");
      sets.push(rowVals);
      if (cur.matchPunct(",")) continue;
      break;
    }
    const n = this.insertRows(table, cols, sets);
    return {
      statementIndex: 0,
      statementType: "INSERT",
      columns: [],
      rows: [],
      rowCount: n,
      affectedRows: n,
      executionTimeMs: 0,
      message: `${n} row${n === 1 ? "" : "s"} inserted into '${table}'`,
      success: true,
    };
  }

  private parseUpdate(cur: Cur): QueryResult {
    cur.next(); // UPDATE
    const table = cur.readIdent();
    const td = this.getTable(table);
    if (!td) throw new Error(`Table '${table}' does not exist`);
    cur.expectKw("SET");
    const assigns: { col: string; expr: ExprNode }[] = [];
    for (;;) {
      const col = cur.readIdent();
      const eq = cur.next();
      if (!eq || !((eq.kind === "op" && eq.v === "=") || (eq.kind === "punct" && eq.v === "=")))
        throw new Error("Expected '=' in SET assignment");
      const expr = parseAddSub(cur);
      assigns.push({ col, expr });
      if (cur.matchPunct(",")) continue;
      break;
    }
    let where: CondNode | undefined;
    if (isKwToken(cur.peek(), "WHERE")) {
      cur.next();
      where = parseCondition(cur);
    }
    const colMap = new Map(td.schema.columns.map((c) => [c.name.toLowerCase(), c]));
    let affected = 0;
    for (let i = 0; i < td.rows.length; i++) {
      const row = td.rows[i];
      const jr = this.singleRowMap(td.schema.name, td.schema.columns.map((c) => c.name), row);
      if (where && !evalCond(where, jr)) continue;
      const newRow = { ...row };
      for (const a of assigns) {
        const def = colMap.get(a.col.toLowerCase());
        if (!def) throw new Error(`Table '${table}' has no column '${a.col}'`);
        newRow[def.name] = coerceValue(evalScalar(a.expr, jr), def.type);
      }
      this.checkConstraints(td, newRow, i);
      td.rows[i] = newRow;
      affected++;
    }
    return {
      statementIndex: 0,
      statementType: "UPDATE",
      columns: [],
      rows: [],
      rowCount: affected,
      affectedRows: affected,
      executionTimeMs: 0,
      message: `${affected} row${affected === 1 ? "" : "s"} updated in '${table}'`,
      success: true,
    };
  }

  private parseDelete(cur: Cur): QueryResult {
    cur.next(); // DELETE
    cur.expectKw("FROM");
    const table = cur.readIdent();
    const td = this.getTable(table);
    if (!td) throw new Error(`Table '${table}' does not exist`);
    let where: CondNode | undefined;
    if (isKwToken(cur.peek(), "WHERE")) {
      cur.next();
      where = parseCondition(cur);
    }
    if (!where) {
      const n = td.rows.length;
      td.rows = [];
      return {
        statementIndex: 0,
        statementType: "DELETE",
        columns: [],
        rows: [],
        rowCount: n,
        affectedRows: n,
        executionTimeMs: 0,
        message: `${n} row${n === 1 ? "" : "s"} deleted from '${table}'`,
        success: true,
      };
    }
    const kept: RowObject[] = [];
    let del = 0;
    for (const row of td.rows) {
      const jr = this.singleRowMap(td.schema.name, td.schema.columns.map((c) => c.name), row);
      if (evalCond(where, jr)) del++;
      else kept.push(row);
    }
    td.rows = kept;
    return {
      statementIndex: 0,
      statementType: "DELETE",
      columns: [],
      rows: [],
      rowCount: del,
      affectedRows: del,
      executionTimeMs: 0,
      message: `${del} row${del === 1 ? "" : "s"} deleted from '${table}'`,
      success: true,
    };
  }

  private parseDrop(cur: Cur): QueryResult {
    cur.next(); // DROP
    cur.expectKw("TABLE");
    let ifExists = false;
    if (isKwToken(cur.peek(), "IF")) {
      cur.next();
      cur.expectKw("EXISTS");
      ifExists = true;
    }
    const table = cur.readIdent();
    this.dropTable(table, ifExists);
    return {
      statementIndex: 0,
      statementType: "DROP",
      columns: [],
      rows: [],
      rowCount: 0,
      executionTimeMs: 0,
      message: `Table '${table}' dropped`,
      success: true,
    };
  }

  private parseAlter(cur: Cur): QueryResult {
    cur.next(); // ALTER
    cur.expectKw("TABLE");
    const table = cur.readIdent();
    const td = this.getTable(table);
    if (!td) throw new Error(`Table '${table}' does not exist`);
    if (isKwToken(cur.peek(), "ADD")) {
      cur.next();
      if (isKwToken(cur.peek(), "COLUMN")) cur.next();
      const colName = cur.readIdent();
      let type: ColumnType = "TEXT";
      const tp = cur.peek();
      if (tp && tp.kind === "word") {
        const up = tp.v.toUpperCase();
        if (["INTEGER", "INT"].includes(up)) {
          type = "INTEGER";
          cur.next();
        } else if (["REAL", "FLOAT", "DOUBLE"].includes(up)) {
          type = "REAL";
          cur.next();
        } else if (up === "BLOB") {
          type = "BLOB";
          cur.next();
        } else if (["TEXT", "VARCHAR", "CHAR", "NUMERIC"].includes(up)) {
          type = up === "NUMERIC" ? "NUMERIC" : "TEXT";
          cur.next();
          if (cur.matchPunct("(")) {
            cur.next();
            cur.matchPunct(")");
          }
        }
      }
      const col: ColumnDef = { name: colName, type };
      if (isKwToken(cur.peek(), "DEFAULT")) {
        cur.next();
        const d = cur.next();
        if (d?.kind === "str") col.defaultValue = d.v;
        else if (d?.kind === "num") col.defaultValue = Number(d.v);
        else if (d?.kind === "word" && d.v.toUpperCase() === "NULL") col.defaultValue = null;
      }
      if (td.schema.columns.some((c) => c.name.toLowerCase() === colName.toLowerCase()))
        throw new Error(`Column '${colName}' already exists`);
      td.schema.columns.push(col);
      for (const r of td.rows) r[colName] = col.defaultValue ?? null;
      return {
        statementIndex: 0,
        statementType: "ALTER",
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        message: `Column '${colName}' added to '${table}'`,
        success: true,
      };
    }
    if (isKwToken(cur.peek(), "DROP")) {
      cur.next();
      if (isKwToken(cur.peek(), "COLUMN")) cur.next();
      const col = cur.readIdent();
      td.schema.columns = td.schema.columns.filter((c) => c.name.toLowerCase() !== col.toLowerCase());
      for (const r of td.rows) delete r[col];
      return {
        statementIndex: 0,
        statementType: "ALTER",
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        message: `Column '${col}' dropped from '${table}'`,
        success: true,
      };
    }
    if (isKwToken(cur.peek(), "RENAME")) {
      cur.next();
      cur.expectKw("TO");
      const newName = cur.readIdent();
      const oldKey = td.schema.name.toLowerCase();
      td.schema.name = newName;
      this.tables.delete(oldKey);
      this.tables.set(newName.toLowerCase(), td);
      return {
        statementIndex: 0,
        statementType: "ALTER",
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        message: `Table renamed to '${newName}'`,
        success: true,
      };
    }
    throw new Error("ALTER TABLE supports ADD COLUMN, DROP COLUMN, RENAME TO");
  }

  private singleRowMap(alias: string, cols: string[], row: RowObject): JoinedRow {
    const m = new Map<string, SqlValue>();
    for (const c of cols) {
      m.set(`${alias.toLowerCase()}.${c.toLowerCase()}`, row[c] ?? null);
    }
    return m;
  }

  private evalValueExpr(e: ExprNode): SqlValue {
    // VALUES expressions have no row context
    return evalScalar(e, new Map());
  }

  // ---------------- SELECT execution ----------------
  private runSelect(ast: SelectAST): QueryResult {
    // expand stars
    let items = ast.items;
    if (ast.from) {
      const aliases: { alias: string; table: string }[] = [{ alias: ast.from.alias, table: ast.from.table }];
      for (const j of ast.joins) aliases.push({ alias: j.alias, table: j.table });
      const expanded: SelectItem[] = [];
      const multiTable = aliases.length > 1;
      for (const it of items) {
        if (it.expr.kind === "star") {
          for (const a of aliases) {
            const td = this.getTable(a.table);
            if (!td) throw new Error(`Table '${a.table}' does not exist`);
            for (const c of td.schema.columns) {
              expanded.push({
                expr: { kind: "col", table: a.alias, name: c.name },
                alias: multiTable ? `${a.alias}.${c.name}` : c.name,
                raw: multiTable ? `${a.alias}.${c.name}` : c.name,
              });
            }
          }
        } else if (it.expr.kind === "tstar") {
          const found = aliases.find((x) => x.alias.toLowerCase() === it.expr.kind && false);
          void found;
          const match = aliases.find((x) => x.alias.toLowerCase() === (it.expr as { table: string }).table.toLowerCase());
          if (!match) throw new Error(`Unknown table alias '${(it.expr as { table: string }).table}'`);
          const td = this.getTable(match.table);
          if (!td) throw new Error(`Table '${match.table}' does not exist`);
          for (const c of td.schema.columns) {
            expanded.push({
              expr: { kind: "col", table: match.alias, name: c.name },
              alias: multiTable ? `${match.alias}.${c.name}` : c.name,
              raw: c.name,
            });
          }
        } else expanded.push(it);
      }
      items = expanded;
    } else {
      // SELECT without FROM: stars invalid
      if (items.some((x) => x.expr.kind === "star" || x.expr.kind === "tstar"))
        throw new Error("SELECT * requires a FROM clause");
    }

    // build base rows
    let base: JoinedRow[];
    let aliasCols = new Map<string, string[]>(); // alias(lower) -> cols
    if (!ast.from) {
      base = [new Map()];
    } else {
      const fromTd = this.getTable(ast.from.table);
      if (!fromTd) throw new Error(`Table '${ast.from.table}' does not exist`);
      const fromAlias = ast.from.alias;
      aliasCols.set(fromAlias.toLowerCase(), fromTd.schema.columns.map((c) => c.name));
      base = fromTd.rows.map((r) => this.singleRowMap(fromAlias, fromTd.schema.columns.map((c) => c.name), r));
      for (const j of ast.joins) {
        const jtd = this.getTable(j.table);
        if (!jtd) throw new Error(`Table '${j.table}' does not exist`);
        aliasCols.set(j.alias.toLowerCase(), jtd.schema.columns.map((c) => c.name));
        const jcols = jtd.schema.columns.map((c) => c.name);
        if (j.type === "CROSS" || !j.on) {
          const out: JoinedRow[] = [];
          for (const l of base) {
            for (const r of jtd.rows) {
              const m = new Map(l);
              for (const c of jcols) m.set(`${j.alias.toLowerCase()}.${c.toLowerCase()}`, r[c] ?? null);
              out.push(m);
            }
          }
          // cross with empty right => empty
          base = out;
        } else if (j.type === "INNER") {
          const out: JoinedRow[] = [];
          for (const l of base) {
            for (const r of jtd.rows) {
              const m = new Map(l);
              for (const c of jcols) m.set(`${j.alias.toLowerCase()}.${c.toLowerCase()}`, r[c] ?? null);
              if (evalCond(j.on, m)) out.push(m);
            }
          }
          base = out;
        } else {
          // LEFT
          const out: JoinedRow[] = [];
          for (const l of base) {
            let matched = false;
            for (const r of jtd.rows) {
              const m = new Map(l);
              for (const c of jcols) m.set(`${j.alias.toLowerCase()}.${c.toLowerCase()}`, r[c] ?? null);
              if (evalCond(j.on, m)) {
                out.push(m);
                matched = true;
              }
            }
            if (!matched) {
              const m = new Map(l);
              for (const c of jcols) m.set(`${j.alias.toLowerCase()}.${c.toLowerCase()}`, null);
              out.push(m);
            }
          }
          base = out;
        }
      }
    }

    // WHERE
    let filtered = ast.where ? base.filter((r) => evalCond(ast.where!, r)) : base;

    const hasAgg = items.some((it) => containsAgg(it.expr)) || ast.groupBy.length > 0 || !!ast.having;
    const colNames = items.map((x) => x.alias);
    let outRows: SqlValue[][] = [];

    if (!hasAgg) {
      // project
      let projected = filtered.map((r) => items.map((it) => evalScalar(it.expr, r)));
      // distinct
      if (ast.distinct) projected = dedupe(projected);
      // order by
      if (ast.orderBy.length > 0) {
        const aliasIdx = new Map(colNames.map((c, i) => [c.toLowerCase(), i]));
        const pairs = filtered.map((r, i) => ({ r, vals: projected[i] }));
        // for distinct case pairs may mismatch; recompute mapping: use projected index alignment pre-distinct is complex.
        // Simpler: sort projected rows using alias/ordinal resolution only when possible; else sort by projected values.
        if (ast.distinct) {
          pairs.length = 0; // fallback: sort projected directly
          projected = sortProjected(projected, colNames, ast.orderBy);
        } else {
          pairs.sort((a, b) => {
            for (const o of ast.orderBy) {
              const va = resolveOrderVal(o.expr, a.r, a.vals, aliasIdx);
              const vb = resolveOrderVal(o.expr, b.r, b.vals, aliasIdx);
              const c = cmpVals(va, vb);
              if (c !== 0) return o.dir === "ASC" ? c : -c;
            }
            return 0;
          });
          projected = pairs.map((p) => p.vals);
        }
      }
      // limit/offset
      const off = ast.offset ?? 0;
      projected = ast.limit !== undefined ? projected.slice(off, off + ast.limit) : projected.slice(off);
      outRows = projected;
    } else {
      // grouping
      type Group = { key: string; keyVals: SqlValue[]; rows: JoinedRow[] };
      const groups = new Map<string, Group>();
      if (ast.groupBy.length === 0) {
        groups.set("__single__", { key: "__single__", keyVals: [], rows: filtered });
      } else {
        for (const r of filtered) {
          const kvs = ast.groupBy.map((g) => evalScalar(g, r));
          const key = JSON.stringify(kvs);
          let g = groups.get(key);
          if (!g) {
            g = { key, keyVals: kvs, rows: [] };
            groups.set(key, g);
          }
          g.rows.push(r);
        }
      }
      // having + projection per group
      const aliasIdx = new Map(colNames.map((c, i) => [c.toLowerCase(), i]));
      void aliasIdx;
      const grouped: { vals: SqlValue[]; aliasMap: Record<string, SqlValue>; firstRow: JoinedRow; rows: JoinedRow[] }[] = [];
      for (const [, g] of groups) {
        const first = g.rows[0] ?? new Map<string, SqlValue>();
        const vals = items.map((it) => evalAggExpr(it.expr, g.rows, first));
        const aliasMap: Record<string, SqlValue> = {};
        items.forEach((it, i) => {
          aliasMap[it.alias.toLowerCase()] = vals[i];
        });
        if (ast.having && !evalCondAgg(ast.having, g.rows, first, aliasMap)) continue;
        grouped.push({ vals, aliasMap, firstRow: first, rows: g.rows });
      }
      let valsArr = grouped.map((g) => g.vals);
      if (ast.distinct) valsArr = dedupe(valsArr);
      // order by for grouped: resolve via alias, ordinal, or agg expr
      if (ast.orderBy.length > 0) {
        // rebuild grouped alignment if deduped — for simplicity sort valsArr when distinct
        if (ast.distinct) {
          valsArr = sortProjected(valsArr, colNames, ast.orderBy);
        } else {
          grouped.sort((a, b) => {
            for (const o of ast.orderBy) {
              const va = resolveOrderValAgg(o.expr, a, colNames);
              const vb = resolveOrderValAgg(o.expr, b, colNames);
              const c = cmpVals(va, vb);
              if (c !== 0) return o.dir === "ASC" ? c : -c;
            }
            return 0;
          });
          valsArr = grouped.map((g) => g.vals);
        }
      }
      const off = ast.offset ?? 0;
      valsArr = ast.limit !== undefined ? valsArr.slice(off, off + ast.limit) : valsArr.slice(off);
      outRows = valsArr;
    }

    return {
      statementIndex: 0,
      statementType: "SELECT",
      columns: colNames,
      rows: outRows,
      rowCount: outRows.length,
      executionTimeMs: 0,
      message: `${outRows.length} row${outRows.length === 1 ? "" : "s"} returned`,
      success: true,
    };
  }

  exportDump(): string {
    const lines: string[] = [];
    lines.push("-- QueryPulse SQL dump — local_workspace.db");
    lines.push(`-- Generated ${new Date().toISOString()}`);
    lines.push("-- Engine: QueryPulse In-Memory v1.0");
    lines.push("");
    for (const [, td] of this.tables) {
      lines.push(generateDDL(td.schema) + ";");
      lines.push("");
      for (const r of td.rows) {
        const cols = td.schema.columns.map((c) => `"${c.name}"`).join(", ");
        const vals = td.schema.columns.map((c) => sqlLiteral(r[c.name] ?? null)).join(", ");
        lines.push(`INSERT INTO "${td.schema.name}" (${cols}) VALUES (${vals});`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
}

// ---------------- evaluation ----------------
function lookupCol(row: JoinedRow, table: string | undefined, name: string): SqlValue {
  const nl = name.toLowerCase();
  if (table) {
    const k = `${table.toLowerCase()}.${nl}`;
    if (row.has(k)) return row.get(k) ?? null;
    return null;
  }
  // exact key first (single-col maps use alias.col so search suffix)
  for (const [k, v] of row) {
    if (k === nl || k.endsWith(`.${nl}`)) return v;
  }
  return null;
}

function truthy(v: SqlValue): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    if (v === "") return false;
    const n = Number(v);
    if (!Number.isNaN(n)) return n !== 0;
    return true;
  }
  return false;
}

function likeMatch(value: string, pattern: string): boolean {
  // SQL LIKE: % = any seq, _ = single char. case-insensitive
  let rx = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "%") rx += ".*";
    else if (c === "_") rx += ".";
    else rx += escapeReg(c);
  }
  rx += "$";
  return new RegExp(rx, "is").test(value);
}

function escapeReg(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cmpVals(a: SqlValue, b: SqlValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // NULLS LAST
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  // numeric strings compare numerically if both numeric
  const an = typeof a === "string" && a.trim() !== "" ? Number(a) : NaN;
  const bn = typeof b === "string" && b.trim() !== "" ? Number(b) : NaN;
  if (!Number.isNaN(an) && !Number.isNaN(bn) && typeof a === typeof b) return an < bn ? -1 : an > bn ? 1 : 0;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function eqVals(a: SqlValue, b: SqlValue): boolean {
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "boolean" || typeof b === "boolean")
    return Number(a === true ? 1 : a === false ? 0 : a) === Number(b === true ? 1 : b === false ? 0 : b);
  // loose numeric equality
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b)))
    return a === Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a)))
    return Number(a) === b;
  return String(a).toLowerCase() === String(b).toLowerCase() ? String(a) === String(b) || String(a).toLowerCase() === String(b).toLowerCase() : false;
}

function evalScalar(expr: ExprNode, row: JoinedRow): SqlValue {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "star":
      return null;
    case "tstar":
      return null;
    case "col":
      return lookupCol(row, expr.table, expr.name);
    case "unary": {
      const v = evalScalar(expr.expr, row);
      if (expr.op === "NOT") return truthy(v) ? 0 : 1;
      if (v === null) return null;
      if (expr.op === "-") return typeof v === "number" ? -v : -Number(v);
      if (expr.op === "+") return typeof v === "number" ? v : Number(v);
      return v;
    }
    case "binary": {
      if (expr.op === "AND" || expr.op === "OR") {
        const l = truthy(evalScalar(expr.left, row));
        const r = truthy(evalScalar(expr.right, row));
        return expr.op === "AND" ? (l && r ? 1 : 0) : l || r ? 1 : 0;
      }
      if (["==", "=", "!=", "<>", "<", ">", "<=", ">="].includes(expr.op)) {
        const l = evalScalar(expr.left, row);
        const r = evalScalar(expr.right, row);
        if (l === null || r === null) return 0;
        if (expr.op === "==" || expr.op === "=") return eqVals(l, r) ? 1 : 0;
        if (expr.op === "!=" || expr.op === "<>") return eqVals(l, r) ? 0 : 1;
        const c = cmpVals(l, r);
        if (expr.op === "<") return c < 0 ? 1 : 0;
        if (expr.op === ">") return c > 0 ? 1 : 0;
        if (expr.op === "<=") return c <= 0 ? 1 : 0;
        if (expr.op === ">=") return c >= 0 ? 1 : 0;
        return 0;
      }
      if (expr.op.toUpperCase() === "LIKE" || expr.op.toUpperCase() === "GLOB") {
        const l = evalScalar(expr.left, row);
        const r = evalScalar(expr.right, row);
        if (l === null || r === null) return 0;
        return likeMatch(String(l), String(r)) ? 1 : 0;
      }
      const l = evalScalar(expr.left, row);
      const r = evalScalar(expr.right, row);
      if (expr.op === "||") {
        if (l === null || r === null) return null;
        return String(l) + String(r);
      }
      if (l === null || r === null) return null;
      const ln = typeof l === "number" ? l : typeof l === "boolean" ? (l ? 1 : 0) : Number(l);
      const rn = typeof r === "number" ? r : typeof r === "boolean" ? (r ? 1 : 0) : Number(r);
      if (expr.op === "+") return Number.isNaN(ln) || Number.isNaN(rn) ? null : ln + rn;
      if (expr.op === "-") return Number.isNaN(ln) || Number.isNaN(rn) ? null : ln - rn;
      if (expr.op === "*") return Number.isNaN(ln) || Number.isNaN(rn) ? null : ln * rn;
      if (expr.op === "/") {
        if (Number.isNaN(ln) || Number.isNaN(rn)) return null;
        if (rn === 0) return null;
        return ln / rn;
      }
      if (expr.op === "%") {
        if (Number.isNaN(ln) || Number.isNaN(rn)) return null;
        if (rn === 0) return null;
        return ln % rn;
      }
      return null;
    }
    case "cast": {
      const v = evalScalar(expr.expr, row);
      if (v === null) return null;
      const t = expr.asType.toUpperCase();
      if (t.includes("INT")) {
        const n = parseInt(String(v), 10);
        return Number.isNaN(n) ? 0 : n;
      }
      if (t.includes("REAL") || t.includes("FLOAT") || t.includes("DOUBLE") || t.includes("NUM")) {
        const n = Number(v);
        return Number.isNaN(n) ? 0 : n;
      }
      return String(v);
    }
    case "func": {
      const name = expr.name.toUpperCase();
      if (name === "__ORDINAL__") return evalScalar(expr.args[0], row);
      if (AGGS.has(name)) {
        // bare aggregate in scalar context: treat single row
        if (name === "COUNT") {
          const a = expr.args[0];
          if (!a || a.kind === "star") return 1;
          return evalScalar(a, row) === null ? 0 : 1;
        }
        const a = expr.args[0];
        if (!a) return null;
        return evalScalar(a, row);
      }
      return evalScalarFunc(name, expr.args.map((a) => evalScalar(a, row)));
    }
  }
}

function evalScalarFunc(name: string, args: SqlValue[]): SqlValue {
  switch (name) {
    case "UPPER":
      return args[0] === null ? null : String(args[0]).toUpperCase();
    case "LOWER":
      return args[0] === null ? null : String(args[0]).toLowerCase();
    case "LENGTH":
      return args[0] === null ? null : String(args[0]).length;
    case "TRIM":
      return args[0] === null ? null : String(args[0]).trim();
    case "LTRIM":
      return args[0] === null ? null : String(args[0]).trimStart();
    case "RTRIM":
      return args[0] === null ? null : String(args[0]).trimEnd();
    case "COALESCE":
    case "IFNULL": {
      for (const a of args) if (a !== null) return a;
      return null;
    }
    case "NULLIF":
      return eqVals(args[0], args[1]) ? null : args[0];
    case "ABS": {
      if (args[0] === null) return null;
      const n = Number(args[0]);
      return Number.isNaN(n) ? null : Math.abs(n);
    }
    case "ROUND": {
      if (args[0] === null) return null;
      const n = Number(args[0]);
      if (Number.isNaN(n)) return null;
      const d = args[1] !== undefined && args[1] !== null ? Number(args[1]) : 0;
      const f = Math.pow(10, Number.isNaN(d) ? 0 : d);
      return Math.round(n * f) / f;
    }
    case "SUBSTR":
    case "SUBSTRING": {
      if (args[0] === null) return null;
      const s = String(args[0]);
      const start = (Number(args[1]) || 1) - 1;
      const len = args[2] !== undefined && args[2] !== null ? Number(args[2]) : undefined;
      return len === undefined ? s.slice(Math.max(0, start)) : s.slice(Math.max(0, start), Math.max(0, start) + len);
    }
    case "CASEEVAL": {
      // args: [cond1, val1, cond2, val2, ..., else] — trailing ELSE always present
      if (args.length === 0) return null;
      for (let i = 0; i < args.length - 1; i += 2) {
        const cond = args[i];
        const val = args[i + 1];
        if (truthy(cond)) return val;
      }
      return args[args.length - 1];
    }
    case "ISNULL":
      return args[0] === null ? 1 : 0;
    case "ISNOTNULL":
      return args[0] !== null ? 1 : 0;
    case "IN": {
      const v = args[0];
      if (v === null) return 0;
      for (let i = 1; i < args.length; i++) if (eqVals(v, args[i])) return 1;
      return 0;
    }
    case "NOTIN": {
      const v = args[0];
      if (v === null) return 0;
      for (let i = 1; i < args.length; i++) if (eqVals(v, args[i])) return 0;
      return 1;
    }
    case "BETWEEN": {
      const [v, lo, hi] = args;
      if (v === null || lo === null || hi === null) return 0;
      return cmpVals(v, lo) >= 0 && cmpVals(v, hi) <= 0 ? 1 : 0;
    }
    case "NOTBETWEEN": {
      const [v, lo, hi] = args;
      if (v === null || lo === null || hi === null) return 0;
      return cmpVals(v, lo) >= 0 && cmpVals(v, hi) <= 0 ? 0 : 1;
    }
    default:
      // unknown scalar func — emulate by returning first arg string
      if (SCALAR_FUNCS.has(name)) return args[0] ?? null;
      return args.length ? args[0] : null;
  }
}

function evalCond(c: CondNode, row: JoinedRow): boolean {
  switch (c.t) {
    case "and":
      return evalCond(c.left, row) && evalCond(c.right, row);
    case "or":
      return evalCond(c.left, row) || evalCond(c.right, row);
    case "not":
      return !evalCond(c.expr, row);
    case "isnull": {
      const v = evalScalar(c.expr, row);
      return c.negated ? v !== null : v === null;
    }
    case "in": {
      const v = evalScalar(c.expr, row);
      if (v === null) return false;
      let found = false;
      for (const e of c.list) {
        if (eqVals(v, evalScalar(e, row))) {
          found = true;
          break;
        }
      }
      return c.negated ? !found : found;
    }
    case "between": {
      const v = evalScalar(c.expr, row);
      const lo = evalScalar(c.low, row);
      const hi = evalScalar(c.high, row);
      if (v === null || lo === null || hi === null) return false;
      const ok = cmpVals(v, lo) >= 0 && cmpVals(v, hi) <= 0;
      return c.negated ? !ok : ok;
    }
    case "cmp": {
      const l = evalScalar(c.left, row);
      const r = evalScalar(c.right, row);
      const op = c.op.toUpperCase();
      if (op === "LIKE" || op === "GLOB") {
        if (l === null || r === null) return false;
        return likeMatch(String(l), String(r));
      }
      if (l === null || r === null) return false;
      if (c.op === "=" || c.op === "==") return eqVals(l, r);
      if (c.op === "!=" || c.op === "<>") return !eqVals(l, r);
      const cmp = cmpVals(l, r);
      if (c.op === "<") return cmp < 0;
      if (c.op === ">") return cmp > 0;
      if (c.op === "<=") return cmp <= 0;
      if (c.op === ">=") return cmp >= 0;
      return false;
    }
  }
}

function containsAgg(e: ExprNode): boolean {
  if (e.kind === "func" && AGGS.has(e.name.toUpperCase())) return true;
  if (e.kind === "binary") return containsAgg(e.left) || containsAgg(e.right);
  if (e.kind === "unary") return containsAgg(e.expr);
  if (e.kind === "cast") return containsAgg(e.expr);
  if (e.kind === "func") return e.args.some(containsAgg);
  return false;
}

function evalAggExpr(expr: ExprNode, rows: JoinedRow[], first: JoinedRow): SqlValue {
  if (expr.kind === "func" && AGGS.has(expr.name.toUpperCase())) {
    return computeAgg(expr.name.toUpperCase(), expr.args[0], rows, !!expr.distinct);
  }
  if (expr.kind === "binary") {
    if (expr.op === "AND" || expr.op === "OR") {
      const l = truthy(evalAggExpr(expr.left, rows, first));
      const r = truthy(evalAggExpr(expr.right, rows, first));
      return expr.op === "AND" ? (l && r ? 1 : 0) : l || r ? 1 : 0;
    }
    if (["==", "=", "!=", "<>", "<", ">", "<=", ">="].includes(expr.op)) {
      const l = evalAggExpr(expr.left, rows, first);
      const r = evalAggExpr(expr.right, rows, first);
      if (l === null || r === null) return 0;
      if (expr.op === "==" || expr.op === "=") return eqVals(l, r) ? 1 : 0;
      if (expr.op === "!=" || expr.op === "<>") return eqVals(l, r) ? 0 : 1;
      const c = cmpVals(l, r);
      if (expr.op === "<") return c < 0 ? 1 : 0;
      if (expr.op === ">") return c > 0 ? 1 : 0;
      if (expr.op === "<=") return c <= 0 ? 1 : 0;
      if (expr.op === ">=") return c >= 0 ? 1 : 0;
      return 0;
    }
    if (expr.op.toUpperCase() === "LIKE" || expr.op.toUpperCase() === "GLOB") {
      const l = evalAggExpr(expr.left, rows, first);
      const r = evalAggExpr(expr.right, rows, first);
      if (l === null || r === null) return 0;
      return likeMatch(String(l), String(r)) ? 1 : 0;
    }
    const l = evalAggExpr(expr.left, rows, first);
    const r = evalAggExpr(expr.right, rows, first);
    if (expr.op === "||") {
      if (l === null || r === null) return null;
      return String(l) + String(r);
    }
    if (l === null || r === null) return null;
    const ln = Number(l);
    const rn = Number(r);
    if (Number.isNaN(ln) || Number.isNaN(rn)) return null;
    if (expr.op === "+") return ln + rn;
    if (expr.op === "-") return ln - rn;
    if (expr.op === "*") return ln * rn;
    if (expr.op === "/") return rn === 0 ? null : ln / rn;
    if (expr.op === "%") return rn === 0 ? null : ln % rn;
    return null;
  }
  if (expr.kind === "unary") {
    const v = evalAggExpr(expr.expr, rows, first);
    if (expr.op === "NOT") return truthy(v) ? 0 : 1;
    if (v === null) return null;
    return expr.op === "-" ? -Number(v) : Number(v);
  }
  if (expr.kind === "cast") {
    const v = evalAggExpr(expr.expr, rows, first);
    if (v === null) return null;
    const t = expr.asType.toUpperCase();
    if (t.includes("INT")) {
      const n = parseInt(String(v), 10);
      return Number.isNaN(n) ? 0 : n;
    }
    if (t.includes("REAL") || t.includes("FLOAT") || t.includes("NUM")) {
      const n = Number(v);
      return Number.isNaN(n) ? 0 : n;
    }
    return String(v);
  }
  if (expr.kind === "func") {
    // scalar func over agg args
    const vals = expr.args.map((a) => evalAggExpr(a, rows, first));
    return evalScalarFunc(expr.name.toUpperCase(), vals);
  }
  return evalScalar(expr, first);
}

function computeAgg(name: string, arg: ExprNode | undefined, rows: JoinedRow[], distinct: boolean): SqlValue {
  if (name === "COUNT") {
    if (!arg || arg.kind === "star") return rows.length;
    let vals: SqlValue[] = rows.map((r) => evalScalar(arg, r)).filter((v) => v !== null);
    if (distinct) vals = [...new Set(vals.map((v) => JSON.stringify(v)))].map((s) => JSON.parse(s) as SqlValue);
    return vals.length;
  }
  if (!arg) return null;
  let vals: SqlValue[] = rows.map((r) => evalScalar(arg, r)).filter((v) => v !== null);
  if (distinct) vals = [...new Set(vals.map((v) => JSON.stringify(v)))].map((s) => JSON.parse(s) as SqlValue);
  if (vals.length === 0) return null;
  if (name === "MIN") return vals.reduce((a, b) => (cmpVals(a, b) <= 0 ? a : b));
  if (name === "MAX") return vals.reduce((a, b) => (cmpVals(a, b) >= 0 ? a : b));
  const nums = vals.map((v) => (typeof v === "number" ? v : Number(v))).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return null;
  if (name === "SUM") return nums.reduce((a, b) => a + b, 0);
  if (name === "AVG") return nums.reduce((a, b) => a + b, 0) / nums.length;
  return null;
}

function evalCondAgg(c: CondNode, rows: JoinedRow[], first: JoinedRow, aliasMap: Record<string, SqlValue>): boolean {
  const evalE = (e: ExprNode): SqlValue => {
    // alias lookup first
    if (e.kind === "col" && !e.table && aliasMap[e.name.toLowerCase()] !== undefined) {
      return aliasMap[e.name.toLowerCase()];
    }
    if (containsAgg(e)) return evalAggExpr(e, rows, first);
    return evalScalar(e, first);
  };
  const run = (n: CondNode): boolean => {
    switch (n.t) {
      case "and":
        return run(n.left) && run(n.right);
      case "or":
        return run(n.left) || run(n.right);
      case "not":
        return !run(n.expr);
      case "isnull": {
        const v = evalE(n.expr);
        return n.negated ? v !== null : v === null;
      }
      case "in": {
        const v = evalE(n.expr);
        if (v === null) return false;
        let found = false;
        for (const e of n.list) if (eqVals(v, evalE(e))) found = true;
        return n.negated ? !found : found;
      }
      case "between": {
        const v = evalE(n.expr);
        const lo = evalE(n.low);
        const hi = evalE(n.high);
        if (v === null || lo === null || hi === null) return false;
        const ok = cmpVals(v, lo) >= 0 && cmpVals(v, hi) <= 0;
        return n.negated ? !ok : ok;
      }
      case "cmp": {
        const l = evalE(n.left);
        const r = evalE(n.right);
        if (n.op.toUpperCase() === "LIKE" || n.op.toUpperCase() === "GLOB") {
          if (l === null || r === null) return false;
          return likeMatch(String(l), String(r));
        }
        if (l === null || r === null) return false;
        if (n.op === "=" || n.op === "==") return eqVals(l, r);
        if (n.op === "!=" || n.op === "<>") return !eqVals(l, r);
        const cmp = cmpVals(l, r);
        if (n.op === "<") return cmp < 0;
        if (n.op === ">") return cmp > 0;
        if (n.op === "<=") return cmp <= 0;
        if (n.op === ">=") return cmp >= 0;
        return false;
      }
    }
  };
  return run(c);
}

function dedupe(rows: SqlValue[][]): SqlValue[][] {
  const seen = new Set<string>();
  const out: SqlValue[][] = [];
  for (const r of rows) {
    const k = JSON.stringify(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

function resolveOrderVal(
  expr: ExprNode,
  row: JoinedRow,
  projected: SqlValue[],
  aliasIdx: Map<string, number>
): SqlValue {
  if (expr.kind === "func" && expr.name === "__ORDINAL__") {
    const n = Number((expr.args[0] as { value: SqlValue }).value ?? 1);
    return projected[n - 1] ?? null;
  }
  if (expr.kind === "col" && !expr.table && aliasIdx.has(expr.name.toLowerCase())) {
    return projected[aliasIdx.get(expr.name.toLowerCase())!];
  }
  return evalScalar(expr, row);
}

function sortProjected(rows: SqlValue[][], colNames: string[], orderBy: { expr: ExprNode; dir: "ASC" | "DESC" }[]): SqlValue[][] {
  const aliasIdx = new Map(colNames.map((c, i) => [c.toLowerCase(), i]));
  return [...rows].sort((a, b) => {
    for (const o of orderBy) {
      let va: SqlValue = null;
      let vb: SqlValue = null;
      if (o.expr.kind === "func" && o.expr.name === "__ORDINAL__") {
        const n = Number(((o.expr.args[0] as unknown as { value: SqlValue }).value ?? 1) as number);
        va = a[n - 1] ?? null;
        vb = b[n - 1] ?? null;
      } else if (o.expr.kind === "col") {
        const key = o.expr.table ? `${o.expr.table}.${o.expr.name}`.toLowerCase() : o.expr.name.toLowerCase();
        const idx = aliasIdx.get(key) ?? aliasIdx.get(o.expr.name.toLowerCase());
        if (idx !== undefined) {
          va = a[idx];
          vb = b[idx];
        } else {
          va = null;
          vb = null;
        }
      }
      const c = cmpVals(va, vb);
      if (c !== 0) return o.dir === "ASC" ? c : -c;
    }
    return 0;
  });
}

function resolveOrderValAgg(
  expr: ExprNode,
  g: { vals: SqlValue[]; aliasMap: Record<string, SqlValue>; firstRow: JoinedRow; rows: JoinedRow[] },
  colNames: string[]
): SqlValue {
  if (expr.kind === "func" && expr.name === "__ORDINAL__") {
    const n = Number(((expr.args[0] as unknown as { value: SqlValue }).value ?? 1) as number);
    return g.vals[n - 1] ?? null;
  }
  if (expr.kind === "col" && !expr.table) {
    if (g.aliasMap[expr.name.toLowerCase()] !== undefined) return g.aliasMap[expr.name.toLowerCase()];
    // maybe group key col
    return evalScalar(expr, g.firstRow);
  }
  if (containsAgg(expr)) return evalAggExpr(expr, g.rows, g.firstRow);
  // colNames fallback
  const idx = colNames.findIndex((c) => c.toLowerCase() === exprToString(expr).toLowerCase());
  if (idx >= 0) return g.vals[idx];
  return evalScalar(expr, g.firstRow);
}

// ---------------- utils ----------------
function coerceValue(v: SqlValue, type: ColumnType): SqlValue {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (type === "INTEGER") {
    if (typeof v === "number") return Math.trunc(v);
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Math.trunc(Number(v));
    return v;
  }
  if (type === "REAL" || type === "NUMERIC") {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
    return v;
  }
  return v;
}

function formatVal(v: SqlValue): string {
  if (v === null) return "NULL";
  if (typeof v === "string") return `'${v}'`;
  return String(v);
}

function sqlLiteral(v: SqlValue): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${v.replace(/'/g, "''")}'`;
}

export function generateDDL(schema: TableSchema): string {
  const parts: string[] = [];
  for (const c of schema.columns) {
    let s = `  "${c.name}" ${c.type}`;
    if (c.primaryKey) s += " PRIMARY KEY";
    if (c.notNull && !c.primaryKey) s += " NOT NULL";
    if (c.unique && !c.primaryKey) s += " UNIQUE";
    if (c.defaultValue !== undefined && c.defaultValue !== null) s += ` DEFAULT ${sqlLiteral(c.defaultValue)}`;
    else if (c.defaultValue === null) s += " DEFAULT NULL";
    parts.push(s);
  }
  for (const fk of schema.foreignKeys) {
    parts.push(`  FOREIGN KEY ("${fk.column}") REFERENCES "${fk.referencesTable}"("${fk.referencesColumn}")`);
  }
  return `CREATE TABLE "${schema.name}" (\n${parts.join(",\n")}\n)`;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
