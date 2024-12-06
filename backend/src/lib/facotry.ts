import { IBookingRepository } from "@/repositories/bookingRepository";
import { WebhookHandlers } from "@/routes/payments";
import { BookingService } from "@/services/bookingService";
import { StripeService } from "@/services/stripeService";
import { Hono } from "hono";

export type Env = {
  Variables: {
    bookingRepository: IBookingRepository;
    bookingService: BookingService;
    stripeService: StripeService;
    webhookHandlers: WebhookHandlers;
  };
};

export const h = new Hono<Env>();
