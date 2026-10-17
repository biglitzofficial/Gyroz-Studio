import { Schema, model } from "./store";

const opts = { timestamps: true };

const roleSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    systemKey: { type: String, enum: ["super_admin", "admin", null], default: null },
    description: { type: String, default: "" },
    permissions: { type: [String], default: [] },
    protected: { type: Boolean, default: false },
  },
  opts,
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee" },
    roleId: { type: Schema.Types.ObjectId, ref: "Role", required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    scopeClientIds: { type: [Schema.Types.ObjectId], default: [] },
    scopeProjectIds: { type: [Schema.Types.ObjectId], default: [] },
    mustChangePassword: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    refreshTokens: { type: [{ hash: String, expiresAt: Date }], default: [] },
  },
  opts,
);

const compensationSchema = new Schema(
  {
    type: { type: String, enum: ["daily", "monthly"], default: "daily" },
    dailyRatePaise: { type: Number, default: 0 },
    monthlySalaryPaise: { type: Number, default: 0 },
    standardPayableDays: { type: Number, default: 26 },
  },
  { _id: false },
);

const employeeSchema = new Schema(
  {
    employeeCode: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    firstName: { type: String, required: true },
    lastName: { type: String, default: "" },
    email: { type: String, required: true },
    phone: { type: String, default: "" },
    photoAssetId: { type: Schema.Types.ObjectId },
    designation: { type: String, default: "" },
    roleId: { type: Schema.Types.ObjectId, ref: "Role", required: true },
    joiningDate: { type: String, required: true },
    employmentStatus: { type: String, enum: ["active", "on_leave", "inactive"], default: "active" },
    compensation: { type: compensationSchema, default: () => ({}) },
    reportingManagerId: { type: Schema.Types.ObjectId, ref: "Employee" },
    teamId: { type: Schema.Types.ObjectId, ref: "Team" },
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift" },
    emergencyContact: { name: String, phone: String, relation: String },
    bank: { accountName: String, accountNumber: String, ifsc: String, bankName: String },
    leaveBalance: { paid: { type: Number, default: 0 }, sick: { type: Number, default: 0 } },
    documents: { type: [{ assetId: Schema.Types.ObjectId, label: String }], default: [] },
    notes: { type: String, default: "" },
  },
  opts,
);
employeeSchema.index({ employmentStatus: 1, lastName: 1 });
employeeSchema.index({ teamId: 1 });

const teamSchema = new Schema({ name: { type: String, required: true }, leadEmployeeId: { type: Schema.Types.ObjectId, ref: "Employee" } }, opts);
const shiftSchema = new Schema(
  {
    name: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    graceMinutes: { type: Number, default: 10 },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
  },
  opts,
);
const holidaySchema = new Schema({ dateKey: { type: String, required: true, unique: true }, name: { type: String, required: true } }, opts);

const attendanceSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    dateKey: { type: String, required: true },
    checkInAt: Date,
    checkOutAt: Date,
    checkInSource: { type: String, enum: ["qr", "self", "correction"] },
    checkOutSource: { type: String, enum: ["qr", "self", "correction"] },
    late: { type: Boolean, default: false },
    earlyDeparture: { type: Boolean, default: false },
    minutes: { type: Number, default: 0 },
    latitude: Number,
    longitude: Number,
    accuracyMeters: Number,
    distanceMeters: Number,
    locationStatus: { type: String, enum: ["inside", "outside"] },
    correctionReason: String,
    correctedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  opts,
);
attendanceSchema.index({ employeeId: 1, dateKey: 1 }, { unique: true });

const attendanceTokenSchema = new Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  opts,
);
attendanceTokenSchema.index({ expiresAt: 1 });

const punchExceptionSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    dateKey: { type: String, required: true },
    kind: { type: String, enum: ["qr_failed", "location_failed", "missed_punch"], required: true },
    checkInTime: String,
    checkOutTime: String,
    reason: { type: String, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    decisionNote: String,
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
  },
  opts,
);
punchExceptionSchema.index({ employeeId: 1, dateKey: 1, status: 1 });

const leaveSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ["paid", "sick", "unpaid"], required: true },
    fromKey: { type: String, required: true },
    toKey: { type: String, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    decidedBy: { type: Schema.Types.ObjectId },
    decisionNote: String,
  },
  opts,
);
leaveSchema.index({ employeeId: 1, status: 1 });

const overtimeSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    dateKey: { type: String, required: true },
    minutes: { type: Number, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    decidedBy: { type: Schema.Types.ObjectId },
  },
  opts,
);

const payrollPeriodSchema = new Schema(
  {
    monthKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ["preview", "finalized"], default: "preview" },
    statutoryAcknowledged: { type: Boolean, default: false },
    finalizedBy: { type: Schema.Types.ObjectId },
    finalizedAt: Date,
    note: String,
  },
  opts,
);

const payslipSchema = new Schema(
  {
    periodId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    monthKey: { type: String, required: true },
    structure: compensationSchema,
    payableDays: Number,
    unpaidAbsenceDays: Number,
    sundayDaysWorked: Number,
    holidayDaysWorked: Number,
    overtimeMinutes: Number,
    basePaise: Number,
    overtimePaise: Number,
    sundayPaise: Number,
    holidayPaise: Number,
    bonusesPaise: Number,
    statutoryPaise: Number,
    deductionsPaise: Number,
    lopPaise: Number,
    timeDeductionPaise: Number,
    advancesPaise: Number,
    adjustmentsPaise: Number,
    grossPaise: Number,
    netPaise: Number,
    flags: [String],
    needsConfiguration: Boolean,
    statutoryApplied: Boolean,
  },
  opts,
);
payslipSchema.index({ periodId: 1, employeeId: 1 }, { unique: true });

const payrollAdjustmentSchema = new Schema(
  {
    periodId: { type: Schema.Types.ObjectId, required: true },
    payslipId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    amountPaise: { type: Number, required: true },
    reason: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  opts,
);

const contactSchema = new Schema({ name: String, role: String, phone: String, email: String }, { _id: true });
const clientSchema = new Schema(
  {
    clientCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    kind: { type: String, enum: ["company", "individual"], default: "company" },
    contactPerson: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    billingAddress: { type: String, default: "" },
    gstin: { type: String, default: "" },
    status: { type: String, enum: ["active", "paused", "archived"], default: "active" },
    pricingModel: { type: String, enum: ["project", "per_output", "package", "retainer"], default: "project" },
    contacts: { type: [contactSchema], default: [] },
    agreementRef: { type: String, default: "" },
    notes: { type: String, default: "" },
    requiresClientApproval: { type: Boolean, default: false },
  },
  opts,
);
clientSchema.index({ status: 1, name: 1 });
clientSchema.index({ name: 1 });

const pricingRuleSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client" },
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    serviceType: { type: String, required: true },
    label: { type: String, required: true },
    unitPricePaise: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    active: { type: Boolean, default: true },
  },
  opts,
);
pricingRuleSchema.index({ clientId: 1, serviceType: 1 });

const milestoneSchema = new Schema({ title: String, dueKey: String, done: { type: Boolean, default: false } }, { _id: true });
const projectSchema = new Schema(
  {
    projectCode: { type: String, required: true, unique: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    serviceType: { type: String, default: "video" },
    startDate: String,
    endDate: String,
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    managerId: { type: Schema.Types.ObjectId, ref: "Employee" },
    budgetPaise: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["planning", "scheduled", "in_production", "in_post", "awaiting_approval", "ready_for_publishing", "completed", "on_hold", "cancelled"],
      default: "planning",
    },
    requiresClientApproval: { type: Boolean, default: false },
    milestones: { type: [milestoneSchema], default: [] },
    notes: { type: String, default: "" },
  },
  opts,
);
projectSchema.index({ clientId: 1, status: 1 });
projectSchema.index({ status: 1, endDate: 1 });

