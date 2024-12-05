// index.ts
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { expensesRoute } from "./routes/expeses";
import { env } from "@/config";
import { authRoute } from "./routes/auth";

const API_VERSION = "v1";
const corsOrigin = env.CORS_ORIGIN;

const app = new Hono();
app.use(logger());
app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-API-Version"],
    credentials: true,
  })
);

const apiRoutes = app
  .basePath(`/api`)
  .route("/auth", authRoute)
  .basePath(`/${API_VERSION}`)
  .route("/expenses", expensesRoute);

app.use("*", async (c, next) => {
  await next();
  c.header("X-API-Version", API_VERSION);
});

export default {
  port: env.PORT,
  fetch: app.fetch,
};

export type ApiRoutes = typeof apiRoutes;
