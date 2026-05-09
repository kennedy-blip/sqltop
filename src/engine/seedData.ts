import { InMemoryDB } from "./sqlEngine";

const FIRST = [
  "Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Iris", "Lucas", "Mila", "Owen",
  "Nora", "Felix", "Aria", "Hugo", "Elena", "Kai", "Luna", "Miles", "Sofia", "Theo",
  "Ivy", "Jonas", "Clara", "Ravi",
];
const LAST = [
  "Chen", "Kowalski", "Tanaka", "Garcia", "Novak", "Silva", "Kim", "Okafor", "Larsen", "Petrov",
  "Nguyen", "Weber", "Ali", "Costa", "Müller", "Rossi", "Dubois", "Yamamoto", "Singh", "Moreau",
  "Lindqvist", "Adeyemi", "Kaur", "Fischer",
];
const COUNTRIES = ["USA", "Germany", "Japan", "Brazil", "India", "France", "UK", "Canada", "Spain", "Nigeria"];
const PLANS = ["free", "pro", "team", "enterprise"];
const ENDPOINTS: [string, string][] = [
  ["/api/v1/query", "POST"],
  ["/api/v1/embed", "POST"],
  ["/api/v1/users", "GET"],
  ["/api/v1/datasets", "GET"],
  ["/api/v1/completions", "POST"],
  ["/api/v1/search", "GET"],
  ["/api/v1/ingest", "POST"],
  ["/api/v1/health", "GET"],
];
const MODELS = [
  ["text-embed-3-small", 1536],
  ["text-embed-3-large", 3072],
  ["voyage-code-2", 1536],
  ["bge-large-en", 1024],
  ["e5-mistral-7b", 4096],
] as const;

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedSampleDataset(db: InMemoryDB): { tables: number; rows: number } {
  const rnd = mulberry32(42);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];

  db.execute(`DROP TABLE IF EXISTS embeddings_meta;`);
  db.execute(`DROP TABLE IF EXISTS api_logs;`);
  db.execute(`DROP TABLE IF EXISTS users;`);

  db.execute(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      age INTEGER,
      country TEXT DEFAULT 'USA',
      plan TEXT DEFAULT 'free',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  db.execute(`
    CREATE TABLE api_logs (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER DEFAULT 200,
      latency_ms REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.execute(`
    CREATE TABLE embeddings_meta (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      tokens INTEGER NOT NULL,
      cost_usd REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ---- users ----
  const userIds: number[] = [];
  for (let i = 0; i < 24; i++) {
    const fn = FIRST[i % FIRST.length];
    const ln = LAST[(i * 7 + 3) % LAST.length];
    const name = `${fn} ${ln}`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@querypulse.dev`;
    const age = 19 + Math.floor(rnd() * 45);
    const country = COUNTRIES[Math.floor(rnd() * COUNTRIES.length)];
    const plan = i < 8 ? "free" : pick(PLANS);
    const isActive = rnd() > 0.12 ? 1 : 0;
    const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
    const mon = String(1 + Math.floor(rnd() * 11)).padStart(2, "0");
    const created = `2025-${mon}-${day}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`;
    db.insertRows("users", ["name", "email", "age", "country", "plan", "is_active", "created_at"], [
      [name, email, age, country, plan, isActive, created],
    ]);
    userIds.push(i + 1);
  }

  // ---- api_logs (140 rows) ----
  for (let i = 0; i < 140; i++) {
    const uid = rnd() > 0.06 ? pick(userIds) : (null as unknown as number);
    const [endpoint, method] = pick(ENDPOINTS);
    const r = rnd();
    const status = r > 0.93 ? (rnd() > 0.5 ? 500 : 429) : r > 0.86 ? 404 : r > 0.8 ? 400 : 200;
    const latency = Math.round((8 + rnd() * rnd() * 900 + (status !== 200 ? rnd() * 400 : 0)) * 10) / 10;
    const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
    const created = `2026-10-${day}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}Z`;
    db.insertRows(
      "api_logs",
      ["user_id", "endpoint", "method", "status_code", "latency_ms", "created_at"],
      [[uid, endpoint, method, status, latency, created]]
    );
  }

  // ---- embeddings_meta (48 rows) ----
  for (let i = 0; i < 48; i++) {
    const uid = pick(userIds);
    const [model, dims] = pick(MODELS);
    const tokens = 128 + Math.floor(rnd() * 12000);
    const cost = Math.round(tokens * (dims >= 3000 ? 0.00013 : 0.00002) * 100000) / 100000;
    const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
    const created = `2026-09-${day}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`;
    db.insertRows(
      "embeddings_meta",
      ["user_id", "model", "dimensions", "tokens", "cost_usd", "created_at"],
      [[uid, model, dims, tokens, i % 11 === 0 ? null : cost, created]]
    );
  }

  return { tables: 3, rows: db.totalRows() };
}

export const PRESET_QUERIES: { name: string; description: string; sql: string }[] = [
  {
    name: "Overview — all users",
    description: "Preview the users dimension table",
    sql: `SELECT id, name, email, country, plan, is_active
FROM users
ORDER BY id
LIMIT 20;`,
  },
  {
    name: "Aggregation — users by plan",
    description: "GROUP BY with COUNT + AVG age",
    sql: `SELECT plan, COUNT(*) AS n_users, ROUND(AVG(age), 1) AS avg_age
FROM users
GROUP BY plan
ORDER BY n_users DESC;`,
  },
  {
    name: "JOIN — slowest endpoints",
    description: "JOIN users + logs with latency filter",
    sql: `SELECT u.name, u.plan, l.endpoint, l.method, l.status_code, l.latency_ms
FROM api_logs AS l
JOIN users AS u ON l.user_id = u.id
WHERE l.latency_ms > 250
ORDER BY l.latency_ms DESC
LIMIT 15;`,
  },
  {
    name: "Error-rate by endpoint",
    description: "Conditional aggregation with CASE",
    sql: `SELECT endpoint,
  COUNT(*) AS hits,
  SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors,
  ROUND(AVG(latency_ms), 1) AS avg_ms
FROM api_logs
GROUP BY endpoint
HAVING COUNT(*) > 5
ORDER BY errors DESC;`,
  },
  {
    name: "Embedding spend by model",
    description: "SUM + NULL handling + LIKE filter",
    sql: `SELECT model, COUNT(*) AS jobs, SUM(tokens) AS total_tokens,
  ROUND(SUM(cost_usd), 4) AS spend_usd
FROM embeddings_meta
WHERE model LIKE '%embed%'
GROUP BY model
ORDER BY spend_usd DESC;`,
  },
  {
    name: "Power users — JOIN + HAVING",
    description: "Users with heavy API usage",
    sql: `SELECT u.name, u.email, u.plan, COUNT(*) AS calls,
  ROUND(AVG(l.latency_ms), 1) AS avg_latency
FROM users u
JOIN api_logs l ON l.user_id = u.id
GROUP BY u.name, u.email, u.plan
HAVING COUNT(*) >= 5
ORDER BY calls DESC
LIMIT 10;`,
  },
  {
    name: "Funnel — active vs churned",
    description: "Boolean grouping + IN + BETWEEN",
    sql: `SELECT
  CASE WHEN is_active = 1 THEN 'active' ELSE 'churned' END AS cohort,
  COUNT(*) AS users,
  COUNT(CASE WHEN plan IN ('pro','team','enterprise') THEN 1 END) AS paid
FROM users
WHERE age BETWEEN 18 AND 80
GROUP BY cohort;`,
  },
];
