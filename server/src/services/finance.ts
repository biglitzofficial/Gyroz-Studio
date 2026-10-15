import PDFDocument from "pdfkit";
import type { Response } from "express";
import { assertClientAccess, hasPermission, scopeFilter, type AuthContext } from "../auth";
import { calculateInvoice, MoneyError, outstandingPaise, presentInvoiceStatus, type InvoiceLineInput } from "../domain/money";
import { INVOICE_EDITABLE } from "../domain/workflow";
import { AppError } from "../http";
import { Client, Deliverable, EditingTask, Expense, Invoice, Payment, Project, PublishingTask, Reshoot, Settings, Shoot } from "../models";
import { activity, audit, getSettings, nextCode, notify, recipientIds, userIdsForSystemKey } from "../platform";

type LineDraft = InvoiceLineInput & { sourceType?: string; sourceId?: string; serviceType?: string };

function moneyError(error: unknown): never {
  if (error instanceof MoneyError) throw new AppError(400, "VALIDATION", error.message);
  throw error;
}

function totalsFor(lines: LineDraft[], discountPaise: number, taxRateBps: number) {
  try {
    return calculateInvoice(lines, discountPaise, taxRateBps);
  } catch (error) {
    moneyError(error);
  }
}

async function assertBillableSources(lines: LineDraft[], invoiceId?: string) {
  for (const line of lines) {
    if (!line.sourceId || line.sourceType === "manual" || !line.sourceType) continue;
    const clash = await Invoice.findOne({
      _id: { $ne: invoiceId },
      status: { $ne: "void" },
      lineItems: { $elemMatch: { sourceId: line.sourceId, sourceType: line.sourceType } },
    }).lean() as any;
    if (clash) throw new AppError(409, "CONFLICT", "That item is already on another invoice.");
    if (line.sourceType === "reshoot") {
      const reshoot = await Reshoot.findById(line.sourceId);
      if (!reshoot) throw new AppError(400, "VALIDATION", "Reshoot not found.");
      if (!["approved", "partial"].includes(reshoot.billableDecision) || reshoot.chargePaise <= 0) {
        throw new AppError(409, "CONFLICT", "Only an approved billable reshoot charge can be invoiced.");
      }
    }
    if (line.sourceType === "deliverable") {
      const deliverable = await Deliverable.findById(line.sourceId);
      if (!deliverable || deliverable.billableStatus === "waived") throw new AppError(409, "CONFLICT", "This deliverable is not billable.");
      if (deliverable.status !== "published" && deliverable.billableStatus !== "eligible" && deliverable.billableStatus !== "invoiced") {
        throw new AppError(409, "CONFLICT", "A deliverable can be billed after it is published.");
      }
    }
  }
}

function present<T extends { status: "draft" | "pending_approval" | "approved" | "issued" | "partially_paid" | "paid" | "void"; dueDate?: Date | null; totalPaise: number; paidPaise: number }>(invoice: T) {
  return { ...invoice, displayStatus: presentInvoiceStatus(invoice.status, invoice.dueDate ?? null, invoice.totalPaise, invoice.paidPaise), outstandingPaise: invoice.totalPaise - invoice.paidPaise };
}

export function previewInvoice(input: { lineItems: Array<{ description: string; quantity: number; unitPricePaise: number; discountPaise?: number; sourceType?: string; sourceId?: string; serviceType?: string }>; discountPaise?: number; taxRateBps?: number }) {
  const lines = input.lineItems.map((line) => ({ ...line, discountPaise: line.discountPaise ?? 0 }));
  const totals = totalsFor(lines, input.discountPaise ?? 0, input.taxRateBps ?? 0);
  return { ...totals, outstandingPaise: totals.totalPaise };
}

export async function listInvoices(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (query.clientId) filter.clientId = query.clientId;
  if (query.status === "overdue") {
    filter.status = { $in: ["issued", "partially_paid"] };
    filter.dueDate = { $lt: new Date() };
    filter.$expr = { $lt: ["$paidPaise", "$totalPaise"] };
  } else if (query.status) filter.status = query.status;
  const rows = await Invoice.find(filter).sort({ createdAt: -1 }).limit(100).lean() as any;
  return rows.map((row) => present(row));
}

