import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  BookingType,
  Role,
  User,
} from "@prisma/client";
import { BookingValidationError } from "../errors";

export interface CreateBookingCommand {
  startTime: string;
  currentUser: User;
  toUserId: number;
}

export class CreateBookingCommandHandler {
  private static readonly MAX_ADVANCE_BOOKING_MONTHS = 1;
  private static readonly FREE_MEETING_DURATION_MINUTES = 15;
  private static readonly LESSON_DURATION_MINUTES = 60;

  static async execute(command: CreateBookingCommand): Promise<Booking> {
    await CreateBookingCommandHandler.validateBookingTime(command.startTime);

    const isTutor = command.currentUser.roles.includes(Role.TUTOR);

    const hostId = isTutor ? command.currentUser.id : command.toUserId;
    const participantId = isTutor ? command.toUserId : command.currentUser.id;

    await this.validateUsers(command.currentUser, participantId);
    const bookingType = await this.determineBookingType(hostId, participantId);

    if (bookingType === BookingType.FREE_MEETING && isTutor) {
      throw new BookingValidationError(
        "FREE_MEETING_TUTOR",
        "Tutors cannot book free meetings"
      );
    }

    const endTime = this.calculateEndTime(command.startTime, bookingType);
    await this.validateNoConflicts(
      hostId,
      new Date(command.startTime),
      endTime
    );

    return await prisma.booking.create({
      data: {
        startTime: new Date(command.startTime),
        title: `Meeting with ${command.currentUser.name} | ${bookingType}`,
        endTime: endTime,
        hostId: hostId,
        participants: {
          connect: {
            id: participantId,
          },
        },
        type: bookingType,
        status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      },
    });
  }

  private static async validateBookingTime(startTime: string): Promise<void> {
    const bookingDate = new Date(startTime);
    const now = new Date();

    if (bookingDate < now) {
      throw new BookingValidationError(
        "PAST_BOOKING",
        "Cannot book a meeting in the past"
      );
    }

    const maxBookingDate = new Date();
    maxBookingDate.setMonth(now.getMonth() + this.MAX_ADVANCE_BOOKING_MONTHS);

    if (bookingDate > maxBookingDate) {
      throw new BookingValidationError(
        "ADVANCE_BOOKING_LIMIT",
        `Cannot book a meeting more than ${this.MAX_ADVANCE_BOOKING_MONTHS} month in advance`
      );
    }
  }

  private static async validateNoConflicts(
    hostId: number,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    const hasConflict = await prisma.booking.findFirst({
      where: {
        hostId: hostId,
        AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        status: {
          in: [
            BookingStatus.COMPLETED,
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
        "A booking already exists at this time"
      );
    }
  }

  private static async validateUsers(
    currentUser: User,
    targetUserId: number
  ): Promise<void> {
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        roles: true,
      },
    });

    if (!targetUser) {
      throw new BookingValidationError(
        "USER_NOT_FOUND",
        "Target user not found"
      );
    }

    // Validate user roles match expectations
    if (
      currentUser.roles.includes(Role.TUTOR) &&
      targetUser.roles.includes(Role.TUTOR)
    ) {
      throw new BookingValidationError(
        "INVALID_BOOKING_COMBINATION",
        "Tutors cannot book sessions with other tutors"
      );
    }
  }

  private static calculateEndTime(startTime: string, type: BookingType): Date {
    const endTime = new Date(startTime);
    const durationMinutes =
      type === BookingType.FREE_MEETING
        ? this.FREE_MEETING_DURATION_MINUTES
        : this.LESSON_DURATION_MINUTES;

    endTime.setMinutes(endTime.getMinutes() + durationMinutes);
    return endTime;
  }

  private static async determineBookingType(
    hostId: number,
    participantId: number
  ): Promise<BookingType> {
    const hasHadFreeMeeting = await prisma.booking.findFirst({
      select: {
        id: true,
      },
      where: {
        hostId: hostId,
        type: BookingType.FREE_MEETING,
        participants: {
          some: {
            id: participantId,
          },
        },
        status: {
          in: [
            BookingStatus.COMPLETED,
            BookingStatus.SCHEDULED,
            BookingStatus.AWAITING_TUTOR_CONFIRMATION,
            BookingStatus.AWAITING_STUDENT_CONFIRMATION,
          ],
        },
      },
    });

    return hasHadFreeMeeting ? BookingType.LESSON : BookingType.FREE_MEETING;
  }
}
