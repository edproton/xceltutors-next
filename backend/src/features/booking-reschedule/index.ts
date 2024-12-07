import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  BookingType,
  Prisma,
  Role,
  User,
} from "@prisma/client";
import { BookingValidationError } from "../errors";

export interface RescheduleBookingCommand {
  bookingId: number;
  startTime: string;
  currentUser: User;
}

type BookingWithParticipants = Prisma.BookingGetPayload<{
  include: { participants: true };
}>;

export class RescheduleBookingCommandHandler {
  private static readonly FREE_MEETING_DURATION_MINUTES = 15;
  private static readonly LESSON_DURATION_MINUTES = 60;

  static async execute(command: RescheduleBookingCommand): Promise<Booking> {
    const booking = await this.getAndValidateBooking(command.bookingId);
    await this.validateUserPermissions(booking, command.currentUser);
    await this.validateNewStartTime(command.startTime);

    const newEndTime = this.calculateNewEndTime(
      command.startTime,
      booking.type
    );

    await this.validateNoConflicts(
      booking.hostId,
      new Date(command.startTime),
      newEndTime,
      booking.id
    );

    return await prisma.booking.update({
      where: { id: command.bookingId },
      data: {
        startTime: new Date(command.startTime),
        endTime: newEndTime,
        status: this.determineNewStatus(booking, command.currentUser),
      },
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
      },
    });
  }

  private static async getAndValidateBooking(
    bookingId: number
  ): Promise<BookingWithParticipants> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        participants: true,
      },
    });

    if (!booking) {
      throw new BookingValidationError(
        "BOOKING_NOT_FOUND",
        "Booking not found"
      );
    }

    return booking;
  }

  private static async validateUserPermissions(
    booking: BookingWithParticipants,
    currentUser: User
  ): Promise<void> {
    const isTutor =
      booking.hostId === currentUser.id &&
      currentUser.roles.includes(Role.TUTOR);

    const isStudent =
      currentUser.roles.includes(Role.STUDENT) &&
      booking.participants.some((p) => p.id === currentUser.id);

    if (!isTutor && !isStudent) {
      throw new BookingValidationError(
        "UNAUTHORIZED",
        "User not authorized to reschedule this booking"
      );
    }

    if (
      isTutor &&
      booking.status !== BookingStatus.AWAITING_TUTOR_CONFIRMATION
    ) {
      throw new BookingValidationError(
        "INVALID_STATUS_TUTOR",
        `Only bookings in ${BookingStatus.AWAITING_TUTOR_CONFIRMATION} can be rescheduled by the tutor`
      );
    }

    if (
      isStudent &&
      booking.status !== BookingStatus.AWAITING_STUDENT_CONFIRMATION
    ) {
      throw new BookingValidationError(
        "INVALID_STATUS_STUDENT",
        `Only bookings in ${BookingStatus.AWAITING_STUDENT_CONFIRMATION} can be rescheduled by the student`
      );
    }
  }

  private static async validateNewStartTime(startTime: string): Promise<void> {
    const newStartTime = new Date(startTime);
    const now = new Date();

    if (newStartTime <= now) {
      throw new BookingValidationError(
        "PAST_TIME",
        "Cannot reschedule to a past time"
      );
    }
  }

  private static calculateNewEndTime(
    startTime: string,
    type: BookingType
  ): Date {
    const endTime = new Date(startTime);
    const durationMinutes =
      type === BookingType.FREE_MEETING
        ? this.FREE_MEETING_DURATION_MINUTES
        : this.LESSON_DURATION_MINUTES;

    endTime.setMinutes(endTime.getMinutes() + durationMinutes);
    return endTime;
  }

  private static async validateNoConflicts(
    hostId: number,
    startTime: Date,
    endTime: Date,
    currentBookingId: number
  ): Promise<void> {
    const hasConflict = await prisma.booking.findFirst({
      where: {
        id: { not: currentBookingId }, // Exclude current booking
        hostId: hostId,
        AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        status: {
          in: [
            BookingStatus.SCHEDULED,
            BookingStatus.AWAITING_TUTOR_CONFIRMATION,
            BookingStatus.AWAITING_STUDENT_CONFIRMATION,
          ],
        },
      },
    });

    if (hasConflict) {
      throw new BookingValidationError(
        "BOOKING_CONFLICT",
        "Another booking already exists at this time"
      );
    }
  }

  private static determineNewStatus(
    booking: Booking,
    currentUser: User
  ): BookingStatus {
    const isTutor = booking.hostId === currentUser.id;
    return isTutor
      ? BookingStatus.AWAITING_STUDENT_CONFIRMATION
      : BookingStatus.AWAITING_TUTOR_CONFIRMATION;
  }
}
