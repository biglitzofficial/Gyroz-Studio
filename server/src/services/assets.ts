import type { AuthContext } from "../auth";
import { AppError, pageParams } from "../http";
import { Employee, Equipment } from "../models";
import { audit, nextCode, studioTimezone } from "../platform";
import { businessDateKey } from "../domain/dates";

const CATEGORIES = ["camera", "lens", "lighting", "audio", "drone", "grip", "computer", "storage", "power", "vehicle", "other"] as const;
const CONDITIONS = ["new", "good", "fair", "poor"] as const;
const KINDS = ["assigned", "returned", "damaged", "repair_sent", "repair_done", "service", "retired", "lost", "note"] as const;

type Kind = (typeof KINDS)[number];

function assertOffice(auth: AuthContext) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only an admin can manage studio assets.");
}

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function dateKey(value: unknown, label: string, required = false) {
  const day = clean(value, 10);
  if (!day) {
    if (required) throw new AppError(400, "VALIDATION", `${label} needs a date.`);
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError(400, "VALIDATION", `${label} needs a date like 2026-10-17.`);
  return day;
}

function money(value: unknown, label: string) {
  const amount = Number(value ?? 0);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000_00) throw new AppError(400, "VALIDATION", `${label} needs a rupee amount.`);
  return amount;
}

async function names() {
  const people = await Employee.find({}).select("firstName lastName employeeCode").lean() as Array<{ _id: unknown; firstName?: string; lastName?: string; employeeCode?: string }>;
  return new Map(people.map((person) => [String(person._id), [person.employeeCode, person.firstName, person.lastName].filter(Boolean).join(" ")]));
}

function present(asset: Record<string, any>, people: Map<string, string>): Record<string, any> {
  const events = (Array.isArray(asset.events) ? asset.events : []).map((event) => ({
    ...event,
    holderName: event.holderEmployeeId ? people.get(String(event.holderEmployeeId)) ?? "" : "",
  }));
  return {
    ...asset,
    holderName: asset.holderEmployeeId ? people.get(String(asset.holderEmployeeId)) ?? "" : "",
    events,
  };
}

async function assertSerial(serial: string, exceptId?: string) {
  const value = serial.trim().toLowerCase();
  if (!value) return;
  const rows = await Equipment.find({}).select("serialNumber").lean() as Array<{ _id: unknown; serialNumber?: string }>;
  const clash = rows.find((row) => String(row.serialNumber ?? "").trim().toLowerCase() === value && String(row._id) !== exceptId);
  if (clash) throw new AppError(409, "CONFLICT", "Another item already uses that serial number.");
}

