import { prisma } from "@/lib/prisma";
import {
  BookingStatus,
  BookingType,
  RecurrencePattern,
  User,
  WeekDay,
  Role,
} from "@prisma/client";
import { BookingValidationError } from "../errors";

type TimeSlot = {
  weekDay: WeekDay;
  startTime: string; // HH:mm in UTC
};

export interface CreateRecurringBookingsCommand {
  title: string;
  description?: string;
  hostId: number;
  startDate: Date;
  recurrencePattern: RecurrencePattern;
  timeSlots: TimeSlot[];
  currentUser: User;
}

export interface RecurringBookingsResult {
  recurringTemplateId: number;
}

export class CreateRecurringBookingsCommandHandler {
  private static readonly MAX_RECURRENCE_MONTHS = 1;
  private static readonly LESSON_DURATION_MINUTES = 60;

  static async execute(
    command: CreateRecurringBookingsCommand
  ): Promise<RecurringBookingsResult> {
    await this.validateCommand(command);

    return await prisma.$transaction(async (tx) => {
      // Check for prior booking existence efficiently
      const priorBooking = await tx.booking.findFirst({
        where: {
          hostId: command.hostId,
          participants: { some: { id: command.currentUser.id } },
          type: BookingType.LESSON,
          status: { in: [BookingStatus.COMPLETED, BookingStatus.SCHEDULED] },
        },
        select: { id: true },
      });

      if (!priorBooking) {
        throw new BookingValidationError(
          "NO_PRIOR_BOOKING",
          "You must have at least one lesson booking with this tutor before creating recurring bookings"
        );
      }

      // Generate booking dates first to check conflicts
      const bookingDates = this.generateBookingDates(
        command.timeSlots,
        command.startDate,
        command.recurrencePattern
      );

      // Check conflicts in a single query
      const conflictingBooking = await tx.booking.findFirst({
        where: {
          OR: [
            {
              hostId: command.hostId,
              startTime: {
                in: bookingDates.map((date) => date.startTime),
              },
              status: {
                notIn: [BookingStatus.CANCELED, BookingStatus.REFUNDED],
              },
            },
            {
              participants: { some: { id: command.currentUser.id } },
              startTime: {
                in: bookingDates.map((date) => date.startTime),
              },
              status: {
                notIn: [BookingStatus.CANCELED, BookingStatus.REFUNDED],
              },
            },
          ],
        },
        select: {
          id: true,
          hostId: true,
        },
      });

      if (conflictingBooking) {
        throw new BookingValidationError(
          "TIME_SLOT_CONFLICT",
          conflictingBooking.hostId !== command.hostId
            ? "You have existing bookings that conflict with these time slots"
            : "The tutor is not available during these time slots"
        );
      }

      // Create template and bookings in a single transaction
      const recurringTemplate = await tx.recurringTemplate.create({
        data: {
          title: command.title,
          description: command.description,
          hostId: command.hostId,
          recurrencePattern: command.recurrencePattern,
          durationMinutes: this.LESSON_DURATION_MINUTES,
          timeSlots: {
            create: command.timeSlots.map((slot) => ({
              weekDay: slot.weekDay,
              startTime: new Date(`1970-01-01T${slot.startTime}Z`),
            })),
          },
          bookings: {
            create: bookingDates.map(({ startTime, endTime }) => ({
              title: command.title,
              description: command.description,
              startTime,
              endTime,
              type: BookingType.LESSON,
              status: BookingStatus.AWAITING_STUDENT_CONFIRMATION,
              hostId: command.hostId,
              participants: {
                connect: [{ id: command.currentUser.id }],
              },
            })),
          },
        },
        select: { id: true },
      });

      return { recurringTemplateId: recurringTemplate.id };
    });
  }

  private static async validateCommand(
    command: CreateRecurringBookingsCommand
  ): Promise<void> {
    if (
      command.hostId === command.currentUser.id ||
      command.currentUser.roles.includes(Role.TUTOR) ||
      command.recurrencePattern === RecurrencePattern.NONE ||
      command.timeSlots.length === 0
    ) {
      throw new BookingValidationError(
        "INVALID_INPUT",
        "Invalid command parameters"
      );
    }

    // Efficient validation query
    const users = await prisma.user.findMany({
      where: {
        id: { in: [command.hostId, command.currentUser.id] },
      },
      select: {
        id: true,
        roles: true,
      },
    });

    const host = users.find((u) => u.id === command.hostId);
    const participant = users.find((u) => u.id === command.currentUser.id);

    if (!host?.roles.includes(Role.TUTOR)) {
      throw new BookingValidationError(
        "INVALID_HOST",
        "Host not found or is not a tutor"
      );
    }

    if (!participant?.roles.includes(Role.STUDENT)) {
      throw new BookingValidationError(
        "INVALID_PARTICIPANT",
        "Participant must be a student"
      );
    }
  }

  private static generateBookingDates(
    timeSlots: TimeSlot[],
    startDate: Date,
    pattern: RecurrencePattern
  ): Array<{ startTime: Date; endTime: Date }> {
    const dates: Array<{ startTime: Date; endTime: Date }> = [];
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + this.MAX_RECURRENCE_MONTHS);

    for (const slot of timeSlots) {
      let currentDate = new Date(startDate);
      const [hours, minutes] = slot.startTime.split(":").map(Number);
      currentDate.setHours(hours, minutes, 0, 0);

      while (currentDate.getDay() !== getWeekdayNumber(slot.weekDay)) {
        currentDate.setDate(currentDate.getDate() + 1);
      }

      while (currentDate < endDate) {
        const endTime = new Date(currentDate);
        endTime.setMinutes(endTime.getMinutes() + this.LESSON_DURATION_MINUTES);

        dates.push({
          startTime: new Date(currentDate),
          endTime: new Date(endTime),
        });

        currentDate = getNextDate(currentDate, pattern);
      }
    }

    return dates;
  }
}

const getWeekdayNumber = (weekDay: WeekDay): number =>
  ({
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
  })[weekDay];

const getNextDate = (currentDate: Date, pattern: RecurrencePattern): Date => {
  const nextDate = new Date(currentDate);
  const patternMap: Record<RecurrencePattern, number> = {
    DAILY: 1,
    WEEKLY: 7,
    BIWEEKLY: 14,
    MONTHLY: 0,
    NONE: 0,
  };

  if (pattern === RecurrencePattern.MONTHLY) {
    nextDate.setMonth(nextDate.getMonth() + 1);
  } else if (patternMap[pattern]) {
    nextDate.setDate(nextDate.getDate() + patternMap[pattern]);
  } else {
    throw new BookingValidationError(
      "INVALID_RECURRENCE_PATTERN",
      "Unsupported recurrence pattern"
    );
  }

  return nextDate;
};
