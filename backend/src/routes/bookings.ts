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
    required_error: "Week day is required",
    invalid_type_error: "Invalid week day",
  }),
  startTime: z
    .string()
    .regex(
      /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/,
      "Invalid time format. Must be HH:mm"
    )
    .refine((time) => {
      const [hours, minutes] = time.split(":").map(Number);
      return minutes % 15 === 0;
    }, "Time must be in 15-minute intervals")
    .refine((time) => {
      const [hours, minutes] = time.split(":").map(Number);
      return !(hours === 23 && minutes > 0);
    }, "Cannot schedule a 1-hour lesson starting after 23:00"),
});

const overrideSchema = z.object({
  conflictTime: z.string().datetime({
    message: "Invalid conflictTime. Must be ISO 8601 format.",
  }),
  newStartTime: z.string().datetime({
    message: "Invalid newStartTime. Must be ISO 8601 format.",
  }),
});

export const createRecurringBookingsSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200, "Title too long"),
    description: z.string().max(1000, "Description too long").optional(),
    hostId: z.number().int().positive("Host ID is required"),
    recurrencePattern: z.nativeEnum(RecurrencePattern),
    timeSlots: z
      .array(timeSlotSchema)
      .min(1, "At least one time slot is required")
      .max(10, "Maximum 10 time slots allowed"),
    overrides: z.array(overrideSchema).optional(),
  })
  .refine((data) => {
    if (!data.overrides?.length) return true;

    // Ensure all override dates fall within the recurrence pattern
    const startDate = DateTime.now().setZone("UTC");
    const endDate = startDate.plus({ months: 1 });

    return data.overrides.every((override) => {
      const newDate = DateTime.fromISO(override.newStartTime);
      return newDate >= startDate && newDate <= endDate;
    });
  }, "Override dates must fall within the booking period");
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
    await ConfirmBookingCommandHandler.execute({
      bookingId: id,
      currentUser: c.var.user!,
    });

    return c.json({ message: "Booking confirmed" }, 200);
  })
  .post(
    "/recurring",
    zValidator("json", createRecurringBookingsSchema),
    async (c) => {
      const payload = c.req.valid("json");

      const response = await CreateRecurringBookingsCommandHandler.execute({
        ...payload,
        currentUser: c.var.user!,
      });

      if (response.recurringTemplateId === -1) {
        return c.json(
          {
            error: "Invalid recurrence pattern",
            conflicts: response.conflicts,
          },
          400
        );
      }

      return c.json(
        {
          message: "Recurring bookings created successfully",
          recurringTemplateId: response.recurringTemplateId,
        },
        201
      );
    }
  );
