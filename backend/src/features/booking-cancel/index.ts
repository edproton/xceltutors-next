import { prisma } from "@/lib/prisma";
import { Booking, BookingStatus, Prisma, User } from "@prisma/client";
import { BookingValidationError } from "../errors";
import { cancelStripePaymentIntent } from "@/lib/stripe";

type BookingWithParticipantsAndPayment = Prisma.BookingGetPayload<{
  include: { participants: true; payment: true };
}>;

export interface CancelBookingCommand {
  bookingId: number;
  currentUser: User;
}

export class CancelBookingCommandHandler {
  private static readonly VALID_STATUSES_FOR_CANCELLATION: BookingStatus[] = [
    BookingStatus.AWAITING_TUTOR_CONFIRMATION,
    BookingStatus.AWAITING_STUDENT_CONFIRMATION,
    BookingStatus.SCHEDULED,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.PAYMENT_FAILED,
  ];

  static async execute(command: CancelBookingCommand): Promise<Booking> {
    const booking = await prisma.booking.findUnique({
      where: { id: command.bookingId },
      include: {
        host: true,
        participants: true,
        payment: true,
      },
    });

    if (!booking) {
      throw new BookingValidationError(
        "BOOKING_NOT_FOUND",
        "Booking not found"
      );
    }

    await this.validateUserAuthorization(command.currentUser, booking);
    await this.validateBookingStatus(booking);

    if (booking.status === BookingStatus.AWAITING_PAYMENT) {
      await this.validateAndCancelPayment(booking);
    }

    return await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELED,
      },
      include: {
        host: true,
        participants: true,
        payment: true,
      },
    });
  }

  private static async validateUserAuthorization(
    currentUser: User,
    booking: BookingWithParticipantsAndPayment
  ): Promise<void> {
    const isHost = booking.hostId === currentUser.id;
    const isParticipant = booking.participants.some(
      (p) => p.id === currentUser.id
    );

    if (!isHost && !isParticipant) {
      throw new BookingValidationError(
        "UNAUTHORIZED",
        "User not authorized to cancel this booking"
      );
    }
  }

  private static async validateBookingStatus(
    booking: BookingWithParticipantsAndPayment
  ): Promise<void> {
    if (!this.VALID_STATUSES_FOR_CANCELLATION.includes(booking.status)) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        `The booking status is ${booking.status}. It cannot be canceled.`
      );
    }
  }

  private static async validateAndCancelPayment(
    booking: BookingWithParticipantsAndPayment
  ): Promise<void> {
    if (!booking.payment) {
      throw new BookingValidationError(
        "NO_PAYMENT_INFO",
        "Booking has no payment information"
      );
    }

    try {
      await cancelStripePaymentIntent(booking);
    } catch (error) {
      throw new BookingValidationError(
        "PAYMENT_CANCELLATION_FAILED",
        "Failed to cancel the payment for this booking"
      );
    }
  }
}
