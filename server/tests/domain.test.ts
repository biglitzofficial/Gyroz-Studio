import { describe, expect, it } from "vitest";
import { distanceMeters } from "../src/domain/geo";
import { calculateInvoice, presentInvoiceStatus } from "../src/domain/money";
import { calculatePayroll, summarizePayable } from "../src/domain/payroll";
import { assertProjectTransition } from "../src/domain/workflow";

describe("invoice money", () => {
  it("calculates the studio example before tax", () => {
    const totals = calculateInvoice(
      [
        { description: "Shoot", quantity: 1, unitPricePaise: 300_000, discountPaise: 0 },
        { description: "Editing", quantity: 1, unitPricePaise: 150_000, discountPaise: 0 },
        { description: "Reshoot", quantity: 1, unitPricePaise: 100_000, discountPaise: 0 },
      ],
      50_000,
      0,
    );
    expect(totals.subtotalPaise).toBe(550_000);
    expect(totals.taxablePaise).toBe(500_000);
    expect(totals.totalPaise).toBe(500_000);
  });

  it("applies tax in basis points with half-up rounding", () => {
    const totals = calculateInvoice([{ description: "Fee", quantity: 1, unitPricePaise: 101, discountPaise: 0 }], 0, 1800);
    expect(totals.taxPaise).toBe(18);
    expect(totals.totalPaise).toBe(119);
  });

  it("rejects a discount larger than the subtotal", () => {
    expect(() => calculateInvoice([{ description: "Fee", quantity: 1, unitPricePaise: 100, discountPaise: 0 }], 101, 0)).toThrow(/discount/i);
  });

  it("shows overdue without rewriting a paid invoice", () => {
    expect(presentInvoiceStatus("issued", new Date("2020-01-01"), 1000, 0, new Date("2026-01-01"))).toBe("overdue");
    expect(presentInvoiceStatus("paid", new Date("2020-01-01"), 1000, 1000, new Date("2026-01-01"))).toBe("paid");
  });
});

describe("payroll rules", () => {
  it("pays configured daily wages for payable days", () => {
    const days = Array.from({ length: 26 }, () => ({ weekday: 1, isHoliday: false, isScheduledWorkingDay: true, attendance: "present" as const, leave: null, late: false }));
    const summary = summarizePayable(days);
    const result = calculatePayroll({
      structure: { type: "daily", dailyRatePaise: 50_000, monthlySalaryPaise: 0, standardPayableDays: 26 },
      policy: { overtimePaisePerHour: null, offdayMultiplier: null, pfEmployeeBps: null, esiEmployeeBps: null, professionalTaxPaise: null },
      payableDays: summary.payableDays,
      overtimeMinutes: 0,
      sundayDaysWorked: 0,
      holidayDaysWorked: 0,
      bonusesPaise: 0,
      deductionsPaise: 0,
      advancesPaise: 0,
      adjustmentsPaise: 0,
    });
    expect(summary.payableDays).toBe(26);
    expect(result.basePaise).toBe(1_300_000);
    expect(result.flags).toContain("statutory_unconfigured");
    expect(result.needsConfiguration).toBe(false);
  });

  it("adds one day of pay for a Sunday and does not block the month", () => {
    const summary = summarizePayable([{ weekday: 0, isHoliday: false, isScheduledWorkingDay: false, attendance: "present", leave: null, late: false }]);
    const result = calculatePayroll({
      structure: { type: "daily", dailyRatePaise: 50_000, monthlySalaryPaise: 0, standardPayableDays: 26 },
      policy: { overtimePaisePerHour: null, offdayMultiplier: null, pfEmployeeBps: null, esiEmployeeBps: null, professionalTaxPaise: null },
      payableDays: summary.payableDays,
      overtimeMinutes: 0,
      sundayDaysWorked: summary.sundayDaysWorked,
      holidayDaysWorked: 0,
      bonusesPaise: 0,
      deductionsPaise: 0,
      advancesPaise: 0,
      adjustmentsPaise: 0,
    });
    expect(summary.sundayDaysWorked).toBe(1);
    expect(summary.payableDays).toBe(0);
    expect(result.sundayPaise).toBe(50_000);
    expect(result.needsConfiguration).toBe(false);
  });

  it("pays the monthly salary, adds a Sunday, and deducts a lost day and late minutes", () => {
    const result = calculatePayroll({
      structure: { type: "monthly", dailyRatePaise: 80_645, monthlySalaryPaise: 2_500_000, standardPayableDays: 31 },
      policy: { overtimePaisePerHour: null, offdayMultiplier: null, pfEmployeeBps: null, esiEmployeeBps: null, professionalTaxPaise: null },
      payableDays: 25,
      overtimeMinutes: 0,
      sundayDaysWorked: 1,
      holidayDaysWorked: 0,
      bonusesPaise: 0,
      deductionsPaise: 0,
      advancesPaise: 0,
      adjustmentsPaise: 0,
      lopDays: 1,
      timeDeductionPaise: 8_065,
    });
    expect(result.basePaise).toBe(2_500_000);
    expect(result.sundayPaise).toBe(80_645);
    expect(result.lopPaise).toBe(80_645);
    expect(result.netPaise).toBe(2_500_000 + 80_645 - 80_645 - 8_065);
  });
});

describe("office distance", () => {
  it("is zero at the same point and about 111 metres one thousandth of a degree north", () => {
    expect(distanceMeters({ latitude: 9.9312, longitude: 76.2673 }, { latitude: 9.9312, longitude: 76.2673 })).toBe(0);
    const north = distanceMeters({ latitude: 9.9312, longitude: 76.2673 }, { latitude: 9.9322, longitude: 76.2673 });
    expect(north).toBeGreaterThan(100);
    expect(north).toBeLessThan(120);
  });
});

describe("project transitions", () => {
  it("blocks an invalid jump", () => {
    expect(() => assertProjectTransition("planning", "completed")).toThrow(/cannot move/);
  });
});
