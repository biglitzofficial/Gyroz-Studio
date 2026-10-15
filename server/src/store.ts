import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

let firestore: Firestore | null = null;

export function bindFirestore(db: Firestore) {
  firestore = db;
}

function database() {
  if (!firestore) throw new Error("Firestore is not connected.");
  return firestore;
}

export class Schema {
  definition: Record<string, any>;
  options: Record<string, any>;
  static Types = { ObjectId: String, Mixed: Object };
  constructor(definition: Record<string, any>, options: Record<string, any> = {}) {
    this.definition = definition;
    this.options = options;
  }
  index(..._fields: unknown[]) {
    return this;
  }
}

type Row = Record<string, any>;

function newId() {
  return randomBytes(12).toString("hex");
}

function isSchema(value: unknown): value is Schema {
  return value instanceof Schema;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (item instanceof Date ? { __date: item.toISOString() } : item)), (_key, item) => {
    if (item && typeof item === "object" && typeof item.__date === "string") return new Date(item.__date);
    return item;
  });
}

function revive(value: any): any {
  if (Array.isArray(value)) return value.map(revive);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const out: Row = {};
    for (const [key, item] of Object.entries(value)) out[key] = revive(item);
    return out;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return new Date(value);
  return value;
}

function strip(doc: Row) {
  const out: Row = {};
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === "function") continue;
    out[key] = clone(value);
  }
  return out;
}

function getPath(doc: Row, path: string) {
  return path.split(".").reduce<any>((current, key) => (current == null ? undefined : current[key]), doc);
}

function setPath(doc: Row, path: string, value: unknown) {
  const parts = path.split(".");
  let current = doc;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (current[parts[index]] == null || typeof current[parts[index]] !== "object") current[parts[index]] = {};
    current = current[parts[index]];
  }
  current[parts[parts.length - 1]] = value;
}

function unsetPath(doc: Row, path: string) {
  const parts = path.split(".");
  let current = doc;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (current?.[parts[index]] == null) return;
    current = current[parts[index]];
  }
  delete current[parts[parts.length - 1]];
}

function same(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  if (left instanceof Date || right instanceof Date) return new Date(left as string).getTime() === new Date(right as string).getTime();
  return String(left) === String(right);
}

function compare(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (left instanceof Date || right instanceof Date) return new Date(left as string).getTime() - new Date(right as string).getTime();
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function matchValue(value: unknown, expected: any): boolean {
  if (expected instanceof RegExp) return expected.test(String(value ?? ""));
  if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
    if ("$in" in expected) return expected.$in.some((item: unknown) => (Array.isArray(value) ? value.some((entry) => same(entry, item)) : same(value, item)));
    if ("$nin" in expected) return !expected.$nin.some((item: unknown) => same(value, item));
    if ("$ne" in expected) return !same(value ?? null, expected.$ne ?? null);
    if ("$gt" in expected) return compare(value, expected.$gt) > 0;
    if ("$gte" in expected) return compare(value, expected.$gte) >= 0;
    if ("$lt" in expected) return compare(value, expected.$lt) < 0;
    if ("$lte" in expected) return compare(value, expected.$lte) <= 0;
    if ("$regex" in expected) {
      const expression = expected.$regex instanceof RegExp ? expected.$regex : new RegExp(String(expected.$regex), expected.$options ?? "");
      return expression.test(String(value ?? ""));
    }
    if ("$not" in expected) {
      if (expected.$not instanceof RegExp) return !expected.$not.test(String(value ?? ""));
      return !matchValue(value, expected.$not);
    }
    if ("$exists" in expected) return expected.$exists ? value != null : value == null;
  }
  if (Array.isArray(value)) return value.some((item) => same(item, expected));
  return same(value, expected);
}

function matches(doc: Row, filter: Row = {}) {
  const entries = Object.entries(filter);
  if (!entries.length) return true;
  if (Array.isArray(filter.$or) && !filter.$or.some((branch) => matches(doc, branch))) return false;
  if (filter.$expr && !matchExpr(doc, filter.$expr)) return false;
  return entries.every(([key, expected]) => {
    if (key === "$or" || key === "$expr") return true;
    return matchValue(key === "_id" ? doc._id : getPath(doc, key), expected);
  });
}

