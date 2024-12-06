import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
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

export const bookingRoutes = new Hono()
  .get("/", async (c) => {
    const bookings = await c.var.dependencies.bookingService.getAllBookings();

    return c.json(
      {
        bookings,
      },
      200
    );
  })
  // .use(authMiddleware)
  .get("/:id{[0-9]+}", async (c) => {
    const id = parseInt(c.req.param("id"));
    const booking = await c.var.dependencies.bookingService.getBooking(id);

    return c.json(booking, 200);
  })
  .post("/", zValidator("json", createBookingSchema), async (c) => {
    const { startTime, username, hostUsername } = c.req.valid("json");

    const newBooking = await c.var.dependencies.bookingService.createBooking(
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

      const updatedBooking =
        await c.var.dependencies.bookingService.rescheduleBooking(
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
    const result = await c.var.dependencies.bookingService.cancelBooking(
      id,
      username
    );

    return c.json(result, 200);
  })
  .patch("/:id{[0-9]+}/cancel/refund", async (c) => {
    const id = parseInt(c.req.param("id"));

    const result = await c.var.dependencies.bookingService.requestRefund(id);

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

    const result = await c.var.dependencies.bookingService.confirmBooking(
      id,
      username
    );

    return c.json(result, 200);
  });
