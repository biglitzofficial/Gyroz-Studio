import crypto from "crypto";
import { assertClientAccess, hashPassword, hashToken, hasPermission, type AuthContext } from "../auth";
import { businessDateKey, daysInMonth, eachDateKey, minuteOfDay, minutesBetween, monthBounds, parseClock, weekdayOfKey, zonedTimeToUtc } from "../domain/dates";
import { calculatePayroll, dayTimeCut, summarizePayable, type DayFact, type PayrollPolicy, type SalaryStructure } from "../domain/payroll";
import { AppError, escapeRegex, pageParams } from "../http";
import { distanceMeters, punchOutsideOffice } from "../domain/geo";
import { Attendance, AttendanceToken, Employee, Holiday, LeaveRequest, OvertimeRecord, PayrollAdjustment, PayrollPeriod, Payslip, PunchException, Role, Settings, Shift, Team, User } from "../models";
import { audit, getSettings, nextEmployeeCode, notify, studioTimezone } from "../platform";
import { EditingTask, Shoot } from "../models";

function seesCompensation(auth: AuthContext, employeeId: string) {
  return auth.employeeId === employeeId || hasPermission(auth, "employees.sensitive") || hasPermission(auth, "payroll.sensitive");
}

function assertStudioPayroll(auth: AuthContext) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can open the studio payroll.");
}

function seesBank(auth: AuthContext) {
  return hasPermission(auth, "employees.sensitive") || hasPermission(auth, "payroll.sensitive");
}

function presentEmployee(auth: AuthContext, employee: Record<string, unknown>) {
  const id = String(employee._id);
  const copy: Record<string, unknown> = { ...employee, id };
  if (!seesCompensation(auth, id)) delete copy.compensation;
  if (!seesBank(auth)) delete copy.bank;
  delete copy.temporaryPassword;
  delete copy.createLogin;
  delete copy.mustChangePassword;
  return copy;
}

const EMPLOYEE_CODE = /^\d{4}-GYROZ-\d{3,}$/;

async function currentEmployeeYear() {
  return Number(businessDateKey(new Date(), await studioTimezone()).slice(0, 4));
}

async function alignEmployeeCodes() {
  const stale = await Employee.find({ employeeCode: { $not: EMPLOYEE_CODE } }).sort({ createdAt: 1 });
  if (!stale.length) return;
  const year = await currentEmployeeYear();
  for (const person of stale) {
    person.employeeCode = await nextEmployeeCode(year);
    await person.save();
  }
}

const ASSIGN_PERMISSION: Record<string, string> = {
  camera: "shoots.log",
  editor: "editing.claim",
  publisher: "publishing.publish",
};

export async function assertAssignable(id: string, permission: string, by: "employee" | "user" = "employee") {
  const user = by === "employee"
    ? await User.findOne({ employeeId: id, status: "active" }).lean() as any
    : await User.findOne({ _id: id, status: "active" }).lean() as any;
  const role = user ? await Role.findById(user.roleId).lean() as any : null;
  const specialist = role && role.systemKey !== "admin" && role.systemKey !== "super_admin" && (role.permissions ?? []).includes(permission);
  if (!specialist) throw new AppError(400, "VALIDATION", "Choose someone whose role does this work.");
}

export async function listEmployees(auth: AuthContext, query: Record<string, unknown>) {
  if (!hasPermission(auth, "employees.view")) throw new AppError(403, "FORBIDDEN", "You do not have permission for this action.");
  await alignEmployeeCodes();
  const { page, limit, skip } = pageParams(query);
  const filter: Record<string, unknown> = {};
  if (typeof query.assign === "string" && query.assign) {
    const permission = ASSIGN_PERMISSION[query.assign];
    if (!permission) throw new AppError(400, "VALIDATION", "Unknown assignment list.");
    const roles = await Role.find({ permissions: permission, systemKey: null }).select("_id").lean() as any;
    filter.roleId = { $in: roles.map((role: { _id: unknown }) => role._id) };
    filter.employmentStatus = "active";
  }
  if (!query.assign && query.status && query.status !== "all") filter.employmentStatus = query.status;
  else if (!query.assign && !query.status) filter.employmentStatus = { $ne: "inactive" };
  if (typeof query.q === "string" && query.q.trim()) {
    const q = escapeRegex(query.q.trim());
    filter.$or = [{ firstName: { $regex: q, $options: "i" } }, { lastName: { $regex: q, $options: "i" } }, { employeeCode: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }];
  }
  const [rows, total] = await Promise.all([
    Employee.find(filter).sort({ firstName: 1 }).skip(skip).limit(limit).lean() as any,
    Employee.countDocuments(filter),
  ]);
  return { rows: rows.map((row) => presentEmployee(auth, row as unknown as Record<string, unknown>)), meta: { page, limit, total } };
}

