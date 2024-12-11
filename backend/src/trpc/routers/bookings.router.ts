// backend/src/trpc/routers/bookings.router.ts
import { getBookingsSchema } from "@/features/bookings/bookings-get-all/schema";
import { privateProcedure, router } from "..";
import { GetBookingsCommandHandler } from "@/features/bookings/bookings-get-all";

export const bookingRouter = router({
  getBookings: privateProcedure
    .input(getBookingsSchema)
    .query(async ({ input, ctx }) => {
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
      } = input;

      const bookings = await GetBookingsCommandHandler.execute({
        currentUser: ctx.user!,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        filters: {
          status: status ?? undefined,
          type,
          startDate,
          endDate,
          search,
        },
        sort: sortField && sortDirection
          ? {
            field: sortField,
            direction: sortDirection,
          }
          : undefined,
      });

      return bookings;
    }),
});
