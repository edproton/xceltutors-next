import { env } from "@/config";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);

type BookingWithPayment = Prisma.BookingGetPayload<{
  include: { payment: true };
}>;
/**
 * Creates a Stripe checkout session for a booking and stores the session URL.
 *
 * @param bookingId - The ID of the booking.
 * @param amount - The amount to charge in the currency's smallest unit (e.g., cents for USD).
 * @returns The Stripe checkout session URL.
 */
export const createOrRegenerateStripeSessionForBooking = async (
  booking: Prisma.BookingGetPayload<{
    select: {
      id: true;
      title: true;
      type: true;
      startTime: true;
      endTime: true;
      host: {
        select: { name: true };
      };
      participants: {
        select: {
          id: true;
          name: true;
        };
      };
      payment: {
        select: {
          sessionId: true;
        };
      };
    };
  }>
): Promise<{ sessionUrl: string; sessionId: string }> => {
  const amount = 10;
  try {
    if (!booking) {
      throw new Error("Booking not found");
    }

    if (booking.type !== "LESSON") {
      throw new Error("Stripe session is only applicable for lesson bookings.");
    }

    if (!amount || amount <= 0) {
      throw new Error("Invalid payment amount");
    }

    // Check if a session already exists
    if (booking.payment?.sessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        booking.payment.sessionId
      );

      if (
        existingSession &&
        existingSession.status !== "expired" &&
        existingSession.url
      ) {
        // Return the existing session if valid
        return {
          sessionUrl: existingSession.url,
          sessionId: existingSession.id,
        };
      }
    }

    // Create a new session if no valid session exists
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      payment_intent_data: {
        metadata: {
          bookingId: booking.id,
        },
      },
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Tutoring Session",
              description: `Booking with ${booking.host.name}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        bookingId: booking.id,
      },
      customer_email: booking.participants[0].name + "@example.com",
      customer_creation: "if_required",
      success_url: `${env.FRONTEND_URL}/bookings?session_id={CHECKOUT_SESSION_ID}&bookingId=${booking.id}`,
      cancel_url: `${env.FRONTEND_URL}/bookings?bookingId=${booking.id}`,
    });

    if (!stripeSession.url) {
      throw new Error("Failed to create Stripe checkout session");
    }

    return { sessionUrl: stripeSession.url, sessionId: stripeSession.id };
  } catch (error) {
    console.error("Error creating or regenerating Stripe session:", error);
    throw new Error("Failed to create Stripe checkout session");
  }
};

export const createStripeRefund = async (
  booking: BookingWithPayment
): Promise<void> => {
  try {
    if (!booking) {
      throw new Error("Booking not found");
    }

    if (!booking.payment?.chargeId) {
      throw new Error("No charge ID found for booking");
    }

    if (!booking.payment?.paymentIntentId) {
      throw new Error("No paymentIntentId found for booking");
    }

    const refund = await stripe.refunds.create({
      payment_intent: booking.payment.paymentIntentId,
      metadata: {
        bookingId: booking.id,
      },
    });

    if (!refund) {
      throw new Error("Failed to process refund");
    }
  } catch (error) {
    console.error("Error processing Stripe refund:", error);
    throw new Error("Failed to process refund");
  }
};

export const cancelStripePaymentIntent = async (
  booking: BookingWithPayment
): Promise<void> => {
  try {
    if (!booking) {
      throw new Error("Booking not found");
    }

    if (!booking.payment?.sessionId) {
      throw new Error("No session ID found for booking");
    }

    const paymentIntent = await stripe.checkout.sessions.expire(
      booking.payment.sessionId
    );

    if (!paymentIntent) {
      throw new Error("Failed to cancel payment intent");
    }
  } catch (error) {
    console.error("Error cancelling Stripe payment intent:", error);
    throw new Error("Failed to cancel payment intent");
  }
};
