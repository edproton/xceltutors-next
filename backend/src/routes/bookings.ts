import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { CreateBookingCommandHandler } from "@/features/booking-create";
import {
  BookingSortField,
  GetBookingsCommandHandler,
  SortDirection,
} from "@/features/booking-get-all";
import { RescheduleBookingCommandHandler } from "@/features/booking-reschedule";
import { CancelBookingCommandHandler } from "@/features/booking-cancel";
import { RequestRefundCommandHandler } from "@/features/booking-refund";
import { ConfirmBookingCommandHandler } from "@/features/booking-confirm";
import { authMiddleware } from "@/middlewares/auth";
import { GetBookingByIdCommandHandler } from "@/features/booking-get-by-id";
import {
  BookingStatus,
  BookingType,
  RecurrencePattern,
  WeekDay,
} from "@prisma/client";
import { CreateRecurringBookingsCommandHandler } from "@/features/booking-recurring";
import { DateTime } from "luxon";

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
      .union([z.nativeEnum(BookingStatus), z.nativeEnum(BookingStatus).array()])
      .optional()
      .transform((value) => {
        if (!value) return undefined;
        return Array.isArray(value) ? value : [value];
      }),
    type: z.nativeEnum(BookingType).optional(),
    startDate: z
      .string()
      .datetime()
      .transform((date) => {
        const parsed = DateTime.fromISO(date);
        return parsed.isValid ? parsed.toISO() : undefined;
      })
      .optional(),
    endDate: z
      .string()
      .datetime()
      .transform((date) => {
        const parsed = DateTime.fromISO(date);
        return parsed.isValid ? parsed.toISO() : undefined;
      })
      .optional(),
    search: z.string().optional(),
    sortField: z.nativeEnum(BookingSortField).optional(),
    sortDirection: z.nativeEnum(SortDirection).optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        const start = DateTime.fromISO(data.startDate);
        const end = DateTime.fromISO(data.endDate);
        return start <= end;
      }
      return true;
    },
    {
      message: "Start date must be before or equal to end date",
      path: ["startDate"],
    }
  )
  .refine((data) => !data.sortField === !data.sortDirection, {
    message: "sortField and sortDirection must be provided together",
    path: ["sortField"],
  });

const recheduleBookingSchema = z.object({
  startTime: z
    .string()
    .datetime({ message: "Invalid startTime. Must be ISO 8601 format." })
    .refine(
      (date) => new Date(date) > new Date(),
      "Cannot reschedule to a past time"
    ),
});

const timeSlotSchema = z.object({
  weekDay: z.nativeEnum(WeekDay, {
    required_error: "Weekday is required",
    invalid_type_error: "Invalid weekday",
  }),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: "Start time must be in HH:mm format",
  }),
});

const createRecurringBookingsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  hostId: z.number().int().positive("Host ID is required"),
  startDate: z
    .string()
    .datetime({ message: "Invalid startDate. Must be ISO 8601 format." })
    .transform((date) => new Date(date))
    .refine((date) => {
      const now = DateTime.now().setZone("utc").startOf("day");
      const startDate = DateTime.fromJSDate(date).setZone("utc").startOf("day");
      return startDate >= now;
    }, "Start date must be today or in the future"),
  recurrencePattern: z.nativeEnum(RecurrencePattern, {
    required_error: "Recurrence pattern is required",
    invalid_type_error: "Invalid recurrence pattern",
  }),
  timeSlots: z
    .array(timeSlotSchema)
    .min(1, "At least one time slot is required")
    .max(10, "Maximum 10 time slots allowed"),
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
    const {
      page,
      limit,
      status,
      type,
      startDate,
      endDate,
      search,
      sortField,
      sortDirection,
    } = c.req.valid("query");

    const bookings = await GetBookingsCommandHandler.execute({
      currentUser: c.var.user!,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      filters: {
        status: status ? status : undefined,
        type,
        startDate,
        endDate,
        search,
      },
      sort:
        sortField && sortDirection
          ? {
              field: sortField,
              direction: sortDirection,
            }
          : undefined,
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
  .post(
    "/recurring",
    zValidator("json", createRecurringBookingsSchema),
    async (c) => {
      const payload = c.req.valid("json");

      const recurringBookings =
        await CreateRecurringBookingsCommandHandler.execute({
          ...payload,
          startDate: payload.startDate.toISOString(),
          currentUser: c.var.user!,
        });

      return c.json(
        {
          message: "Recurring bookings created successfully",
          bookings: recurringBookings,
        },
        201
      );
    }
  );
