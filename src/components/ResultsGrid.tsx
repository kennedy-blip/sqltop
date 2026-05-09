import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  Search,
  Table2,
  XCircle,
} from "lucide-react";
import type { SqlValue } from "../engine/types";
import { toCSV, toJSON } from "../engine/csvUtils";
import { cn } from "../utils/cn";

interface Props {
  columns: string[];
  rows: SqlValue[][];
  rowCount: number;
  executionTimeMs: number | null;
  success: boolean;
  message: string;
  error?: string;
  statementType?: string;
  hasRun: boolean;
  onCopyMessage?: (msg: string) => void;
}

const PAGE_SIZE = 50;

export default function ResultsGrid({
  columns,
  rows,
  rowCount,
  executionTimeMs,
  success,
  message,
  error,
  statementType,
  hasRun,
  onCopyMessage,
}: Props) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setPage(0);
    setSortCol(null);
    setFilter("");
  }, [rows, columns]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.some((v) => (v === null ? "null" : String(v)).toLowerCase().includes(q)));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    if (sortCol === null) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      let c: number;
      if (typeof va === "number" && typeof vb === "number") c = va - vb;
      else c = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sortDir === "asc" ? c : -c;
    });
    return copy;
  }, [filtered, sortCol, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (idx: number) => {
    if (sortCol !== idx) {
      setSortCol(idx);
      setSortDir("asc");
    } else if (sortDir === "asc") setSortDir("desc");
    else setSortCol(null);
  };

  const exportCSV = () => {
    const csv = toCSV(columns, sorted);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `querypulse_results_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onCopyMessage?.(`Exported ${sorted.length} rows to CSV`);
  };

  const exportJSON = () => {
    const json = toJSON(columns, sorted);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `querypulse_results_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onCopyMessage?.(`Exported ${sorted.length} rows to JSON`);
  };

  const copyTSV = async () => {
    const tsv = [columns.join("\t"), ...sorted.map((r) => r.map((v) => (v === null ? "NULL" : String(v))).join("\t"))].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      onCopyMessage?.(`Copied ${sorted.length} rows to clipboard`);
    } catch {
      onCopyMessage?.("Clipboard unavailable in this browser");
    }
  };

  if (!hasRun) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#1e293b] bg-[#0f172a]">
          <Table2 className="h-6 w-6 text-slate-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-300">No results yet</p>
          <p className="mt-1 font-mono text-[11px] text-slate-500">
            Write SQL above and press <span className="rounded border border-[#1e293b] bg-[#0f172a] px-1 text-cyan-300">⌘/Ctrl + Enter</span> to run
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* status bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#1e293b]/70 px-3 py-2">
        {success ? (
          <span className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] font-medium text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {statementType && statementType !== "SELECT" ? `${statementType} OK` : "Query OK"}
            {executionTimeMs !== null && (
              <span className="text-emerald-400/70">• {executionTimeMs < 10 ? executionTimeMs.toFixed(1) : executionTimeMs.toFixed(0)}ms</span>
            )}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 font-mono text-[11px] font-medium text-rose-300">
            <XCircle className="h-3.5 w-3.5" />
            Query failed
          </span>
        )}
        <span className="truncate font-mono text-[11px] text-slate-400" title={message}>
          {message}
          {filter && success && ` • ${filtered.length}/${rowCount} match filter`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {success && rows.length > 0 && (
            <>
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                <input
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Filter rows…"
                  className="qp-focus w-36 rounded-md border border-[#1e293b] bg-[#070a12]/80 py-1 pl-7 pr-2 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
                />
              </div>
              <button
                onClick={copyTSV}
                title="Copy as TSV"
                className="flex items-center gap-1 rounded-md border border-[#1e293b] px-2 py-1 font-mono text-[11px] text-slate-400 transition-colors hover:border-slate-500/60 hover:text-white"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button
                onClick={exportCSV}
                title="Export results as CSV"
                className="flex items-center gap-1 rounded-md border border-[#1e293b] px-2 py-1 font-mono text-[11px] text-slate-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
              >
                <FileSpreadsheet className="h-3 w-3" /> CSV
              </button>
              <button
                onClick={exportJSON}
                title="Export results as JSON"
                className="flex items-center gap-1 rounded-md border border-[#1e293b] px-2 py-1 font-mono text-[11px] text-slate-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
              >
                <FileJson className="h-3 w-3" /> JSON
              </button>
            </>
          )}
          {success && rows.length === 0 && <Download className="h-3.5 w-3.5 text-slate-600" />}
        </div>
      </div>

      {/* error */}
      {!success && error && (
        <div className="m-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.07] p-3">
          <p className="font-mono text-xs leading-relaxed text-rose-200">{error}</p>
          <p className="mt-2 font-mono text-[11px] text-slate-500">
            Tip: supported statements are SELECT (JOIN / WHERE / GROUP BY / HAVING / ORDER BY / LIMIT), CREATE TABLE, INSERT,
            UPDATE, DELETE, DROP TABLE, ALTER TABLE, EXPLAIN, PRAGMA.
          </p>
        </div>
      )}

      {/* grid */}
      {success && columns.length > 0 && (
        <>
          <div className="relative flex-1 overflow-auto">
            <table className="dgrid w-full border-collapse font-mono text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[3] w-12 border-b border-r border-[#1e293b] bg-[#0b1222] px-2 py-2 text-center text-[10px] font-medium text-slate-600">
                    #
                  </th>
                  {columns.map((c, i) => (
                    <th
                      key={i}
                      onClick={() => toggleSort(i)}
                      className="cursor-pointer select-none whitespace-nowrap border-b border-r border-[#1e293b] px-3 py-2 text-left text-[11px] font-semibold text-slate-300 transition-colors last:border-r-0 hover:bg-cyan-500/5 hover:text-cyan-200"
                      title="Click to sort"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {c}
                        {sortCol === i ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3 text-cyan-400" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-cyan-400" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-700" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, ri) => (
                  <tr key={ri} className="border-b border-[#1e293b]/40">
                    <td className="sticky left-0 border-r border-[#1e293b]/60 bg-[#0b1222]/95 px-2 py-1.5 text-center text-[10px] text-slate-600">
                      {safePage * PAGE_SIZE + ri + 1}
                    </td>
                    {r.map((v, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "max-w-[320px] truncate border-r border-[#1e293b]/40 px-3 py-1.5 last:border-r-0",
                          v === null
                            ? "italic text-amber-500/90"
                            : typeof v === "number"
                              ? "text-right text-cyan-200"
                              : "text-slate-200"
                        )}
                        title={v === null ? "NULL" : String(v)}
                      >
                        {v === null ? "NULL" : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 1} className="px-3 py-8 text-center font-sans text-xs text-slate-500">
                      {filter ? "No rows match the current filter." : "Query returned 0 rows."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* pagination */}
          <div className="flex items-center gap-2 border-t border-[#1e293b]/70 px-3 py-1.5 font-mono text-[11px] text-slate-500">
            <span>
              {sorted.length.toLocaleString()} row{sorted.length === 1 ? "" : "s"}
              {sorted.length !== rowCount && ` (filtered from ${rowCount.toLocaleString()})`}
            </span>
            <span className="text-slate-700">•</span>
            <span>{columns.length} cols</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                disabled={safePage === 0}
                onClick={() => setPage(0)}
                className="rounded border border-[#1e293b] px-1.5 py-0.5 disabled:opacity-30 hover:text-slate-200"
              >
                «
              </button>
              <button
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                className="rounded border border-[#1e293b] px-1.5 py-0.5 disabled:opacity-30 hover:text-slate-200"
              >
                ‹
              </button>
              <span className="px-1.5 text-slate-400">
                {safePage + 1} / {pageCount}
              </span>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                className="rounded border border-[#1e293b] px-1.5 py-0.5 disabled:opacity-30 hover:text-slate-200"
              >
                ›
              </button>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(pageCount - 1)}
                className="rounded border border-[#1e293b] px-1.5 py-0.5 disabled:opacity-30 hover:text-slate-200"
              >
                »
              </button>
            </div>
          </div>
        </>
      )}

      {success && columns.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="font-mono text-xs text-slate-500">{message}</p>
        </div>
      )}
    </div>
  );
}
