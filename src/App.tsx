import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Info, PanelLeft, ShieldCheck, X } from "lucide-react";
import StudioHeader from "./components/StudioHeader";
import SchemaExplorer from "./components/SchemaExplorer";
import SqlEditor, { type QueryTab } from "./components/SqlEditor";
import ErdVisualizer from "./components/ErdVisualizer";
import { InMemoryDB } from "./engine/sqlEngine";
import { PRESET_QUERIES, seedSampleDataset } from "./engine/seedData";
import {
  buildImportFromCSV,
  buildImportFromJSON,
  downloadFile,
  sanitizeName,
  type ImportPreview,
} from "./engine/csvUtils";
import type { EngineSnapshot, TableSchema } from "./engine/types";
import { cn } from "./utils/cn";

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "err" | "info";
}

let toastSeq = 0;
let tabSeq = 0;
const newTabId = () => `tab_${Date.now()}_${tabSeq++}`;

const WELCOME_SQL = `-- ⚡ Welcome to QueryPulse — Sovereign Local-First SQL Studio
-- All queries run in-memory. Zero network calls. Try ⌘/Ctrl + Enter.

SELECT u.name, u.country, u.plan, COUNT(l.id) AS api_calls,
  ROUND(AVG(l.latency_ms), 1) AS avg_latency_ms
FROM users AS u
LEFT JOIN api_logs AS l ON l.user_id = u.id
GROUP BY u.name, u.country, u.plan
ORDER BY api_calls DESC
LIMIT 12;
`;

