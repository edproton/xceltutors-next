import { env } from "@/config";
import Stripe from "stripe";
import { Booking } from "./mock";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
/**
 * Creates a Stripe checkout session for a booking and stores the session URL.
 *
 * @param bookingId - The ID of the booking.
 * @param amount - The amount to charge in the currency's smallest unit (e.g., cents for USD).
 * @returns The Stripe checkout session URL.
 */
export const createOrRegenerateStripeSessionForBooking = async (
  booking: Booking,
  amount: number
): Promise<{ sessionUrl: string }> => {
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
        return { sessionUrl: existingSession.url };
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
              description: `Booking with ${booking.hostUsername}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: booking.participantsUsernames[0] + "@example.com",
      customer_creation: "if_required",
      success_url: `${env.FRONTEND_URL}/bookings?session_id={CHECKOUT_SESSION_ID}&bookingId=${booking.id}`,
      cancel_url: `${env.FRONTEND_URL}/bookings?bookingId=${booking.id}`,
    });

    if (!stripeSession.url) {
      throw new Error("Failed to create Stripe checkout session");
    }

    return { sessionUrl: stripeSession.url };
  } catch (error) {
    console.error("Error creating or regenerating Stripe session:", error);
    throw new Error("Failed to create Stripe checkout session");
  }
};