function matchExpr(doc: Row, expression: any): boolean {
  if (expression?.$gte) return Number(evalExpr(doc, expression.$gte[0]) ?? 0) >= Number(evalExpr(doc, expression.$gte[1]) ?? 0);
  if (expression?.$gt) return Number(evalExpr(doc, expression.$gt[0]) ?? 0) > Number(evalExpr(doc, expression.$gt[1]) ?? 0);
  if (expression?.$lte) return Number(evalExpr(doc, expression.$lte[0]) ?? 0) <= Number(evalExpr(doc, expression.$lte[1]) ?? 0);
  if (expression?.$lt) return Number(evalExpr(doc, expression.$lt[0]) ?? 0) < Number(evalExpr(doc, expression.$lt[1]) ?? 0);
  return true;
}

function applyDefaults(definition: Record<string, any>, input: Row) {
  const out: Row = { ...input };
  for (const [key, spec] of Object.entries(definition ?? {})) {
    if (out[key] !== undefined) continue;
    if (isSchema(spec)) {
      out[key] = applyDefaults(spec.definition, {});
      continue;
    }
    if (!spec || typeof spec !== "object" || spec instanceof Date || spec instanceof RegExp) continue;
    if ("default" in spec) {
      const fallback = typeof spec.default === "function" ? spec.default() : spec.default;
      out[key] = isSchema(spec.type) ? applyDefaults(spec.type.definition, fallback ?? {}) : clone(fallback);
      continue;
    }
    if (Array.isArray(spec.type)) out[key] = [];
  }
  return out;
}

function uniqueFields(definition: Record<string, any>) {
  return Object.entries(definition ?? {})
    .filter(([, spec]) => spec && typeof spec === "object" && spec.unique)
    .map(([key]) => key);
}

function plainFilter(filter: Row) {
  const seed: Row = {};
  for (const [key, value] of Object.entries(filter ?? {})) {
    if (key.startsWith("$") || (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof RegExp))) continue;
    seed[key] = value;
  }
  return seed;
}

function normalizeUpdate(update: Row) {
  const ops: Record<string, Row> = { $set: {}, $inc: {}, $push: {}, $pull: {}, $unset: {}, $setOnInsert: {} };
  const operator = Object.keys(update ?? {}).some((key) => key.startsWith("$"));
  if (!operator) ops.$set = { ...update };
  else {
    for (const [key, value] of Object.entries(update ?? {})) {
      if (key.startsWith("$")) ops[key] = { ...(ops[key] ?? {}), ...(value as Row) };
      else ops.$set[key] = value;
    }
  }
  return ops;
}

function applyUpdate(doc: Row, update: Row, inserting: boolean) {
  const ops = normalizeUpdate(update);
  if (inserting) Object.assign(doc, ops.$setOnInsert);
  for (const [path, value] of Object.entries(ops.$set)) setPath(doc, path, value);
  for (const path of Object.keys(ops.$unset)) unsetPath(doc, path);
  for (const [path, value] of Object.entries(ops.$inc)) setPath(doc, path, Number(getPath(doc, path) ?? 0) + Number(value));
  for (const [path, value] of Object.entries(ops.$push)) {
    const current = Array.isArray(getPath(doc, path)) ? [...getPath(doc, path)] : [];
    const addition = value && typeof value === "object" && "$each" in (value as Row) ? (value as Row).$each : [value];
    setPath(doc, path, current.concat(addition));
  }
  for (const [path, value] of Object.entries(ops.$pull)) {
    const current = Array.isArray(getPath(doc, path)) ? getPath(doc, path) : [];
    setPath(doc, path, current.filter((item: any) => {
      if (value && typeof value === "object" && !Array.isArray(value)) return !Object.entries(value).every(([key, expected]) => same(item?.[key], expected));
      return !same(item, value);
    }));
  }
  return doc;
}

function project(doc: Row, fields: string) {
  const names = fields.split(/\s+/).filter(Boolean);
  const out: Row = { _id: doc._id };
  for (const name of names) if (name !== "_id") out[name] = getPath(doc, name);
  return out;
}

