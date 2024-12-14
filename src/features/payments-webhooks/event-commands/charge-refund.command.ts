import { prisma } from "@/lib/prisma";
import { Booking, BookingStatus, Prisma } from "@prisma/client";
import { BookingValidationError } from "@/features/errors";
import Stripe from "stripe";

export interface HandleChargeRefundCommand {
  event: Stripe.Charge;
}
export class HandleChargeRefundCommandHandler {
  static async execute(command: HandleChargeRefundCommand): Promise<Booking> {
    if (!command.event.metadata.bookingId) {
      throw new BookingValidationError(
        "INVALID_METADATA",
        "Booking ID not found in charge metadata"
      );
    }

    const bookingId = parseInt(command.event.metadata.bookingId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });

    if (!booking) {
      throw new BookingValidationError(
        "BOOKING_NOT_FOUND",
        "Booking not found"
      );
    }

    if (booking.status !== BookingStatus.AWAITING_REFUND) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        "Booking not in awaiting refund state"
      );
    }

    const updateData: Prisma.BookingUpdateInput = {
      status: BookingStatus.REFUNDED,
    };

    if (command.event.failure_message || command.event.failure_code) {
      const failureMessage =
        command.event.failure_message ??
        command.event.failure_code ??
        "Unknown failure";

      updateData.payment = {
        update: {
          metadata: {
            failure_reason: failureMessage,
          },
        },
      };
    }

    return await prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: {
        host: true,
        participants: true,
        payment: true,
      },
    });
  }
}