export async function createEmployee(auth: AuthContext, input: Record<string, any>) {
  if (input.compensation && !seesCompensation(auth, "new")) {
    throw new AppError(403, "FORBIDDEN", "Compensation can be set only by someone with payroll access.");
  }
  if (input.bank && !seesBank(auth)) throw new AppError(403, "FORBIDDEN", "Bank details are restricted.");
  const settings = await getSettings();
  const compensation = input.compensation ?? {
    type: "daily",
    dailyRatePaise: settings.payroll?.defaultDailyRatePaise ?? 50_000,
    monthlySalaryPaise: 0,
    standardPayableDays: settings.payroll?.standardPayableDays ?? 26,
  };
  if (!seesCompensation(auth, "new")) {
    compensation.dailyRatePaise = settings.payroll?.defaultDailyRatePaise ?? 50_000;
  }
  await alignEmployeeCodes();
  const { createLogin: _createLogin, temporaryPassword: _temporaryPassword, mustChangePassword: _mustChangePassword, scopeClientIds: _scopeClientIds, scopeProjectIds: _scopeProjectIds, ...employeeInput } = input;
  const employee = await Employee.create({
    ...employeeInput,
    employeeCode: await nextEmployeeCode(await currentEmployeeYear()),
    compensation,
    leaveBalance: input.leaveBalance ?? { paid: 12, sick: 6 },
  });
  if (input.createLogin) {
    if (!input.temporaryPassword) throw new AppError(400, "VALIDATION", "A temporary password is required to create a login.");
    const user = await User.create({
      email: String(input.email).toLowerCase(),
      name: `${input.firstName} ${input.lastName}`.trim(),
      passwordHash: await hashPassword(input.temporaryPassword),
      roleId: input.roleId,
      employeeId: employee._id,
      mustChangePassword: input.mustChangePassword !== false,
      status: "active",
      scopeClientIds: input.scopeClientIds ?? [],
      scopeProjectIds: input.scopeProjectIds ?? [],
    });
    employee.userId = user._id;
    await employee.save();
  }
  await audit({ actorId: auth.userId, action: "employee.created", entityType: "employee", entityId: String(employee._id), after: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName}` } });
  return presentEmployee(auth, employee.toObject() as unknown as Record<string, unknown>);
}

export async function getEmployee(auth: AuthContext, id: string) {
  const employee = await Employee.findById(id).lean() as any;
  if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found.");
  const self = auth.employeeId === String(employee._id);
  if (!self && !hasPermission(auth, "employees.view")) throw new AppError(403, "FORBIDDEN", "You cannot open another employee's record.");
  const [attendance, shoots, tasks, payslips] = await Promise.all([
    Attendance.find({ employeeId: id }).sort({ dateKey: -1 }).limit(40).lean() as any,
    Shoot.find({ cinematographerId: id }).sort({ scheduledDate: -1 }).limit(20).lean() as any,
    employee.userId ? EditingTask.find({ claimedBy: employee.userId }).sort({ updatedAt: -1 }).limit(20).lean() as any : [],
    seesCompensation(auth, id) || self ? Payslip.find({ employeeId: id }).sort({ monthKey: -1 }).lean() as any : [],
  ]);
  return { employee: presentEmployee(auth, employee as unknown as Record<string, unknown>), attendance, shoots, tasks, payslips: self || seesCompensation(auth, id) ? payslips : undefined };
}

export async function updateEmployee(auth: AuthContext, id: string, input: Record<string, any>) {
  const employee = await Employee.findById(id);
  if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found.");
  const self = auth.employeeId === String(employee._id);
  if (!self && !hasPermission(auth, "employees.edit")) throw new AppError(403, "FORBIDDEN", "You cannot edit this record.");
  if (input.bank && !seesBank(auth)) throw new AppError(403, "FORBIDDEN", "Bank details are restricted.");
  if (input.compensation && !seesCompensation(auth, id)) throw new AppError(403, "FORBIDDEN", "Compensation is restricted.");
  if (input.employmentStatus && input.employmentStatus !== employee.employmentStatus) {
    if (!hasPermission(auth, "employees.edit")) throw new AppError(403, "FORBIDDEN", "You cannot change employment status.");
    if (self && input.employmentStatus === "inactive") throw new AppError(409, "CONFLICT", "You cannot mark yourself inactive.");
    if (input.employmentStatus === "inactive" && employee.userId) {
      const account = await User.findById(employee.userId);
      const role = account ? await Role.findById(account.roleId) : null;
      if (account && role?.systemKey === "super_admin") {
        const remaining = await User.countDocuments({ roleId: role._id, status: "active", _id: { $ne: account._id } });
        if (remaining < 1) throw new AppError(409, "CONFLICT", "The studio needs at least one active super admin.");
      }
    }
  }
  const before = { designation: employee.designation, employmentStatus: employee.employmentStatus, phone: employee.phone, roleId: employee.roleId ? String(employee.roleId) : undefined };
  let nextRole: { _id: unknown; systemKey?: string } | null = null;
  if (input.roleId && hasPermission(auth, "employees.edit")) {
    const role = await Role.findById(input.roleId);
    if (!role) throw new AppError(400, "VALIDATION", "Choose a role.");
    if (employee.userId) {
      const account = await User.findById(employee.userId);
      const current = account ? await Role.findById(account.roleId) : null;
      if (account && current?.systemKey === "super_admin" && role.systemKey !== "super_admin") {
        const remaining = await User.countDocuments({ roleId: current._id, status: "active", _id: { $ne: account._id } });
        if (remaining < 1) throw new AppError(409, "CONFLICT", "The studio needs at least one active super admin.");
      }
    }
    nextRole = role;
  }
  const allowed = self && !hasPermission(auth, "employees.edit")
    ? ["phone", "emergencyContact"]
    : Object.keys(input);
  for (const key of allowed) {
    if (input[key] !== undefined && !["createLogin", "temporaryPassword", "scopeClientIds"].includes(key)) {
      (employee as unknown as Record<string, unknown>)[key] = input[key];
    }
  }
  await employee.save();
  if (nextRole && employee.userId) {
    await User.updateOne({ _id: employee.userId }, { $set: { roleId: nextRole._id } });
  }
  if (employee.userId && input.employmentStatus) {
    const nextStatus = employee.employmentStatus === "inactive" ? "disabled" : "active";
    await User.updateOne({ _id: employee.userId }, { $set: { status: nextStatus }, $inc: { tokenVersion: employee.employmentStatus === "inactive" ? 1 : 0 } });
  }
  await audit({ actorId: auth.userId, action: "employee.updated", entityType: "employee", entityId: id, before, after: { designation: employee.designation, employmentStatus: employee.employmentStatus, phone: employee.phone } });
  return presentEmployee(auth, employee.toObject() as unknown as Record<string, unknown>);
}

export async function listTeams() {
  return Team.find().lean() as any;
}

export async function saveTeam(input: { name: string; leadEmployeeId?: string }, id?: string) {
  if (id) {
    const team = await Team.findByIdAndUpdate(id, input, { new: true });
    if (!team) throw new AppError(404, "NOT_FOUND", "Team not found.");
    return team.toObject();
  }
  const team = await Team.create(input);
  return team.toObject();
}

export async function ensureDefaultShift() {
  const existing = await Shift.findOne();
  if (existing) return existing;
  return Shift.create({ name: "Studio floor", startTime: "09:30", endTime: "19:30", graceMinutes: 10, workingDays: [1, 2, 3, 4, 5, 6] });
}

export async function listShifts() {
  await ensureDefaultShift();
  return Shift.find().lean() as any;
}

export async function saveShift(auth: AuthContext, input: { name: string; startTime: string; endTime: string; graceMinutes?: number; workingDays?: number[] }, id?: string) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can change the studio shift.");
  if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) {
    throw new AppError(400, "VALIDATION", "Use times like 09:30 and 19:30.");
  }
  const workingDays = (input.workingDays ?? [1, 2, 3, 4, 5, 6]).filter((day) => day >= 0 && day <= 6);
  const next = { ...input, graceMinutes: input.graceMinutes ?? 10, workingDays };
  if (id) {
    const shift = await Shift.findByIdAndUpdate(id, next, { new: true }).lean();
    if (!shift) throw new AppError(404, "NOT_FOUND", "Shift not found.");
    return shift;
  }
  return Shift.create(next);
}

export async function listHolidays() {
  return Holiday.find().sort({ dateKey: 1 }).lean() as any;
}

export async function saveHoliday(dateKey: string, name: string) {
  return Holiday.findOneAndUpdate({ dateKey }, { name }, { upsert: true, new: true }).lean() as any;
}

async function payrollLocked(dateKey: string) {
  const monthKey = dateKey.slice(0, 7);
  const period = await PayrollPeriod.findOne({ monthKey, status: "finalized" }).lean() as any;
  return Boolean(period);
}

async function issueQrCode() {
  const settings = await getSettings();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join("");
  const expiresAt = new Date(Date.now() + (settings.qrTtlSeconds || 45) * 1000);
  await AttendanceToken.create({ codeHash: hashToken(code), expiresAt });
  return { code, expiresAt, ttlSeconds: settings.qrTtlSeconds || 45 };
}

export async function createKioskToken(auth: AuthContext) {
  const issued = await issueQrCode();
  await audit({ actorId: auth.userId, action: "attendance.token_issued", entityType: "attendance_token", entityId: "kiosk" });
  return issued;
}

export async function issueOfficeScreen(auth: AuthContext) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can create the office screen.");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const key = Array.from(crypto.randomBytes(24), (byte) => alphabet[byte % alphabet.length]).join("");
  await Settings.updateOne({ key: "studio" }, { $set: { officeScreenKeyHash: hashToken(key) } });
  await audit({ actorId: auth.userId, action: "attendance.screen_issued", entityType: "settings", entityId: "studio" });
  return { key };
}

export async function officeScreenCode(key: string) {
  const settings = await getSettings();
  const presented = hashToken(key.trim().toUpperCase());
  if (!key.trim() || !settings.officeScreenKeyHash || presented !== settings.officeScreenKeyHash) {
    throw new AppError(401, "UNAUTHORIZED", "This office screen link is not valid.");
  }
  return issueQrCode();
}

async function consumeToken(code: string) {
  const consumed = await AttendanceToken.findOneAndUpdate(
    { codeHash: hashToken(code.trim().toUpperCase()), consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true },
  );
  if (!consumed) throw new AppError(401, "UNAUTHORIZED", "This office code is invalid, expired, or already used. Read the code on the studio screen.");
}

async function markLate(employeeId: string, checkInAt: Date, timeZone: string) {
  const employee = await Employee.findById(employeeId).lean() as any;
  const shift = employee?.shiftId ? await Shift.findById(employee.shiftId).lean() as any : await Shift.findOne().lean() as any;
  if (!shift) return { late: false, lateMinutes: 0, earlyLimit: null as Date | null, graceMs: 0, shift };
  const dateKey = businessDateKey(checkInAt, timeZone);
  const start = zonedTimeToUtc(dateKey, `${shift.startTime}:00`, timeZone);
  const graceMs = (shift.graceMinutes ?? 10) * 60000;
  const lateMinutes = Math.max(0, Math.round((checkInAt.getTime() - (start.getTime() + graceMs)) / 60000));
  const end = zonedTimeToUtc(dateKey, `${shift.endTime}:00`, timeZone);
  return { late: lateMinutes > 0, lateMinutes, earlyLimit: end, graceMs, shift };
}

function asDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  throw new AppError(409, "CONFLICT", "Today's punch could not be read. Ask an admin to correct it.");
}

function earlyMinutes(limit: Date | null, graceMs: number, at: Date) {
  if (!limit) return 0;
  return Math.max(0, Math.round((limit.getTime() - graceMs - at.getTime()) / 60000));
}

function punchNote(direction: "in" | "out", lateMinutes: number, leftEarly: number) {
  if (direction === "in") {
    return lateMinutes > 0
      ? `Punched in ${lateMinutes} minutes after the grace. Those minutes come off today's pay.`
      : "Punched in on time.";
  }
  return leftEarly > 0
    ? `Punched out ${leftEarly} minutes early. Those minutes come off today's pay.`
    : "Punched out. Today counts as a full day.";
}

