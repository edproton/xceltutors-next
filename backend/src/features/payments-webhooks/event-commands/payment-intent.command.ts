import { prisma } from "@/lib/prisma";
import { Booking, BookingStatus } from "@prisma/client";
import { BookingValidationError } from "@/features/errors";
import Stripe from "stripe";

export interface HandlePaymentIntentCommand {
  event: Stripe.PaymentIntent;
  newStatus: BookingStatus;
}

export class HandlePaymentIntentCommandHandler {
  static async execute(command: HandlePaymentIntentCommand): Promise<Booking> {
    if (!command.event.metadata.bookingId) {
      throw new BookingValidationError(
        "INVALID_METADATA",
        "Booking ID not found in payment intent metadata"
      );
    }

    const bookingId = parseInt(command.event.metadata.bookingId);

    return await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: command.newStatus,
        payment: {
          update: {
            paymentIntentId: command.event.id,
            chargeId: command.event.latest_charge?.toString(),
          },
        },
      },
      include: {
        host: true,
        participants: true,
        payment: true,
      },
    });
  }
}