const referenceSchema = new Schema({ label: String, url: String, assetId: Schema.Types.ObjectId }, { _id: false });
const shootSchema = new Schema(
  {
    shootCode: { type: String, required: true, unique: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    scheduledDate: { type: String, required: true },
    plannedStart: { type: String, default: "10:00" },
    plannedEnd: { type: String, default: "18:00" },
    actualStart: Date,
    actualEnd: Date,
    location: { type: String, default: "" },
    cinematographerId: { type: Schema.Types.ObjectId, required: true },
    crewIds: { type: [Schema.Types.ObjectId], default: [] },
    brief: { type: String, default: "" },
    status: { type: String, enum: ["scheduled", "in_progress", "submitted", "cancelled"], default: "scheduled" },
    plannedOutputCount: { type: Number, default: 1 },
    usableFootageCount: { type: Number, default: 0 },
    hoursSpent: { type: Number, default: 0 },
    report: { type: String, default: "" },
    sourceReferences: { type: [referenceSchema], default: [] },
    notes: { type: String, default: "" },
    blockers: { type: String, default: "" },
    progressLog: { type: [{ at: { type: Date, default: Date.now }, note: String, location: String }], default: [] },
    outputsRegistered: { type: Boolean, default: false },
    reshootRequestId: { type: Schema.Types.ObjectId },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
  },
  opts,
);
shootSchema.index({ cinematographerId: 1, scheduledDate: 1 });
shootSchema.index({ projectId: 1, status: 1 });
shootSchema.index({ clientId: 1, scheduledDate: 1 });

const planSchema = new Schema(
  {
    planCode: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["shoot", "editing", "publishing", "other"], required: true },
    title: { type: String, required: true },
    dateKey: { type: String, required: true },
    startTime: { type: String, default: "10:00" },
    endTime: { type: String, default: "18:00" },
    assigneeEmployeeId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId },
    projectId: { type: Schema.Types.ObjectId },
    shootId: { type: Schema.Types.ObjectId },
    location: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["scheduled", "done", "cancelled"], default: "scheduled" },
    createdBy: { type: Schema.Types.ObjectId },
  },
  opts,
);
planSchema.index({ dateKey: 1, assigneeEmployeeId: 1 });
planSchema.index({ status: 1, dateKey: 1 });

const deliverableSchema = new Schema(
  {
    deliverableCode: { type: String, required: true, unique: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    shootId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    type: { type: String, default: "promotional_video" },
    platform: { type: String, default: "" },
    brief: { type: String, default: "" },
    aspectRatio: { type: String, default: "" },
    deadline: String,
    status: {
      type: String,
      enum: ["available", "claimed", "in_progress", "on_hold", "submitted", "rework", "approved", "ready_to_publish", "published", "cancelled"],
      default: "available",
    },
    assignedEditorId: { type: Schema.Types.ObjectId },
    assignedPublisherId: { type: Schema.Types.ObjectId },
    sourceReferences: { type: [referenceSchema], default: [] },
    exportReferences: { type: [referenceSchema], default: [] },
    revisionCount: { type: Number, default: 0 },
    approvalStatus: { type: String, enum: ["none", "internal_approved", "client_approved", "rejected"], default: "none" },
    billableStatus: { type: String, enum: ["unbilled", "eligible", "invoiced", "waived"], default: "unbilled" },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
  },
  opts,
);
deliverableSchema.index({ projectId: 1, status: 1 });
deliverableSchema.index({ clientId: 1, status: 1 });
deliverableSchema.index({ deadline: 1, status: 1 });
deliverableSchema.index({ assignedEditorId: 1, status: 1 });

const editingTaskSchema = new Schema(
  {
    deliverableId: { type: Schema.Types.ObjectId, required: true, unique: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    shootId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ["available", "claimed", "in_progress", "on_hold", "submitted", "rework", "approved"], default: "available" },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    claimedBy: { type: Schema.Types.ObjectId },
    claimedAt: Date,
    startedAt: Date,
    submittedAt: Date,
    completedAt: Date,
    holdReason: String,
    workNotes: { type: String, default: "" },
    hoursSpent: { type: Number, default: 0 },
    outcome: { type: String, default: "" },
    lockVersion: { type: Number, default: 0 },
  },
  opts,
);
editingTaskSchema.index({ status: 1, priority: 1 });
editingTaskSchema.index({ claimedBy: 1, status: 1 });

const historySchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, required: true },
    deliverableId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    fromUserId: { type: Schema.Types.ObjectId },
    toUserId: { type: Schema.Types.ObjectId },
    actorId: { type: Schema.Types.ObjectId, required: true },
    reason: String,
  },
  opts,
);
historySchema.index({ deliverableId: 1, createdAt: -1 });

