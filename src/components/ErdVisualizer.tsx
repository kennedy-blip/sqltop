import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  KeyRound,
  Link2,
  Minus,
  Move,
  Network,
  Plus,
  Table2,
  Trash2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ColumnType, TableSchema } from "../engine/types";
import { generateDDL } from "../engine/sqlEngine";
import { highlightSql } from "../engine/sqlHighlight";
import { cn } from "../utils/cn";

interface Props {
  tables: TableSchema[];
  rowCounts: Record<string, number>;
  onExecuteDDL: (ddl: string) => { success: boolean; message: string };
  onToast: (msg: string, kind?: "ok" | "err" | "info") => void;
  onDropTable: (table: string) => void;
  onPreviewTable: (table: string) => void;
}

interface BuilderCol {
  id: string;
  name: string;
  type: ColumnType;
  pk: boolean;
  nn: boolean;
  unique: boolean;
  defaultVal: string;
  fkTable: string;
  fkCol: string;
}

const CARD_W = 228;
const HEADER_H = 42;
const ROW_H = 27;

let colSeq = 0;
const newCol = (over: Partial<BuilderCol> = {}): BuilderCol => ({
  id: `c${Date.now()}_${colSeq++}`,
  name: "",
  type: "TEXT",
  pk: false,
  nn: false,
  unique: false,
  defaultVal: "",
  fkTable: "",
  fkCol: "",
  ...over,
});

