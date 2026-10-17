import type { AuthContext } from "../auth";
import { AppError } from "../http";
import {
  Activity,
  Attendance,
  AttendanceToken,
  AuditLog,
  Client,
  Counter,
  Deliverable,
  EditingTask,
  Employee,
  Expense,
  Holiday,
  Invoice,
  LeaveRequest,
  MediaAsset,
  Equipment,
  Notification,
  OvertimeRecord,
  Payment,
  PayrollAdjustment,
  PayrollPeriod,
  Payslip,
  Plan,
  PricingRule,
  Project,
  PublishingTask,
  PunchException,
  Reshoot,
  Review,
  Settings,
  Shift,
  Shoot,
  TaskHistory,
  Team,
  User,
} from "../models";
import { audit } from "../platform";
import { clearLocalUploads } from "./storage";

const records = [
  Employee, Team, Shift, Holiday, Attendance, AttendanceToken, PunchException, LeaveRequest, OvertimeRecord,
  PayrollPeriod, Payslip, PayrollAdjustment, Client, PricingRule, Project, Shoot, Plan, Deliverable, EditingTask,
  TaskHistory, Review, Reshoot, PublishingTask, Invoice, Payment, Expense, Notification, Activity, MediaAsset, Equipment, Counter,
];

export async function wipeStudio(auth: AuthContext) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can delete studio data.");
  await clearLocalUploads();
  for (const collection of records) await collection.deleteMany({});
  await AuditLog.deleteMany({});
  await User.deleteMany({ _id: { $ne: auth.userId } });
  await User.updateOne({ _id: auth.userId }, { $unset: { employeeId: 1 }, $set: { scopeClientIds: [], scopeProjectIds: [] } });
  await Settings.updateOne({ key: "studio" }, {
    $set: {
      legalName: "Gyroz Studio",
      address: "",
      gstin: "",
      email: "",
      phone: "",
      invoiceApprovalThresholdPaise: 5_000_000,
      defaultTaxRateBps: 0,
      officeLatitude: null,
      officeLongitude: null,
      officeRadiusMeters: 100,
      officeLocationPolicy: "reject",
      officeScreenKeyHash: "",
      demoSeeded: false,
      payroll: {
        defaultDailyRatePaise: 50_000,
        standardPayableDays: 26,
        salaryDay: 5,
        overtimePaisePerHour: null,
        offdayMultiplier: null,
        pfEmployeeBps: null,
        esiEmployeeBps: null,
        professionalTaxPaise: null,
      },
      performanceTargets: { editorApprovedPerMonth: null, shootsPerMonth: null, onTimePublishPercent: null },
    },
  });
  await audit({ actorId: auth.userId, action: "studio.wiped", entityType: "settings", entityId: "studio" });
  return { wiped: true };
}
