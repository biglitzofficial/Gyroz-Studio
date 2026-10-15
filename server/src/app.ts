import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env, logger } from "./config";
import { errorHandler } from "./http";
import { api } from "./routes";

function clientBuildDir() {
  return [path.resolve(process.cwd(), "client", "dist"), path.resolve(process.cwd(), "..", "client", "dist")].find((dir) => fs.existsSync(path.join(dir, "index.html")));
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const httpsSite = env.clientOrigin.startsWith("https://");
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    strictTransportSecurity: httpsSite ? undefined : false,
    contentSecurityPolicy: httpsSite ? undefined : { useDefaults: true, directives: { upgradeInsecureRequests: null } },
  }));
  const allowedOrigins = new Set([env.clientOrigin, "http://localhost", "https://localhost", "capacitor://localhost", "http://localhost:5173"]);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else callback(null, false);
    },
    credentials: true,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path === "/health") return;
      logger.info({ method: req.method, url: req.originalUrl, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });
  app.use("/api/v1", api);
  const site = env.nodeEnv === "production" ? clientBuildDir() : undefined;
  if (site) {
    app.use(express.static(site, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(site, "index.html"));
    });
  }
  app.use(errorHandler);
  return app;
}