function evalExpr(doc: Row, expression: any): any {
  if (typeof expression === "string" && expression.startsWith("$")) return getPath(doc, expression.slice(1));
  if (expression && typeof expression === "object" && "$subtract" in expression) {
    return Number(evalExpr(doc, expression.$subtract[0]) ?? 0) - Number(evalExpr(doc, expression.$subtract[1]) ?? 0);
  }
  return expression;
}

class Query {
  constructor(private readonly source: Collection, private readonly opts: { filter: Row; one: boolean; sort?: Row; skip?: number; limit?: number; fields?: string; lean?: boolean }) {}
  sort(sort: Row) { this.opts.sort = sort; return this; }
  skip(skip: number) { this.opts.skip = skip; return this; }
  limit(limit: number) { this.opts.limit = limit; return this; }
  select(fields: string) { this.opts.fields = fields; return this; }
  session(_session?: unknown) { return this; }
  lean() { this.opts.lean = true; return this; }
  then(onfulfilled?: ((value: any) => any) | null, onrejected?: ((reason: any) => any) | null): Promise<any> {
    return this.exec().then(onfulfilled, onrejected);
  }
  private async exec() {
    let rows = (await this.source.rows()).filter((row) => matches(row, this.opts.filter));
    const sort = this.opts.sort ?? {};
    const keys = Object.keys(sort);
    if (keys.length) {
      rows.sort((left, right) => {
        for (const key of keys) {
          const diff = compare(getPath(left, key), getPath(right, key));
          if (diff) return sort[key] === -1 ? -diff : diff;
        }
        return 0;
      });
    }
    if (this.opts.skip) rows = rows.slice(this.opts.skip);
    if (this.opts.one) rows = rows.slice(0, 1);
    else if (this.opts.limit != null) rows = rows.slice(0, this.opts.limit);
    const present = (row: Row) => (this.opts.fields ? project(row, this.opts.fields) : clone(row));
    if (this.opts.one) {
      const row = rows[0];
      if (!row) return null;
      return this.opts.lean ? present(row) : this.source.doc(row);
    }
    return this.opts.lean ? rows.map(present) : rows.map((row) => this.source.doc(row));
  }
}

class Collection {
  private cache: Map<string, Row> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly unique: string[];
  constructor(readonly name: string, private readonly definition: Record<string, any>) {
    this.unique = uniqueFields(definition);
  }

  async rows() {
    if (!this.cache) {
      const snap = await database().collection(this.name).get();
      this.cache = new Map();
      snap.forEach((item) => {
        const data = revive(item.data());
        data._id = item.id;
        this.cache!.set(item.id, data);
      });
    }
    return [...this.cache.values()].map((row) => clone(row));
  }

