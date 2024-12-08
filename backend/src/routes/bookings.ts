import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { CreateBookingCommandHandler } from "@/features/booking-create";
import { GetBookingsCommandHandler } from "@/features/booking-get-all";
import { RescheduleBookingCommandHandler } from "@/features/booking-reschedule";
import { CancelBookingCommandHandler } from "@/features/booking-cancel";
import { RequestRefundCommandHandler } from "@/features/booking-refund";
import { ConfirmBookingCommandHandler } from "@/features/booking-confirm";
import { authMiddleware } from "@/middlewares/auth";
import { GetBookingByIdCommandHandler } from "@/features/booking-get-by-id";
import { BookingStatus, BookingType, RecurrencePattern } from "@prisma/client";
import { CreateRecurringBookingsCommandHandler } from "@/features/booking-recurring";

const createBookingSchema = z.object({
  startTime: z
    .string()
    .datetime({ message: "Invalid startTime. Must be ISO 8601 format." }),
  toUserId: z.number().min(1, { message: "toUserId is required." }),
});

export const getBookingsSchema = z
  .object({
    page: z.coerce.number().positive().optional(),
    limit: z.coerce.number().positive().optional(),
    status: z
      .union([
        z.nativeEnum(BookingStatus), // Single status
        z.nativeEnum(BookingStatus).array(), // Array of statuses
      ])
      .optional()
      .transform((value) => {
        if (!value) return undefined;
        return Array.isArray(value) ? value : [value];
      }),
    type: z.nativeEnum(BookingType).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    search: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    {
      message: "Start date must be before or equal to end date",
      path: ["startDate"],
    }
  );

const recheduleBookingSchema = z.object({
  startTime: z
    .string()
    .datetime({ message: "Invalid startTime. Must be ISO 8601 format." })
    .refine(
      (date) => new Date(date) > new Date(),
      "Cannot reschedule to a past time"
    ),
});

const createRecurringBookingsSchema = z.object({
  recurrencePattern: z.nativeEnum(RecurrencePattern, {
    required_error: "Recurrence pattern is required",
    invalid_type_error: "Invalid recurrence pattern",
  }),
  recurrenceEnd: z
    .string()
    .datetime({ message: "Invalid recurrenceEnd. Must be ISO 8601 format." })
    .refine(
      (date) => new Date(date) > new Date(),
      "Recurrence end date must be in the future"
    ),
});

export const bookingRoutes = new Hono()
  .use(authMiddleware)
  .post("/", zValidator("json", createBookingSchema), async (c) => {
    const { startTime, toUserId } = c.req.valid("json");

    const newBooking = await CreateBookingCommandHandler.execute({
      startTime,
      currentUser: c.var.user!,
      toUserId,
    });

    return c.json(
      {
        message: "Booking created",
        booking: newBooking,
      },
      201
    );
  })
  .get("/", zValidator("query", getBookingsSchema), async (c) => {
    const { page, limit, status, type, startDate, endDate, search } =
      c.req.valid("query");

    const bookings = await GetBookingsCommandHandler.execute({
      currentUser: c.var.user!,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      filters: {
        status: status ? status : undefined, // Now handles array
        type,
        startDate,
        endDate,
        search,
      },
    });

    return c.json(bookings, 200);
  })
  .get("/:id{[0-9]+}", async (c) => {
    const id = parseInt(c.req.param("id"));
    const booking = await GetBookingByIdCommandHandler.execute({
      bookingId: id,
      currentUser: c.var.user!,
    });

    return c.json(booking, 200);
  })
  .patch(
    "/:id{[0-9]+}/reschedule",
    zValidator("json", recheduleBookingSchema),
    async (c) => {
      const id = parseInt(c.req.param("id"));
      const { startTime } = c.req.valid("json");

      const updatedBooking = await RescheduleBookingCommandHandler.execute({
        bookingId: id,
        currentUser: c.var.user!,
        startTime,
      });

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
    const result = await CancelBookingCommandHandler.execute({
      bookingId: id,
      currentUser: c.var.user!,
    });

    return c.json(result, 200);
  })
  .patch("/:id{[0-9]+}/cancel/refund", async (c) => {
    const id = parseInt(c.req.param("id"));
    const result = await RequestRefundCommandHandler.execute({
      bookingId: id,
      currentUser: c.var.user!,
    });

    return c.json(result, 200);
  })
  .patch("/:id{[0-9]+}/confirm", async (c) => {
    const id = parseInt(c.req.param("id"));
    const result = await ConfirmBookingCommandHandler.execute({
      bookingId: id,
      currentUser: c.var.user!,
    });

    return c.json(result, 200);
  })
  .patch(
    "/:id{[0-9]+}/recurring",
    zValidator("json", createRecurringBookingsSchema),
    async (c) => {
      const id = parseInt(c.req.param("id"));
      const { recurrencePattern, recurrenceEnd } = c.req.valid("json");

      const recurringBookings =
        await CreateRecurringBookingsCommandHandler.execute({
          parentBookingId: id,
          recurrencePattern,
          recurrenceEnd: new Date(recurrenceEnd),
          currentUser: c.var.user!,
        });

      return c.json(
        {
          message: "Recurring bookings created successfully",
          bookings: recurringBookings,
        },
        200
      );
    }
  );
