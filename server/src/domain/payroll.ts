import { MoneyError } from "./money";

export type SalaryStructure = {
  type: "daily" | "monthly";
  dailyRatePaise: number;
  monthlySalaryPaise: number;
  standardPayableDays: number;
};

export type PayrollPolicy = {
  overtimePaisePerHour: number | null;
  offdayMultiplier: number | null;
  pfEmployeeBps: number | null;
  esiEmployeeBps: number | null;
  professionalTaxPaise: number | null;
};

export type DayFact = {
  weekday: number;
  isHoliday: boolean;
  isScheduledWorkingDay: boolean;
  attendance: "present" | "absent" | "none";
  leave: "paid" | "sick" | "unpaid" | null;
  late: boolean;
};

export function summarizePayable(days: DayFact[]) {
  let payableDays = 0;
  let unpaidAbsenceDays = 0;
  let sundayDaysWorked = 0;
  let holidayDaysWorked = 0;
  let lateCount = 0;
  let presentDays = 0;

  for (const day of days) {
    const offDay = day.weekday === 0 || day.isHoliday || !day.isScheduledWorkingDay;
    if (day.attendance === "present") {
      presentDays += 1;
      if (day.late) lateCount += 1;
      if (day.weekday === 0) sundayDaysWorked += 1;
      else if (day.isHoliday) holidayDaysWorked += 1;
      else payableDays += 1;
    } else if (!offDay) {
      if (day.leave === "paid" || day.leave === "sick") payableDays += 1;
      else unpaidAbsenceDays += 1;
    }
  }

  return { payableDays, unpaidAbsenceDays, sundayDaysWorked, holidayDaysWorked, lateCount, presentDays };
}

export type PayrollInput = {
  structure: SalaryStructure;
  policy: PayrollPolicy;
  payableDays: number;
  overtimeMinutes: number;
  sundayDaysWorked: number;
  holidayDaysWorked: number;
  bonusesPaise: number;
  deductionsPaise: number;
  advancesPaise: number;
  adjustmentsPaise: number;
  lopDays?: number;
  timeDeductionPaise?: number;
};

export type PayrollResult = {
  basePaise: number;
  overtimePaise: number;
  sundayPaise: number;
  holidayPaise: number;
  bonusesPaise: number;
  statutoryPaise: number;
  deductionsPaise: number;
  lopPaise: number;
  timeDeductionPaise: number;
  advancesPaise: number;
  adjustmentsPaise: number;
  grossPaise: number;
  netPaise: number;
  flags: string[];
  needsConfiguration: boolean;
  statutoryApplied: boolean;
};

export function dayTimeCut(input: {
  ratePaise: number;
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  inMinute: number | null;
  outMinute: number | null;
}) {
  if (input.inMinute == null || input.ratePaise <= 0) return 0;
  const span = Math.max(1, input.endMinute - input.startMinute);
  if (input.outMinute == null) return Math.min(input.ratePaise, Math.round(input.ratePaise / 2));
  const late = Math.max(0, input.inMinute - (input.startMinute + input.graceMinutes));
  const early = Math.max(0, (input.endMinute - input.graceMinutes) - input.outMinute);
  return Math.min(input.ratePaise, Math.round((input.ratePaise * (late + early)) / span));
}

function dayRate(structure: SalaryStructure) {
  if (!Number.isSafeInteger(structure.standardPayableDays) || structure.standardPayableDays < 1) {
    throw new MoneyError("Standard payable days must be configured.");
  }
  if (structure.type === "daily") {
    if (!Number.isSafeInteger(structure.dailyRatePaise) || structure.dailyRatePaise < 0) {
      throw new MoneyError("Daily rate is not configured.");
    }
    return structure.dailyRatePaise;
  }
  if (!Number.isSafeInteger(structure.monthlySalaryPaise) || structure.monthlySalaryPaise < 0) {
    throw new MoneyError("Monthly salary is not configured.");
  }
  return Math.round(structure.monthlySalaryPaise / structure.standardPayableDays);
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const rate = dayRate(input.structure);
  const basePaise = input.structure.type === "daily"
    ? input.payableDays * input.structure.dailyRatePaise
    : input.structure.monthlySalaryPaise;
  const flags: string[] = [];
  let overtimePaise = 0;
  if (input.overtimeMinutes > 0) {
    if (input.policy.overtimePaisePerHour == null) flags.push("overtime_rate_unconfigured");
    else overtimePaise = Math.round((input.overtimeMinutes / 60) * input.policy.overtimePaisePerHour);
  }
  const sundayPaise = Math.round(rate * input.sundayDaysWorked);
  const holidayPaise = Math.round(rate * input.holidayDaysWorked);
  const lopPaise = input.structure.type === "monthly" ? Math.round(rate * (input.lopDays ?? 0)) : 0;
  const timeDeductionPaise = Math.max(0, input.timeDeductionPaise ?? 0);

  const statutoryConfigured = [input.policy.pfEmployeeBps, input.policy.esiEmployeeBps, input.policy.professionalTaxPaise].some(
    (value) => value != null,
  );
  let statutoryPaise = 0;
  if (input.policy.pfEmployeeBps != null) statutoryPaise += Math.round((basePaise * input.policy.pfEmployeeBps) / 10000);
  if (input.policy.esiEmployeeBps != null) statutoryPaise += Math.round((basePaise * input.policy.esiEmployeeBps) / 10000);
  if (input.policy.professionalTaxPaise != null) statutoryPaise += input.policy.professionalTaxPaise;
  if (!statutoryConfigured) flags.push("statutory_unconfigured");

  const grossPaise = basePaise + overtimePaise + sundayPaise + holidayPaise + input.bonusesPaise + input.adjustmentsPaise;
  const deductionsPaise = input.deductionsPaise + lopPaise + timeDeductionPaise;
  const netPaise = Math.max(0, grossPaise - statutoryPaise - deductionsPaise - input.advancesPaise);
  return {
    basePaise,
    overtimePaise,
    sundayPaise,
    holidayPaise,
    bonusesPaise: input.bonusesPaise,
    statutoryPaise,
    deductionsPaise,
    lopPaise,
    timeDeductionPaise,
    advancesPaise: input.advancesPaise,
    adjustmentsPaise: input.adjustmentsPaise,
    grossPaise,
    netPaise,
    flags,
    needsConfiguration: flags.includes("overtime_rate_unconfigured"),
    statutoryApplied: statutoryConfigured,
  };
}