function officeCode(value: string) {
  const raw = value.trim().toUpperCase();
  const code = raw.startsWith("GYROZ:") ? raw.slice(6) : raw;
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new AppError(400, "VALIDATION", "Scan the QR on the office screen.");
  return code;
}

async function placeInOffice(point: { latitude: number; longitude: number; accuracy: number }) {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 || !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
    throw new AppError(400, "VALIDATION", "The phone did not send a usable location. Allow location, or request a correction.");
  }
  if (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 1000) {
    throw new AppError(409, "CONFLICT", "The location reading is too vague. Move closer to a window, or request a correction.");
  }
  const settings = await getSettings();
  if (settings.officeLatitude == null || settings.officeLongitude == null) {
    throw new AppError(409, "CONFLICT", "The office area is not set. A super admin places it on the map in HRMS.");
  }
  const distance = distanceMeters(
    { latitude: settings.officeLatitude, longitude: settings.officeLongitude },
    { latitude: point.latitude, longitude: point.longitude },
  );
  const radius = settings.officeRadiusMeters ?? 100;
  const outside = punchOutsideOffice(distance, radius, point.accuracy);
  if (outside && (settings.officeLocationPolicy ?? "reject") !== "flag") {
    throw new AppError(403, "FORBIDDEN", `You are ${distance} m from the office. Punches are accepted within ${radius} m. Request a correction if this reading is wrong.`);
  }
  return { distance, locationStatus: outside ? "outside" as const : "inside" as const };
}

