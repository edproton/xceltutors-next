import { z } from "zod";
import { BookingStatus, BookingType } from "@prisma/client";
import { BookingSortField, SortDirection } from ".";

export const getBookingsSchema = z.object({
  page: z.coerce.number().positive().optional(),
  limit: z.coerce.number().positive().optional(),
  search: z.string().optional(),
  status: z.union([
    z.nativeEnum(BookingStatus),
    z.nativeEnum(BookingStatus).array(),
  ])
    .optional()
    .transform((val) => val ? (Array.isArray(val) ? val : [val]) : undefined),
  type: z.nativeEnum(BookingType).optional(),
  startDate: z.string()
    .transform((date) => {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    })
    .optional(),
  endDate: z.string()
    .transform((date) => {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    })
    .optional(),
  sortField: z.nativeEnum(BookingSortField).optional(),
  sortDirection: z.nativeEnum(SortDirection).optional(),
}).superRefine((data, ctx) => {
  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must be before or equal to end date",
        path: ["startDate"],
      });
    }
  }

  if (
    (data.sortField && !data.sortDirection) ||
    (!data.sortField && data.sortDirection)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sortField and sortDirection must be provided together",
      path: ["sortField"],
    });
  }
});
