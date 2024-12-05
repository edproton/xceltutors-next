import { env } from "@/config";
import { Booking, BookingStatus, fakeDatabase } from "@/lib/mock";
import { stripe } from "@/lib/stripe";
import { Context, Hono } from "hono";
import { Stripe } from "stripe";

// Constants and Types
enum WebhookEventType {
  PAYMENT_INTENT_SUCCEEDED = "payment_intent.succeeded",
  PAYMENT_INTENT_FAILED = "payment_intent.payment_failed",
  CHARGE_REFUNDED = "charge.refunded",
  REFUND_CREATED = "refund.created",
  REFUND_FAILED = "refund.failed",
}

interface PaymentInfo {
  paymentIntentId: string;
  chargeId: string | undefined;
  metadata?: Record<string, string>;
}

class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingError";
  }
}

// Repository functions
function getBooking(bookingId: number): Booking {
  const booking = fakeDatabase.find((booking) => booking.id === bookingId);
  if (!booking) {
    throw new BookingError(`Booking not found with ID: ${bookingId}`);
  }
  return booking;
}

function updateBookingStatus(
  bookingId: number,
  newStatus: BookingStatus,
  paymentInfo?: PaymentInfo
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

  const updateIndex = fakeDatabase.findIndex((b) => b.id === booking.id);
  fakeDatabase[updateIndex] = booking;
  return booking;
}

// Add this helper function at the top of the file
function updatePaymentMetadata(
  booking: Booking,
  metadata: Record<string, string>,
  sessionId: string
) {
  if (!booking.payment) {
    booking.payment = {
      sessionId,
      metadata: {},
    };
  }
  if (!booking.payment.metadata) {
    booking.payment.metadata = {};
  }
  booking.payment.metadata = {
    ...booking.payment.metadata,
    ...metadata,
  };
}

function getSessionId(
  paymentIntent: string | Stripe.PaymentIntent | null | undefined
): string {
  if (!paymentIntent) {
    throw new BookingError("Payment intent not found");
  }

  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }

  return paymentIntent.client_secret || "default-session";
}

class WebhookHandlers {
  static handlePaymentIntent(
    event: Stripe.PaymentIntent,
    newStatus: BookingStatus
  ): Booking {
    if (!event.metadata.bookingId) {
      throw new BookingError("Booking ID not found in payment intent metadata");
    }

    const bookingId = parseInt(event.metadata.bookingId);
    return updateBookingStatus(bookingId, newStatus, {
      paymentIntentId: event.id,
      chargeId: event.latest_charge?.toString(),
    });
  }

  static handleRefund(
    event: Stripe.Refund,
    newStatus: BookingStatus,
    expectedStatus?: BookingStatus
  ): Booking {
    if (!event.metadata?.bookingId) {
      throw new BookingError("Booking ID not found in refund metadata");
    }

    const bookingId = parseInt(event.metadata.bookingId);
    const booking = getBooking(bookingId);

    if (expectedStatus && booking.status !== expectedStatus) {
      throw new BookingError(
        `Invalid booking status. Expected: ${expectedStatus}, Got: ${booking.status}`
      );
    }

    // Handle failed refund
    if (event.status === "failed" && event.failure_reason) {
      console.error(`Refund failed: ${event.failure_reason}`);

      // Update the metadata for the failed refund reason
      updatePaymentMetadata(
        booking,
        { failure_reason: event.failure_reason },
        getSessionId(event.payment_intent)
      );
    }

    return updateBookingStatus(bookingId, newStatus);
  }

  static handleChargeRefund(event: Stripe.Charge): Booking {
    if (!event.metadata.bookingId) {
      throw new BookingError("Booking ID not found in charge metadata");
    }

    const bookingId = parseInt(event.metadata.bookingId);
    const booking = getBooking(bookingId);

    if (booking.status !== BookingStatus.SCHEDULED) {
      throw new BookingError("Booking not in scheduled state");
    }

    // Handle failed charge refund
    if (event.failure_message || event.failure_code) {
      // Ensure failure message or code is a string
      const failureMessage =
        event.failure_message ?? event.failure_code ?? "Unknown failure";

      console.error(`Charge refund failed: ${failureMessage}`);

      // Update the metadata for the failed charge refund reason
      updatePaymentMetadata(
        booking,
        { failure_reason: failureMessage },
        getSessionId(event.payment_intent)
      );
    }

    return updateBookingStatus(bookingId, BookingStatus.REFUNDED);
  }
}

// Webhook Handler
export async function webhook(c: Context): Promise<Response> {
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.text("Missing stripe signature", 400);
  }

  try {
    const body = await c.req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case WebhookEventType.PAYMENT_INTENT_SUCCEEDED:
        WebhookHandlers.handlePaymentIntent(
          event.data.object,
          BookingStatus.SCHEDULED
        );
        break;

      case WebhookEventType.PAYMENT_INTENT_FAILED:
        WebhookHandlers.handlePaymentIntent(
          event.data.object,
          BookingStatus.PAYMENT_FAILED
        );
        break;

      case WebhookEventType.CHARGE_REFUNDED:
        WebhookHandlers.handleChargeRefund(event.data.object);
        break;

      case WebhookEventType.REFUND_CREATED:
        WebhookHandlers.handleRefund(
          event.data.object,
          BookingStatus.AWAITING_REFUND,
          BookingStatus.AWAITING_REFUND
        );
        break;

      case WebhookEventType.REFUND_FAILED:
        WebhookHandlers.handleRefund(
          event.data.object,
          BookingStatus.REFUND_FAILED,
          BookingStatus.AWAITING_REFUND
        );
        break;
    }

    return c.text("Webhook processed successfully", 200);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Internal server error";
    console.error(`Webhook Error: ${errorMessage}`);
    return c.text(errorMessage, 400);
  }
}

export const paymentRoute = new Hono();
paymentRoute.post("/webhook", webhook);
