export type SqlValue = string | number | boolean | null;

export type ColumnType = "INTEGER" | "TEXT" | "REAL" | "BLOB" | "NUMERIC";

export interface ColumnDef {
  name: string;
  type: ColumnType;
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  defaultValue?: SqlValue;
}

export interface ForeignKeyDef {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnDef[];
  foreignKeys: ForeignKeyDef[];
}

export type RowObject = Record<string, SqlValue>;

export interface QueryResult {
  statementIndex: number;
  statementType: "SELECT" | "CREATE" | "INSERT" | "UPDATE" | "DELETE" | "DROP" | "ALTER" | "OTHER";
  columns: string[];
  rows: SqlValue[][];
  rowCount: number;
  affectedRows?: number;
  executionTimeMs: number;
  message: string;
  success: boolean;
  error?: string;
}

export interface EngineSnapshot {
  tables: TableSchema[];
  rowCounts: Record<string, number>;
  totalRows: number;
}