export async function getInvoice(auth: AuthContext, id: string) {
  const invoice = await Invoice.findById(id).lean() as any;
  if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
  assertClientAccess(auth, invoice.clientId, invoice.projectId);
  const [client, project, payments] = await Promise.all([
    Client.findById(invoice.clientId).lean() as any,
    invoice.projectId ? Project.findById(invoice.projectId).lean() as any : null,
    Payment.find({ invoiceId: id }).sort({ paidAt: 1 }).lean() as any,
  ]);
  return { invoice: present(invoice), client, project, payments };
}

export async function billableItems(auth: AuthContext, clientId: string) {
  assertClientAccess(auth, clientId);
  const [deliverables, reshoots] = await Promise.all([
    Deliverable.find({ clientId, status: "published", billableStatus: "eligible" }).lean() as any,
    Reshoot.find({ clientId, billableDecision: { $in: ["approved", "partial"] }, chargePaise: { $gt: 0 }, invoicedInvoiceId: null }).lean() as any,
  ]);
  return {
    deliverables: deliverables.map((item) => ({ sourceType: "deliverable", sourceId: item._id, description: `${item.deliverableCode} · ${item.title}`, suggestedPaise: null })),
    reshoots: reshoots.map((item) => ({ sourceType: "reshoot", sourceId: item._id, description: `${item.reshootCode} reshoot`, suggestedPaise: item.chargePaise })),
  };
}

async function writeInvoice(auth: AuthContext, id: string | undefined, input: { clientId: string; projectId?: string; dueDate?: string; lineItems: Array<Omit<LineDraft, "discountPaise"> & { discountPaise?: number }>; discountPaise?: number; taxRateBps?: number; internalNotes?: string; clientNotes?: string }) {
  const client = await Client.findById(input.clientId);
  if (!client) throw new AppError(400, "VALIDATION", "Client not found.");
  assertClientAccess(auth, client._id, input.projectId);
  const settings = await getSettings();
  const discountPaise = input.discountPaise ?? 0;
  const taxRateBps = input.taxRateBps ?? settings.defaultTaxRateBps ?? 0;
  const normalizedLines = input.lineItems.map((line) => ({ ...line, discountPaise: line.discountPaise ?? 0 }));
  const totals = totalsFor(normalizedLines, discountPaise, taxRateBps);
  await assertBillableSources(normalizedLines, id);
  const lineItems = totals.lines.map((line, index) => ({
    description: line.description,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    discountPaise: line.discountPaise,
    sourceType: normalizedLines[index]?.sourceType ?? "manual",
    sourceId: normalizedLines[index]?.sourceId || undefined,
    serviceType: normalizedLines[index]?.serviceType,
  }));
  if (!id) {
    const invoice = await Invoice.create({
      invoiceNumber: await nextCode("invoice", "GY-INV"),
      clientId: input.clientId,
      projectId: input.projectId,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      lineItems,
      discountPaise,
      taxRateBps,
      subtotalPaise: totals.subtotalPaise,
      taxPaise: totals.taxPaise,
      totalPaise: totals.totalPaise,
      internalNotes: input.internalNotes ?? "",
      clientNotes: input.clientNotes ?? "",
      createdBy: auth.userId,
      currency: settings.currency,
    });
    await audit({ actorId: auth.userId, action: "invoice.created", entityType: "invoice", entityId: String(invoice._id), after: { totalPaise: invoice.totalPaise, invoiceNumber: invoice.invoiceNumber } });
    return getInvoice(auth, String(invoice._id));
  }
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
  if (!INVOICE_EDITABLE.includes(invoice.status as "draft" | "pending_approval")) {
    throw new AppError(409, "INVOICE_LOCKED", "Issued invoices cannot be overwritten. Record a payment or void the invoice.");
  }
  const before = { totalPaise: invoice.totalPaise, lineItems: invoice.lineItems };
  invoice.clientId = client._id;
  invoice.projectId = input.projectId as unknown as typeof invoice.projectId;
  invoice.dueDate = input.dueDate ? new Date(input.dueDate) : invoice.dueDate;
  invoice.lineItems = lineItems as unknown as typeof invoice.lineItems;
  invoice.discountPaise = discountPaise;
  invoice.taxRateBps = taxRateBps;
  invoice.subtotalPaise = totals.subtotalPaise;
  invoice.taxPaise = totals.taxPaise;
  invoice.totalPaise = totals.totalPaise;
  invoice.internalNotes = input.internalNotes ?? invoice.internalNotes;
  invoice.clientNotes = input.clientNotes ?? invoice.clientNotes;
  await invoice.save();
  await audit({ actorId: auth.userId, action: "invoice.updated", entityType: "invoice", entityId: id, before, after: { totalPaise: invoice.totalPaise } });
  return getInvoice(auth, id);
}