async function recordPunch(auth: AuthContext, direction: "in" | "out", source: "qr" | "self", place?: { latitude: number; longitude: number; accuracy: number; distance: number; locationStatus: "inside" | "outside" }) {
  if (!auth.employeeId) throw new AppError(409, "CONFLICT", "This login is not linked to an employee record.");
  const timeZone = await studioTimezone();
  const now = new Date();
  const dateKey = businessDateKey(now, timeZone);
  if (await payrollLocked(dateKey)) throw new AppError(409, "CONFLICT", "Payroll for this month is finalized. Use an authorized correction.");
  if (direction === "in") {
    const existing = await Attendance.findOne({ employeeId: auth.employeeId, dateKey });
    if (existing?.checkInAt) throw new AppError(409, "CONFLICT", "You are already punched in for today.");
    const timing = await markLate(auth.employeeId, now, timeZone);
    try {
      const record = await Attendance.findOneAndUpdate(
        { employeeId: auth.employeeId, dateKey, checkInAt: null },
        { $set: { checkInAt: now, checkInSource: source, late: timing.late, latitude: place?.latitude, longitude: place?.longitude, accuracyMeters: place?.accuracy, distanceMeters: place?.distance, locationStatus: place?.locationStatus }, $setOnInsert: { employeeId: auth.employeeId, dateKey } },
        { upsert: true, new: true },
      );
      return { ...record.toObject(), note: punchNote("in", timing.lateMinutes, 0) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000) {
        throw new AppError(409, "CONFLICT", "You are already punched in for today.");
      }
      throw error;
    }
  }
  const existing = await Attendance.findOne({ employeeId: auth.employeeId, dateKey, checkInAt: { $ne: null }, checkOutAt: null });
  if (!existing?.checkInAt) throw new AppError(409, "CONFLICT", "Punch in before punching out.");
  const checkInAt = asDate(existing.checkInAt);
  const timing = await markLate(auth.employeeId, checkInAt, timeZone);
  const leftEarly = earlyMinutes(timing.earlyLimit, timing.graceMs, now);
  existing.checkInAt = checkInAt;
  existing.checkOutAt = now;
  existing.checkOutSource = source;
  existing.minutes = minutesBetween(checkInAt, now);
  existing.earlyDeparture = leftEarly > 0;
  if (place) {
    existing.latitude = place.latitude;
    existing.longitude = place.longitude;
    existing.accuracyMeters = place.accuracy;
    existing.distanceMeters = place.distance;
    existing.locationStatus = place.locationStatus;
  }
  await existing.save();
  return { ...existing.toObject(), note: punchNote("out", timing.lateMinutes, leftEarly) };
}

export async function assertPunchedIn(auth: AuthContext) {
  if (auth.systemKey === "super_admin") return;
  if (!auth.employeeId) throw new AppError(409, "CONFLICT", "Punch in before you log work.");
  const dateKey = businessDateKey(new Date(), await studioTimezone());
  const record = await Attendance.findOne({ employeeId: auth.employeeId, dateKey }).lean() as { checkInAt?: Date | null; checkOutAt?: Date | null } | null;
  if (!record?.checkInAt) throw new AppError(409, "CONFLICT", "Punch in before you log work.");
  if (record.checkOutAt) throw new AppError(409, "CONFLICT", "You have punched out. Work can be logged only while you are punched in.");
}

