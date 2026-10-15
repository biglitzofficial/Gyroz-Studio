import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { connectDb, disconnectDb } from "../src/db";
import { bootstrap } from "../src/services/identity";
import { Role } from "../src/models";

let app: ReturnType<typeof createApp>;

async function token(email: string, password: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

beforeAll(async () => {
  await connectDb();
  await bootstrap();
  app = createApp();
}, 180000);

afterAll(async () => {
  await disconnectDb();
});

describe("studio API", () => {
  it("rejects anonymous access", async () => {
    const response = await request(app).get("/api/v1/clients");
    expect(response.status).toBe(401);
  });

  it("keeps one client, many projects, one shoot, and four deliverables", async () => {
    const director = await token("director@gyroz.studio", "ChangeMeNow!2026");
    const editorRole = await Role.findOne({ slug: "video-editor" });
    const cineRole = await Role.findOne({ slug: "cinematographer" });
    const adminRole = await Role.findOne({ slug: "admin" });
    const created = await request(app).post("/api/v1/employees").set("Authorization", `Bearer ${director}`).send({
      firstName: "Editor", lastName: "One", email: "editor1@gyroz.test", roleId: editorRole?._id, joiningDate: "2024-01-01", createLogin: true, temporaryPassword: "EditorPass1", mustChangePassword: false,
      compensation: { type: "daily", dailyRatePaise: 50000, monthlySalaryPaise: 0, standardPayableDays: 26 },
    });
    expect(created.status).toBe(201);
    await request(app).post("/api/v1/employees").set("Authorization", `Bearer ${director}`).send({
      firstName: "Editor", lastName: "Two", email: "editor2@gyroz.test", roleId: editorRole?._id, joiningDate: "2024-01-01", createLogin: true, temporaryPassword: "EditorPass1", mustChangePassword: false,
    });
    const camera = await request(app).post("/api/v1/employees").set("Authorization", `Bearer ${director}`).send({
      firstName: "Cam", lastName: "Era", email: "cam@gyroz.test", roleId: cineRole?._id, joiningDate: "2024-01-01", createLogin: true, temporaryPassword: "CameraPass1", mustChangePassword: false,
    });
    await request(app).post("/api/v1/employees").set("Authorization", `Bearer ${director}`).send({
      firstName: "Ops", lastName: "Admin", email: "ops@gyroz.test", roleId: adminRole?._id, joiningDate: "2024-01-01", createLogin: true, temporaryPassword: "AdminPass1", mustChangePassword: false,
    });
    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${director}`).send({
      name: "Harbor & Co",
      contactPerson: "Asha Verghese",
      phone: "9847012345",
      email: "asha@harbor.example",
      billingAddress: "Fort Kochi",
    });
    const first = await request(app).post("/api/v1/projects").set("Authorization", `Bearer ${director}`).send({ clientId: client.body.data.id, name: "Spring" });
    const second = await request(app).post("/api/v1/projects").set("Authorization", `Bearer ${director}`).send({ clientId: client.body.data.id, name: "Autumn" });
    expect(first.body.data.clientId).toBe(second.body.data.clientId);
    const shoot = await request(app).post("/api/v1/shoots").set("Authorization", `Bearer ${director}`).send({
      clientId: client.body.data.id, projectId: first.body.data._id, scheduledDate: "2026-10-13", cinematographerId: camera.body.data._id, plannedOutputCount: 4,
    });
    const cam = await token("cam@gyroz.test", "CameraPass1");
    await request(app).post(`/api/v1/shoots/${shoot.body.data._id}/start`).set("Authorization", `Bearer ${cam}`);
    const submitted = await request(app).post(`/api/v1/shoots/${shoot.body.data._id}/submit`).set("Authorization", `Bearer ${cam}`).send({
      usableFootageCount: 4,
      outputs: ["One", "Two", "Three", "Four"].map((title) => ({ title })),
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.deliverables).toHaveLength(4);
    const again = await request(app).post(`/api/v1/shoots/${shoot.body.data._id}/submit`).set("Authorization", `Bearer ${cam}`).send({ usableFootageCount: 4, outputs: [{ title: "Duplicate" }] });
    expect(again.status).toBe(409);

    const queue = await request(app).get("/api/v1/editing/queue").set("Authorization", `Bearer ${director}`);
    const available = queue.body.data.filter((item: { status: string }) => item.status === "available");
    const editorA = await token("editor1@gyroz.test", "EditorPass1");
    const editorB = await token("editor2@gyroz.test", "EditorPass1");
    const target = available[0];
    const [claimA, claimB] = await Promise.all([
      request(app).post(`/api/v1/editing/${target._id}/claim`).set("Authorization", `Bearer ${editorA}`),
      request(app).post(`/api/v1/editing/${target._id}/claim`).set("Authorization", `Bearer ${editorB}`),
    ]);
    expect([claimA.status, claimB.status].sort()).toEqual([200, 409]);

    const bank = await request(app).get(`/api/v1/employees/${camera.body.data._id}`).set("Authorization", `Bearer ${editorA}`);
    expect(bank.status).toBe(403);
    const self = await request(app).get(`/api/v1/employees/${created.body.data._id}`).set("Authorization", `Bearer ${editorA}`);
    expect(self.status).toBe(200);
    expect(self.body.data.employee.bank).toBeUndefined();

    const escalation = await request(app).patch(`/api/v1/roles/${adminRole?._id}`).set("Authorization", `Bearer ${await token("ops@gyroz.test", "AdminPass1")}`).send({ name: "Admin", permissions: ["payroll.sensitive", "roles.manage"] });
    expect(escalation.status).toBe(403);

    const deliverableId = submitted.body.data.deliverables[1]._id;
    const taskId = available.find((item: { deliverable: { _id: string } }) => String(item.deliverable._id) === String(deliverableId))._id;
    await request(app).post(`/api/v1/editing/${taskId}/claim`).set("Authorization", `Bearer ${editorA}`);
    await request(app).post(`/api/v1/editing/${taskId}/start`).set("Authorization", `Bearer ${editorA}`);
    await request(app).post(`/api/v1/editing/${taskId}/submit`).set("Authorization", `Bearer ${editorA}`).send({ exportReferences: [{ url: "https://files.example/cut.mp4" }] });
    const before = await request(app).get("/api/v1/deliverables").set("Authorization", `Bearer ${director}`);
    const countBefore = before.body.data.filter((item: { projectId: string }) => String(item.projectId) === String(first.body.data._id)).length;
    const review = await request(app).post(`/api/v1/deliverables/${deliverableId}/reviews`).set("Authorization", `Bearer ${director}`).send({ decision: "rework", feedback: "Tighten the opening." });
    expect(review.body.data.deliverable.revisionCount).toBe(1);
    const after = await request(app).get("/api/v1/deliverables").set("Authorization", `Bearer ${director}`);
    const countAfter = after.body.data.filter((item: { projectId: string }) => String(item.projectId) === String(first.body.data._id)).length;
    expect(countAfter).toBe(countBefore);

    const reshoot = await request(app).post("/api/v1/reshoots").set("Authorization", `Bearer ${cam}`).send({ deliverableId, reason: "missing_shots", notes: "Need the doorway." });
    expect(String(reshoot.body.data.deliverableId)).toBe(String(deliverableId));
    const blocked = await request(app).post("/api/v1/invoices").set("Authorization", `Bearer ${director}`).send({
      clientId: client.body.data.id,
      lineItems: [{ description: "Reshoot", quantity: 1, unitPricePaise: 100000, discountPaise: 0, sourceType: "reshoot", sourceId: reshoot.body.data._id }],
    });
    expect(blocked.status).toBe(409);

    const invoice = await request(app).post("/api/v1/invoices").set("Authorization", `Bearer ${director}`).send({
      clientId: client.body.data.id,
      discountPaise: 50000,
      taxRateBps: 0,
      lineItems: [
        { description: "Shoot charges", quantity: 1, unitPricePaise: 300000, discountPaise: 0 },
        { description: "Editing charges", quantity: 1, unitPricePaise: 150000, discountPaise: 0 },
        { description: "Reshoot placeholder", quantity: 1, unitPricePaise: 100000, discountPaise: 0 },
      ],
    });
    expect(invoice.body.data.invoice.totalPaise).toBe(500000);
    await request(app).post(`/api/v1/invoices/${invoice.body.data.invoice._id}/submit`).set("Authorization", `Bearer ${director}`);
    await request(app).post(`/api/v1/invoices/${invoice.body.data.invoice._id}/approve`).set("Authorization", `Bearer ${director}`);
    await request(app).post(`/api/v1/invoices/${invoice.body.data.invoice._id}/issue`).set("Authorization", `Bearer ${director}`);
    const locked = await request(app).patch(`/api/v1/invoices/${invoice.body.data.invoice._id}`).set("Authorization", `Bearer ${director}`).send({
      clientId: client.body.data.id,
      lineItems: [{ description: "Changed", quantity: 1, unitPricePaise: 1, discountPaise: 0 }],
    });
    expect(locked.status).toBe(409);
    const partial = await request(app).post("/api/v1/payments").set("Authorization", `Bearer ${director}`).send({ invoiceId: invoice.body.data.invoice._id, amountPaise: 200000, method: "upi" });
    expect(partial.body.data.invoice.paidPaise).toBe(200000);
    expect(partial.body.data.invoice.displayStatus).toBe("partially_paid");

    const finance = await request(app).get("/api/v1/analytics/financial?from=2026-01-01&to=2026-12-31").set("Authorization", `Bearer ${editorA}`);
    expect(finance.status).toBe(403);
  });

  it("rejects a second check-in", async () => {
    const director = await token("director@gyroz.studio", "ChangeMeNow!2026");
    const editor = await token("editor1@gyroz.test", "EditorPass1");
    const firstCode = await request(app).post("/api/v1/attendance/kiosk-token").set("Authorization", `Bearer ${director}`);
    const secondCode = await request(app).post("/api/v1/attendance/kiosk-token").set("Authorization", `Bearer ${director}`);
    const checkIn = await request(app).post("/api/v1/attendance/check-in").set("Authorization", `Bearer ${editor}`).send({ code: firstCode.body.data.code });
    expect(checkIn.status).toBe(200);
    const duplicate = await request(app).post("/api/v1/attendance/check-in").set("Authorization", `Bearer ${editor}`).send({ code: secondCode.body.data.code });
    expect(duplicate.status).toBe(409);
  });
});
