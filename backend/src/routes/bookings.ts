import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { Env, h } from "@/lib/facotry";
import { authMiddleware } from "@/middlewares/auth";
import { Hono } from "hono";

// Zod schema for booking validation
const createBookingSchema = z.object({
  startTime: z
    .string()
    .datetime({ message: "Invalid startTime. Must be ISO 8601 format." }),
  username: z.string().min(1, { message: "Username is required." }),
  hostUsername: z.string().min(1, { message: "Host username is required." }),
});

const recheduleBookingSchema = z.object({
  startTime: z
    .string()
    .datetime({ message: "Invalid startTime. Must be ISO 8601 format." }),
});

const publicRoutes = new Hono<Env>().get("/", async (c) => {
  const bookings = await c.var.bookingService.getAllBookings();

  return c.json(
    {
      bookings,
    },
    200
  );
});

export const privateRoutes = new Hono<Env>()
  .use(authMiddleware)
  .get("/:id{[0-9]+}", async (c) => {
    const id = parseInt(c.req.param("id"));
    const booking = await c.var.bookingService.getBooking(id);

    return c.json(booking, 200);
  })
  .post("/", zValidator("json", createBookingSchema), async (c) => {
    const { startTime, username, hostUsername } = c.req.valid("json");

    const newBooking = await c.var.bookingService.createBooking(
      startTime,
      username,
      hostUsername
    );

    return c.json(
      {
        message: "Booking created",
        booking: newBooking,
      },
      201
    );
  })
  .patch(
    "/:id{[0-9]+}/reschedule",
    zValidator("json", recheduleBookingSchema),
    async (c) => {
      const id = parseInt(c.req.param("id"));
      const { startTime } = c.req.valid("json");
      const username = c.req.header("x-username");

      if (!username) {
        return c.json(
          {
            error: "Username is required in the header.",
            code: "MISSING_USERNAME",
          },
          400
        );
      }

      const updatedBooking = await c.var.bookingService.rescheduleBooking(
        id,
        startTime,
        username
      );

      return c.json(
        {
          message: "Booking rescheduled successfully.",
          booking: updatedBooking,
        },
        200
      );
    }
  )
  .patch("/:id{[0-9]+}/cancel", async (c) => {
    const id = parseInt(c.req.param("id"));
    const username = c.req.header("x-username");

    if (!username) {
      return c.json(
        {
          error: "Username is required in the header.",
          code: "MISSING_USERNAME",
        },
        400
      );
    }

    // Call the service to cancel the booking
    const result = await c.var.bookingService.cancelBooking(id, username);

    return c.json(result, 200);
  })
  .patch("/:id{[0-9]+}/cancel/refund", async (c) => {
    const id = parseInt(c.req.param("id"));

    const result = await c.var.bookingService.requestRefund(id);

    return c.json(result, 200);
  })
  .patch("/:id{[0-9]+}/confirm", async (c) => {
    const id = c.req.param("id");
    const username = c.req.header("x-username");

    if (!username) {
      return c.json(
        {
          error: "Username is required in the header.",
          code: "MISSING_USERNAME",
        },
        400
      );
    }

    const result = await c.var.bookingService.confirmBooking(id, username);

    return c.json(result, 200);
  });

export const bookingRoutes = h
  .route("/", publicRoutes)
  .route("/", privateRoutes);
