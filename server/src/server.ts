import { createApp } from "./app";
import { env, logger } from "./config";
import { connectDb } from "./db";
import { bootstrap } from "./services/identity";

async function main() {
  await connectDb();
  await bootstrap();
  const app = createApp();
  app.listen(env.port, "0.0.0.0", () => {
    logger.info({ port: env.port }, "Gyroz Studio listening");
  });
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
