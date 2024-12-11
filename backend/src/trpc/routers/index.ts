// backend/src/trpc/routers/index.ts
import { router } from "..";
import { authRouter } from "./auth.router";
import { bookingRouter } from "./bookings.router";

export const appRouter = router({
  bookings: bookingRouter,
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