export async function listAssets(auth: AuthContext, query: Record<string, unknown>) {
  assertOffice(auth);
  const people = await names();
  const rows = (await Equipment.find({}).lean() as Array<Record<string, any>>).map((row) => present(row, people));
  const summary = {
    total: rows.length,
    available: rows.filter((row) => row.status === "available").length,
    assigned: rows.filter((row) => row.status === "assigned").length,
    inRepair: rows.filter((row) => row.status === "in_repair").length,
    damaged: rows.filter((row) => row.status === "damaged").length,
    purchasePaise: rows.reduce((sum, row) => sum + Number(row.purchasePaise ?? 0), 0),
    repairPaise: rows.reduce((sum, row) => sum + Number(row.repairPaise ?? 0), 0),
    servicePaise: rows.reduce((sum, row) => sum + Number(row.servicePaise ?? 0), 0),
  };
  const needle = clean(query.q, 80).toLowerCase();
  let visible = rows;
  if (query.category) visible = visible.filter((row) => row.category === String(query.category));
  if (query.status) visible = visible.filter((row) => row.status === String(query.status));
  if (needle) {
    visible = visible.filter((row) => [row.assetCode, row.name, row.brand, row.modelName, row.serialNumber, row.location, row.holderName].join(" ").toLowerCase().includes(needle));
  }
  const stamp = (row: { createdAt?: unknown }) => {
    const time = new Date((row.createdAt ?? 0) as string).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  visible.sort((left, right) => stamp(right) - stamp(left));
  const { page, limit, skip } = pageParams({ page: query.page ?? 1, limit: query.limit ?? 20 });
  return {
    items: visible.slice(skip, skip + limit).map((row) => ({ ...row, events: undefined, eventCount: row.events.length })),
    total: visible.length,
    page,
    pageSize: limit,
    summary,
  };
}

export async function getAsset(auth: AuthContext, id: string) {
  assertOffice(auth);
  const asset = await Equipment.findById(id).lean() as Record<string, any> | null;
  if (!asset) throw new AppError(404, "NOT_FOUND", "Asset not found.");
  const row = present(asset, await names());
  row.events = [...row.events].reverse();
  return row;
}

export async function createAsset(auth: AuthContext, input: Record<string, unknown>) {
  assertOffice(auth);
  const name = clean(input.name, 80);
  if (name.length < 2) throw new AppError(400, "VALIDATION", "Name the item.");
  const category = clean(input.category, 20);
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) throw new AppError(400, "VALIDATION", "Choose a category.");
  const condition = clean(input.condition, 20) || "good";
  if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) throw new AppError(400, "VALIDATION", "Choose the condition.");
  const serialNumber = clean(input.serialNumber, 80);
  await assertSerial(serialNumber);
  const purchasePaise = money(input.purchasePaise, "Purchase cost");
  const purchaseDate = dateKey(input.purchaseDate, "Purchase date");
  const warrantyUntil = dateKey(input.warrantyUntil, "Warranty");
  const day = purchaseDate || businessDateKey(new Date(), await studioTimezone());
  const asset = await Equipment.create({
    assetCode: await nextCode("asset", "GY-A"),
    name,
    category,
    brand: clean(input.brand, 80),
    modelName: clean(input.modelName, 80),
    serialNumber,
    status: "available",
    condition,
    location: clean(input.location, 120),
    purchaseDate,
    purchasePaise,
    vendor: clean(input.vendor, 80),
    warrantyUntil,
    notes: clean(input.notes, 500),
    repairPaise: 0,
    servicePaise: 0,
    events: [{
      kind: "added",
      dateKey: day,
      note: "Added to the studio.",
      costPaise: purchasePaise,
      recordedAt: new Date(),
      recordedBy: auth.userId,
    }],
  });
  await audit({ actorId: auth.userId, action: "asset.created", entityType: "equipment", entityId: String(asset._id), after: { assetCode: asset.assetCode, name, purchasePaise } });
  return getAsset(auth, String(asset._id));
}

export async function updateAsset(auth: AuthContext, id: string, input: Record<string, unknown>) {
  assertOffice(auth);
  const asset = await Equipment.findById(id);
  if (!asset) throw new AppError(404, "NOT_FOUND", "Asset not found.");
  const name = clean(input.name, 80);
  if (name.length < 2) throw new AppError(400, "VALIDATION", "Name the item.");
  const category = clean(input.category, 20);
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) throw new AppError(400, "VALIDATION", "Choose a category.");
  const condition = clean(input.condition, 20);
  if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) throw new AppError(400, "VALIDATION", "Choose the condition.");
  const serialNumber = clean(input.serialNumber, 80);
  await assertSerial(serialNumber, id);
  const before = { name: asset.name, serialNumber: asset.serialNumber, purchasePaise: asset.purchasePaise, condition: asset.condition, location: asset.location };
  asset.name = name;
  asset.category = category;
  asset.brand = clean(input.brand, 80);
  asset.modelName = clean(input.modelName, 80);
  asset.serialNumber = serialNumber;
  asset.condition = condition;
  asset.location = clean(input.location, 120);
  asset.purchaseDate = dateKey(input.purchaseDate, "Purchase date");
  asset.purchasePaise = money(input.purchasePaise, "Purchase cost");
  asset.vendor = clean(input.vendor, 80);
  asset.warrantyUntil = dateKey(input.warrantyUntil, "Warranty");
  asset.notes = clean(input.notes, 500);
  await asset.save();
  await audit({ actorId: auth.userId, action: "asset.updated", entityType: "equipment", entityId: id, before, after: { name, serialNumber, purchasePaise: asset.purchasePaise, condition, location: asset.location } });
  return getAsset(auth, id);
}