export default function ErdVisualizer({ tables, rowCounts, onExecuteDDL, onToast, onDropTable, onPreviewTable }: Props) {
  const [tableName, setTableName] = useState("events");
  const [cols, setCols] = useState<BuilderCol[]>([
    newCol({ name: "id", type: "INTEGER", pk: true, nn: true }),
    newCol({ name: "user_id", type: "INTEGER", fkTable: "users", fkCol: "id" }),
    newCol({ name: "title", type: "TEXT", nn: true }),
    newCol({ name: "created_at", type: "TEXT" }),
  ]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [zoom, setZoom] = useState(1);
  const [hoverTable, setHoverTable] = useState<string | null>(null);
  const dragRef = useRef<{ table: string; dx: number; dy: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // auto layout new tables
  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      tables.forEach((t, i) => {
        if (!next[t.name]) {
          const col = i % 3;
          const row = Math.floor(i / 3);
          next[t.name] = { x: 40 + col * (CARD_W + 90), y: 40 + row * 300 };
        }
      });
      // prune removed
      for (const k of Object.keys(next)) {
        if (!tables.some((t) => t.name === k)) delete next[k];
      }
      return next;
    });
  }, [tables]);

  const ddl = useMemo(() => {
    const name = tableName.trim() || "new_table";
    const columns = cols
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name.trim(),
        type: c.type,
        primaryKey: c.pk || undefined,
        notNull: c.nn || c.pk || undefined,
        unique: c.unique || undefined,
        defaultValue:
          c.defaultVal.trim() === ""
            ? undefined
            : c.defaultVal.trim().toLowerCase() === "null"
              ? null
              : c.type === "INTEGER" || c.type === "REAL" || c.type === "NUMERIC"
                ? Number.isNaN(Number(c.defaultVal.trim()))
                  ? c.defaultVal.trim()
                  : Number(c.defaultVal.trim())
                : c.defaultVal.trim(),
      }));
    const fks = cols
      .filter((c) => c.name.trim() && c.fkTable.trim() && c.fkCol.trim())
      .map((c) => ({
        column: c.name.trim(),
        referencesTable: c.fkTable.trim(),
        referencesColumn: c.fkCol.trim(),
      }));
    if (columns.length === 0) return `-- Add at least one column to generate DDL`;
    return generateDDL({ name, columns, foreignKeys: fks }) + ";";
  }, [tableName, cols]);

  const ddlTokens = useMemo(() => highlightSql(ddl), [ddl]);

  const updateCol = (id: string, patch: Partial<BuilderCol>) =>
    setCols((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleCreate = () => {
    if (!tableName.trim()) {
      onToast("Table name is required", "err");
      return;
    }
    if (!cols.some((c) => c.name.trim())) {
      onToast("Add at least one column", "err");
      return;
    }
    const res = onExecuteDDL(ddl);
    onToast(res.message, res.success ? "ok" : "err");
    if (res.success) {
      setTableName("");
      setCols([newCol({ name: "id", type: "INTEGER", pk: true, nn: true })]);
    }
  };

  const copyDDL = async () => {
    try {
      await navigator.clipboard.writeText(ddl);
      onToast("DDL copied to clipboard", "ok");
    } catch {
      onToast("Clipboard unavailable", "err");
    }
  };

  // drag handlers
  const onCardDown = (e: React.MouseEvent, table: string) => {
    const pos = positions[table];
    if (!pos || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    dragRef.current = {
      table,
      dx: (e.clientX - rect.left) / zoom - pos.x,
      dy: (e.clientY - rect.top) / zoom - pos.y,
    };
    e.preventDefault();
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom - dragRef.current.dx;
      const y = (e.clientY - rect.top) / zoom - dragRef.current.dy;
      const t = dragRef.current.table;
      setPositions((p) => ({ ...p, [t]: { x: Math.max(0, x), y: Math.max(0, y) } }));
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [zoom]);

  const edges = useMemo(() => {
    const list: {
      key: string;
      from: string;
      to: string;
      label: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }[] = [];
    for (const t of tables) {
      const sp = positions[t.name];
      if (!sp) continue;
      t.foreignKeys.forEach((fk, i) => {
        const tp = positions[fk.referencesTable];
        if (!tp) return;
        const srcIdx = Math.max(
          0,
          t.columns.findIndex((c) => c.name.toLowerCase() === fk.column.toLowerCase())
        );
        const tgtTable = tables.find((x) => x.name === fk.referencesTable);
        const tgtIdx = tgtTable
          ? Math.max(0, tgtTable.columns.findIndex((c) => c.name.toLowerCase() === fk.referencesColumn.toLowerCase()))
          : 0;
        const x1 = sp.x + CARD_W;
        const y1 = sp.y + HEADER_H + srcIdx * ROW_H + ROW_H / 2;
        const x2 = tp.x;
        const y2 = tp.y + HEADER_H + tgtIdx * ROW_H + ROW_H / 2;
        list.push({
          key: `${t.name}.${fk.column}->${fk.referencesTable}.${fk.referencesColumn}#${i}`,
          from: t.name,
          to: fk.referencesTable,
          label: fk.column,
          x1,
          y1,
          x2,
          y2,
        });
      });
    }
    return list;
  }, [tables, positions]);

  const canvasH = useMemo(() => {
    let maxY = 600;
    for (const t of tables) {
      const p = positions[t.name];
      if (p) maxY = Math.max(maxY, p.y + HEADER_H + t.columns.length * ROW_H + 120);
    }
    return maxY;
  }, [tables, positions]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[#070a12] lg:flex-row">
      {/* ---------- builder panel ---------- */}
      <div className="flex w-full flex-col border-b border-[#1e293b] bg-[#0b1120]/90 lg:w-[380px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 border-b border-[#1e293b]/70 px-4 py-3">
          <Wand2 className="h-4 w-4 text-violet-400" />
          <h2 className="text-sm font-bold text-white">Table Builder</h2>
          <span className="ml-auto font-mono text-[10px] text-slate-500">DDL auto-generates</span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {/* table name */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Table name
            </label>
            <input
              value={tableName}
              onChange={(e) => setTableName(e.target.value.replace(/[^A-Za-z0-9_]/g, "_"))}
              placeholder="e.g. events"
              className="qp-focus w-full rounded-lg border border-[#1e293b] bg-[#070a12]/80 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600"
            />
          </div>

          {/* columns */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Columns ({cols.length})
              </label>
              <button
                onClick={() => setCols((p) => [...p, newCol()])}
                className="flex items-center gap-1 rounded-md border border-[#1e293b] px-2 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
            <div className="space-y-2">
              {cols.map((c) => (
                <div key={c.id} className="rounded-lg border border-[#1e293b] bg-[#0f172a]/60 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={c.name}
                      onChange={(e) => updateCol(c.id, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") })}
                      placeholder="column_name"
                      className="qp-focus min-w-0 flex-1 rounded-md border border-[#1e293b] bg-[#070a12]/80 px-2 py-1.5 font-mono text-xs text-white placeholder:text-slate-600"
                    />
                    <select
                      value={c.type}
                      onChange={(e) => updateCol(c.id, { type: e.target.value as ColumnType })}
                      className="qp-focus shrink-0 rounded-md border border-[#1e293b] bg-[#070a12]/80 px-1.5 py-1.5 font-mono text-[11px] text-slate-200"
                    >
                      <option value="INTEGER">INTEGER</option>
                      <option value="TEXT">TEXT</option>
                      <option value="REAL">REAL</option>
                      <option value="NUMERIC">NUMERIC</option>
                      <option value="BLOB">BLOB</option>
                    </select>
                    <button
                      onClick={() => setCols((p) => p.filter((x) => x.id !== c.id))}
                      className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                      title="Remove column"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => updateCol(c.id, { pk: !c.pk, nn: !c.pk ? true : c.nn })}
                      className={cn(
                        "flex items-center gap-1 rounded border px-1.5 py-1 font-mono text-[10px] transition-all",
                        c.pk
                          ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-300"
                          : "border-[#1e293b] text-slate-500 hover:text-slate-300"
                      )}
                      title="Primary key"
                    >
                      <KeyRound className="h-2.5 w-2.5" /> PK
                    </button>
                    <button
                      onClick={() => updateCol(c.id, { nn: !c.nn })}
                      className={cn(
                        "rounded border px-1.5 py-1 font-mono text-[10px] transition-all",
                        c.nn ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-[#1e293b] text-slate-500 hover:text-slate-300"
                      )}
                      title="NOT NULL"
                    >
                      NN
                    </button>
                    <button
                      onClick={() => updateCol(c.id, { unique: !c.unique })}
                      className={cn(
                        "rounded border px-1.5 py-1 font-mono text-[10px] transition-all",
                        c.unique ? "border-amber-500/60 bg-amber-500/15 text-amber-300" : "border-[#1e293b] text-slate-500 hover:text-slate-300"
                      )}
                      title="UNIQUE"
                    >
                      UQ
                    </button>
                    <input
                      value={c.defaultVal}
                      onChange={(e) => updateCol(c.id, { defaultVal: e.target.value })}
                      placeholder="DEFAULT"
                      className="qp-focus w-20 rounded border border-[#1e293b] bg-[#070a12]/80 px-1.5 py-1 font-mono text-[10px] text-slate-200 placeholder:text-slate-600"
                    />
                  </div>
                  {/* FK row */}
                  <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-dashed border-[#1e293b] bg-[#070a12]/40 px-2 py-1.5">
                    <Link2 className={cn("h-3 w-3 shrink-0", c.fkTable ? "text-violet-400" : "text-slate-600")} />
                    <select
                      value={c.fkTable}
                      onChange={(e) => updateCol(c.id, { fkTable: e.target.value, fkCol: e.target.value ? "id" : "" })}
                      className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-slate-300 outline-none"
                    >
                      <option value="" className="bg-[#0f172a]">No FK</option>
                      {tables.map((t) => (
                        <option key={t.name} value={t.name} className="bg-[#0f172a]">
                          → {t.name}
                        </option>
                      ))}
                    </select>
                    {c.fkTable && (
                      <select
                        value={c.fkCol}
                        onChange={(e) => updateCol(c.id, { fkCol: e.target.value })}
                        className="w-20 shrink-0 bg-transparent font-mono text-[10px] text-violet-300 outline-none"
                      >
                        {(tables.find((t) => t.name === c.fkTable)?.columns ?? []).map((col) => (
                          <option key={col.name} value={col.name} className="bg-[#0f172a]">
                            .{col.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DDL preview */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Generated DDL
              </label>
              <button
                onClick={copyDDL}
                className="flex items-center gap-1 rounded-md border border-[#1e293b] px-2 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-[#1e293b] bg-[#070a12] p-3 font-mono text-[11px] leading-relaxed">
              {ddlTokens.map((t, i) => (
                <span key={i} className={t.cls}>
                  {t.text}
                </span>
              ))}
            </pre>
          </div>
        </div>

        <div className="border-t border-[#1e293b]/70 p-3">
          <button
            onClick={handleCreate}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-violet-400 px-4 py-2.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.35)] transition-all hover:shadow-[0_0_30px_rgba(139,92,246,0.55)]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.75} />
            Create Table
          </button>
        </div>
      </div>

      {/* ---------- ERD canvas ---------- */}
      <div className="flex min-h-[420px] min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-[#1e293b]/70 bg-[#0b1120]/40 px-4 py-2.5">
          <Network className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-white">Entity-Relationship Diagram</h2>
          <span className="font-mono text-[10px] text-slate-500">
            {tables.length} tables • {edges.length} relations • drag cards to arrange
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}
              className="rounded-md border border-[#1e293b] p-1.5 text-slate-400 hover:text-white"
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 text-center font-mono text-[11px] text-slate-400">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}
              className="rounded-md border border-[#1e293b] p-1.5 text-slate-400 hover:text-white"
              title="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-auto bg-[#070a12]">
          {tables.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <Table2 className="h-10 w-10 text-slate-700" />
              <p className="text-sm font-semibold text-slate-300">No tables to visualize</p>
              <p className="font-mono text-[11px] text-slate-500">Seed the sample dataset or build a table on the left.</p>
            </div>
          ) : (
            <div
              ref={canvasRef}
              className="erd-grid relative"
              style={{ width: 1400 * zoom, height: canvasH * zoom, minWidth: "100%", minHeight: "100%" }}
            >
              <div className="absolute inset-0" style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: 1400, height: canvasH }}>
                {/* edges */}
                <svg className="absolute inset-0" width={1400} height={canvasH} style={{ overflow: "visible" }}>
                  <defs>
                    <marker id="qp-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8 Z" fill="#8b5cf6" />
                    </marker>
                    <marker id="qp-arrow-dim" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8 Z" fill="#475569" />
                    </marker>
                  </defs>
                  {edges.map((e) => {
                    const active = !hoverTable || hoverTable === e.from || hoverTable === e.to;
                    const mx = (e.x1 + e.x2) / 2;
                    const d = `M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2 - 4} ${e.y2}`;
                    return (
                      <g key={e.key} opacity={active ? 1 : 0.25}>
                        <path d={d} fill="none" stroke={active ? "#8b5cf6" : "#475569"} strokeWidth={active ? 2 : 1.5} markerEnd={active ? "url(#qp-arrow)" : "url(#qp-arrow-dim)"} />
                        <text
                          x={mx}
                          y={(e.y1 + e.y2) / 2 - 6}
                          textAnchor="middle"
                          fontSize={9}
                          fontFamily="JetBrains Mono, monospace"
                          fill={active ? "#a78bfa" : "#475569"}
                        >
                          {e.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* cards */}
                {tables.map((t) => {
                  const p = positions[t.name] ?? { x: 40, y: 40 };
                  const dim = hoverTable && hoverTable !== t.name && !edges.some((e) => (e.from === hoverTable && e.to === t.name) || (e.to === hoverTable && e.from === t.name));
                  return (
                    <div
                      key={t.name}
                      onMouseEnter={() => setHoverTable(t.name)}
                      onMouseLeave={() => setHoverTable(null)}
                      className={cn(
                        "absolute overflow-hidden rounded-xl border bg-[#0d1526]/95 shadow-xl shadow-black/40 backdrop-blur transition-opacity",
                        hoverTable === t.name ? "border-violet-500/60" : "border-[#1e293b]"
                      )}
                      style={{ left: p.x, top: p.y, width: CARD_W, opacity: dim ? 0.45 : 1 }}
                    >
                      {/* header (drag handle) */}
                      <div
                        onMouseDown={(e) => onCardDown(e, t.name)}
                        className="flex cursor-move items-center gap-2 border-b border-[#1e293b] bg-gradient-to-r from-cyan-500/10 to-violet-500/10 px-3"
                        style={{ height: HEADER_H }}
                      >
                        <Table2 className="h-4 w-4 shrink-0 text-cyan-400" />
                        <span className="truncate font-mono text-xs font-bold text-white">{t.name}</span>
                        <span className="ml-auto shrink-0 rounded-full border border-[#1e293b] bg-[#070a12]/70 px-1.5 py-px font-mono text-[10px] text-slate-400">
                          {(rowCounts[t.name] ?? 0).toLocaleString()}
                        </span>
                        <Move className="h-3 w-3 shrink-0 text-slate-600" />
                      </div>
                      {/* columns */}
                      <div>
                        {t.columns.map((c) => {
                          const isFk = t.foreignKeys.some((f) => f.column.toLowerCase() === c.name.toLowerCase());
                          return (
                            <div
                              key={c.name}
                              className="flex items-center gap-1.5 border-b border-[#1e293b]/40 px-3 last:border-b-0"
                              style={{ height: ROW_H }}
                            >
                              {c.primaryKey ? (
                                <KeyRound className="h-3 w-3 shrink-0 text-cyan-400" />
                              ) : isFk ? (
                                <Link2 className="h-3 w-3 shrink-0 text-violet-400" />
                              ) : (
                                <span className="h-3 w-3 shrink-0" />
                              )}
                              <span className={cn("truncate font-mono text-[11px]", c.primaryKey ? "font-semibold text-cyan-200" : "text-slate-300")}>
                                {c.name}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[9px] text-slate-500">{c.type}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* footer */}
                      <div className="flex items-center gap-1 border-t border-[#1e293b] bg-[#070a12]/50 px-2 py-1">
                        <button
                          onClick={() => onPreviewTable(t.name)}
                          className="rounded px-1.5 py-1 font-mono text-[10px] text-slate-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => onDropTable(t.name)}
                          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[10px] text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                        >
                          <Trash2 className="h-2.5 w-2.5" /> Drop
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* relation legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1e293b]/70 bg-[#0b1120]/40 px-4 py-2 font-mono text-[10px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-6 rounded bg-violet-500" /> foreign-key relation
          </span>
          <span className="flex items-center gap-1.5">
            <KeyRound className="h-3 w-3 text-cyan-400" /> PK
          </span>
          <span className="flex items-center gap-1.5">
            <Link2 className="h-3 w-3 text-violet-400" /> FK
          </span>
          <span className="ml-auto hidden sm:inline">Tip: hover a table to isolate its relations</span>
        </div>
      </div>
    </div>
  );
}