  private enqueue<T>(work: () => Promise<T>) {
    const run = this.tail.then(work, work);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async write(data: Row) {
    await this.rows();
    for (const field of this.unique) {
      if (data[field] == null) continue;
      const clash = [...this.cache!.values()].find((row) => row._id !== data._id && same(row[field], data[field]));
      if (clash) throw new Error(`${this.name}.${field} must be unique.`);
    }
    const stored = strip(data);
    const id = String(stored._id);
    delete stored._id;
    await database().collection(this.name).doc(id).set(JSON.parse(JSON.stringify(stored)));
    stored._id = id;
    this.cache!.set(id, revive(stored));
  }

  doc(data: Row) {
    const doc: Row = clone(data);
    doc.save = async () => {
      doc.updatedAt = new Date();
      await this.enqueue(() => this.write(strip(doc)));
      return doc;
    };
    doc.toObject = () => strip(doc);
    return doc;
  }

  find(filter: Row = {}) { return new Query(this, { filter, one: false }); }
  findOne(filter: Row = {}) { return new Query(this, { filter, one: true }); }
  findById(id: unknown) { return this.findOne({ _id: id == null ? "__none__" : String(id) }); }

  async create(input: Row, options?: unknown): Promise<Row>;
  async create(input: Row[], options?: unknown): Promise<Row[]>;
  async create(input: Row | Row[], _options?: unknown): Promise<any> {
    const many = Array.isArray(input);
    const docs = await Promise.all((many ? input : [input]).map(async (item) => {
      const now = new Date();
      const data = applyDefaults(this.definition, { ...item, _id: item._id ? String(item._id) : newId(), createdAt: item.createdAt ?? now, updatedAt: item.updatedAt ?? now });
      const doc = this.doc(data);
      await doc.save();
      return doc;
    }));
    return many ? docs : docs[0];
  }

  async insertMany(inputs: Row[]) {
    return this.create(inputs);
  }

  async countDocuments(filter: Row = {}) {
    return (await this.rows()).filter((row) => matches(row, filter)).length;
  }

  private async change(filter: Row, update: Row, options: { new?: boolean; upsert?: boolean } = {}) {
    return this.enqueue(async () => {
      const current = (await this.rows()).find((row) => matches(row, filter));
      if (!current && !options.upsert) return null;
      const base = current ? clone(current) : applyDefaults(this.definition, { ...plainFilter(filter), _id: newId(), createdAt: new Date() });
      const before = clone(base);
      applyUpdate(base, update, !current);
      base.updatedAt = new Date();
      await this.write(base);
      return options.new === false ? this.doc(before) : this.doc(base);
    });
  }

  async updateOne(filter: Row, update: Row, options: { upsert?: boolean; session?: unknown } = {}) {
    const doc = await this.change(filter, update, { ...options, new: true });
    return { matchedCount: doc && !options.upsert ? 1 : doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
  }

  async updateMany(filter: Row, update: Row) {
    const rows = (await this.rows()).filter((row) => matches(row, filter));
    for (const row of rows) await this.change({ _id: row._id }, update, { new: true });
    return { matchedCount: rows.length, modifiedCount: rows.length };
  }

  findOneAndUpdate(filter: Row, update: Row, options: { new?: boolean; upsert?: boolean; session?: unknown } = {}) {
    let lean = false;
    let started: Promise<any> | null = null;
    const run = () => {
      started ??= this.change(filter, update, { new: options.new === true, upsert: options.upsert }).then((doc) => (doc && lean ? strip(doc) : doc));
      return started;
    };
    return {
      lean() { lean = true; return this; },
      session() { return this; },
      then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
        return run().then(onfulfilled, onrejected);
      },
    };
  }

  findByIdAndUpdate(id: string, update: Row, options: { new?: boolean } = {}) {
    return this.findOneAndUpdate({ _id: id }, update, options);
  }

  async deleteOne(filter: Row) {
    const row = (await this.rows()).find((item) => matches(item, filter));
    if (!row) return { deletedCount: 0 };
    await database().collection(this.name).doc(String(row._id)).delete();
    this.cache?.delete(String(row._id));
    return { deletedCount: 1 };
  }

  async deleteMany(filter: Row) {
    const rows = (await this.rows()).filter((item) => matches(item, filter));
    for (const row of rows) {
      await database().collection(this.name).doc(String(row._id)).delete();
      this.cache?.delete(String(row._id));
    }
    return { deletedCount: rows.length };
  }

  async aggregate(pipeline: Row[]) {
    let rows = await this.rows();
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((row) => matches(row, stage.$match));
      if (stage.$group) {
        const groups = new Map<string, Row>();
        for (const row of rows) {
          const id = typeof stage.$group._id === "string" && stage.$group._id.startsWith("$") ? getPath(row, stage.$group._id.slice(1)) : stage.$group._id ?? null;
          const key = JSON.stringify(id);
          const acc = groups.get(key) ?? { _id: id };
          for (const [field, spec] of Object.entries(stage.$group)) {
            if (field === "_id" || !spec || typeof spec !== "object" || !("$sum" in (spec as Row))) continue;
            const add = (spec as Row).$sum === 1 ? 1 : Number(evalExpr(row, (spec as Row).$sum) ?? 0);
            acc[field] = Number(acc[field] ?? 0) + add;
          }
          groups.set(key, acc);
        }
        rows = [...groups.values()];
      }
    }
    return rows;
  }
}

const collections = new Map<string, Collection>();

export function model(name: string, schema: Schema) {
  const existing = collections.get(name);
  if (existing) return existing;
  const created = new Collection(name, schema.definition);
  collections.set(name, created);
  return created;
}