export async function checkIn(auth: AuthContext, code: string) {
  await consumeToken(code);
  return recordPunch(auth, "in", "qr");
}

export async function checkOut(auth: AuthContext, code: string) {
  await consumeToken(code);
  return recordPunch(auth, "out", "qr");
}

export async function punchIn(auth: AuthContext, input: { code: string; latitude: number; longitude: number; accuracy: number }) {
  if (!auth.employeeId) throw new AppError(409, "CONFLICT", "This login is not linked to an employee record.");
  await ensureDefaultShift();
  const place = await placeInOffice(input);
  await consumeToken(officeCode(input.code));
  const result = await recordPunch(auth, "in", "qr", { ...input, ...place });
  return { ...result, note: `${result.note} ${place.locationStatus === "outside" ? "Location is outside the office and was flagged." : "Location is inside the office."}` };
}

export async function punchOut(auth: AuthContext, input: { code: string; latitude: number; longitude: number; accuracy: number }) {
  if (!auth.employeeId) throw new AppError(409, "CONFLICT", "This login is not linked to an employee record.");
  await ensureDefaultShift();
  const place = await placeInOffice(input);
  await consumeToken(officeCode(input.code));
  const result = await recordPunch(auth, "out", "qr", { ...input, ...place });
  return { ...result, note: `${result.note} ${place.locationStatus === "outside" ? "Location is outside the office and was flagged." : "Location is inside the office."}` };
}

export async function requestPunchException(auth: AuthContext, input: { dateKey: string; kind: "qr_failed" | "location_failed" | "missed_punch"; reason: string; checkInTime?: string; checkOutTime?: string }) {
  if (!auth.employeeId) throw new AppError(409, "CONFLICT", "This login is not linked to an employee record.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) throw new AppError(400, "VALIDATION", "Choose the day.");
  if (input.reason.trim().length < 2) throw new AppError(400, "VALIDATION", "Say why the punch could not be recorded.");
  const clock = /^\d{2}:\d{2}$/;
  if (input.checkInTime && !clock.test(input.checkInTime)) throw new AppError(400, "VALIDATION", "Enter the login time as HH:mm.");
  if (input.checkOutTime && !clock.test(input.checkOutTime)) throw new AppError(400, "VALIDATION", "Enter the logout time as HH:mm.");
  if (!input.checkInTime && !input.checkOutTime) throw new AppError(400, "VALIDATION", "Enter the login or logout time that should be recorded.");
  const waiting = await PunchException.findOne({ employeeId: auth.employeeId, dateKey: input.dateKey, status: "pending" });
  if (waiting) throw new AppError(409, "CONFLICT", "A correction for this day is already waiting for an admin.");
  const request = await PunchException.create({ ...input, reason: input.reason.trim(), employeeId: auth.employeeId, status: "pending" });
  await audit({ actorId: auth.userId, action: "attendance.exception_requested", entityType: "punch_exception", entityId: String(request._id), after: { dateKey: input.dateKey, kind: input.kind } });
  return request.toObject();
}

export async function listPunchExceptions(auth: AuthContext) {
  const office = hasPermission(auth, "attendance.correct") || hasPermission(auth, "attendance.manage");
  const filter = office ? { status: "pending" } : { employeeId: auth.employeeId };
  return PunchException.find(filter).sort({ createdAt: -1 }).limit(50).lean() as any;
}

export async function decidePunchException(auth: AuthContext, id: string, input: { status: "approved" | "rejected"; decisionNote: string }) {
  if (!input.decisionNote.trim()) throw new AppError(400, "VALIDATION", "Record why this request was approved or rejected.");
  const request = await PunchException.findOne({ _id: id, status: "pending" });
  if (!request) throw new AppError(409, "CONFLICT", "This correction is no longer waiting.");
  if (input.status === "approved") {
    await correctAttendance(auth, {
      employeeId: String(request.employeeId),
      dateKey: request.dateKey,
      checkInTime: request.checkInTime || undefined,
      checkOutTime: request.checkOutTime || undefined,
      reason: `Approved punch correction (${request.kind}): ${request.reason}. ${input.decisionNote.trim()}`,
    });
  }
  request.status = input.status;
  request.decisionNote = input.decisionNote.trim();
  request.decidedBy = auth.userId as unknown as typeof request.decidedBy;
  request.decidedAt = new Date();
  await request.save();
  await audit({ actorId: auth.userId, action: `attendance.exception_${input.status}`, entityType: "punch_exception", entityId: id, after: { status: input.status, decisionNote: request.decisionNote } });
  return request.toObject();
}

export async function listAttendance(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = {};
  const company = hasPermission(auth, "attendance.view") || hasPermission(auth, "attendance.manage");
  if (!company) {
    if (!auth.employeeId) return [];
    filter.employeeId = auth.employeeId;
  } else if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.from || query.to) {
    filter.dateKey = {};
    if (typeof query.from === "string") (filter.dateKey as Record<string, string>).$gte = query.from;
    if (typeof query.to === "string") (filter.dateKey as Record<string, string>).$lte = query.to;
  }
  const rows = await Attendance.find(filter).sort({ dateKey: -1 }).limit(200).lean() as any[];
  const people = rows.length
    ? await Employee.find({ _id: { $in: rows.map((row) => row.employeeId) } }).select("firstName lastName employeeCode").lean() as any[]
    : [];
  const byId = new Map(people.map((person) => [String(person._id), person]));
  return rows.map((row) => {
    const person = byId.get(String(row.employeeId));
    return {
      ...row,
      personName: person ? `${person.firstName} ${person.lastName}`.trim() : "",
      employeeCode: person?.employeeCode ?? "",
    };
  });
}

