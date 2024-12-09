import { prisma } from "@/lib/prisma";
import { BookingStatus, BookingType, Role, User } from "@prisma/client";
import { BookingValidationError } from "../errors";
import { DateTime } from "luxon";

export interface CreateBookingCommand {
  startTime: string; // ISO 8601 string
  currentUser: User;
  toUserId: number;
}

export class CreateBookingCommandHandler {
  private static readonly MAX_ADVANCE_BOOKING_MONTHS = 1;
  private static readonly FREE_MEETING_DURATION_MINUTES = 15;
  private static readonly LESSON_DURATION_MINUTES = 60;
  private static readonly VALID_ONGOING_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.SCHEDULED,
    BookingStatus.AWAITING_TUTOR_CONFIRMATION,
    BookingStatus.AWAITING_STUDENT_CONFIRMATION,
  ];
  private static readonly VALID_PREVIOUS_MEETING_STATUSES: BookingStatus[] = [
    BookingStatus.COMPLETED,
    BookingStatus.SCHEDULED,
  ];

  static async execute(command: CreateBookingCommand): Promise<{ id: number }> {
    const startDateTime = DateTime.fromISO(command.startTime, { zone: "utc" });
    if (!startDateTime.isValid) {
      throw new BookingValidationError(
        "INVALID_DATE",
        "Invalid date format. Please provide ISO 8601 UTC date"
      );
    }

    this.validateBookingTime(startDateTime);

    const isTutor = command.currentUser.roles.includes(Role.TUTOR);

    // Combine user validation, meeting history, and free meeting checks into a single query
    const [targetUser, existingBookings] = await prisma.$transaction([
      prisma.user.findUnique({
        where: {
          id: command.toUserId,
          NOT: {
            id: command.currentUser.id,
          },
        },
        select: {
          id: true,
          roles: true,
        },
      }),
      prisma.booking.findMany({
        where: {
          hostId: isTutor ? command.currentUser.id : command.toUserId,
          participants: {
            some: {
              id: isTutor ? command.toUserId : command.currentUser.id,
            },
          },
          OR: [
            { status: { in: this.VALID_PREVIOUS_MEETING_STATUSES } },
            {
              AND: [
                { type: BookingType.FREE_MEETING },
                { status: { in: this.VALID_ONGOING_BOOKING_STATUSES } },
              ],
            },
            {
              AND: [
                {
                  startTime: {
                    lt: this.calculateEndTime(
                      startDateTime,
                      BookingType.LESSON
                    ).toJSDate(),
                  },
                },
                { endTime: { gt: startDateTime.toJSDate() } },
                { status: { in: this.VALID_ONGOING_BOOKING_STATUSES } },
              ],
            },
          ],
        },
        select: {
          type: true,
          status: true,
          startTime: true,
          endTime: true,
        },
      }),
    ]);

    if (command.toUserId === command.currentUser.id) {
      throw new BookingValidationError(
        "YOURSELF_BOOKING",
        "You cannot book a meeting with yourself"
      );
    }

    if (!targetUser) {
      throw new BookingValidationError(
        "USER_NOT_FOUND",
        "Target user not found"
      );
    }

    if (isTutor && targetUser.roles.includes(Role.TUTOR)) {
      throw new BookingValidationError(
        "INVALID_BOOKING_COMBINATION",
        "Tutors cannot book sessions with other tutors"
      );
    }

    const tutorId = isTutor ? command.currentUser.id : command.toUserId;
    const studentId = isTutor ? command.toUserId : command.currentUser.id;

    const hasConflict = existingBookings.some(
      (booking) =>
        booking.startTime <
          this.calculateEndTime(startDateTime, BookingType.LESSON).toJSDate() &&
        booking.endTime > startDateTime.toJSDate()
    );

    if (hasConflict) {
      throw new BookingValidationError(
        "BOOKING_CONFLICT",
        "Cannot book at this time - there is an existing booking"
      );
    }

    const hasOngoingFreeMeeting = existingBookings.some(
      (booking) =>
        booking.type === BookingType.FREE_MEETING &&
        this.VALID_ONGOING_BOOKING_STATUSES.includes(booking.status)
    );
    if (hasOngoingFreeMeeting) {
      throw new BookingValidationError(
        "ONGOING_FREE_MEETING",
        "Cannot book new meetings while there is an ongoing free meeting"
      );
    }

    if (isTutor) {
      const hasPreviousMeeting = existingBookings.some((booking) =>
        this.VALID_PREVIOUS_MEETING_STATUSES.includes(booking.status)
      );
      if (!hasPreviousMeeting) {
        throw new BookingValidationError(
          "NO_PREVIOUS_MEETING",
          "Tutors cannot book meetings with students they haven't met before"
        );
      }
    }

    const hasCompletedFreeMeeting = existingBookings.some(
      (booking) =>
        booking.type === BookingType.FREE_MEETING &&
        booking.status === BookingStatus.COMPLETED
    );
    const bookingType = hasCompletedFreeMeeting
      ? BookingType.LESSON
      : BookingType.FREE_MEETING;

    if (bookingType === BookingType.FREE_MEETING && isTutor) {
      throw new BookingValidationError(
        "FREE_MEETING_TUTOR",
        "Tutors cannot book free meetings"
      );
    }

    const endDateTime = this.calculateEndTime(startDateTime, bookingType);
    const initialStatus = isTutor
      ? BookingStatus.AWAITING_STUDENT_CONFIRMATION
      : BookingStatus.AWAITING_TUTOR_CONFIRMATION;

    const booking = await prisma.booking.create({
      data: {
        startTime: startDateTime.toJSDate(),
        endTime: endDateTime.toJSDate(),
        title: `Booking ${startDateTime.toFormat("yyyy-MM-dd HH:mm")}`,
        hostId: tutorId,
        serviceId: 1,
        participants: {
          connect: {
            id: studentId,
          },
        },
        type: bookingType,
        status: initialStatus,
      },
      select: {
        id: true,
      },
    });

    return booking;
  }

  private static validateBookingTime(startDateTime: DateTime): void {
    const now = DateTime.utc();
    if (startDateTime < now) {
      throw new BookingValidationError(
        "PAST_BOOKING",
        "Cannot book a meeting in the past"
      );
    }

    const maxBookingDate = now.plus({
      months: this.MAX_ADVANCE_BOOKING_MONTHS,
    });

    if (startDateTime > maxBookingDate) {
      throw new BookingValidationError(
        "ADVANCE_BOOKING_LIMIT",
        `Cannot book a meeting more than ${this.MAX_ADVANCE_BOOKING_MONTHS} month in advance`
      );
    }
  }

  private static calculateEndTime(
    startDateTime: DateTime,
    type: BookingType
  ): DateTime {
    const durationMinutes =
      type === BookingType.FREE_MEETING
        ? this.FREE_MEETING_DURATION_MINUTES
        : this.LESSON_DURATION_MINUTES;

    return startDateTime.plus({ minutes: durationMinutes });
  }
}
