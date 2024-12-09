import { prisma } from "@/lib/prisma";
import { Booking, BookingStatus, BookingType, User } from "@prisma/client";
import { BookingValidationError } from "../errors";
import { createOrRegenerateStripeSessionForBooking } from "@/lib/stripe";

export interface ConfirmBookingCommand {
  bookingId: number;
  currentUser: User;
}

export class ConfirmBookingCommandHandler {
  private static readonly VALID_STATUSES_FOR_CONFIRMATION: BookingStatus[] = [
    BookingStatus.AWAITING_TUTOR_CONFIRMATION,
    BookingStatus.AWAITING_STUDENT_CONFIRMATION,
  ];

  static async execute(command: ConfirmBookingCommand): Promise<void> {
    const booking = await prisma.booking.findUnique({
      where: { id: command.bookingId },
      select: {
        id: true,
        status: true,
        type: true,
        hostId: true,
        participants: {
          select: {
            id: true,
          },
        },
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
      const paymentData = await this.processPayment(booking.id);
      await this.updateBookingWithPayment(booking.id, newStatus, paymentData);
      return;
    }

    await this.updateBooking(booking.id, newStatus);
  }

  private static async validateUserAuthorization(
    currentUser: User,
    booking: {
      hostId: number;
      participants: { id: number }[];
    }
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

  private static async validateBookingStatus(booking: {
    status: BookingStatus;
  }): Promise<void> {
    if (!this.VALID_STATUSES_FOR_CONFIRMATION.includes(booking.status)) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        `The booking status is ${booking.status}. It cannot be confirmed.`
      );
    }
  }

  private static determineNewStatus(booking: {
    type: BookingType;
  }): BookingStatus {
    return booking.type === BookingType.FREE_MEETING
      ? BookingStatus.SCHEDULED
      : BookingStatus.AWAITING_PAYMENT;
  }

  private static async processPayment(bookingId: number) {
    try {
      // Get minimal booking data required for payment processing
      const bookingForPayment = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          title: true,
          type: true,
          startTime: true,
          endTime: true,
          host: {
            select: { name: true },
          },
          participants: {
            select: {
              id: true,
              name: true,
            },
          },
          payment: {
            select: {
              sessionId: true,
            },
          },
        },
      });

      if (!bookingForPayment) {
        throw new Error("Booking not found");
      }

      return await createOrRegenerateStripeSessionForBooking(bookingForPayment);
    } catch (error) {
      throw new BookingValidationError(
        "PAYMENT_SESSION_CREATION_FAILED",
        "Failed to create payment session for the booking"
      );
    }
  }

  private static async updateBookingWithPayment(
    bookingId: number,
    newStatus: BookingStatus,
    paymentData: { sessionId: string; sessionUrl: string }
  ): Promise<void> {
    await prisma.booking.update({
      where: { id: bookingId },
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
    });
  }

  private static async updateBooking(
    bookingId: number,
    newStatus: BookingStatus
  ): Promise<void> {
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: newStatus,
      },
    });
  }
}