export async function correctAttendance(auth: AuthContext, input: { employeeId: string; dateKey: string; checkInAt?: string; checkOutAt?: string; checkInTime?: string; checkOutTime?: string; reason: string }) {
  if (!input.reason.trim()) throw new AppError(400, "VALIDATION", "A correction needs a reason.");
  if (await payrollLocked(input.dateKey)) throw new AppError(409, "CONFLICT", "Payroll for this month is finalized. Add a payroll adjustment instead of changing attendance.");
  const before = await Attendance.findOne({ employeeId: input.employeeId, dateKey: input.dateKey }).lean() as any;
  const timeZone = await studioTimezone();
  const clockOn = (value?: string) => value && /^\d{2}:\d{2}$/.test(value) ? zonedTimeToUtc(input.dateKey, `${value}:00`, timeZone) : null;
  const checkInAt = input.checkInTime ? clockOn(input.checkInTime) : input.checkInAt ? new Date(input.checkInAt) : before?.checkInAt;
  const checkOutAt = input.checkOutTime ? clockOn(input.checkOutTime) : input.checkOutAt ? new Date(input.checkOutAt) : before?.checkOutAt;
  const timing = checkInAt ? await markLate(input.employeeId, checkInAt, timeZone) : null;
  const earlyDeparture = Boolean(timing?.earlyLimit && checkOutAt && checkOutAt.getTime() < timing.earlyLimit.getTime() - (timing.shift?.graceMinutes ?? 0) * 60000);
  const record = await Attendance.findOneAndUpdate(
    { employeeId: input.employeeId, dateKey: input.dateKey },
    {
      $set: {
        checkInAt,
        checkOutAt,
        checkInSource: "correction",
        checkOutSource: checkOutAt ? "correction" : undefined,
        minutes: checkInAt && checkOutAt ? minutesBetween(checkInAt, checkOutAt) : 0,
        late: Boolean(timing?.late),
        earlyDeparture,
        correctionReason: input.reason.trim(),
        correctedBy: auth.userId,
      },
    },
    { upsert: true, new: true },
  );
  await audit({ actorId: auth.userId, action: "attendance.corrected", entityType: "attendance", entityId: String(record._id), before, after: record.toObject() });
  return record.toObject();
}

export async function requestLeave(auth: AuthContext, input: { type: "paid" | "sick" | "unpaid"; fromKey: string; toKey: string; reason: string }) {
  if (!auth.employeeId) throw new AppError(409, "CONFLICT", "This login is not linked to an employee record.");
  if (input.toKey < input.fromKey) throw new AppError(400, "VALIDATION", "The leave end date is before the start date.");
  const leave = await LeaveRequest.create({ ...input, employeeId: auth.employeeId });
  return leave.toObject();
}

export async function listLeave(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = {};
  if (!(hasPermission(auth, "attendance.manage") || hasPermission(auth, "attendance.view"))) {
    filter.employeeId = auth.employeeId;
  } else if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;
  return LeaveRequest.find(filter).sort({ createdAt: -1 }).lean() as any;
}

export async function decideLeave(auth: AuthContext, id: string, status: "approved" | "rejected", decisionNote?: string) {
  const patch: Record<string, unknown> = { status, decidedBy: auth.userId };
  if (decisionNote?.trim()) patch.decisionNote = decisionNote.trim();
  const leave = await LeaveRequest.findOneAndUpdate({ _id: id, status: "pending" }, { $set: patch }, { new: false });
  if (!leave) throw new AppError(409, "CONFLICT", "This leave request is no longer pending.");
  if (status === "approved" && (leave.type === "paid" || leave.type === "sick")) {
    const days = eachDateKey(leave.fromKey, leave.toKey).length;
    const field = leave.type === "paid" ? "leaveBalance.paid" : "leaveBalance.sick";
    const updated = await Employee.findOneAndUpdate({ _id: leave.employeeId, [field]: { $gte: days } }, { $inc: { [field]: -days } }, { new: true });
    if (!updated) {
      await LeaveRequest.updateOne({ _id: id }, { status: "pending", decidedBy: null });
      throw new AppError(409, "CONFLICT", "Leave balance is not enough for this request.");
    }
  }
  await audit({ actorId: auth.userId, action: `leave.${status}`, entityType: "leave", entityId: id, after: { status, type: leave.type } });
  return LeaveRequest.findById(id).lean() as any;
}

export async function requestOvertime(auth: AuthContext, input: { dateKey: string; minutes: number; reason: string }) {
  if (!auth.employeeId) throw new AppError(409, "CONFLICT", "This login is not linked to an employee record.");
  const record = await OvertimeRecord.create({ ...input, employeeId: auth.employeeId });
  return record.toObject();
}

export async function decideOvertime(auth: AuthContext, id: string, status: "approved" | "rejected") {
  const record = await OvertimeRecord.findOneAndUpdate({ _id: id, status: "pending" }, { status, decidedBy: auth.userId }, { new: true });
  if (!record) throw new AppError(409, "CONFLICT", "This overtime request is no longer pending.");
  await audit({ actorId: auth.userId, action: `overtime.${status}`, entityType: "overtime", entityId: id, after: { minutes: record.minutes, status } });
  return record.toObject();
}