export const saveInvoice = writeInvoice;

const GENERATED_SERVICES = new Set(["shoot", "editing", "reshoot", "published"]);

function hoursLabel(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function rupees(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
}

export async function draftInvoiceForPublished(auth: AuthContext, publishedTask: { clientId: unknown; projectId: unknown }) {
  const projectId = String(publishedTask.projectId);
  const clientId = String(publishedTask.clientId);
  const [project, shoots, tasks, reshoots, published, publishedPosts, existing] = await Promise.all([
    Project.findById(projectId).select("name").lean() as any,
    Shoot.find({ projectId, status: { $in: ["in_progress", "submitted"] } }).select("shootCode").lean() as any,
    EditingTask.find({ projectId, status: { $nin: ["available", "cancelled"] } }).select("hoursSpent status").lean() as any,
    Reshoot.find({ projectId }).select("approvalStatus billableDecision chargePaise").lean() as any,
    Deliverable.find({ projectId, status: "published", billableStatus: "eligible" }).select("title deliverableCode").lean() as any,
    PublishingTask.find({ projectId, status: "published" }).select("deliverableId publishedAt").lean() as any,
    Invoice.findOne({ projectId, status: "draft" }).sort({ createdAt: -1 }),
  ]);
  const prior = (existing?.lineItems ?? []) as Array<{ serviceType?: string; sourceId?: unknown; unitPricePaise?: number; description?: string; quantity?: number; discountPaise?: number; sourceType?: string }>;
  const keptRate = (serviceType: string, sourceId?: string) => {
    const match = prior.find((line) => sourceId ? String(line.sourceId) === sourceId : line.serviceType === serviceType);
    return match?.unitPricePaise ?? 0;
  };
  const hours = tasks.reduce((sum: number, task: { hoursSpent?: number }) => sum + (Number(task.hoursSpent) || 0), 0);
  const approvedCharge = reshoots
    .filter((item: { billableDecision?: string; chargePaise?: number }) => ["approved", "partial"].includes(item.billableDecision ?? "") && (item.chargePaise ?? 0) > 0)
    .reduce((sum: number, item: { chargePaise?: number }) => sum + (item.chargePaise ?? 0), 0);
  const lines: Array<{ description: string; quantity: number; unitPricePaise: number; discountPaise: number; sourceType?: string; sourceId?: string; serviceType?: string }> = [];
  if (shoots.length) {
    lines.push({
      description: `Shoots · ${shoots.length} taken`.slice(0, 160),
      quantity: Math.min(shoots.length, 999),
      unitPricePaise: keptRate("shoot"),
      discountPaise: 0,
      sourceType: "manual",
      serviceType: "shoot",
    });
  }
  lines.push({
    description: `Editing · ${tasks.length} cut${tasks.length === 1 ? "" : "s"} · ${hours > 0 ? `${hoursLabel(hours)}h logged` : "hours not logged yet"}`.slice(0, 160),
    quantity: Math.min(Math.max(tasks.length, 1), 999),
    unitPricePaise: keptRate("editing"),
    discountPaise: 0,
    sourceType: "manual",
    serviceType: "editing",
  });
  if (reshoots.length) {
    const chargeNote = approvedCharge > 0 ? ` · approved charges ${rupees(approvedCharge)}` : "";
    lines.push({
      description: `Reshoots · ${reshoots.length}${chargeNote}`.slice(0, 160),
      quantity: Math.min(reshoots.length, 999),
      unitPricePaise: keptRate("reshoot"),
      discountPaise: 0,
      sourceType: "manual",
      serviceType: "reshoot",
    });
  }
  const savedAt = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const keptPublished = new Set(prior.filter((line) => line.serviceType === "published" && line.sourceId).map((line) => String(line.sourceId)));
  const publishedAt = new Map((publishedPosts as Array<{ deliverableId: unknown; publishedAt?: Date }>).map((post) => [String(post.deliverableId), post.publishedAt ? new Date(post.publishedAt).getTime() : 0]));
  for (const item of published) {
    const id = String(item._id);
    const fresh = !existing || (publishedAt.get(id) ?? 0) > savedAt;
    if (existing && !keptPublished.has(id) && !fresh) continue;
    lines.push({
      description: `Published · ${item.deliverableCode} ${item.title}`.slice(0, 160),
      quantity: 1,
      unitPricePaise: keptRate("published", id),
      discountPaise: 0,
      sourceType: "deliverable",
      sourceId: id,
      serviceType: "published",
    });
  }
  const extras = prior
    .filter((line) => !GENERATED_SERVICES.has(line.serviceType ?? ""))
    .map((line) => ({
      description: line.description ?? "Additional charge",
      quantity: line.quantity ?? 1,
      unitPricePaise: line.unitPricePaise ?? 0,
      discountPaise: line.discountPaise ?? 0,
      sourceType: line.sourceType,
      sourceId: line.sourceId ? String(line.sourceId) : undefined,
      serviceType: line.serviceType,
    }));
  const saved = await writeInvoice(auth, existing ? String(existing._id) : undefined, {
    clientId,
    projectId,
    lineItems: [...lines, ...extras],
    discountPaise: existing?.discountPaise ?? 0,
    taxRateBps: existing?.taxRateBps ?? 0,
    clientNotes: existing?.clientNotes || "Opened when a video was published. Counts come from the project. Set each rate before you approve.",
    internalNotes: existing?.internalNotes || `${project?.name ?? "Project"} · shoots, editing, and reshoots.`,
  });
  await notify(await recipientIds("invoices.view", clientId), {
    type: "invoice.draft",
    title: "Invoice ready to edit",
    body: `${saved.invoice.invoiceNumber} lists the shoots, editing, and reshoots for ${project?.name ?? "the project"}.`,
    entityType: "invoice",
    entityId: String(saved.invoice._id),
  });
  return saved;
}

export async function submitInvoice(auth: AuthContext, id: string) {
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
  if (invoice.status !== "draft") throw new AppError(409, "CONFLICT", "Only a draft can be submitted for approval.");
  if (!invoice.lineItems.length) throw new AppError(400, "VALIDATION", "Add a line before submitting.");
  invoice.status = "pending_approval";
  await invoice.save();
  return getInvoice(auth, id);
}

export async function approveInvoice(auth: AuthContext, id: string) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can approve an invoice.");
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
  if (!["draft", "pending_approval"].includes(invoice.status)) throw new AppError(409, "CONFLICT", "This invoice is not waiting for approval.");
  invoice.status = "approved";
  invoice.approvedBy = auth.userId as unknown as typeof invoice.approvedBy;
  await invoice.save();
  await audit({ actorId: auth.userId, action: "invoice.approved", entityType: "invoice", entityId: id, after: { totalPaise: invoice.totalPaise } });
  return getInvoice(auth, id);
}

