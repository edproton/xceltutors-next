import { BookingRepository } from "@/repositories/bookingRepository";
import { WebhookHandlers } from "@/routes/payments";
import { BookingService } from "@/services/bookingService";
import { StripeService } from "@/services/stripeService";
import { createMiddleware } from "hono/factory";

export const diMiddleware = createMiddleware(async (c, next) => {
  const bookingRepository = new BookingRepository();
  const stripeService = new StripeService();
  const bookingService = new BookingService(bookingRepository, stripeService);
  const webhookHandlers = new WebhookHandlers(bookingService);

  c.set("bookingRepository", bookingRepository);
  c.set("bookingService", bookingService);
  c.set("stripeService", stripeService);
  c.set("webhookHandlers", webhookHandlers);

  await next();
});
