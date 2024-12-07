import { prisma } from "@/lib/prisma";
import { Booking, User } from "@prisma/client";
import { BookingValidationError } from "../errors";

export interface GetBookingByIdCommand {
  bookingId: number;
  currentUser: User;
}

export class GetBookingByIdCommandHandler {
  static async execute(command: GetBookingByIdCommand): Promise<Booking> {
    const booking = await prisma.booking.findUnique({
      where: { id: command.bookingId },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        participants: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        payment: true,
      },
    });

    if (!booking) {
      throw new BookingValidationError(
        "BOOKING_NOT_FOUND",
        "Booking not found"
      );
    }

    // Verify that the current user is either the host or a participant
    const isHost = booking.hostId === command.currentUser.id;
    const isParticipant = booking.participants.some(
      (p) => p.id === command.currentUser.id
    );

    if (!isHost && !isParticipant) {
      throw new BookingValidationError(
        "UNAUTHORIZED",
        "User not authorized to view this booking"
      );
    }

    return booking;
  }
}