export async function issueInvoice(auth: AuthContext, id: string) {
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
  if (invoice.status !== "approved") throw new AppError(409, "CONFLICT", "Approve the invoice before issuing it.");
  invoice.status = "issued";
  invoice.issueDate = new Date();
  await invoice.save();
  for (const line of invoice.lineItems) {
    if (line.sourceType === "deliverable" && line.sourceId) await Deliverable.updateOne({ _id: line.sourceId }, { billableStatus: "invoiced" });
    if (line.sourceType === "reshoot" && line.sourceId) await Reshoot.updateOne({ _id: line.sourceId }, { invoicedInvoiceId: invoice._id });
  }
  if (invoice.projectId) await Deliverable.updateMany({ projectId: invoice.projectId, status: "published", billableStatus: "eligible" }, { billableStatus: "invoiced" });
  await activity({ clientId: invoice.clientId, projectId: invoice.projectId, actorId: auth.userId, verb: "invoice.issued", summary: `${invoice.invoiceNumber} issued.` });
  await audit({ actorId: auth.userId, action: "invoice.issued", entityType: "invoice", entityId: id, after: { totalPaise: invoice.totalPaise, status: "issued" } });
  return getInvoice(auth, id);
}

export async function voidInvoice(auth: AuthContext, id: string, reason: string) {
  if (!reason.trim()) throw new AppError(400, "VALIDATION", "A voided invoice needs a reason.");
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
  if (invoice.paidPaise > 0) throw new AppError(409, "CONFLICT", "Reverse recorded payments before voiding this invoice.");
  if (invoice.status === "void" || invoice.status === "paid") throw new AppError(409, "CONFLICT", "This invoice cannot be voided.");
  const before = invoice.status;
  invoice.status = "void";
  invoice.voidReason = reason.trim();
  invoice.voidedBy = auth.userId as unknown as typeof invoice.voidedBy;
  await invoice.save();
  for (const line of invoice.lineItems) {
    if (line.sourceType === "deliverable" && line.sourceId) await Deliverable.updateOne({ _id: line.sourceId, billableStatus: "invoiced" }, { billableStatus: "eligible" });
    if (line.sourceType === "reshoot" && line.sourceId) await Reshoot.updateOne({ _id: line.sourceId }, { $unset: { invoicedInvoiceId: 1 } });
  }
  await audit({ actorId: auth.userId, action: "invoice.voided", entityType: "invoice", entityId: id, before: { status: before }, after: { status: "void", reason } });
  return getInvoice(auth, id);
}

