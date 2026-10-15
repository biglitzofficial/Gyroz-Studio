import { env, logger } from "./config";
import { connectDb } from "./db";
import { Employee, Role, Settings, User } from "./models";
import { loadAuth, type AuthContext } from "./auth";
import { bootstrap } from "./services/identity";
import { createClient, createProject } from "./services/crm";
import { createEmployee, ensureDefaultShift } from "./services/people";
import { claimTask, createShoot, holdTask, reviewDeliverable, startShoot, startTask, submitShoot, submitTask } from "./services/production";
import { approveInvoice, issueInvoice, recordPayment, saveInvoice, submitInvoice } from "./services/finance";
import { EditingTask } from "./models";

const DEMO_PASSWORD = "GyrozDemo!2026";

async function authFor(email: string): Promise<AuthContext> {
  const user = await User.findOne({ email });
  if (!user) throw new Error(`Missing user ${email}`);
  return loadAuth(String(user._id));
}

export async function seedDemo() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed while NODE_ENV is production.");
  await connectDb();
  await bootstrap();
  const settings = await Settings.findOne({ key: "studio" });
  if (settings?.demoSeeded) {
    logger.info("Demo data is already present. Nothing was overwritten.");
    return;
  }
  const director = await authFor(env.bootstrapEmail);
  const shift = await ensureDefaultShift();
  const roles = await Role.find().lean() as any;
  const roleId = (slug: string) => {
    const role = roles.find((item) => item.slug === slug);
    if (!role) throw new Error(`Missing role ${slug}`);
    return String(role._id);
  };
  const people = [
    ["Meera", "Nair", "admin@gyroz.studio", "admin", "Studio manager"],
    ["Arjun", "Menon", "arjun@gyroz.studio", "cinematographer", "Cinematographer"],
    ["Kabir", "Shah", "kabir@gyroz.studio", "video-editor", "Editor"],
    ["Leela", "Iyer", "leela@gyroz.studio", "video-editor", "Editor"],
    ["Rafi", "Thomas", "rafi@gyroz.studio", "social-media-manager", "Social"],
  ] as const;
  for (const [firstName, lastName, email, slug, designation] of people) {
    if (await User.findOne({ email })) continue;
    await createEmployee(director, {
      firstName, lastName, email, designation, roleId: roleId(slug), joiningDate: "2024-04-01",
      shiftId: String(shift._id), createLogin: true, temporaryPassword: DEMO_PASSWORD, mustChangePassword: false,
      compensation: { type: "daily", dailyRatePaise: 50_000, monthlySalaryPaise: 0, standardPayableDays: 26 },
    });
  }
  const floor = [
    ["Darshan", "darshan@gyroz.studio", 2_500_000],
    ["Muhil", "muhil@gyroz.studio", 2_300_000],
    ["Akther", "akther@gyroz.studio", 2_000_000],
    ["Manoj", "manoj@gyroz.studio", 1_500_000],
    ["Bharath", "bharath@gyroz.studio", 1_500_000],
    ["Dharun", "dharun@gyroz.studio", 1_500_000],
    ["Sudha", "sudha@gyroz.studio", 1_300_000],
  ] as const;
  for (const [firstName, email, monthlySalaryPaise] of floor) {
    if (await User.findOne({ email })) continue;
    const dailyRatePaise = Math.round(monthlySalaryPaise / 31);
    await createEmployee(director, {
      firstName, lastName: "", email, designation: "Studio", roleId: roleId("floor-staff"), joiningDate: "2026-04-01",
      shiftId: String(shift._id), createLogin: true, temporaryPassword: DEMO_PASSWORD, mustChangePassword: false,
      compensation: { type: "monthly", dailyRatePaise, monthlySalaryPaise, standardPayableDays: 31 },
    });
  }
  await Settings.updateOne({ key: "studio" }, { $set: { "payroll.salaryDay": 5 } });
  const arjun = await Employee.findOne({ email: "arjun@gyroz.studio" });
  const client = await createClient(director, { name: "Northwind Atelier", kind: "company", contactPerson: "Asha Verghese", email: "asha@northwind.example", pricingModel: "per_output", billingAddress: "Fort Kochi", requiresClientApproval: false });
  const project = await createProject(director, { clientId: String((client as { id: string }).id), name: "Monsoon Lookbook", description: "Four promotional films.", serviceType: "promotional video", priority: "high", budgetPaise: 800_000 });
  const shoot = await createShoot(director, { clientId: project.clientId, projectId: project._id, scheduledDate: new Date().toISOString().slice(0, 10), location: "Mattancherry", cinematographerId: arjun?._id, brief: "Four hero films.", plannedOutputCount: 4 });
  const cinematographer = await authFor("arjun@gyroz.studio");
  await startShoot(cinematographer, String(shoot._id));
  await submitShoot(cinematographer, String(shoot._id), {
    usableFootageCount: 4,
    outputs: ["Look 01", "Look 02", "Look 03", "Look 04"].map((title) => ({ title, type: "promotional_video", platform: "Instagram" })),
  });
  const tasks = await EditingTask.find({ shootId: shoot._id }).sort({ createdAt: 1 });
  const kabir = await authFor("kabir@gyroz.studio");
  await claimTask(kabir, String(tasks[0]._id));
  await startTask(kabir, String(tasks[0]._id));
  await holdTask(kabir, String(tasks[0]._id), "Waiting on a missing insert.");
  for (const task of tasks.slice(1, 3)) {
    await claimTask(kabir, String(task._id));
    await startTask(kabir, String(task._id));
    await submitTask(kabir, String(task._id), { exportReferences: [{ label: "Export", url: "https://files.gyroz.example/cut.mp4" }] });
    await reviewDeliverable(director, String(task.deliverableId), { decision: "approved" });
  }
  const invoice = await saveInvoice(director, undefined, {
    clientId: String(project.clientId),
    projectId: String(project._id),
    lineItems: [
      { description: "Shoot charges", quantity: 1, unitPricePaise: 300_000, discountPaise: 0 },
      { description: "Editing charges", quantity: 1, unitPricePaise: 150_000, discountPaise: 0 },
      { description: "Approved reshoot", quantity: 1, unitPricePaise: 100_000, discountPaise: 0, sourceType: "manual" },
    ],
    discountPaise: 50_000,
    taxRateBps: 0,
    clientNotes: "Example billing for four films. These rates belong to this draft only.",
  });
  const invoiceId = String(invoice.invoice._id);
  await submitInvoice(director, invoiceId);
  await approveInvoice(director, invoiceId);
  await issueInvoice(director, invoiceId);
  await recordPayment(director, { invoiceId, amountPaise: 200_000, method: "bank_transfer", reference: "NEFT-DEMO" });
  if (settings) {
    settings.demoSeeded = true;
    await settings.save();
  }
  logger.info({ password: DEMO_PASSWORD, director: env.bootstrapEmail }, "Demo studio seeded. Change these passwords before any shared deployment.");
}

const entry = (process.argv[1] ?? "").replaceAll("\\", "/");
if (entry.endsWith("/seed.ts") || entry.endsWith("/seed.js")) {
  seedDemo().then(() => process.exit(0)).catch((error) => {
    logger.error(error);
    process.exit(1);
  });
}
