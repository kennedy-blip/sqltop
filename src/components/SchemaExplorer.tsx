import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  KeyRound,
  Link2,
  Plus,
  Search,
  Table2,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { TableSchema } from "../engine/types";
import { cn } from "../utils/cn";

interface Props {
  tables: TableSchema[];
  rowCounts: Record<string, number>;
  onInsertSnippet: (sql: string) => void;
  onPreviewTable: (table: string) => void;
  onDropTable: (table: string) => void;
  onNewTable: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  INTEGER: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  TEXT: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  REAL: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  NUMERIC: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  BLOB: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

export default function SchemaExplorer({ tables, rowCounts, onInsertSnippet, onPreviewTable, onDropTable, onNewTable }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ users: true, api_logs: true, embeddings_meta: true });
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(
      (t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [tables, search]);

  const toggle = (name: string) => setExpanded((p) => ({ ...p, [name]: !p[name] }));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[#1e293b] bg-[#0b1120]/95">
      {/* header */}
      <div className="flex items-center justify-between border-b border-[#1e293b]/70 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          <Database className="h-3.5 w-3.5 text-cyan-400" />
          Schema Explorer
        </div>
        <button
          onClick={onNewTable}
          title="New table (opens ERD Builder)"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-[#1e293b] text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* search */}
      <div className="border-b border-[#1e293b]/70 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter tables / columns…"
            className="qp-focus w-full rounded-lg border border-[#1e293b] bg-[#070a12]/80 py-1.5 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-600"
          />
        </div>
      </div>

      {/* tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <div className="mt-8 text-center">
            <Table2 className="mx-auto h-8 w-8 text-slate-700" />
            <p className="mt-2 text-xs text-slate-500">
              {tables.length === 0 ? "No tables yet. Seed or import data." : "No matches for filter."}
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          {filtered.map((t) => {
            const isOpen = expanded[t.name] ?? false;
            const fkCols = new Set(t.foreignKeys.map((f) => f.column.toLowerCase()));
            return (
              <div key={t.name} className="overflow-hidden rounded-lg border border-[#1e293b] bg-[#0f172a]/60">
                {/* table row */}
                <div
                  className="group flex cursor-pointer items-center gap-1.5 px-2 py-2 transition-colors hover:bg-cyan-500/5"
                  onClick={() => toggle(t.name)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  )}
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <span className="truncate font-mono text-xs font-semibold text-slate-100">{t.name}</span>
                  <span className="ml-auto shrink-0 rounded-full border border-[#1e293b] bg-[#070a12]/70 px-1.5 py-px font-mono text-[10px] text-slate-400">
                    {(rowCounts[t.name] ?? 0).toLocaleString()}
                  </span>
                </div>

                {/* quick actions */}
                <div className="flex items-center gap-1 border-t border-[#1e293b]/60 bg-[#070a12]/40 px-2 py-1">
                  <button
                    onClick={() => onInsertSnippet(`SELECT * FROM ${t.name} LIMIT 100;`)}
                    title="Insert SELECT * snippet"
                    className="flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:bg-cyan-500/10 hover:text-cyan-300"
                  >
                    <TerminalSquare className="h-3 w-3" />
                    SELECT *
                  </button>
                  <button
                    onClick={() => onPreviewTable(t.name)}
                    title="Run SELECT * preview"
                    className="flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                  <button
                    onClick={() => onDropTable(t.name)}
                    title="Drop table"
                    className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[10px] text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* columns */}
                {isOpen && (
                  <div className="border-t border-[#1e293b]/60 p-1.5">
                    <div className="space-y-0.5">
                      {t.columns.map((c) => {
                        const isFk = fkCols.has(c.name.toLowerCase());
                        const fk = t.foreignKeys.find((f) => f.column.toLowerCase() === c.name.toLowerCase());
                        return (
                          <div
                            key={c.name}
                            className="group/col flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.04]"
                            title={fk ? `FK → ${fk.referencesTable}(${fk.referencesColumn})` : c.name}
                            onClick={() => onInsertSnippet(`${t.name}.${c.name}`)}
                          >
                            {c.primaryKey ? (
                              <KeyRound className="h-3 w-3 shrink-0 text-cyan-400" />
                            ) : isFk ? (
                              <Link2 className="h-3 w-3 shrink-0 text-violet-400" />
                            ) : (
                              <span className="h-3 w-3 shrink-0 text-center font-mono text-[9px] text-slate-600">•</span>
                            )}
                            <span
                              className={cn(
                                "truncate font-mono text-[11px]",
                                c.primaryKey ? "font-semibold text-cyan-200" : "text-slate-300"
                              )}
                            >
                              {c.name}
                            </span>
                            {c.primaryKey && (
                              <span className="shrink-0 rounded border border-cyan-500/40 bg-cyan-500/15 px-1 font-mono text-[9px] font-bold text-cyan-300">
                                PK
                              </span>
                            )}
                            {isFk && (
                              <span className="shrink-0 rounded border border-violet-500/40 bg-violet-500/15 px-1 font-mono text-[9px] font-bold text-violet-300">
                                FK
                              </span>
                            )}
                            <span
                              className={cn(
                                "ml-auto shrink-0 rounded border px-1 font-mono text-[9px]",
                                TYPE_COLORS[c.type] ?? TYPE_COLORS.TEXT
                              )}
                            >
                              {c.type}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {t.foreignKeys.length > 0 && (
                      <div className="mt-1.5 space-y-1 border-t border-[#1e293b]/60 pt-1.5">
                        {t.foreignKeys.map((f, i) => (
                          <div key={i} className="flex items-center gap-1 px-1.5 font-mono text-[10px] text-violet-300/80">
                            <Link2 className="h-2.5 w-2.5" />
                            <span className="truncate">
                              {f.column} → {f.referencesTable}.{f.referencesColumn}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* legend */}
      <div className="border-t border-[#1e293b]/70 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <KeyRound className="h-2.5 w-2.5 text-cyan-400" /> primary key
          </span>
          <span className="flex items-center gap-1">
            <Link2 className="h-2.5 w-2.5 text-violet-400" /> foreign key
          </span>
          <span className="ml-auto text-slate-600">click col → insert</span>
        </div>
      </div>
    </aside>
  );
}