export async function listOvertime(auth: AuthContext) {
  const filter: Record<string, unknown> = {};
  if (!hasPermission(auth, "payroll.manage") && !hasPermission(auth, "attendance.manage")) filter.employeeId = auth.employeeId;
  return OvertimeRecord.find(filter).sort({ dateKey: -1 }).lean() as any;
}

function policyFrom(settings: Awaited<ReturnType<typeof getSettings>>): PayrollPolicy {
  return {
    overtimePaisePerHour: settings.payroll?.overtimePaisePerHour ?? null,
    offdayMultiplier: settings.payroll?.offdayMultiplier ?? null,
    pfEmployeeBps: settings.payroll?.pfEmployeeBps ?? null,
    esiEmployeeBps: settings.payroll?.esiEmployeeBps ?? null,
    professionalTaxPaise: settings.payroll?.professionalTaxPaise ?? null,
  };
}

export async function generatePayroll(auth: AuthContext, monthKey: string) {
  assertStudioPayroll(auth);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new AppError(400, "VALIDATION", "Use a month in YYYY-MM format.");
  const existing = await PayrollPeriod.findOne({ monthKey });
  if (existing?.status === "finalized") throw new AppError(409, "CONFLICT", "This payroll period is finalized. Use an adjustment instead of regenerating it.");
  const period = existing ?? (await PayrollPeriod.create({ monthKey, status: "preview" }));
  const settings = await getSettings();
  const timeZone = settings.businessTimezone || "Asia/Kolkata";
  const { start, end } = monthBounds(monthKey);
  const days = eachDateKey(start, end);
  const [employees, holidays, attendance, leaves, overtime, shifts] = await Promise.all([
    Employee.find({ employmentStatus: { $in: ["active", "on_leave"] } }).lean() as any,
    Holiday.find({ dateKey: { $gte: start, $lte: end } }).lean() as any,
    Attendance.find({ dateKey: { $gte: start, $lte: end } }).lean() as any,
    LeaveRequest.find({ status: "approved", fromKey: { $lte: end }, toKey: { $gte: start } }).lean() as any,
    OvertimeRecord.find({ status: "approved", dateKey: { $gte: start, $lte: end } }).lean() as any,
    Shift.find().lean() as any,
  ]);
    const holidaySet = new Set(holidays.map((holiday) => holiday.dateKey));
    const shiftById = new Map(shifts.map((shift) => [String(shift._id), shift]));
    const today = businessDateKey(new Date(), timeZone);
  await Payslip.deleteMany({ periodId: period._id });
  const slips: any[] = [];
  for (const employee of employees) {
    const shift = employee.shiftId ? shiftById.get(String(employee.shiftId)) : shifts[0];
    const workingDays = new Set(shift?.workingDays ?? [1, 2, 3, 4, 5, 6]);
    const facts: DayFact[] = days.map((dateKey) => {
      const weekday = weekdayOfKey(dateKey, timeZone);
      const record = attendance.find((item) => String(item.employeeId) === String(employee._id) && item.dateKey === dateKey);
      const leave = leaves.find((item) => String(item.employeeId) === String(employee._id) && item.fromKey <= dateKey && item.toKey >= dateKey);
      const stillOpen = dateKey >= today && !record?.checkInAt;
      return {
        weekday,
        isHoliday: holidaySet.has(dateKey),
        isScheduledWorkingDay: stillOpen ? false : workingDays.has(weekday) && weekday !== 0,
        attendance: record?.checkInAt ? "present" : "none",
        leave: leave?.type ?? null,
        late: Boolean(record?.late),
      };
    });
    const summary = summarizePayable(facts);
    const overtimeMinutes = overtime.filter((item) => String(item.employeeId) === String(employee._id)).reduce((sum, item) => sum + item.minutes, 0);
    const monthDays = daysInMonth(monthKey);
    const structure = {
      ...(employee.compensation as SalaryStructure),
      standardPayableDays: employee.compensation?.type === "monthly" ? monthDays : (employee.compensation?.standardPayableDays || monthDays),
    };
    const startMinute = parseClock(shift?.startTime || "09:30");
    const endMinute = parseClock(shift?.endTime || "19:30");
    const ratePaise = structure.type === "monthly"
      ? Math.round(structure.monthlySalaryPaise / monthDays)
      : structure.dailyRatePaise;
    const punches = attendance.filter((item) => String(item.employeeId) === String(employee._id) && item.checkInAt);
    const timeDeductionPaise = punches.reduce((sum, item) => sum + dayTimeCut({
      ratePaise,
      startMinute,
      endMinute: endMinute > startMinute ? endMinute : endMinute + 1440,
      graceMinutes: shift?.graceMinutes ?? 10,
      inMinute: minuteOfDay(new Date(item.checkInAt), timeZone),
      outMinute: item.checkOutAt ? minuteOfDay(new Date(item.checkOutAt), timeZone) : null,
    }), 0);
    const result = calculatePayroll({
      structure,
      policy: policyFrom(settings),
      payableDays: summary.payableDays,
      overtimeMinutes,
      sundayDaysWorked: summary.sundayDaysWorked,
      holidayDaysWorked: summary.holidayDaysWorked,
      bonusesPaise: 0,
      deductionsPaise: 0,
      advancesPaise: 0,
      adjustmentsPaise: 0,
      lopDays: summary.unpaidAbsenceDays,
      timeDeductionPaise,
    });
    const slip = await Payslip.create({ periodId: period._id, employeeId: employee._id, monthKey, structure, overtimeMinutes, ...summary, ...result });
    slips.push(slip.toObject());
  }
  await audit({ actorId: auth.userId, action: "payroll.previewed", entityType: "payroll_period", entityId: String(period._id), after: { monthKey, count: slips.length } });
  return getPayroll(auth, monthKey);
}

