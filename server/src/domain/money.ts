export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

function assertPaise(value: number, label: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new MoneyError(`${label} must be a non-negative whole number of paise.`);
  }
}

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
};

export type InvoiceTotals = {
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPaise: number;
  totalPaise: number;
  lines: Array<InvoiceLineInput & { netPaise: number }>;
};

/** Half-up rounding for positive integer arithmetic. All money stays in paise. */
export function calculateInvoice(
  lines: InvoiceLineInput[],
  invoiceDiscountPaise: number,
  taxRateBps: number,
): InvoiceTotals {
  if (!lines.length) throw new MoneyError("An invoice needs at least one line.");
  assertPaise(invoiceDiscountPaise, "Invoice discount");
  if (!Number.isSafeInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
    throw new MoneyError("Tax rate must be between 0 and 10000 basis points.");
  }

  const detailed = lines.map((line) => {
    if (!line.description.trim()) throw new MoneyError("Each line needs a description.");
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new MoneyError("Quantity must be a positive whole number.");
    }
    assertPaise(line.unitPricePaise, "Unit price");
    assertPaise(line.discountPaise, "Line discount");
    const gross = line.quantity * line.unitPricePaise;
    if (!Number.isSafeInteger(gross)) throw new MoneyError("Line amount is too large.");
    if (line.discountPaise > gross) throw new MoneyError("A line discount cannot exceed the line amount.");
    return { ...line, netPaise: gross - line.discountPaise };
  });

  const subtotalPaise = detailed.reduce((sum, line) => sum + line.netPaise, 0);
  if (invoiceDiscountPaise > subtotalPaise) {
    throw new MoneyError("The invoice discount cannot exceed the subtotal.");
  }
  const taxablePaise = subtotalPaise - invoiceDiscountPaise;
  const taxPaise = Math.round((taxablePaise * taxRateBps) / 10000);
  const totalPaise = taxablePaise + taxPaise;
  if (!Number.isSafeInteger(totalPaise)) throw new MoneyError("Invoice total is too large.");
  return { subtotalPaise, discountPaise: invoiceDiscountPaise, taxablePaise, taxPaise, totalPaise, lines: detailed };
}

export function outstandingPaise(totalPaise: number, paidPaise: number) {
  assertPaise(totalPaise, "Total");
  assertPaise(paidPaise, "Amount paid");
  if (paidPaise > totalPaise) throw new MoneyError("Amount paid cannot exceed the invoice total.");
  return totalPaise - paidPaise;
}

export type StoredInvoiceStatus = "draft" | "pending_approval" | "approved" | "issued" | "partially_paid" | "paid" | "void";

export function presentInvoiceStatus(
  status: StoredInvoiceStatus,
  dueDate: Date | null,
  totalPaise: number,
  paidPaise: number,
  now = new Date(),
) {
  if ((status === "issued" || status === "partially_paid") && dueDate && dueDate.getTime() < now.getTime() && paidPaise < totalPaise) {
    return "overdue" as const;
  }
  return status;
}
