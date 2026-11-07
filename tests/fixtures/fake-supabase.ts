import type { SupabaseClient } from "@supabase/supabase-js";

// Just enough of PostgREST's query builder for the `reports` and `cv_sources` tables, and of the storage API for
// the `cvs` bucket, in memory, so the Supabase repository's contract can be exercised without a database. The
// unique indexes and the ownership triggers from the migrations are modelled too, because the repository's
// idempotency and ownership behaviour depends on them. Nothing else is modelled; anything else throws.

export interface FakeRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  score: number | null;
  payload: unknown;
  storage_path: string | null;
  source_id?: string | null;
  created_at: string;
}

export interface FakeSourceRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  kind: string;
  file_name: string;
  text: string;
  document_version: string;
  meta: unknown;
  outcome: unknown;
  storage_path: string | null;
  idempotency_key: string | null;
  created_at: string;
}

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "in" | "notnull" | "lt"; v: unknown };
type Op = { kind: "select" } | { kind: "insert"; row: Row } | { kind: "update"; map: Row } | { kind: "delete" };
type Result = { data: Row[] | null; error: { message: string; code?: string } | null; count: number | null };

interface Table {
  rows: Row[];
  /** Unique indexes: the columns, and which of them must be non-null for the index to apply (partial index). */
  uniques: { cols: string[]; where: string }[];
  /** Mirrors the before-insert ownership triggers: a referenced row must belong to the same user. */
  owned: { col: string; table: string; message: string }[];
  /** Foreign keys declared `on delete cascade` onto this table: the referencing table and column. */
  cascades?: { table: string; col: string }[];
  /** Foreign keys declared `on delete set null` onto this table. */
  nullOnDelete?: { table: string; col: string }[];
}

let clock = 1_800_000_000_000;