async function namePayslips(payslips: any[]) {
  if (!payslips.length) return payslips;
  const employees = await Employee.find({ _id: { $in: payslips.map((slip) => slip.employeeId) } }).select("firstName lastName employeeCode").lean() as any;
  const byId = new Map<string, any>(employees.map((employee) => [String(employee._id), employee]));
  return payslips.map((slip) => {
    const employee = byId.get(String(slip.employeeId));
    return {
      ...slip,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}` : "Employee",
      employeeCode: employee?.employeeCode,
    };
  });
}

export async function getPayroll(auth: AuthContext, monthKey: string) {
  assertStudioPayroll(auth);
  const period = await PayrollPeriod.findOne({ monthKey }).lean() as any;
  if (!period) return { period: null, payslips: [] };
  const payslips = await namePayslips(await Payslip.find({ periodId: period._id }).lean() as any);
  const adjustments = await PayrollAdjustment.find({ periodId: period._id }).lean() as any;
  return { period, payslips, adjustments };
}

export async function finalizePayroll(auth: AuthContext, monthKey: string, statutoryAcknowledged: boolean) {
  assertStudioPayroll(auth);
  const period = await PayrollPeriod.findOne({ monthKey });
  if (!period) throw new AppError(404, "NOT_FOUND", "Generate a payroll preview first.");
  if (period.status === "finalized") throw new AppError(409, "CONFLICT", "This payroll period is already finalized.");
  const slips = await Payslip.find({ periodId: period._id }).lean() as any;
  if (slips.some((slip) => slip.needsConfiguration)) {
    throw new AppError(409, "CONFLICT", "Payroll needs an overtime rate before this month can be finalized.");
  }
  if (slips.some((slip) => slip.flags?.includes("statutory_unconfigured")) && !statutoryAcknowledged) {
    throw new AppError(409, "CONFLICT", "Statutory deductions are not configured. Confirm with your accountant, then acknowledge that this run is wage-only.");
  }
  period.status = "finalized";
  period.statutoryAcknowledged = statutoryAcknowledged;
  period.finalizedBy = auth.userId as unknown as typeof period.finalizedBy;
  period.finalizedAt = new Date();
  await period.save();
  const employees = await Employee.find({ _id: { $in: slips.map((slip) => slip.employeeId) } }).select("userId").lean() as Array<{ userId?: unknown }>;
  await notify(employees.map((employee) => (employee.userId ? String(employee.userId) : undefined)), {
    type: "payslip",
    title: `Payslip for ${monthLabel(monthKey)}`,
    body: "Your payslip for this month is ready. Open Payroll and download it.",
    entityType: "payslip",
  });
  await audit({ actorId: auth.userId, action: "payroll.finalized", entityType: "payroll_period", entityId: String(period._id), after: { monthKey, statutoryAcknowledged } });
  return getPayroll(auth, monthKey);
}

export async function adjustPayroll(auth: AuthContext, monthKey: string, input: { employeeId: string; amountPaise: number; reason: string }) {
  assertStudioPayroll(auth);
  const period = await PayrollPeriod.findOne({ monthKey, status: "finalized" });
  if (!period) throw new AppError(409, "CONFLICT", "Adjustments are recorded only after payroll is finalized.");
  const slip = await Payslip.findOne({ periodId: period._id, employeeId: input.employeeId });
  if (!slip) throw new AppError(404, "NOT_FOUND", "Payslip not found.");
  if (!input.reason.trim()) throw new AppError(400, "VALIDATION", "An adjustment needs a reason.");
  const adjustment = await PayrollAdjustment.create({ periodId: period._id, payslipId: slip._id, employeeId: input.employeeId, amountPaise: input.amountPaise, reason: input.reason.trim(), createdBy: auth.userId });
  await audit({ actorId: auth.userId, action: "payroll.adjusted", entityType: "payslip", entityId: String(slip._id), after: { amountPaise: input.amountPaise, reason: input.reason } });
  return adjustment.toObject();
}

export async function myPayslips(auth: AuthContext) {
  if (!auth.employeeId) return [];
  const slips = await Payslip.find({ employeeId: auth.employeeId }).sort({ monthKey: -1 }).lean() as any[];
  if (!slips.length) return [];
  const periods = await PayrollPeriod.find({ _id: { $in: slips.map((slip) => slip.periodId) }, status: "finalized" }).select("_id").lean() as Array<{ _id: unknown }>;
  const released = new Set(periods.map((period) => String(period._id)));
  const employee = await Employee.findById(auth.employeeId).select("firstName lastName employeeCode").lean() as { firstName?: string; lastName?: string; employeeCode?: string } | null;
  const settings = await getSettings();
  return slips.filter((slip) => released.has(String(slip.periodId))).map((slip) => ({
    ...slip,
    employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : "Employee",
    employeeCode: employee?.employeeCode,
    legalName: settings.legalName,
  }));
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export async function listRolesForForms() {
  return Role.find().select("name slug systemKey").lean() as any;
}

export { parseClock, assertClientAccess };
