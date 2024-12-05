import { env } from "@/config";
import { Booking, BookingStatus, fakeDatabase } from "@/lib/mock";
import { stripe } from "@/lib/stripe";
import { Context, Hono } from "hono";
import { Stripe } from "stripe";

export const paymentRoute = new Hono();

export async function webhook(c: Context): Promise<Response> {
  const signature = c.req.header("stripe-signature");
  try {
    if (!signature) {
      return c.text("", 400);
    }
    const body = await c.req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case "payment_intent.succeeded": {
        const bookingId = parseInt(event.data.object.metadata.bookingId);
        if (!bookingId) {
          throw new Error("Booking ID not found in payment intent metadata");
        }

        const booking = fakeDatabase.find(
          (booking) => booking.id === bookingId
        );
        if (!booking) {
          throw new Error("Booking not found");
        }

        booking.status = BookingStatus.SCHEDULED;
        const updateId = fakeDatabase.findIndex((b) => b.id === booking.id);
        fakeDatabase[updateId] = booking;

        break;
      }

      case "payment_intent.payment_failed": {
        const booking = getBookingIdFromEvent(event.data.object);
        booking.status = BookingStatus.PAYMENT_FAILED;

        const updateId = fakeDatabase.findIndex((b) => b.id === booking.id);
        fakeDatabase[updateId] = booking;

        break;
      }

      case "checkout.session.completed": {
        console.log(event.data.object);
        break;
      }

      default:
        break;
    }
    return c.text("", 200);
  } catch (err) {
    const errorMessage = `⚠️  Webhook signature verification failed. ${
      err instanceof Error ? err.message : "Internal server error"
    }`;
    console.log(errorMessage);
    return c.text(errorMessage, 400);
  }
}

function getBookingIdFromEvent(event: Stripe.PaymentIntent): Booking {
  const bookingId = parseInt(event.metadata.bookingId);
  if (!bookingId) {
    throw new Error("Booking ID not found in payment intent metadata");
  }

  const booking = fakeDatabase.find((booking) => booking.id === bookingId);
  if (!booking) {
    throw new Error("Booking not found");
  }

  return booking;
}

paymentRoute.post("/webhook", webhook);
