import { Activity, Braces, Database, Download, Network, Rows3, Table2, Upload, Zap } from "lucide-react";
import { cn } from "../utils/cn";

interface Props {
  tableCount: number;
  rowCount: number;
  view: "studio" | "erd";
  onViewChange: (v: "studio" | "erd") => void;
  onSeed: () => void;
  onExportDump: () => void;
  onImportClick: () => void;
  lastMs: number | null;
}

export default function StudioHeader({
  tableCount,
  rowCount,
  view,
  onViewChange,
  onSeed,
  onExportDump,
  onImportClick,
  lastMs,
}: Props) {
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-[#1e293b] bg-[#0f172a]/90 px-3 backdrop-blur-xl sm:px-4">
      {/* glow line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/60 to-transparent" />

      {/* logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
          <Activity className="h-5 w-5 text-[#070a12]" strokeWidth={2.75} />
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-extrabold tracking-tight text-white">
              Query<span className="text-cyan-400">Pulse</span>
            </h1>
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-300 md:inline-flex">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
              local_workspace.db • In-Memory Engine
            </span>
          </div>
          <p className="hidden font-mono text-[10px] text-slate-500 lg:block">
            sovereign local-first sqlite studio — zero network calls
          </p>
        </div>
      </div>

      <div className="mx-1 hidden h-8 w-px bg-[#1e293b] sm:block" />

      {/* view switcher */}
      <div className="flex items-center rounded-lg border border-[#1e293b] bg-[#070a12]/80 p-0.5">
        <button
          onClick={() => onViewChange("studio")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3",
            view === "studio"
              ? "bg-cyan-500/15 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(6,182,212,0.3)]"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          <Braces className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Query Studio</span>
          <span className="sm:hidden">SQL</span>
        </button>
        <button
          onClick={() => onViewChange("erd")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3",
            view === "erd"
              ? "bg-violet-500/15 text-violet-300 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35)]"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          <Network className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">ERD & Builder</span>
          <span className="sm:hidden">ERD</span>
        </button>
      </div>

      <div className="flex-1" />

      {/* stats */}
      <div className="hidden items-center gap-2 font-mono text-[11px] xl:flex">
        <span className="flex items-center gap-1.5 rounded-md border border-[#1e293b] bg-[#070a12]/60 px-2 py-1 text-slate-300">
          <Table2 className="h-3.5 w-3.5 text-cyan-400" />
          {tableCount} tables
        </span>
        <span className="flex items-center gap-1.5 rounded-md border border-[#1e293b] bg-[#070a12]/60 px-2 py-1 text-slate-300">
          <Rows3 className="h-3.5 w-3.5 text-violet-400" />
          {rowCount.toLocaleString()} rows
        </span>
        {lastMs !== null && (
          <span className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
            <Zap className="h-3.5 w-3.5" />
            {lastMs < 10 ? lastMs.toFixed(1) : lastMs.toFixed(0)}ms
          </span>
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={onSeed}
          title="Seed sample dataset (users, api_logs, embeddings_meta)"
          className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-xs font-semibold text-emerald-300 transition-all hover:border-emerald-400/60 hover:bg-emerald-500/20 hover:shadow-[0_0_16px_rgba(16,185,129,0.25)]"
        >
          <Database className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Seed Sample Dataset</span>
          <span className="md:hidden">Seed</span>
        </button>
        <button
          onClick={onExportDump}
          title="Export full SQL dump"
          className="flex items-center gap-1.5 rounded-lg border border-[#1e293b] bg-[#1a2440]/60 px-2.5 py-2 text-xs font-semibold text-slate-300 transition-all hover:border-slate-500/60 hover:text-white"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Export SQL Dump</span>
          <span className="md:hidden">Dump</span>
        </button>
        <button
          onClick={onImportClick}
          title="Import CSV or JSON file as a new table"
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-400 px-2.5 py-2 text-xs font-bold text-[#070a12] shadow-[0_0_18px_rgba(6,182,212,0.35)] transition-all hover:shadow-[0_0_26px_rgba(6,182,212,0.55)]"
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />
          <span className="hidden md:inline">Import CSV/JSON</span>
          <span className="md:hidden">Import</span>
        </button>
      </div>
    </header>
  );
}
