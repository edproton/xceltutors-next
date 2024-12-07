import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  BookingType,
  Prisma,
  User,
} from "@prisma/client";
import { BookingValidationError } from "../errors";
import { createOrRegenerateStripeSessionForBooking } from "@/lib/stripe";

type BookingWithParticipantsAndPayment = Prisma.BookingGetPayload<{
  include: { participants: true; payment: true; host: true };
}>;

export interface ConfirmBookingCommand {
  bookingId: number;
  currentUser: User;
}

export class ConfirmBookingCommandHandler {
  private static readonly VALID_STATUSES_FOR_CONFIRMATION: BookingStatus[] = [
    BookingStatus.AWAITING_TUTOR_CONFIRMATION,
    BookingStatus.AWAITING_STUDENT_CONFIRMATION,
  ];

  static async execute(command: ConfirmBookingCommand): Promise<Booking> {
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

    const newStatus = this.determineNewStatus(booking);

    if (booking.type === BookingType.LESSON) {
      const paymentData = await this.processPayment(booking);
      return await this.updateBookingWithPayment(
        booking,
        newStatus,
        paymentData
      );
    }

    return await this.updateBooking(booking, newStatus);
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
        "User not authorized to confirm this booking"
      );
    }
  }

  private static async validateBookingStatus(
    booking: BookingWithParticipantsAndPayment
  ): Promise<void> {
    if (!this.VALID_STATUSES_FOR_CONFIRMATION.includes(booking.status)) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        `The booking status is ${booking.status}. It cannot be confirmed.`
      );
    }
  }

  private static determineNewStatus(
    booking: BookingWithParticipantsAndPayment
  ): BookingStatus {
    return booking.type === BookingType.FREE_MEETING
      ? BookingStatus.SCHEDULED
      : BookingStatus.AWAITING_PAYMENT;
  }

  private static async processPayment(
    booking: BookingWithParticipantsAndPayment
  ) {
    try {
      return await createOrRegenerateStripeSessionForBooking(booking);
    } catch (error) {
      throw new BookingValidationError(
        "PAYMENT_SESSION_CREATION_FAILED",
        "Failed to create payment session for the booking"
      );
    }
  }

  private static async updateBookingWithPayment(
    booking: BookingWithParticipantsAndPayment,
    newStatus: BookingStatus,
    paymentData: { sessionId: string; sessionUrl: string }
  ): Promise<Booking> {
    return await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: newStatus,
        payment: {
          upsert: {
            create: {
              sessionId: paymentData.sessionId,
              sessionUrl: paymentData.sessionUrl,
            },
            update: {
              sessionId: paymentData.sessionId,
              sessionUrl: paymentData.sessionUrl,
            },
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

  private static async updateBooking(
    booking: BookingWithParticipantsAndPayment,
    newStatus: BookingStatus
  ): Promise<Booking> {
    return await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: newStatus,
      },
      include: {
        host: true,
        participants: true,
        payment: true,
      },
    });
  }
}
