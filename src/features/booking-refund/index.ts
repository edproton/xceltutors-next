import { prisma } from "@/lib/prisma";
import { Booking, BookingStatus, Prisma, User } from "@prisma/client";
import { BookingValidationError } from "../errors";
import { createStripeRefund } from "@/lib/stripe";

type BookingWithPayment = Prisma.BookingGetPayload<{
  include: { payment: true };
}>;

export interface RequestRefundCommand {
  bookingId: number;
  currentUser: User;
}

export class RequestRefundCommandHandler {
  static async execute(command: RequestRefundCommand): Promise<Booking> {
    const booking = await prisma.booking.findUnique({
      where: { id: command.bookingId },
      include: {
        payment: true,
      },
    });

    if (!booking) {
      throw new BookingValidationError(
        "BOOKING_NOT_FOUND",
        "Booking not found"
      );
    }

    await this.validateBookingStatus(booking);
    await this.validatePaymentInformation(booking);
    await this.processRefund(booking);

    return await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.AWAITING_REFUND,
      },
      include: {
        host: true,
        participants: true,
        payment: true,
      },
    });
  }

  private static async validateBookingStatus(
    booking: BookingWithPayment
  ): Promise<void> {
    if (booking.status !== BookingStatus.SCHEDULED) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        `The booking status is ${booking.status}. Only ${BookingStatus.SCHEDULED} bookings can be refunded.`
      );
    }
  }

  private static async validatePaymentInformation(
    booking: BookingWithPayment
  ): Promise<void> {
    if (
      !booking.payment ||
      (!booking.payment.paymentIntentId && !booking.payment.paymentIntentId)
    ) {
      throw new BookingValidationError(
        "NO_PAYMENT_INFO",
        "Booking does not have valid payment information for refund"
      );
    }
  }

  private static async processRefund(
    booking: BookingWithPayment
  ): Promise<void> {
    try {
      await createStripeRefund(booking);
    } catch (error) {
      throw new BookingValidationError(
        "REFUND_PROCESSING_FAILED",
        "Failed to process the refund request"
      );
    }
  }
}
