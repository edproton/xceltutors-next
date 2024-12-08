import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  BookingType,
  Role,
  User,
} from "@prisma/client";
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

  static async execute(command: CreateBookingCommand): Promise<Booking> {
    const startDateTime = DateTime.fromISO(command.startTime, { zone: "utc" });

    if (!startDateTime.isValid) {
      throw new BookingValidationError(
        "INVALID_DATE",
        "Invalid date format. Please provide ISO 8601 UTC date"
      );
    }

    await this.validateBookingTime(startDateTime);

    const isTutor = command.currentUser.roles.includes(Role.TUTOR);
    const toUser = await this.getAndValidateTargetUser(
      command.currentUser,
      command.toUserId
    );

    // Determine who is tutor and who is student
    const tutorId = isTutor ? command.currentUser.id : command.toUserId;
    const studentId = isTutor ? command.toUserId : command.currentUser.id;

    // Check for any ongoing free meetings before proceeding
    await this.validateNoOngoingFreeMeeting(tutorId, studentId);

    // Validate meeting history
    await this.validateMeetingHistory(isTutor, tutorId, studentId);

    // Determine booking type
    const bookingType = await this.determineBookingType(tutorId, studentId);

    if (bookingType === BookingType.FREE_MEETING && isTutor) {
      throw new BookingValidationError(
        "FREE_MEETING_TUTOR",
        "Tutors cannot book free meetings"
      );
    }

    const endDateTime = this.calculateEndTime(startDateTime, bookingType);
    await this.validateNoConflicts(tutorId, startDateTime, endDateTime);

    const studentName =
      command.currentUser.id === studentId
        ? command.currentUser.name
        : toUser.name;

    const initialStatus = isTutor
      ? BookingStatus.AWAITING_STUDENT_CONFIRMATION
      : BookingStatus.AWAITING_TUTOR_CONFIRMATION;

    return await prisma.booking.create({
      data: {
        startTime: startDateTime.toJSDate(),
        endTime: endDateTime.toJSDate(),
        title: `Meeting with ${studentName} | ${bookingType}`,
        hostId: tutorId,
        participants: {
          connect: {
            id: studentId,
          },
        },
        type: bookingType,
        status: initialStatus,
      },
    });
  }

  private static async validateBookingTime(
    startDateTime: DateTime
  ): Promise<void> {
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

  private static async getAndValidateTargetUser(
    currentUser: User,
    targetUserId: number
  ): Promise<User> {
    if (currentUser.id === targetUserId) {
      throw new BookingValidationError(
        "SELF_BOOKING",
        "Cannot book a meeting with yourself"
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        roles: true,
        name: true,
        image: true,
      },
    });

    if (!targetUser) {
      throw new BookingValidationError(
        "USER_NOT_FOUND",
        "Target user not found"
      );
    }

    if (
      currentUser.roles.includes(Role.TUTOR) &&
      targetUser.roles.includes(Role.TUTOR)
    ) {
      throw new BookingValidationError(
        "INVALID_BOOKING_COMBINATION",
        "Tutors cannot book sessions with other tutors"
      );
    }

    return targetUser;
  }

  private static async validateMeetingHistory(
    isTutor: boolean,
    tutorId: number,
    studentId: number
  ): Promise<void> {
    if (!isTutor) {
      return; // Students can book first meeting
    }

    const previousMeeting = await prisma.booking.findFirst({
      where: {
        hostId: tutorId,
        participants: {
          some: {
            id: studentId,
          },
        },
        status: {
          in: [BookingStatus.COMPLETED, BookingStatus.SCHEDULED],
        },
      },
    });

    if (!previousMeeting) {
      throw new BookingValidationError(
        "NO_PREVIOUS_MEETING",
        "Tutors cannot book meetings with students they haven't met before"
      );
    }
  }

  private static async validateNoOngoingFreeMeeting(
    tutorId: number,
    studentId: number
  ): Promise<void> {
    const ongoingFreeMeeting = await prisma.booking.findFirst({
      where: {
        hostId: tutorId,
        type: BookingType.FREE_MEETING,
        participants: {
          some: {
            id: studentId,
          },
        },
        status: {
          in: [
            BookingStatus.SCHEDULED,
            BookingStatus.AWAITING_TUTOR_CONFIRMATION,
            BookingStatus.AWAITING_STUDENT_CONFIRMATION,
          ],
        },
      },
    });

    if (ongoingFreeMeeting) {
      throw new BookingValidationError(
        "ONGOING_FREE_MEETING",
        "Cannot book new meetings while there is an ongoing free meeting. Please complete or cancel the existing free meeting first."
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

  private static async validateNoConflicts(
    tutorId: number,
    startDateTime: DateTime,
    endDateTime: DateTime
  ): Promise<void> {
    // Check for any booking at this time, including completed ones
    const hasConflict = await prisma.booking.findFirst({
      where: {
        hostId: tutorId,
        AND: [
          { startTime: { lt: endDateTime.toJSDate() } },
          { endTime: { gt: startDateTime.toJSDate() } },
        ],
        status: {
          in: [
            BookingStatus.COMPLETED,
            BookingStatus.SCHEDULED,
            BookingStatus.AWAITING_TUTOR_CONFIRMATION,
            BookingStatus.AWAITING_STUDENT_CONFIRMATION,
          ],
        },
      },
      select: {
        id: true,
        startTime: true,
        status: true,
      },
    });

    if (hasConflict) {
      const conflictDateTime = DateTime.fromJSDate(hasConflict.startTime, {
        zone: "utc",
      });
      throw new BookingValidationError(
        "BOOKING_CONFLICT",
        `Cannot book at this time - there is a ${hasConflict.status} booking at ${conflictDateTime.toFormat("HH:mm")} UTC`
      );
    }
  }

  private static async determineBookingType(
    tutorId: number,
    studentId: number
  ): Promise<BookingType> {
    const completedFreeMeeting = await prisma.booking.findFirst({
      where: {
        hostId: tutorId,
        type: BookingType.FREE_MEETING,
        participants: {
          some: {
            id: studentId,
          },
        },
        status: BookingStatus.COMPLETED,
      },
    });

    return completedFreeMeeting ? BookingType.LESSON : BookingType.FREE_MEETING;
  }
}
