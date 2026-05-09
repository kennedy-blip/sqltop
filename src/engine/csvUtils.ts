import type { ColumnDef, ColumnType, SqlValue, TableSchema } from "./types";

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    cur.push(field);
    field = "";
  };
  const pushRow = () => {
    // skip fully empty rows
    if (cur.length === 0 && field === "") return;
    pushField();
    if (!(cur.length === 1 && cur[0].trim() === "")) rows.push(cur);
    cur = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ",") {
        pushField();
        i++;
      } else if (c === "\r") {
        i++;
      } else if (c === "\n") {
        pushRow();
        i++;
      } else {
        field += c;
        i++;
      }
    }
  }
  pushRow();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h, idx) => sanitizeName(h.trim() || `col_${idx + 1}`));
  // dedupe headers
  const seen = new Set<string>();
  const deduped = headers.map((h) => {
    let n = h;
    let k = 2;
    while (seen.has(n.toLowerCase())) {
      n = `${h}_${k++}`;
    }
    seen.add(n.toLowerCase());
    return n;
  });
  return { headers: deduped, rows: rows.slice(1) };
}

export function sanitizeName(raw: string): string {
  let s = raw.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(s)) s = "c_" + s;
  if (!s) s = "col";
  return s.toLowerCase();
}

export function inferColumnType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== "" && v !== null && v !== undefined);
  if (nonEmpty.length === 0) return "TEXT";
  const isInt = nonEmpty.every((v) => /^[-+]?\d+$/.test(v.trim()));
  if (isInt) return "INTEGER";
  const isReal = nonEmpty.every((v) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v.trim()));
  if (isReal) return "REAL";
  return "TEXT";
}

export function coerceCell(raw: string, type: ColumnType): SqlValue {
  if (raw === "" || raw === undefined) return null;
  const t = raw.trim();
  if (t === "" || t.toLowerCase() === "null" || t.toLowerCase() === "nil") return null;
  if (type === "INTEGER") {
    const n = parseInt(t, 10);
    return Number.isNaN(n) ? t : n;
  }
  if (type === "REAL") {
    const n = Number(t);
    return Number.isNaN(n) ? t : n;
  }
  if (t.toLowerCase() === "true") return 1;
  if (t.toLowerCase() === "false") return 0;
  return raw;
}

export interface ImportPreview {
  schema: TableSchema;
  rows: SqlValue[][];
  rawRows: string[][];
}

export function buildImportFromCSV(text: string, tableName: string): ImportPreview {
  const { headers, rows } = parseCSV(text);
  if (headers.length === 0) throw new Error("CSV has no header row");
  const cols: ColumnDef[] = headers.map((h, idx) => ({
    name: h,
    type: inferColumnType(rows.map((r) => r[idx] ?? "")),
  }));
  // first column named id -> PK
  if (cols[0] && cols[0].name === "id" && cols[0].type === "INTEGER") {
    cols[0].primaryKey = true;
    cols[0].notNull = true;
  }
  const typed: SqlValue[][] = rows.map((r) => cols.map((c, idx) => coerceCell(r[idx] ?? "", c.type)));
  return { schema: { name: sanitizeName(tableName), columns: cols, foreignKeys: [] }, rows: typed, rawRows: rows };
}

export function buildImportFromJSON(text: string, tableName: string): ImportPreview {
  const parsed: unknown = JSON.parse(text);
  const arr: Record<string, unknown>[] = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
  if (arr.length === 0) throw new Error("JSON array is empty");
  if (typeof arr[0] !== "object" || arr[0] === null) throw new Error("JSON must be an array of objects");
  const keys = [...new Set(arr.flatMap((o) => Object.keys(o as object)))].map(sanitizeName);
  if (keys.length === 0) throw new Error("No keys found in JSON");
  // infer types from values
  const cols: ColumnDef[] = keys.map((k) => {
    const vals = arr.map((o) => (o as Record<string, unknown>)[k] ?? (o as Record<string, unknown>)[k.toLowerCase()]);
    const nonNull = vals.filter((v) => v !== null && v !== undefined && v !== "");
    let type: ColumnType = "TEXT";
    if (nonNull.length > 0) {
      if (nonNull.every((v) => typeof v === "number" && Number.isInteger(v))) type = "INTEGER";
      else if (nonNull.every((v) => typeof v === "number" || typeof v === "boolean")) type = nonNull.every((v) => typeof v === "boolean") ? "INTEGER" : "REAL";
      else if (nonNull.every((v) => typeof v === "string" && /^[-+]?\d+$/.test(v.trim()))) type = "INTEGER";
      else if (nonNull.every((v) => typeof v === "string" && !Number.isNaN(Number(v.trim())) && v.trim() !== "")) type = "REAL";
    }
    return { name: k, type };
  });
  if (cols[0] && cols[0].name === "id" && cols[0].type === "INTEGER") {
    cols[0].primaryKey = true;
  }
  const typed: SqlValue[][] = arr.map((o) => {
    const rec = o as Record<string, unknown>;
    return cols.map((c) => {
      const raw = rec[c.name] ?? rec[Object.keys(rec).find((k) => sanitizeName(k) === c.name) ?? ""] ?? null;
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "number") return raw;
      if (typeof raw === "boolean") return raw ? 1 : 0;
      if (typeof raw === "object") return JSON.stringify(raw);
      return coerceCell(String(raw), c.type);
    });
  });
  return { schema: { name: sanitizeName(tableName), columns: cols, foreignKeys: [] }, rows: typed, rawRows: [] };
}

export function toCSV(columns: string[], rows: SqlValue[][]): string {
  const esc = (v: SqlValue): string => {
    if (v === null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = columns.map((c) => (c.includes(",") || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
  return [head, ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function toJSON(columns: string[], rows: SqlValue[][]): string {
  const arr = rows.map((r) => {
    const o: Record<string, SqlValue> = {};
    columns.forEach((c, i) => {
      o[c] = r[i] ?? null;
    });
    return o;
  });
  return JSON.stringify(arr, null, 2);
}

export function downloadFile(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
