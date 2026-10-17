import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import pino from "pino";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  FIREBASE_SERVICE_ACCOUNT: z.string().optional().default(""),
  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change"),
  JWT_REFRESH_SECRET: z.string().min(16).default("dev-refresh-secret-change"),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  BUSINESS_TIMEZONE: z.string().default("Asia/Kolkata"),
  CURRENCY: z.string().default("INR"),
  BOOTSTRAP_EMAIL: z.string().email().default("superadmin@gyroz.studio"),
  BOOTSTRAP_PASSWORD: z.string().min(8).default("Admin@123"),
  BOOTSTRAP_NAME: z.string().default("Super Admin"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("uploads"),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
  S3_BUCKET: z.string().optional().default(""),
  S3_REGION: z.string().optional().default(""),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
});

const parsed = schema.parse(process.env);

const accountName = "gyroz-studio-firebase-adminsdk-fbsvc-2846b3b786.json";
const firebaseServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
const firebaseServiceAccount = firebaseServiceAccountJson
  ? ""
  : [parsed.FIREBASE_SERVICE_ACCOUNT, path.resolve(process.cwd(), accountName), path.resolve(process.cwd(), "..", accountName)]
      .filter(Boolean)
      .find((file) => fs.existsSync(file));

if (!firebaseServiceAccountJson && !firebaseServiceAccount) {
  throw new Error("Firebase service account was not found. Place the Gyroz Studio key in the project folder or set FIREBASE_SERVICE_ACCOUNT_JSON.");
}

if (firebaseServiceAccountJson) {
  JSON.parse(firebaseServiceAccountJson);
}

const railwayHost = (process.env.RAILWAY_PUBLIC_DOMAIN || "").replace(/^https?:\/\//, "");
const clientOrigin = railwayHost && /^http:\/\/(localhost|127\.0\.0\.1)/.test(parsed.CLIENT_ORIGIN) ? `https://${railwayHost}` : parsed.CLIENT_ORIGIN;

if (parsed.NODE_ENV === "production") {
  const missing = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "BOOTSTRAP_PASSWORD"].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
  if (parsed.JWT_ACCESS_SECRET.startsWith("dev-") || parsed.JWT_REFRESH_SECRET.startsWith("dev-")) {
    throw new Error("Replace the development JWT secrets before running in production.");
  }
}

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  firebaseServiceAccount,
  firebaseServiceAccountJson,
  jwtAccessSecret: parsed.JWT_ACCESS_SECRET,
  jwtRefreshSecret: parsed.JWT_REFRESH_SECRET,
  accessTtlSeconds: 60 * 15,
  refreshTtlDays: 14,
  clientOrigin,
  businessTimezone: parsed.BUSINESS_TIMEZONE,
  currency: parsed.CURRENCY,
  bootstrapEmail: parsed.BOOTSTRAP_EMAIL.toLowerCase(),
  bootstrapPassword: parsed.BOOTSTRAP_PASSWORD,
  bootstrapName: parsed.BOOTSTRAP_NAME,
  storageDriver: parsed.STORAGE_DRIVER,
  uploadDir: parsed.UPLOAD_DIR,
  googleMapsApiKey: parsed.GOOGLE_MAPS_API_KEY.trim(),
  s3: {
    bucket: parsed.S3_BUCKET,
    region: parsed.S3_REGION,
    endpoint: parsed.S3_ENDPOINT,
    accessKeyId: parsed.S3_ACCESS_KEY_ID,
    secretAccessKey: parsed.S3_SECRET_ACCESS_KEY,
  },
};

export const logger = pino({
  level: env.nodeEnv === "test" ? "silent" : "info",
});