export async function recordPayment(auth: AuthContext, input: { invoiceId: string; amountPaise: number; method: string; reference?: string; paidAt?: string; note?: string }) {
  const existing = await Invoice.findById(input.invoiceId);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
  assertClientAccess(auth, existing.clientId, existing.projectId);
  if (!["issued", "partially_paid"].includes(existing.status)) throw new AppError(409, "CONFLICT", "Payments can be recorded only against an issued invoice.");
  try {
    outstandingPaise(existing.totalPaise, existing.paidPaise + input.amountPaise - input.amountPaise);
    if (input.amountPaise > existing.totalPaise - existing.paidPaise) throw new MoneyError("The payment is larger than the outstanding balance.");
  } catch (error) {
    moneyError(error);
  }
  const invoice = await Invoice.findOneAndUpdate(
    { _id: input.invoiceId, status: { $in: ["issued", "partially_paid"] }, $expr: { $gte: [{ $subtract: ["$totalPaise", "$paidPaise"] }, input.amountPaise] } },
    { $inc: { paidPaise: input.amountPaise } },
    { new: true },
  );
  if (!invoice) throw new AppError(409, "CONFLICT", "The payment is larger than the outstanding balance.");
  const status = invoice.paidPaise >= invoice.totalPaise ? "paid" : "partially_paid";
  invoice.status = status;
  await invoice.save();
  const payment = await Payment.create({
    invoiceId: invoice._id,
    clientId: invoice.clientId,
    amountPaise: input.amountPaise,
    method: input.method,
    reference: input.reference ?? "",
    paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
    recordedBy: auth.userId,
    note: input.note ?? "",
  });
  await audit({ actorId: auth.userId, action: "payment.recorded", entityType: "payment", entityId: String(payment._id), after: { invoiceId: invoice._id, amountPaise: input.amountPaise, status } });
  await activity({ clientId: invoice.clientId, projectId: invoice.projectId, actorId: auth.userId, verb: "payment.recorded", summary: `Payment recorded against ${invoice.invoiceNumber}.` });
  return getInvoice(auth, String(invoice._id));
}

export async function listPayments(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (query.clientId) filter.clientId = query.clientId;
  return Payment.find(filter).sort({ paidAt: -1 }).limit(100).lean() as any;
}

export async function listExpenses(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = {};
  if (auth.systemKey !== "admin" && !auth.isSuperAdmin) filter.submittedBy = auth.userId;
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  return Expense.find(filter).sort({ dateKey: -1 }).limit(200).lean() as any;
}

export async function createExpense(auth: AuthContext, input: Record<string, unknown>) {
  const expense = await Expense.create({ ...input, submittedBy: auth.userId, status: "pending" });
  await audit({ actorId: auth.userId, action: "expense.created", entityType: "expense", entityId: String(expense._id), after: { amountPaise: expense.amountPaise, category: expense.category } });
  await notify(await userIdsForSystemKey("admin"), {
    type: "expense.submitted",
    title: "Expense waiting for admin approval",
    body: expense.description,
    entityType: "expense",
    entityId: String(expense._id),
  });
  return expense.toObject();
}

