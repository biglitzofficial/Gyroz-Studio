import { readFileSync } from "node:fs";
import { env, logger } from "./config";
import { bindFirestore } from "./store";

export async function connectDb() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) {
    const serviceAccount = env.firebaseServiceAccountJson
      ? JSON.parse(env.firebaseServiceAccountJson)
      : JSON.parse(readFileSync(env.firebaseServiceAccount ?? "", "utf8"));
    initializeApp({ credential: cert(serviceAccount) });
  }
  bindFirestore(getFirestore());
  logger.info({ project: "gyroz-studio" }, "Connected to Firestore");
}

export async function disconnectDb() {
  const { getApps, deleteApp } = await import("firebase-admin/app");
  await Promise.all(getApps().map((app) => deleteApp(app).catch(() => undefined)));
}

export async function withTransaction<T>(work: (session: null) => Promise<T>): Promise<T> {
  return work(null);
}