export default function App() {
  const dbRef = useRef<InMemoryDB | null>(null);
  if (!dbRef.current) dbRef.current = new InMemoryDB();
  const db = dbRef.current;

  const [snapshot, setSnapshot] = useState<EngineSnapshot>({ tables: [], rowCounts: {}, totalRows: 0 });
  const [tabs, setTabs] = useState<QueryTab[]>([
    { id: newTabId(), name: "Welcome", sql: WELCOME_SQL, results: [], hasRun: false, activeResultIdx: 0 },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [view, setView] = useState<"studio" | "erd">("studio");
  const [isExecuting, setIsExecuting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastMs, setLastMs] = useState<number | null>(null);

  // import modal
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importName, setImportName] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [showMobileSchema, setShowMobileSchema] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeId = activeTabId || tabs[0]?.id || "";

  const refresh = useCallback(() => {
    const tables: TableSchema[] = db.listSchemas();
    const rowCounts = db.rowCounts();
    setSnapshot({ tables, rowCounts, totalRows: db.totalRows() });
  }, [db]);

  const toast = useCallback((msg: string, kind: Toast["kind"] = "ok") => {
    const id = ++toastSeq;
    setToasts((p) => [...p.slice(-4), { id, msg, kind }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3800);
  }, []);

  // initial seed
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    try {
      seedSampleDataset(db);
      refresh();
      const firstId = newTabId();
      setTabs([
        { id: firstId, name: "Welcome", sql: WELCOME_SQL, results: [], hasRun: false, activeResultIdx: 0 },
        { id: newTabId(), name: "Spend by model", sql: PRESET_QUERIES[4].sql, results: [], hasRun: false, activeResultIdx: 0 },
      ]);
      setActiveTabId(firstId);
      // auto-run welcome query
      setTimeout(() => {
        try {
          const res = db.execute(WELCOME_SQL);
          setTabs((prev) =>
            prev.map((t) =>
              t.id === firstId
                ? {
                    ...t,
                    results: res,
                    hasRun: true,
                    activeResultIdx: Math.max(
                      0,
                      res.findIndex((r) => r.statementType === "SELECT" && r.success)
                    ),
                  }
                : t
            )
          );
          const sel = res.find((r) => r.statementType === "SELECT");
          if (sel) setLastMs(sel.executionTimeMs);
        } catch {
          /* noop */
        }
      }, 60);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Seed failed", "err");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executeActive = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || isExecuting) return;
    if (!tab.sql.trim()) {
      toast("Editor is empty — write some SQL first", "info");
      return;
    }
    setIsExecuting(true);
    // defer to let UI paint the running state
    setTimeout(() => {
      try {
        const res = db.execute(tab.sql);
        const selIdx = res.findIndex((r) => r.statementType === "SELECT");
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? { ...t, results: res, hasRun: true, activeResultIdx: selIdx >= 0 ? selIdx : res.length - 1 }
              : t
          )
        );
        refresh();
        const last = res[res.length - 1];
        setLastMs(last.executionTimeMs);
        const failed = res.find((r) => !r.success);
        if (failed) toast(failed.error ?? "Query failed", "err");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Execution failed", "err");
      } finally {
        setIsExecuting(false);
      }
    }, 30);
  }, [tabs, activeId, isExecuting, db, refresh, toast]);

  const handleSeed = useCallback(() => {
    try {
      const { tables, rows } = seedSampleDataset(db);
      refresh();
      toast(`Seeded ${tables} tables • ${rows.toLocaleString()} rows (users, api_logs, embeddings_meta)`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Seed failed", "err");
    }
  }, [db, refresh, toast]);

  const handleExportDump = useCallback(() => {
    try {
      if (snapshot.tables.length === 0) {
        toast("No tables to export — seed or import data first", "info");
        return;
      }
      const dump = db.exportDump();
      downloadFile("local_workspace_dump.sql", dump, "application/sql");
      toast(`Exported SQL dump (${snapshot.tables.length} tables • ${snapshot.totalRows.toLocaleString()} rows)`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed", "err");
    }
  }, [db, snapshot, toast]);

  const handleFileChosen = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        if (!text.trim()) {
          toast("File is empty", "err");
          return;
        }
        const ext = file.name.split(".").pop()?.toLowerCase();
        const base = sanitizeName(file.name.replace(/\.[^.]+$/, "") || "imported");
        let preview: ImportPreview;
        if (ext === "json" || text.trim().startsWith("[") || text.trim().startsWith("{")) {
          try {
            preview = buildImportFromJSON(text, base);
          } catch {
            preview = buildImportFromCSV(text, base);
          }
        } else {
          preview = buildImportFromCSV(text, base);
        }
        if (preview.schema.columns.length === 0) {
          toast("Could not detect columns in file", "err");
          return;
        }
        // ensure unique table name
        let name = preview.schema.name || base || "imported";
        let k = 2;
        while (db.getTable(name)) name = `${preview.schema.name}_${k++}`;
        preview.schema.name = name;
        setImportPreview(preview);
        setImportName(name);
        setImportFileName(file.name);
      } catch (e) {
        toast(e instanceof Error ? `Import parse failed: ${e.message}` : "Import failed", "err");
      }
    },
    [db, toast]
  );

  const confirmImport = useCallback(() => {
    if (!importPreview) return;
    const name = sanitizeName(importName.trim() || importPreview.schema.name);
    if (!name) {
      toast("Table name is required", "err");
      return;
    }
    if (db.getTable(name)) {
      toast(`Table '${name}' already exists`, "err");
      return;
    }
    try {
      const schema = { ...importPreview.schema, name };
      db.createTable(schema);
      const cols = schema.columns.map((c) => c.name);
      // insert in chunks
      const CHUNK = 500;
      for (let i = 0; i < importPreview.rows.length; i += CHUNK) {
        db.insertRows(name, cols, importPreview.rows.slice(i, i + CHUNK));
      }
      refresh();
      toast(`Imported '${name}' — ${importPreview.rows.length.toLocaleString()} rows × ${cols.length} cols`, "ok");
      setImportPreview(null);
      // open preview tab
      const id = newTabId();
      const sql = `SELECT * FROM ${name} LIMIT 100;`;
      const res = db.execute(sql);
      setTabs((p) => [...p, { id, name: name.slice(0, 24), sql, results: res, hasRun: true, activeResultIdx: 0 }]);
      setActiveTabId(id);
      setView("studio");
    } catch (e) {
      try {
        db.dropTable(name, true);
      } catch {
        /* noop */
      }
      toast(e instanceof Error ? `Import failed: ${e.message}` : "Import failed", "err");
    }
  }, [importPreview, importName, db, refresh, toast]);

  const insertSnippet = useCallback(
    (snippet: string) => {
      const tab = tabs.find((t) => t.id === activeId);
      if (!tab) return;
      setView("studio");
      const isQuery = /^\s*SELECT/i.test(snippet);
      const next = tab.sql.trim()
        ? isQuery
          ? `${tab.sql.replace(/\s+$/, "")}\n\n${snippet}`
          : `${tab.sql}${tab.sql.endsWith(" ") || tab.sql.endsWith("\n") ? "" : " "}${snippet}`
        : snippet;
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, sql: next } : t)));
    },
    [tabs, activeId]
  );

  const previewTable = useCallback(
    (table: string) => {
      const id = newTabId();
      const sql = `SELECT * FROM ${table} LIMIT 100;`;
      setTabs((p) => [...p, { id, name: `preview ${table}`.slice(0, 24), sql, results: [], hasRun: false, activeResultIdx: 0 }]);
      setActiveTabId(id);
      setView("studio");
      setTimeout(() => {
        try {
          const res = db.execute(sql);
          setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, results: res, hasRun: true, activeResultIdx: 0 } : t)));
          const sel = res[0];
          if (sel) setLastMs(sel.executionTimeMs);
        } catch (e) {
          toast(e instanceof Error ? e.message : "Preview failed", "err");
        }
      }, 40);
    },
    [db, toast]
  );

  const dropTable = useCallback(
    (table: string) => {
      if (!window.confirm(`Drop table '${table}'? This deletes all its rows (in-memory).`)) return;
      try {
        db.execute(`DROP TABLE "${table}";`);
        refresh();
        toast(`Table '${table}' dropped`, "ok");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Drop failed", "err");
      }
    },
    [db, refresh, toast]
  );

  const executeDDL = useCallback(
    (ddl: string) => {
      try {
        const res = db.execute(ddl);
        refresh();
        const failed = res.find((r) => !r.success);
        if (failed) return { success: false, message: failed.error ?? "DDL failed" };
        return { success: true, message: res[res.length - 1]?.message ?? "Table created" };
      } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : "DDL failed" };
      }
    },
    [db, refresh]
  );

  const addTab = useCallback((sql = "", name?: string) => {
    const id = newTabId();
    setTabs((p) => {
      const n = p.length + 1;
      return [...p, { id, name: name ?? `Query ${n}`, sql: sql || `-- Query ${n}\nSELECT * FROM users LIMIT 10;`, results: [], hasRun: false, activeResultIdx: 0 }];
    });
    setActiveTabId(id);
    setView("studio");
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) return prev;
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (id === activeId) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          setActiveTabId(fallback.id);
        }
        return next;
      });
    },
    [activeId]
  );

  const previewHead = useMemo(() => {
    if (!importPreview) return { cols: [], rows: [] as string[][] };
    return {
      cols: importPreview.schema.columns,
      rows: importPreview.rows.slice(0, 8).map((r) => r.map((v) => (v === null ? "NULL" : String(v)))),
    };
  }, [importPreview]);

  return (
    <div className="flex h-screen flex-col bg-[#070a12] text-slate-200">
      <StudioHeader
        tableCount={snapshot.tables.length}
        rowCount={snapshot.totalRows}
        view={view}
        onViewChange={setView}
        onSeed={handleSeed}
        onExportDump={handleExportDump}
        onImportClick={() => fileRef.current?.click()}
        lastMs={lastMs}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.json,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileChosen(f);
          e.target.value = "";
        }}
      />

      <div className="flex min-h-0 flex-1">
        <div className="hidden md:flex">
          <SchemaExplorer
            tables={snapshot.tables}
            rowCounts={snapshot.rowCounts}
            onInsertSnippet={insertSnippet}
            onPreviewTable={previewTable}
            onDropTable={dropTable}
            onNewTable={() => setView("erd")}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {view === "studio" ? (
            <SqlEditor
              tabs={tabs}
              activeTabId={activeId}
              onSelectTab={setActiveTabId}
              onAddTab={addTab}
              onCloseTab={closeTab}
              onRenameTab={(id, name) => setTabs((p) => p.map((t) => (t.id === id ? { ...t, name } : t)))}
              onSqlChange={(id, sql) => setTabs((p) => p.map((t) => (t.id === id ? { ...t, sql } : t)))}
              onExecute={executeActive}
              isExecuting={isExecuting}
              onToast={toast}
              onSelectResult={(tabId, idx) =>
                setTabs((p) => p.map((t) => (t.id === tabId ? { ...t, activeResultIdx: idx } : t)))
              }
            />
          ) : (
            <ErdVisualizer
              tables={snapshot.tables}
              rowCounts={snapshot.rowCounts}
              onExecuteDDL={executeDDL}
              onToast={toast}
              onDropTable={dropTable}
              onPreviewTable={previewTable}
            />
          )}
        </div>
      </div>

      {/* mobile schema drawer */}
      {showMobileSchema && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowMobileSchema(false)} />
          <div className="relative flex h-full">
            <SchemaExplorer
              tables={snapshot.tables}
              rowCounts={snapshot.rowCounts}
              onInsertSnippet={(s) => {
                insertSnippet(s);
                setShowMobileSchema(false);
              }}
              onPreviewTable={(t) => {
                previewTable(t);
                setShowMobileSchema(false);
              }}
              onDropTable={dropTable}
              onNewTable={() => {
                setView("erd");
                setShowMobileSchema(false);
              }}
            />
          </div>
        </div>
      )}

      {/* status bar */}
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[#1e293b] bg-[#0b1120]/90 px-3 font-mono text-[10px] text-slate-500">
        <button
          onClick={() => setShowMobileSchema(true)}
          className="flex items-center gap-1.5 rounded border border-[#1e293b] px-1.5 py-0.5 text-slate-400 md:hidden"
        >
          <PanelLeft className="h-3 w-3" /> Schema
        </button>
        <span className="hidden items-center gap-1.5 sm:flex">
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
          <span className="text-slate-400">sovereign • local-first • no telemetry</span>
        </span>
        <span className="hidden sm:inline text-slate-700">|</span>
        <span className="hidden sm:inline">
          engine: <span className="text-cyan-400">qp-mem v1.0</span>
        </span>
        <span className="hidden md:inline text-slate-700">|</span>
        <span className="hidden md:inline">
          {snapshot.tables.length} tables • {snapshot.totalRows.toLocaleString()} rows
        </span>
        <span className="ml-auto hidden items-center gap-2 lg:flex">
          <span>SELECT • JOIN • GROUP BY • DDL • CSV/JSON ingest</span>
        </span>
      </footer>

      {/* import modal */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="toast-in flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#1e293b] bg-[#0b1222] shadow-2xl shadow-black/60">
            <div className="flex items-center gap-2.5 border-b border-[#1e293b] px-5 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15">
                <FileUp className="h-4 w-4 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Import dataset</h3>
                <p className="font-mono text-[11px] text-slate-500">
                  {importFileName} • {importPreview.rows.length.toLocaleString()} rows detected • types auto-inferred
                </p>
              </div>
              <button
                onClick={() => setImportPreview(null)}
                className="ml-auto rounded-lg border border-[#1e293b] p-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto p-5">
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Table name
                </label>
                <input
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  className="qp-focus w-full rounded-lg border border-[#1e293b] bg-[#070a12] px-3 py-2 font-mono text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Schema preview ({previewHead.cols.length} columns)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {previewHead.cols.map((c) => (
                    <span
                      key={c.name}
                      className="rounded-md border border-[#1e293b] bg-[#0f172a] px-2 py-1 font-mono text-[11px] text-slate-300"
                    >
                      {c.name} <span className="text-cyan-400">{c.type}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Data preview (first 8 rows)
                </label>
                <div className="overflow-auto rounded-lg border border-[#1e293b]">
                  <table className="w-full border-collapse font-mono text-[11px]">
                    <thead>
                      <tr className="bg-[#0f172a]">
                        {previewHead.cols.map((c) => (
                          <th key={c.name} className="whitespace-nowrap border-b border-r border-[#1e293b] px-2.5 py-1.5 text-left text-slate-300 last:border-r-0">
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewHead.rows.map((r, i) => (
                        <tr key={i} className="border-b border-[#1e293b]/40 last:border-b-0">
                          {r.map((v, j) => (
                            <td
                              key={j}
                              className={cn(
                                "max-w-[180px] truncate border-r border-[#1e293b]/40 px-2.5 py-1.5 last:border-r-0",
                                v === "NULL" ? "italic text-amber-500" : "text-slate-200"
                              )}
                            >
                              {v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-[#1e293b] px-5 py-3.5">
              <button
                onClick={() => setImportPreview(null)}
                className="rounded-lg border border-[#1e293b] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                className="ml-auto rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-400 px-5 py-2 text-xs font-bold text-[#070a12] shadow-[0_0_18px_rgba(6,182,212,0.35)] hover:shadow-[0_0_26px_rgba(6,182,212,0.55)]"
              >
                Create table & import {importPreview.rows.length.toLocaleString()} rows
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-10 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl",
              t.kind === "ok" && "border-emerald-500/30 bg-[#06281e]/95",
              t.kind === "err" && "border-rose-500/30 bg-[#2b0f16]/95",
              t.kind === "info" && "border-cyan-500/30 bg-[#082834]/95"
            )}
          >
            {t.kind === "ok" && <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-400" />}
            {t.kind === "err" && <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-rose-400" />}
            {t.kind === "info" && <Info className="mt-px h-4 w-4 shrink-0 text-cyan-400" />}
            <p className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed text-slate-100">{t.msg}</p>
            <button
              onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              className="shrink-0 text-slate-500 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