class Query {
  private filters: Filter[] = [];
  private sort: { col: string; asc: boolean } | null = null;
  private max = Infinity;
  private skip = 0;
  private op: Op = { kind: "select" };
  constructor(
    private table: Table,
    private tables: Record<string, Table>,
  ) {}
  /** PostgREST JSON-path columns ("alias:payload->a->>b"), read as the real one reads them: null when absent, text with ->>. */
  private paths: { alias: string; steps: string[]; text: boolean }[] = [];
  select(columns?: string) {
    for (const c of typeof columns === "string" ? columns.split(",") : []) {
      const m = c.trim().match(/^(\w+):(\w+)((?:->>?\w+)+)$/);
      if (m) this.paths.push({ alias: m[1], steps: [m[2], ...m[3].split(/->>?/).filter(Boolean)], text: m[3].includes("->>") });
    }
    return this;
  }
  private project(row: Row): Row {
    const out = { ...row };
    for (const p of this.paths) {
      const v = p.steps.reduce<unknown>((at, k) => (at && typeof at === "object" ? (at as Row)[k] : undefined), row) ?? null;
      out[p.alias] = v !== null && p.text ? String(v) : v;
    }
    return out;
  }
  /** A filter on a JSON path ("payload->>editRevision") reads the path as PostgREST does: text, null when absent. */
  private read(r: Row, col: string): unknown {
    const m = col.match(/^(\w+)((?:->>?\w+)+)$/);
    if (!m) return r[col];
    const v = [m[1], ...m[2].split(/->>?/).filter(Boolean)].reduce<unknown>((at, k) => (at && typeof at === "object" ? (at as Row)[k] : undefined), r) ?? null;
    return v !== null && m[2].includes("->>") ? String(v) : v;
  }
  eq(col: string, v: unknown) {
    this.filters.push({ col, op: "eq", v });
    return this;
  }
  is(col: string, v: null) {
    this.filters.push({ col, op: "eq", v });
    return this;
  }
  in(col: string, v: unknown[]) {
    this.filters.push({ col, op: "in", v });
    return this;
  }
  lt(col: string, v: unknown) {
    this.filters.push({ col, op: "lt", v });
    return this;
  }
  delete() {
    this.op = { kind: "delete" };
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error("fake supabase: only .not(col, 'is', null) is modelled");
    this.filters.push({ col, op: "notnull", v: null });
    return this;
  }
  order(col: string, opts: { ascending: boolean }) {
    this.sort = { col, asc: opts.ascending };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  range(from: number, to: number) {
    this.skip = from;
    this.max = to - from + 1;
    return this;
  }
  insert(row: Row) {
    this.op = { kind: "insert", row };
    return this;
  }
  update(map: Row) {
    this.op = { kind: "update", map };
    return this;
  }
  private matches(r: Row): boolean {
    return this.filters.every((f) => (f.op === "eq" ? this.read(r, f.col) === f.v : f.op === "in" ? (f.v as unknown[]).includes(r[f.col]) : f.op === "lt" ? String(r[f.col]) < String(f.v) : r[f.col] !== null && r[f.col] !== undefined));
  }
  private run(): Result {
    if (this.op.kind === "insert") {
      const given = this.op.row;
      const row: Row = { id: crypto.randomUUID(), created_at: new Date(clock++).toISOString(), ...given };
      for (const col of Object.keys(row)) if (row[col] === undefined) row[col] = null;
      for (const u of this.table.uniques) {
        if (row[u.where] === null) continue;
        if (this.table.rows.some((r) => u.cols.every((c) => r[c] === row[c]))) return { data: null, error: { message: `duplicate key value violates unique constraint (${u.cols.join(", ")})`, code: "23505" }, count: null };
      }
      for (const o of this.table.owned) {
        if (row[o.col] === null) continue;
        const ref = this.tables[o.table].rows.find((r) => r.id === row[o.col]);
        if (!ref || ref.user_id !== row.user_id) return { data: null, error: { message: o.message, code: "P0001" }, count: null };
      }
      this.table.rows.push(structuredClone(row));
      return { data: [row], error: null, count: null };
    }
    const matched = this.table.rows.filter((r) => this.matches(r));
    if (this.op.kind === "delete") {
      this.table.rows.splice(0, this.table.rows.length, ...this.table.rows.filter((r) => !matched.includes(r)));
      for (const c of this.table.cascades ?? []) {
        const rows = this.tables[c.table].rows;
        rows.splice(0, rows.length, ...rows.filter((r) => !matched.some((m) => m.id === r[c.col])));
      }
      for (const c of this.table.nullOnDelete ?? []) for (const r of this.tables[c.table].rows) if (matched.some((m) => m.id === r[c.col])) r[c.col] = null;
      return { data: null, error: null, count: null };
    }
    if (this.op.kind === "update") {
      for (const r of matched) Object.assign(r, structuredClone(this.op.map));
      return { data: matched.map((r) => ({ id: r.id })), error: null, count: null };
    }
    const out = [...matched];
    if (this.sort) {
      const { col, asc } = this.sort;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    return { data: out.slice(this.skip, this.skip + this.max).map((r) => structuredClone(this.project(r))), error: null, count: matched.length };
  }
  async maybeSingle() {
    const r = this.run();
    return { data: r.data?.[0] ?? null, error: r.error };
  }
  async single() {
    const r = this.run();
    return r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: r.error ?? { message: "no rows" } };
  }
  then<T>(res: (v: Result) => T, rej?: (e: unknown) => T) {
    return Promise.resolve(this.run()).then(res, rej);
  }
}

export function fakeSupabase(rows: FakeRow[] = [], sources: FakeSourceRow[] = []) {
  const tables: Record<string, Table> = {
    reports: { rows: rows as unknown as Row[], uniques: [{ cols: ["source_id"], where: "source_id" }], owned: [{ col: "source_id", table: "cv_sources", message: "a report can only score its own user's source" }] },
    cv_sources: {
      rows: sources as unknown as Row[],
      uniques: [
        { cols: ["user_id", "idempotency_key"], where: "idempotency_key" },
        { cols: ["user_id", "parent_id", "document_version"], where: "parent_id" },
      ],
      owned: [{ col: "parent_id", table: "cv_sources", message: "a source version can only descend from its own user's version" }],
    },
    proofreading_choices: { rows: [], uniques: [], owned: [{ col: "report_id", table: "reports", message: "a proofreading choice can only be made on its own user's report" }] },
    applications: {
      rows: [],
      uniques: [{ cols: ["user_id", "source_report_id"], where: "source_report_id" }],
      owned: [{ col: "source_report_id", table: "reports", message: "an application can only come from its own user's report" }],
      cascades: [{ table: "application_links", col: "application_id" }],
    },
    application_links: {
      rows: [],
      uniques: [{ cols: ["application_id", "kind"], where: "application_id" }],
      owned: [
        { col: "application_id", table: "applications", message: "an application link can only be on its own user's application" },
        { col: "report_id", table: "reports", message: "an application link can only name its own user's report of that kind" },
      ],
    },
    artefact_downloads: { rows: [], uniques: [{ cols: ["user_id", "report_id", "document_version"], where: "report_id" }], owned: [{ col: "report_id", table: "reports", message: "a download can only be recorded on its own user's report" }] },
    action_choices: { rows: [], uniques: [], owned: [] },
    practice_answers: {
      rows: [],
      uniques: [{ cols: ["user_id", "attempt_key"], where: "attempt_key" }],
      owned: [
        { col: "application_id", table: "applications", message: "a practice answer can only be on its own user's application" },
        { col: "document_report_id", table: "reports", message: "a practice answer can only name its own user's CV or tailored CV" },
        { col: "advert_report_id", table: "reports", message: "a practice answer can only name its own user's advert" },
      ],
    },
    profiles: { rows: [], uniques: [], owned: [] },
    rate_limits: { rows: [], uniques: [], owned: [] },
    share_links: { rows: [], uniques: [], owned: [] },
    staff_access_log: { rows: [], uniques: [], owned: [] },
  };
  tables.reports.cascades = [{ table: "application_links", col: "report_id" }, { table: "artefact_downloads", col: "report_id" }, { table: "practice_answers", col: "document_report_id" }, { table: "practice_answers", col: "advert_report_id" }];
  tables.applications.nullOnDelete = [{ table: "practice_answers", col: "application_id" }];
  /** Failures and misbehaviour to inject into storage, for the deletion tests. */
  const faults = { listError: null as string | null, removeError: null as string | null, removeIsNoop: false };
  /** Model of `delete from auth.users`: the foreign keys cascade to everything the user owns, and to nothing else. */
  const cascade = (userId: string) => {
    for (const table of [tables.reports, tables.cv_sources, tables.proofreading_choices, tables.applications, tables.application_links, tables.artefact_downloads, tables.action_choices, tables.practice_answers]) table.rows.splice(0, table.rows.length, ...table.rows.filter((r) => r.user_id !== userId));
    tables.profiles.rows.splice(0, tables.profiles.rows.length, ...tables.profiles.rows.filter((r) => r.id !== userId));
  };
  /** Stands in for the signed-in user behind `delete_my_account`; retention candidates are what the job should act on. */
  const session = { userId: null as string | null, retentionCandidates: [] as { user_id: string; email: string; full_name: string; action: "warn" | "delete" }[] };
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const client = {
    async rpc(name: string) {
      if (name === "delete_my_account") {
        if (!session.userId) return { data: null, error: { message: "not signed in" } };
        cascade(session.userId);
        return { data: null, error: null };
      }
      if (name === "retention_candidates") return { data: session.retentionCandidates, error: null };
      throw new Error(`fake supabase: rpc ${name} is not modelled`);
    },
    auth: {
      admin: {
        async deleteUser(userId: string) {
          cascade(userId);
          return { data: {}, error: null };
        },
      },
    },
    from(table: string) {
      if (!tables[table]) throw new Error(`fake supabase: table ${table} is not modelled`);
      return new Query(tables[table], tables);
    },
    storage: {
      from(bucket: string) {
        if (bucket !== "cvs") throw new Error(`fake supabase: bucket ${bucket} is not modelled`);
        return {
          // Like the storage API: one level at a time, folders first with a null id.
          async list(prefix: string, opts: { limit: number; offset: number }) {
            if (faults.listError) return { data: null, error: { message: faults.listError } };
            const here = [...objects.keys()].filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1));
            const folders = [...new Set(here.filter((p) => p.includes("/")).map((p) => p.split("/")[0]))].sort().map((name) => ({ name, id: null }));
            const files = here.filter((p) => !p.includes("/")).sort().map((name) => ({ name, id: `id-${name}` }));
            return { data: [...folders, ...files].slice(opts.offset, opts.offset + opts.limit), error: null };
          },
          async upload(path: string, bytes: Uint8Array, opts: { contentType: string; upsert: boolean }) {
            if (objects.has(path) && !opts.upsert) return { data: null, error: { message: "The resource already exists" } };
            objects.set(path, { bytes: new Uint8Array(bytes), contentType: opts.contentType });
            return { data: { path }, error: null };
          },
          async download(path: string) {
            const o = objects.get(path);
            return o ? { data: new Blob([o.bytes as BlobPart], { type: o.contentType }), error: null } : { data: null, error: { message: "Object not found" } };
          },
          async remove(paths: string[]) {
            if (faults.removeError) return { data: null, error: { message: faults.removeError } };
            if (faults.removeIsNoop) return { data: [], error: null };
            for (const p of paths) objects.delete(p);
            return { data: [], error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, rows, sources, choices: tables.proofreading_choices.rows, applications: tables.applications.rows, applicationLinks: tables.application_links.rows, downloads: tables.artefact_downloads.rows, actionChoices: tables.action_choices.rows, practiceAnswers: tables.practice_answers.rows, objects, faults, session, profiles: tables.profiles.rows, rateLimits: tables.rate_limits.rows, shareLinks: tables.share_links.rows };
}
