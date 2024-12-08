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
import { DateTime } from "luxon";

export interface RescheduleBookingCommand {
  bookingId: number;
  startTime: string; // ISO 8601 UTC string
  currentUser: User;
}

type BookingWithParticipants = Prisma.BookingGetPayload<{
  include: { participants: true };
}>;

export class RescheduleBookingCommandHandler {
  private static readonly FREE_MEETING_DURATION_MINUTES = 15;
  private static readonly LESSON_DURATION_MINUTES = 60;

  /**
   * Reschedules an existing booking to a new time
   */
  static async execute(command: RescheduleBookingCommand): Promise<Booking> {
    // 1. Get booking first
    const booking = await this.getBookingById(command.bookingId);

    // 2. Validate permissions and status immediately
    await this.validateUserPermissions(booking, command.currentUser);

    // 3. Only then validate and process the new time
    const newStartTime = this.parseAndValidateDateTime(
      command.startTime,
      booking
    );
    const newEndTime = this.calculateEndTime(newStartTime, booking.type);

    // 4. Check for conflicts
    await this.validateNoTimeConflicts(
      booking.hostId,
      newStartTime,
      newEndTime,
      booking.id
    );

    // 5. Update the booking
    return await this.updateBooking(
      booking,
      command.currentUser,
      newStartTime,
      newEndTime
    );
  }

  private static parseAndValidateDateTime(
    dateTimeStr: string,
    currentBooking: BookingWithParticipants
  ): DateTime {
    const newDateTime = DateTime.fromISO(dateTimeStr, { zone: "utc" });
    const currentStartTime = DateTime.fromJSDate(currentBooking.startTime, {
      zone: "utc",
    });

    if (!newDateTime.isValid) {
      throw new BookingValidationError(
        "INVALID_DATE",
        "Invalid date format. Please provide ISO 8601 UTC date"
      );
    }

    const now = DateTime.utc();
    if (newDateTime <= now) {
      throw new BookingValidationError(
        "PAST_TIME",
        "Cannot reschedule to a past time"
      );
    }

    // Check if the new time is the same as current time
    if (newDateTime.equals(currentStartTime)) {
      throw new BookingValidationError(
        "SAME_TIME",
        "New booking time must be different from the current time"
      );
    }

    return newDateTime;
  }

  private static async getBookingById(
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
    const userRoles = this.getUserRoles(booking, currentUser);

    if (!userRoles.isParticipant) {
      throw new BookingValidationError(
        "UNAUTHORIZED",
        "User not authorized to reschedule this booking"
      );
    }

    // Block rescheduling for some statuses
    const nonReschedulableStatuses: BookingStatus[] = [
      BookingStatus.COMPLETED,
      BookingStatus.CANCELED,
      BookingStatus.AWAITING_REFUND,
      BookingStatus.REFUND_FAILED,
      BookingStatus.REFUNDED,
    ];

    if (nonReschedulableStatuses.includes(booking.status)) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        `Booking cannot be rescheduled when status is ${booking.status}.`
      );
    }

    // Tutor's turn validation
    if (
      userRoles.isTutor &&
      booking.status !== BookingStatus.AWAITING_TUTOR_CONFIRMATION
    ) {
      throw new BookingValidationError(
        "INVALID_STATUS_TUTOR",
        `Tutor can only reschedule when status is ${BookingStatus.AWAITING_TUTOR_CONFIRMATION}`
      );
    }

    // Student's turn validation
    if (
      userRoles.isStudent &&
      booking.status !== BookingStatus.AWAITING_STUDENT_CONFIRMATION
    ) {
      throw new BookingValidationError(
        "INVALID_STATUS_STUDENT",
        `Student can only reschedule when status is ${BookingStatus.AWAITING_STUDENT_CONFIRMATION}`
      );
    }
  }

  private static determineNewStatus(
    booking: Booking,
    currentUser: User
  ): BookingStatus {
    const isTutor = booking.hostId === currentUser.id;

    // When tutor reschedules, only student can respond next
    // When student reschedules, only tutor can respond next
    return isTutor
      ? BookingStatus.AWAITING_STUDENT_CONFIRMATION
      : BookingStatus.AWAITING_TUTOR_CONFIRMATION;
  }

  private static getUserRoles(booking: BookingWithParticipants, user: User) {
    const isTutor =
      booking.hostId === user.id && user.roles.includes(Role.TUTOR);
    const isStudent =
      user.roles.includes(Role.STUDENT) &&
      booking.participants.some((p) => p.id === user.id);

    return {
      isTutor,
      isStudent,
      isParticipant: isTutor || isStudent,
    };
  }

  private static validateStatusForRole(
    booking: BookingWithParticipants,
    userRoles: { isTutor: boolean; isStudent: boolean }
  ): void {
    if (
      userRoles.isTutor &&
      booking.status !== BookingStatus.AWAITING_TUTOR_CONFIRMATION
    ) {
      throw new BookingValidationError(
        "INVALID_STATUS_TUTOR",
        `Tutor can only reschedule bookings that are ${BookingStatus.SCHEDULED} or ${BookingStatus.AWAITING_TUTOR_CONFIRMATION}`
      );
    }

    if (
      userRoles.isStudent &&
      booking.status !== BookingStatus.AWAITING_STUDENT_CONFIRMATION
    ) {
      throw new BookingValidationError(
        "INVALID_STATUS_STUDENT",
        `Student can only reschedule bookings that are ${BookingStatus.SCHEDULED} or ${BookingStatus.AWAITING_STUDENT_CONFIRMATION}`
      );
    }
  }

  private static calculateEndTime(
    startTime: DateTime,
    type: BookingType
  ): DateTime {
    const durationMinutes =
      type === BookingType.FREE_MEETING
        ? this.FREE_MEETING_DURATION_MINUTES
        : this.LESSON_DURATION_MINUTES;

    return startTime.plus({ minutes: durationMinutes });
  }

  private static async validateNoTimeConflicts(
    hostId: number,
    startTime: DateTime,
    endTime: DateTime,
    currentBookingId: number
  ): Promise<void> {
    const hasConflict = await prisma.booking.findFirst({
      where: {
        id: { not: currentBookingId },
        hostId: hostId,
        AND: [
          { startTime: { lt: endTime.toJSDate() } },
          { endTime: { gt: startTime.toJSDate() } },
        ],
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

  private static async updateBooking(
    booking: Booking,
    currentUser: User,
    newStartTime: DateTime,
    newEndTime: DateTime
  ): Promise<Booking> {
    return await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startTime: newStartTime.toJSDate(),
        endTime: newEndTime.toJSDate(),
        status: this.determineNewStatus(booking, currentUser),
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
}
