import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { env } from "../config";
import { AppError } from "../http";
import { MediaAsset } from "../models";
import type { AuthContext } from "../auth";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4", "video/quicktime", "video/webm"]);
const LOCAL_LIMIT = 80 * 1024 * 1024;

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

export function resolveLocalPath(storageKey: string) {
  const root = path.resolve(process.cwd(), env.uploadDir);
  const full = path.resolve(root, storageKey);
  if (!full.startsWith(root)) throw new AppError(400, "VALIDATION", "Invalid storage path.");
  return { root, full };
}

export async function createUploadIntent(auth: AuthContext, input: { filename: string; contentType: string; size: number; ownerType: string; ownerId?: string; kind?: string }) {
  if (!ALLOWED.has(input.contentType)) throw new AppError(400, "VALIDATION", "This file type is not accepted.");
  if (input.size < 1) throw new AppError(400, "VALIDATION", "The file is empty.");
  const useS3 = env.storageDriver === "s3" && env.s3.bucket && env.s3.accessKeyId && env.s3.secretAccessKey;
  if (!useS3 && input.size > LOCAL_LIMIT) {
    throw new AppError(413, "STORAGE_LIMIT", "This file is too large for local storage. Configure object storage for footage and large exports.");
  }
  const storageKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${safeName(input.filename)}`;
  const asset = await MediaAsset.create({
    storageKey,
    driver: useS3 ? "s3" : "local",
    filename: safeName(input.filename),
    contentType: input.contentType,
    size: input.size,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    kind: input.kind ?? "attachment",
    createdBy: auth.userId,
    status: "pending",
  });
  if (!useS3) {
    return { mode: "proxy" as const, assetId: String(asset._id), uploadUrl: `/api/v1/media/${asset._id}/content` };
  }
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: env.s3.region || "us-east-1",
    endpoint: env.s3.endpoint || undefined,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
  });
  const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: env.s3.bucket, Key: storageKey, ContentType: input.contentType }), { expiresIn: 900 });
  return { mode: "direct" as const, assetId: String(asset._id), uploadUrl };
}

export async function saveLocalUpload(assetId: string, body: Buffer, contentType: string) {
  const asset = await MediaAsset.findById(assetId);
  if (!asset || asset.driver !== "local") throw new AppError(404, "NOT_FOUND", "Upload was not found.");
  if (asset.contentType !== contentType && contentType !== "application/octet-stream") {
    throw new AppError(400, "VALIDATION", "The uploaded content type does not match the request.");
  }
  if (body.length !== asset.size && Math.abs(body.length - asset.size) > 1024) {
    throw new AppError(400, "VALIDATION", "The uploaded file size does not match.");
  }
  const { root, full } = resolveLocalPath(asset.storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  if (!full.startsWith(root)) throw new AppError(400, "VALIDATION", "Invalid storage path.");
  await fs.writeFile(full, body);
  asset.status = "ready";
  asset.size = body.length;
  await asset.save();
  return { id: String(asset._id), filename: asset.filename, contentType: asset.contentType, size: asset.size };
}

export async function accessUrl(auth: AuthContext, assetId: string) {
  const asset = await MediaAsset.findById(assetId);
  if (!asset || asset.status !== "ready") throw new AppError(404, "NOT_FOUND", "File not found.");
  if (asset.driver === "local") return { url: `/api/v1/media/${asset._id}/file`, filename: asset.filename, contentType: asset.contentType };
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: env.s3.region || "us-east-1",
    endpoint: env.s3.endpoint || undefined,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
  });
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: env.s3.bucket, Key: asset.storageKey }), { expiresIn: 300 });
  return { url, filename: asset.filename, contentType: asset.contentType, actor: auth.userId };
}

export async function clearLocalUploads() {
  const root = path.resolve(process.cwd(), env.uploadDir);
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  await Promise.all(entries.map((name) => fs.rm(path.join(root, name), { recursive: true, force: true })));
}
