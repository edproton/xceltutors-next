import { env } from "@/config";
import { Booking } from "@/lib/mock";
import Stripe from "stripe";

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY);
  }

  /**
   * Creates a Stripe checkout session for a booking and stores the session URL.
   *
   * @param booking - The booking object.
   * @returns The Stripe checkout session URL and session ID.
   */
  public async createOrRegenerateStripeSessionForBooking(
    booking: Booking
  ): Promise<{ sessionUrl: string; sessionId: string }> {
    const amount = 10;
    try {
      if (!booking) {
        throw new Error("Booking not found");
      }

      if (booking.type !== "LESSON") {
        throw new Error(
          "Stripe session is only applicable for lesson bookings."
        );
      }

      if (!amount || amount <= 0) {
        throw new Error("Invalid payment amount");
      }

      // Check if a session already exists
      if (booking.payment?.sessionId) {
        const existingSession = await this.stripe.checkout.sessions.retrieve(
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
      const stripeSession = await this.stripe.checkout.sessions.create({
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
        metadata: {
          bookingId: booking.id,
        },
        customer_email: booking.participantsUsernames[0] + "@example.com",
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
  }

  /**
   * Processes a refund for a booking.
   *
   * @param booking - The booking object.
   */
  public async createStripeRefund(booking: Booking): Promise<void> {
    try {
      if (!booking) {
        throw new Error("Booking not found");
      }

      if (!booking.payment?.chargeId) {
        throw new Error("No charge ID found for booking");
      }

      const refund = await this.stripe.refunds.create({
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
  }

  /**
   * Cancels a Stripe payment intent.
   *
   * @param booking - The booking object.
   */
  public async cancelStripePaymentIntent(booking: Booking): Promise<void> {
    try {
      if (!booking) {
        throw new Error("Booking not found");
      }

      if (!booking.payment?.sessionId) {
        throw new Error("No session ID found for booking");
      }

      const paymentIntent = await this.stripe.checkout.sessions.expire(
        booking.payment.sessionId
      );

      if (!paymentIntent) {
        throw new Error("Failed to cancel payment intent");
      }
    } catch (error) {
      console.error("Error cancelling Stripe payment intent:", error);
      throw new Error("Failed to cancel payment intent");
    }
  }
}
