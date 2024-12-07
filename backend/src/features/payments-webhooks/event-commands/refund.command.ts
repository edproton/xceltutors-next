import { prisma } from "@/lib/prisma";
import { Booking, BookingStatus, Prisma } from "@prisma/client";
import { BookingValidationError } from "@/features/errors";
import Stripe from "stripe";

export interface HandleRefundCommand {
  event: Stripe.Refund;
  newStatus: BookingStatus;
  expectedStatus?: BookingStatus;
}

export class HandleRefundCommandHandler {
  static async execute(command: HandleRefundCommand): Promise<Booking> {
    if (!command.event.metadata?.bookingId) {
      throw new BookingValidationError(
        "INVALID_METADATA",
        "Booking ID not found in refund metadata"
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

    if (command.expectedStatus && booking.status !== command.expectedStatus) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        `Invalid booking status. Expected: ${command.expectedStatus}, Got: ${booking.status}`
      );
    }

    const updateData: Prisma.BookingUpdateInput = {
      status: command.newStatus,
    };

    if (command.event.status === "failed" && command.event.failure_reason) {
      updateData.payment = {
        update: {
          metadata: {
            failure_reason: command.event.failure_reason,
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
