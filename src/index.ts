import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { BookingValidationError } from "@/features/errors";
import { env } from "./config";
import { authRoute } from "./routes/auth";
import { bookingRoutes } from "./routes/bookings";
import { paymentRoute } from "./routes/payments";

const API_VERSION = "v1";

// Modify your app initialization
const app = new Hono().use(logger()).use(
  "*",
  cors({
    origin: env.FRONTEND_URL,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-API-Version"],
    credentials: true,
  })
);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  if (err instanceof BookingValidationError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
        },
      },
      400
    );
  }

  console.error(err);

  return c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
      },
    },
    500
  );
});

app
  .basePath(`/api`)
  .route("/auth", authRoute)
  .basePath(`/${API_VERSION}`)
  .route("/bookings", bookingRoutes)
  .route("/payments", paymentRoute);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
