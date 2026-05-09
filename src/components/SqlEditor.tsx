import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  ChevronDown,
  Eraser,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import type { QueryResult } from "../engine/types";
import { highlightSql } from "../engine/sqlHighlight";
import { PRESET_QUERIES } from "../engine/seedData";
import ResultsGrid from "./ResultsGrid";
import { cn } from "../utils/cn";

export interface QueryTab {
  id: string;
  name: string;
  sql: string;
  results: QueryResult[];
  hasRun: boolean;
  activeResultIdx: number;
}

interface Props {
  tabs: QueryTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onAddTab: (sql?: string, name?: string) => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  onSqlChange: (id: string, sql: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
  onToast: (msg: string, kind?: "ok" | "err" | "info") => void;
  onSelectResult: (tabId: string, idx: number) => void;
}

function formatSql(sql: string): string {
  let s = sql.replace(/\s+/g, " ").trim();
  const kws = [
    "SELECT", "FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT", "OFFSET",
    "JOIN", "INNER JOIN", "LEFT JOIN", "LEFT OUTER JOIN", "CROSS JOIN",
    "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM",
    "CREATE TABLE", "DROP TABLE", "ALTER TABLE", "AND", "OR",
  ];
  // uppercase keywords
  for (const k of kws.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`, "gi");
    s = s.replace(re, k);
  }
  // newlines before major clauses
  s = s
    .replace(/\s+(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|JOIN|INNER JOIN|LEFT JOIN|LEFT OUTER JOIN|CROSS JOIN|VALUES|SET)\b/g, "\n$1")
    .replace(/;\s*/g, ";\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
  // indent continuation: lines not starting with major kw get 2-space indent when after SELECT/FROM etc.
  return s.trim() + (s.trim().endsWith(";") ? "" : ";");
}

export default function SqlEditor({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onRenameTab,
  onSqlChange,
  onExecute,
  isExecuting,
  onToast,
  onSelectResult,
}: Props) {
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const [showPresets, setShowPresets] = useState(false);
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [splitRatio, setSplitRatio] = useState(0.46);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const tokens = useMemo(() => highlightSql(active?.sql ?? ""), [active?.sql]);
  const lineCount = useMemo(() => (active?.sql ?? "").split("\n").length, [active?.sql]);

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  useEffect(() => {
    syncScroll();
  }, [active?.id]);

  // keyboard shortcut
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onExecute();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onExecute]);

  // split drag
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      setSplitRatio(Math.min(0.75, Math.max(0.2, ratio)));
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  if (!active) return null;
  const activeResult = active.results[active.activeResultIdx] ?? active.results[active.results.length - 1];

  const insertAtCursor = (snippet: string) => {
    const ta = taRef.current;
    if (!ta) {
      onSqlChange(active.id, active.sql + (active.sql.endsWith("\n") ? "" : "\n") + snippet);
      return;
    }
    const start = ta.selectionStart ?? active.sql.length;
    const end = ta.selectionEnd ?? active.sql.length;
    const next = active.sql.slice(0, start) + snippet + active.sql.slice(end);
    onSqlChange(active.id, next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
      syncScroll();
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[#070a12]">
      {/* tab bar */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#1e293b] bg-[#0b1120]/80 px-2 py-1.5">
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => onSelectTab(t.id)}
            onDoubleClick={() => {
              setEditingTab(t.id);
              setEditName(t.name);
            }}
            className={cn(
              "group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
              t.id === active.id
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                : "border-transparent text-slate-400 hover:border-[#1e293b] hover:bg-white/[0.03] hover:text-slate-200"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", t.id === active.id ? "bg-cyan-400" : "bg-slate-600")} />
            {editingTab === t.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => {
                  if (editName.trim()) onRenameTab(t.id, editName.trim().slice(0, 28));
                  setEditingTab(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (editName.trim()) onRenameTab(t.id, editName.trim().slice(0, 28));
                    setEditingTab(null);
                  }
                  if (e.key === "Escape") setEditingTab(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-24 rounded border border-cyan-500/50 bg-[#070a12] px-1 py-px text-xs text-white outline-none"
              />
            ) : (
              <span className="max-w-[140px] truncate">{t.name}</span>
            )}
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(t.id);
                }}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => onAddTab()}
          title="New query tab"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-[#1e293b] px-2 py-1.5 text-xs text-slate-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#1e293b]/70 bg-[#0b1120]/40 px-3 py-2">
        <button
          onClick={onExecute}
          disabled={isExecuting}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all",
            isExecuting
              ? "cursor-wait bg-emerald-600/50 text-emerald-100"
              : "bg-gradient-to-r from-emerald-500 to-emerald-400 text-[#070a12] shadow-[0_0_18px_rgba(16,185,129,0.35)] hover:shadow-[0_0_28px_rgba(16,185,129,0.55)]"
          )}
        >
          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" strokeWidth={2.75} />}
          {isExecuting ? "Running…" : "Run Query"}
          <kbd className="hidden rounded bg-black/25 px-1.5 py-px font-mono text-[10px] font-semibold lg:inline">⌘↵</kbd>
        </button>

        {/* presets */}
        <div className="relative">
          <button
            onClick={() => setShowPresets((v) => !v)}
            onBlur={() => setTimeout(() => setShowPresets(false), 150)}
            className="flex items-center gap-1.5 rounded-lg border border-[#1e293b] bg-[#0f172a]/60 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-violet-500/50 hover:text-violet-200"
          >
            <BookMarked className="h-3.5 w-3.5 text-violet-400" />
            Analytical Presets
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showPresets && "rotate-180")} />
          </button>
          {showPresets && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-[380px] overflow-hidden rounded-xl border border-[#1e293b] bg-[#0b1222]/98 shadow-2xl shadow-black/60 backdrop-blur-xl">
              <div className="border-b border-[#1e293b]/70 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Click to load into a new tab
              </div>
              <div className="max-h-[320px] overflow-y-auto p-1.5">
                {PRESET_QUERIES.map((p, i) => (
                  <button
                    key={i}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onAddTab(p.sql, p.name.slice(0, 26));
                      setShowPresets(false);
                      onToast(`Loaded preset: ${p.name}`, "info");
                    }}
                    className="group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-violet-500/10"
                  >
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400/70 group-hover:text-violet-300" />
                    <span>
                      <span className="block text-xs font-semibold text-slate-200 group-hover:text-white">{p.name}</span>
                      <span className="block font-mono text-[10px] text-slate-500">{p.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            onSqlChange(active.id, formatSql(active.sql));
            onToast("Query formatted", "info");
          }}
          title="Format SQL"
          className="flex items-center gap-1.5 rounded-lg border border-[#1e293b] bg-[#0f172a]/60 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-200"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Format
        </button>
        <button
          onClick={() => onSqlChange(active.id, "")}
          title="Clear editor"
          className="flex items-center gap-1.5 rounded-lg border border-[#1e293b] bg-[#0f172a]/60 px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-300"
        >
          <Eraser className="h-3.5 w-3.5" />
          Clear
        </button>

        <div className="ml-auto hidden items-center gap-2 font-mono text-[10px] text-slate-500 md:flex">
          <span>{active.sql.split("\n").length} lines</span>
          <span className="text-slate-700">•</span>
          <span>{active.sql.length} chars</span>
          {activeResult && active.hasRun && (
            <>
              <span className="text-slate-700">•</span>
              <span className="text-emerald-400/90">
                last run {activeResult.executionTimeMs < 10 ? activeResult.executionTimeMs.toFixed(1) : activeResult.executionTimeMs.toFixed(0)}ms
              </span>
            </>
          )}
        </div>
      </div>

      {/* split pane */}
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        {/* editor */}
        <div className="flex min-h-0 flex-col" style={{ height: `${splitRatio * 100}%` }}>
          <div className="flex min-h-0 flex-1">
            {/* gutter */}
            <div
              ref={gutterRef}
              className="w-12 shrink-0 overflow-hidden border-r border-[#1e293b]/60 bg-[#0a0f1d] py-3 text-right font-mono text-[12px] leading-[1.7] text-slate-700"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="pr-3">
                  {i + 1}
                </div>
              ))}
            </div>
            {/* code area */}
            <div className="sql-stack min-w-0 flex-1">
              <pre
                ref={preRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-4 py-3"
              >
                {tokens.map((t, i) => (
                  <span key={i} className={t.cls}>
                    {t.text}
                  </span>
                ))}
                {"\n"}
              </pre>
              <textarea
                ref={taRef}
                value={active.sql}
                onChange={(e) => onSqlChange(active.id, e.target.value)}
                onScroll={syncScroll}
                onKeyDown={(e) => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    insertAtCursor("  ");
                  }
                }}
                spellCheck={false}
                placeholder="-- Write SQL here… e.g. SELECT * FROM users LIMIT 10;"
                className="absolute inset-0 h-full w-full overflow-auto whitespace-pre px-4 py-3"
              />
            </div>
          </div>
        </div>

        {/* drag handle */}
        <div
          onMouseDown={() => {
            dragging.current = true;
          }}
          className="group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center border-y border-[#1e293b]/70 bg-[#0b1120]/60 transition-colors hover:bg-cyan-500/10"
        >
          <div className="h-1 w-16 rounded-full bg-[#1e293b] transition-colors group-hover:bg-cyan-500/50" />
        </div>

        {/* results */}
        <div className="flex min-h-0 flex-1 flex-col bg-[#0a0f1d]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[#1e293b]/70 px-3 py-1.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">Results</span>
            {active.hasRun && active.results.length > 1 && (
              <div className="flex items-center gap-1">
                {active.results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => onSelectResult(active.id, i)}
                    title={r.message}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      i === active.activeResultIdx
                        ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                        : "border-[#1e293b] text-slate-500 hover:text-slate-300"
                    )}
                  >
                    #{i + 1} {r.statementType}
                  </button>
                ))}
              </div>
            )}
            {active.hasRun && active.results.length > 1 && (
              <span className="font-mono text-[10px] text-slate-600">
                showing statement #{active.activeResultIdx + 1} of {active.results.length}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {active.hasRun && activeResult ? (
              <ResultsGrid
                columns={activeResult.columns}
                rows={activeResult.rows}
                rowCount={activeResult.rowCount}
                executionTimeMs={activeResult.executionTimeMs}
                success={activeResult.success}
                message={activeResult.message}
                error={activeResult.error}
                statementType={activeResult.statementType}
                hasRun={active.hasRun}
                onCopyMessage={(m) => onToast(m, "ok")}
              />
            ) : (
              <ResultsGrid
                columns={[]}
                rows={[]}
                rowCount={0}
                executionTimeMs={null}
                success={true}
                message=""
                hasRun={false}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
