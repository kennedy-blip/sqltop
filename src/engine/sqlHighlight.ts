export interface HToken {
  text: string;
  cls: string;
}

const KW_CYAN = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "OFFSET",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "ON", "AS", "AND",
  "OR", "NOT", "IN", "BETWEEN", "LIKE", "ILIKE", "IS", "NULL", "ASC", "DESC",
  "DISTINCT", "ALL", "UNION", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST",
  "EXISTS", "WITH",
]);
const KW_VIOLET = new Set([
  "CREATE", "TABLE", "DROP", "ALTER", "ADD", "COLUMN", "INSERT", "INTO", "VALUES",
  "UPDATE", "SET", "DELETE", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE",
  "CONSTRAINT", "INDEX", "IF", "DEFAULT", "CHECK",
]);
const KW_AMBER = new Set([
  "INTEGER", "INT", "TEXT", "VARCHAR", "CHAR", "REAL", "FLOAT", "DOUBLE",
  "NUMERIC", "BLOB", "BOOLEAN", "BOOL", "DATE", "DATETIME", "AUTOINCREMENT",
]);
const KW_EMERALD = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "UPPER", "LOWER", "LENGTH", "TRIM",
  "LTRIM", "RTRIM", "COALESCE", "ROUND", "ABS", "SUBSTR", "SUBSTRING", "IFNULL",
  "NULLIF", "EXPLAIN", "PRAGMA", "SHOW", "TABLES", "DESCRIBE", "DESC",
]);

export function highlightSql(sql: string): HToken[] {
  const out: HToken[] = [];
  let i = 0;
  const n = sql.length;
  let buf = "";
  const flushPlain = () => {
    if (buf) {
      out.push({ text: buf, cls: "text-slate-200" });
      buf = "";
    }
  };
  while (i < n) {
    const c = sql[i];
    // line comment
    if (c === "-" && sql[i + 1] === "-") {
      flushPlain();
      let j = i;
      while (j < n && sql[j] !== "\n") j++;
      out.push({ text: sql.slice(i, j), cls: "text-slate-500 italic" });
      i = j;
      continue;
    }
    // block comment
    if (c === "/" && sql[i + 1] === "*") {
      flushPlain();
      let j = i + 2;
      while (j < n && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
      j += 2;
      out.push({ text: sql.slice(i, j), cls: "text-slate-500 italic" });
      i = j;
      continue;
    }
    // string
    if (c === "'") {
      flushPlain();
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") {
          j++;
          break;
        } else j++;
      }
      out.push({ text: sql.slice(i, j), cls: "text-emerald-300" });
      i = j;
      continue;
    }
    // quoted ident
    if (c === '"' || c === "`") {
      flushPlain();
      let j = i + 1;
      while (j < n && sql[j] !== c) j++;
      j++;
      out.push({ text: sql.slice(i, j), cls: "text-amber-200" });
      i = j;
      continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      flushPlain();
      let j = i;
      while (j < n && /[0-9.]/.test(sql[j])) j++;
      out.push({ text: sql.slice(i, j), cls: "text-amber-300" });
      i = j;
      continue;
    }
    // word
    if (/[A-Za-z_]/.test(c)) {
      flushPlain();
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const up = word.toUpperCase();
      if (KW_CYAN.has(up)) out.push({ text: word, cls: "text-cyan-300 font-semibold" });
      else if (KW_VIOLET.has(up)) out.push({ text: word, cls: "text-violet-300 font-semibold" });
      else if (KW_AMBER.has(up)) out.push({ text: word, cls: "text-amber-300" });
      else if (KW_EMERALD.has(up)) out.push({ text: word, cls: "text-emerald-300 font-medium" });
      else if (up === "TRUE" || up === "FALSE") out.push({ text: word, cls: "text-amber-300" });
      else out.push({ text: word, cls: "text-slate-200" });
      i = j;
      continue;
    }
    // operators / punct
    if ("=<>!+-*/%(),;.".includes(c) || c === "|") {
      flushPlain();
      // combine 2-char ops
      const two = sql.slice(i, i + 2);
      if (["<=", ">=", "<>", "!=", "==", "||"].includes(two)) {
        out.push({ text: two, cls: "text-rose-300" });
        i += 2;
      } else {
        out.push({ text: c, cls: c === ";" || c === "," ? "text-slate-400" : "text-rose-300" });
        i++;
      }
      continue;
    }
    buf += c;
    i++;
  }
  flushPlain();
  return out;
}