const reviewSchema = new Schema(
  {
    deliverableId: { type: Schema.Types.ObjectId, required: true },
    reviewerId: { type: Schema.Types.ObjectId, required: true },
    decision: { type: String, enum: ["approved", "rework"], required: true },
    feedback: { type: String, default: "" },
    revisionNumber: { type: Number, required: true },
    exportReference: referenceSchema,
    kind: { type: String, enum: ["internal", "client"], default: "internal" },
  },
  opts,
);
reviewSchema.index({ deliverableId: 1, createdAt: -1 });

const reshootSchema = new Schema(
  {
    reshootCode: { type: String, required: true, unique: true },
    deliverableId: { type: Schema.Types.ObjectId, required: true },
    originalShootId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true },
    notes: { type: String, default: "" },
    approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    assignedCinematographerId: { type: Schema.Types.ObjectId },
    scheduledDate: String,
    resultingShootId: { type: Schema.Types.ObjectId },
    attemptNumber: { type: Number, default: 1 },
    billableDecision: { type: String, enum: ["pending", "approved", "waived", "partial"], default: "pending" },
    chargePaise: { type: Number, default: 0 },
    invoicedInvoiceId: { type: Schema.Types.ObjectId },
    communicationNote: { type: String, default: "" },
  },
  opts,
);
reshootSchema.index({ deliverableId: 1, createdAt: -1 });
reshootSchema.index({ approvalStatus: 1 });

const publishingSchema = new Schema(
  {
    deliverableId: { type: Schema.Types.ObjectId, required: true, unique: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    platform: { type: String, required: true },
    caption: { type: String, default: "" },
    notes: { type: String, default: "" },
    scheduledAt: Date,
    assignedTo: { type: Schema.Types.ObjectId },
    status: { type: String, enum: ["ready", "scheduled", "published", "failed"], default: "ready" },
    publishedUrl: String,
    publishedAt: Date,
    proofAssetId: { type: Schema.Types.ObjectId },
    failureReason: String,
    viewCount: { type: Number, default: 0 },
    likeCount: { type: Number, default: 0 },
    metricsUpdatedAt: Date,
    readings: {
      type: [{
        views: { type: Number, required: true },
        likes: { type: Number, required: true },
        recordedOn: { type: String, required: true },
        note: { type: String, default: "" },
        recordedAt: Date,
        recordedBy: { type: Schema.Types.ObjectId },
      }],
      default: [],
    },
  },
  opts,
);
publishingSchema.index({ status: 1, scheduledAt: 1 });
publishingSchema.index({ assignedTo: 1, status: 1 });

const lineSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPricePaise: { type: Number, required: true },
    discountPaise: { type: Number, default: 0 },
    sourceType: { type: String, enum: ["manual", "shoot", "deliverable", "reshoot", "retainer", "other"], default: "manual" },
    sourceId: { type: Schema.Types.ObjectId },
    serviceType: String,
  },
  { _id: true },
);

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: ["draft", "pending_approval", "approved", "issued", "partially_paid", "paid", "void"], default: "draft" },
    issueDate: Date,
    dueDate: Date,
    currency: { type: String, default: "INR" },
    lineItems: { type: [lineSchema], default: [] },
    discountPaise: { type: Number, default: 0 },
    taxRateBps: { type: Number, default: 0 },
    subtotalPaise: { type: Number, default: 0 },
    taxPaise: { type: Number, default: 0 },
    totalPaise: { type: Number, default: 0 },
    paidPaise: { type: Number, default: 0 },
    internalNotes: { type: String, default: "" },
    clientNotes: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    approvedBy: { type: Schema.Types.ObjectId },
    voidReason: String,
    voidedBy: { type: Schema.Types.ObjectId },
  },
  opts,
);
invoiceSchema.index({ clientId: 1, status: 1 });
invoiceSchema.index({ dueDate: 1, status: 1 });
invoiceSchema.index({ "lineItems.sourceId": 1 });

const paymentSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    amountPaise: { type: Number, required: true },
    method: { type: String, required: true },
    reference: { type: String, default: "" },
    paidAt: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, required: true },
    note: { type: String, default: "" },
  },
  opts,
);
paymentSchema.index({ invoiceId: 1, paidAt: -1 });
paymentSchema.index({ paidAt: 1 });

const expenseSchema = new Schema(
  {
    dateKey: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String, required: true },
    amountPaise: { type: Number, required: true },
    method: { type: String, default: "" },
    vendor: { type: String, default: "" },
    projectId: { type: Schema.Types.ObjectId },
    clientId: { type: Schema.Types.ObjectId },
    shootId: { type: Schema.Types.ObjectId },
    receiptAssetId: { type: Schema.Types.ObjectId },
    submittedBy: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ["pending", "admin_approved", "approved", "rejected"], default: "pending" },
    settlement: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
    adminApprovedBy: { type: Schema.Types.ObjectId },
    approvedBy: { type: Schema.Types.ObjectId },
    rejectedBy: { type: Schema.Types.ObjectId },
    notes: { type: String, default: "" },
  },
  opts,
);
expenseSchema.index({ dateKey: 1, category: 1 });
expenseSchema.index({ projectId: 1, status: 1 });

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    entityType: String,
    entityId: Schema.Types.ObjectId,
    readAt: Date,
  },
  opts,
);
notificationSchema.index({ userId: 1, createdAt: -1 });

const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
  },
  opts,
);
auditSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ createdAt: -1 });

const activitySchema = new Schema(
  {
    clientId: Schema.Types.ObjectId,
    projectId: Schema.Types.ObjectId,
    deliverableId: Schema.Types.ObjectId,
    actorId: Schema.Types.ObjectId,
    verb: { type: String, required: true },
    summary: { type: String, required: true },
  },
  opts,
);
activitySchema.index({ clientId: 1, createdAt: -1 });
activitySchema.index({ projectId: 1, createdAt: -1 });
activitySchema.index({ deliverableId: 1, createdAt: -1 });

const mediaSchema = new Schema(
  {
    storageKey: { type: String, required: true },
    driver: { type: String, enum: ["local", "s3"], required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    ownerType: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId },
    kind: { type: String, default: "attachment" },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ["pending", "ready"], default: "pending" },
  },
  opts,
);

const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    legalName: { type: String, default: "Gyroz Studio" },
    address: { type: String, default: "" },
    gstin: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    businessTimezone: { type: String, default: "Asia/Kolkata" },
    currency: { type: String, default: "INR" },
    invoiceApprovalThresholdPaise: { type: Number, default: 5_000_000 },
    defaultTaxRateBps: { type: Number, default: 0 },
    qrTtlSeconds: { type: Number, default: 45 },
    officeLatitude: { type: Number, default: null },
    officeLongitude: { type: Number, default: null },
    officeRadiusMeters: { type: Number, default: 100 },
    officeLocationPolicy: { type: String, enum: ["reject", "flag"], default: "reject" },
    officeScreenKeyHash: { type: String, default: "" },
    payroll: {
      defaultDailyRatePaise: { type: Number, default: 50_000 },
      standardPayableDays: { type: Number, default: 26 },
      overtimePaisePerHour: { type: Number, default: null },
      offdayMultiplier: { type: Number, default: null },
      salaryDay: { type: Number, default: 5 },
      pfEmployeeBps: { type: Number, default: null },
      esiEmployeeBps: { type: Number, default: null },
      professionalTaxPaise: { type: Number, default: null },
    },
    performanceTargets: {
      editorApprovedPerMonth: { type: Number, default: null },
      shootsPerMonth: { type: Number, default: null },
      onTimePublishPercent: { type: Number, default: null },
    },
    demoSeeded: { type: Boolean, default: false },
  },
  opts,
);

