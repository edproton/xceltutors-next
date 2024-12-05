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
      case "payment_intent.succeeded":
        hanndlePaymentIntent(event.data.object, BookingStatus.SCHEDULED);
        break;

      case "payment_intent.payment_failed":
        hanndlePaymentIntent(event.data.object, BookingStatus.PAYMENT_FAILED);
        break;

      case "charge.refunded":
        handleBookingRefundSucess(event.data.object);
        break;

      case "refund.created":
        handleBookingRefundCreated(event.data.object);
        break;
      case "refund.failed":
        handleBookingRefundFailed(event.data.object);
        break;

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

function getBooking(bookingId: number): Booking {
  const booking = fakeDatabase.find((booking) => booking.id === bookingId);
  if (!booking) {
    throw new Error("Booking not found");
  }

  return booking;
}

function updateBookingStatus(
  bookingId: number,
  newStatus: BookingStatus,
  paymentInfo?: {
    paymentIntentId: string;
    chargeId: string | undefined;
    metadata?: Record<string, string>;
  }
) {
  const booking = getBooking(bookingId);
  booking.status = newStatus;

  if (booking.payment && paymentInfo) {
    booking.payment = {
      ...booking.payment,
      paymentIntentId: paymentInfo.paymentIntentId,
      chargeId: paymentInfo.chargeId,
    };
  }

  const updateId = fakeDatabase.findIndex((b) => b.id === booking.id);
  fakeDatabase[updateId] = booking;
}

function handleBookingRefundSucess(event: Stripe.Charge) {
  if (!event.metadata.bookingId) {
    throw new Error("Booking ID not found in charge metadata");
  }

  const bookingId = parseInt(event.metadata.bookingId);
  const booking = getBooking(bookingId);
  if (booking.status !== BookingStatus.SCHEDULED) {
    throw new Error("Booking not in scheduled state");
  }

  updateBookingStatus(bookingId, BookingStatus.REFUNDED);
}

function handleBookingRefundFailed(event: Stripe.Refund) {
  if (!event.metadata || !event.metadata.bookingId) {
    throw new Error("Booking ID not found in refund metadata");
  }

  const bookingId = parseInt(event.metadata.bookingId);
  const booking = getBooking(bookingId);
  if (booking.status !== BookingStatus.AWAITING_REFUND) {
    throw new Error("Booking not in awaiting refund state");
  }

  updateBookingStatus(bookingId, BookingStatus.REFUND_FAILED);
}

function handleBookingRefundCreated(event: Stripe.Refund) {
  if (!event.metadata || !event.metadata.bookingId) {
    throw new Error("Booking ID not found in refund metadata");
  }

  const bookingId = parseInt(event.metadata.bookingId);
  const booking = getBooking(bookingId);
  if (booking.status !== BookingStatus.AWAITING_REFUND) {
    throw new Error("Booking not in awaiting refund state");
  }

  updateBookingStatus(bookingId, BookingStatus.AWAITING_REFUND);
}

function hanndlePaymentIntent(
  event: Stripe.PaymentIntent,
  newStatus: BookingStatus
): Booking {
  if (!event.metadata.bookingId) {
    throw new Error("Booking ID not found in payment intent metadata");
  }

  const bookingId = parseInt(event.metadata.bookingId);

  const booking = getBooking(bookingId);

  updateBookingStatus(bookingId, newStatus, {
    paymentIntentId: event.id,
    chargeId: event.latest_charge?.toString(),
  });

  const updateId = fakeDatabase.findIndex((b) => b.id === booking.id);
  fakeDatabase[updateId] = booking;

  return booking;
}

paymentRoute.post("/webhook", webhook);