export async function recordAssetEvent(auth: AuthContext, id: string, input: { kind: string; dateKey?: string; note?: string; costPaise?: number; holderEmployeeId?: string; condition?: string }) {
  assertOffice(auth);
  const kind = input.kind as Kind;
  if (!KINDS.includes(kind)) throw new AppError(400, "VALIDATION", "Choose what happened.");
  const asset = await Equipment.findById(id);
  if (!asset) throw new AppError(404, "NOT_FOUND", "Asset not found.");
  const day = dateKey(input.dateKey, "Date", true);
  const note = clean(input.note, 500);
  const costPaise = money(input.costPaise, "Cost");
  const closed = asset.status === "retired" || asset.status === "lost";
  if (closed && kind !== "note") throw new AppError(409, "CONFLICT", "This item is closed. Add a note if something still needs recording.");
  let holderEmployeeId = "";
  if (kind === "assigned") {
    if (asset.status !== "available") throw new AppError(409, "CONFLICT", "Only an available item can be handed out.");
    holderEmployeeId = clean(input.holderEmployeeId, 40);
    const person = holderEmployeeId ? await Employee.findById(holderEmployeeId).lean() as { employmentStatus?: string } | null : null;
    if (!person || person.employmentStatus === "inactive") throw new AppError(400, "VALIDATION", "Choose an active person.");
    asset.holderEmployeeId = holderEmployeeId;
    asset.status = "assigned";
  } else if (kind === "returned") {
    if (!asset.holderEmployeeId || !["assigned", "damaged"].includes(asset.status)) throw new AppError(409, "CONFLICT", "This item is not out with anyone.");
    holderEmployeeId = String(asset.holderEmployeeId);
    asset.holderEmployeeId = undefined;
    if (asset.status === "assigned") asset.status = "available";
  } else if (kind === "damaged") {
    if (note.length < 2) throw new AppError(400, "VALIDATION", "Describe the damage.");
    if (asset.status !== "in_repair") asset.status = "damaged";
  } else if (kind === "repair_sent") {
    if (asset.status === "in_repair") throw new AppError(409, "CONFLICT", "This item is already in repair.");
    if (note.length < 2) throw new AppError(400, "VALIDATION", "Name the shop or what needs fixing.");
    holderEmployeeId = asset.holderEmployeeId ? String(asset.holderEmployeeId) : "";
    asset.holderEmployeeId = undefined;
    asset.status = "in_repair";
  } else if (kind === "repair_done") {
    if (asset.status !== "in_repair") throw new AppError(409, "CONFLICT", "Send the item for repair before recording the bill.");
    if (note.length < 2) throw new AppError(400, "VALIDATION", "Describe what was repaired.");
    asset.repairPaise = Number(asset.repairPaise ?? 0) + costPaise;
    asset.status = "available";
    asset.holderEmployeeId = undefined;
  } else if (kind === "service") {
    if (asset.status === "in_repair") throw new AppError(409, "CONFLICT", "Finish the open repair before logging a service.");
    if (note.length < 2) throw new AppError(400, "VALIDATION", "Describe the service.");
    asset.servicePaise = Number(asset.servicePaise ?? 0) + costPaise;
  } else if (kind === "retired") {
    if (note.length < 2) throw new AppError(400, "VALIDATION", "Say why it is leaving the kit.");
    asset.holderEmployeeId = undefined;
    asset.status = "retired";
  } else if (kind === "lost") {
    if (note.length < 2) throw new AppError(400, "VALIDATION", "Describe how it was lost.");
    holderEmployeeId = asset.holderEmployeeId ? String(asset.holderEmployeeId) : "";
    asset.holderEmployeeId = undefined;
    asset.status = "lost";
  } else if (note.length < 2) {
    throw new AppError(400, "VALIDATION", "Write the note.");
  }
  if (input.condition && (kind === "repair_done" || kind === "service")) {
    const condition = clean(input.condition, 20);
    if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) throw new AppError(400, "VALIDATION", "Choose the condition.");
    asset.condition = condition;
  }
  const events = Array.isArray(asset.events) ? asset.events : [];
  asset.events = [...events, {
    kind,
    dateKey: day,
    note,
    costPaise,
    holderEmployeeId: holderEmployeeId || undefined,
    recordedAt: new Date(),
    recordedBy: auth.userId,
  }].slice(-500);
  await asset.save();
  await audit({ actorId: auth.userId, action: `asset.${kind}`, entityType: "equipment", entityId: id, after: { status: asset.status, costPaise, note, repairPaise: asset.repairPaise, servicePaise: asset.servicePaise } });
  return getAsset(auth, id);
}