const equipmentSchema = new Schema(
  {
    assetCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    brand: { type: String, default: "" },
    modelName: { type: String, default: "" },
    serialNumber: { type: String, default: "" },
    status: { type: String, default: "available" },
    condition: { type: String, default: "good" },
    location: { type: String, default: "" },
    purchaseDate: { type: String, default: "" },
    purchasePaise: { type: Number, default: 0 },
    vendor: { type: String, default: "" },
    warrantyUntil: { type: String, default: "" },
    holderEmployeeId: { type: Schema.Types.ObjectId },
    notes: { type: String, default: "" },
    repairPaise: { type: Number, default: 0 },
    servicePaise: { type: Number, default: 0 },
    events: {
      type: [{
        kind: { type: String, required: true },
        dateKey: { type: String, required: true },
        note: { type: String, default: "" },
        costPaise: { type: Number, default: 0 },
        holderEmployeeId: { type: Schema.Types.ObjectId },
        recordedAt: Date,
        recordedBy: { type: Schema.Types.ObjectId },
      }],
      default: [],
    },
  },
  opts,
);

const counterSchema = new Schema({ key: { type: String, required: true, unique: true }, seq: { type: Number, default: 0 } });

export const Role = model("Role", roleSchema);
export const User = model("User", userSchema);
export const Employee = model("Employee", employeeSchema);
export const Team = model("Team", teamSchema);
export const Shift = model("Shift", shiftSchema);
export const Holiday = model("Holiday", holidaySchema);
export const Attendance = model("Attendance", attendanceSchema);
export const AttendanceToken = model("AttendanceToken", attendanceTokenSchema);
export const PunchException = model("PunchException", punchExceptionSchema);
export const LeaveRequest = model("LeaveRequest", leaveSchema);
export const OvertimeRecord = model("OvertimeRecord", overtimeSchema);
export const PayrollPeriod = model("PayrollPeriod", payrollPeriodSchema);
export const Payslip = model("Payslip", payslipSchema);
export const PayrollAdjustment = model("PayrollAdjustment", payrollAdjustmentSchema);
export const Client = model("Client", clientSchema);
export const PricingRule = model("PricingRule", pricingRuleSchema);
export const Project = model("Project", projectSchema);
export const Shoot = model("Shoot", shootSchema);
export const Plan = model("Plan", planSchema);
export const Deliverable = model("Deliverable", deliverableSchema);
export const EditingTask = model("EditingTask", editingTaskSchema);
export const TaskHistory = model("TaskHistory", historySchema);
export const Review = model("Review", reviewSchema);
export const Reshoot = model("Reshoot", reshootSchema);
export const PublishingTask = model("PublishingTask", publishingSchema);
export const Invoice = model("Invoice", invoiceSchema);
export const Payment = model("Payment", paymentSchema);
export const Expense = model("Expense", expenseSchema);
export const Notification = model("Notification", notificationSchema);
export const AuditLog = model("AuditLog", auditSchema);
export const Activity = model("Activity", activitySchema);
export const MediaAsset = model("MediaAsset", mediaSchema);
export const Settings = model("Settings", settingsSchema);
export const Equipment = model("Equipment", equipmentSchema);
export const Counter = model("Counter", counterSchema);

export type RoleRecord = { _id: string; [key: string]: any };
export type UserRecord = { _id: string; [key: string]: any };
export type EmployeeRecord = { _id: string; [key: string]: any };
export type SettingsRecord = { _id: string; [key: string]: any };