export async function decideExpense(auth: AuthContext, id: string, status: "approved" | "rejected") {
  const expense = await Expense.findById(id);
  if (!expense) throw new AppError(404, "NOT_FOUND", "Expense not found.");
  if (auth.systemKey === "admin") {
    if (expense.status !== "pending") throw new AppError(409, "CONFLICT", "This expense is not waiting for an admin.");
    if (status === "approved") {
      expense.status = "admin_approved";
      expense.adminApprovedBy = auth.userId as unknown as typeof expense.adminApprovedBy;
      await notify(await userIdsForSystemKey("super_admin"), {
        type: "expense.admin_approved",
        title: "Expense waiting for final approval",
        body: expense.description,
        entityType: "expense",
        entityId: String(expense._id),
      });
    } else {
      expense.status = "rejected";
      expense.rejectedBy = auth.userId as unknown as typeof expense.rejectedBy;
    }
  } else if (auth.isSuperAdmin) {
    if (expense.status !== "admin_approved") throw new AppError(409, "CONFLICT", "An admin has to approve this before you can decide.");
    if (status === "approved") {
      expense.status = "approved";
      expense.approvedBy = auth.userId as unknown as typeof expense.approvedBy;
    } else {
      expense.status = "rejected";
      expense.rejectedBy = auth.userId as unknown as typeof expense.rejectedBy;
    }
  } else {
    throw new AppError(403, "FORBIDDEN", "An admin approves first. Only a super admin can make the final decision.");
  }
  await expense.save();
  await audit({ actorId: auth.userId, action: `expense.${expense.status}`, entityType: "expense", entityId: id, after: { amountPaise: expense.amountPaise, status: expense.status } });
  return expense.toObject();
}

export async function renderInvoicePdf(auth: AuthContext, id: string, res: Response) {
  const { invoice, client } = await getInvoice(auth, id);
  const settings = await Settings.findOne({ key: "studio" }).lean() as any;
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${invoice.invoiceNumber}.pdf"`);
  doc.pipe(res);
  doc.rect(0, 0, 595, 8).fill("#FFD500");
  doc.fillColor("#171717").fontSize(22).text(settings?.legalName || "Gyroz Studio", 48, 36);
  doc.fontSize(10).fillColor("#666666").text("Tax invoice", 48, 64);
  doc.fillColor("#171717").fontSize(12).text(invoice.invoiceNumber, 360, 40, { align: "right" });
  doc.fontSize(10).fillColor("#666666").text(`Status  ${invoice.displayStatus}`, 360, 58, { align: "right" });
  doc.moveTo(48, 96).lineTo(547, 96).strokeColor("#E6E3DC").stroke();
  doc.fillColor("#171717").fontSize(10).text("Billed to", 48, 112);
  doc.fontSize(13).text(client?.name ?? "Client", 48, 128);
  doc.fontSize(10).fillColor("#303030").text(client?.billingAddress || "", 48, 148, { width: 240 });
  if (client?.gstin) doc.text(`GSTIN ${client.gstin}`, 48, 190);
  const format = (paise: number) => `Rs ${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let y = 230;
  doc.fillColor("#666666").fontSize(9).text("DESCRIPTION", 48, y).text("QTY", 320, y).text("RATE", 380, y).text("AMOUNT", 470, y, { align: "right", width: 77 });
  y += 18;
  for (const line of invoice.lineItems as Array<{ description: string; quantity: number; unitPricePaise: number; discountPaise: number }>) {
    const net = line.quantity * line.unitPricePaise - line.discountPaise;
    doc.fillColor("#171717").fontSize(10).text(line.description, 48, y, { width: 250 });
    doc.text(String(line.quantity), 320, y).text(format(line.unitPricePaise), 380, y).text(format(net), 470, y, { align: "right", width: 77 });
    y += 22;
  }
  y += 10;
  doc.moveTo(320, y).lineTo(547, y).strokeColor("#E6E3DC").stroke();
  const row = (label: string, value: string) => {
    y += 18;
    doc.fillColor("#666666").text(label, 320, y).fillColor("#171717").text(value, 470, y, { align: "right", width: 77 });
  };
  row("Subtotal", format(invoice.subtotalPaise as number));
  row("Discount", format(invoice.discountPaise as number));
  row("GST", format(invoice.taxPaise as number));
  row("Total", format(invoice.totalPaise as number));
  row("Paid", format(invoice.paidPaise as number));
  row("Outstanding", format((invoice.outstandingPaise as number) ?? 0));
  doc.fillColor("#666666").fontSize(9).text(invoice.clientNotes as string || "Payment is due by the date stated on this invoice.", 48, 760, { width: 500 });
  doc.end();
}

export async function canViewFinance(auth: AuthContext) {
  return hasPermission(auth, "invoices.view");
}
