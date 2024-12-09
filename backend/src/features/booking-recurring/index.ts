import { prisma, Transaction } from "@/lib/prisma";
import {
  BookingStatus,
  BookingType,
  RecurrencePattern,
  User,
  WeekDay,
  Role,
  RecurringTemplateStatus,
} from "@prisma/client";
import { BookingValidationError } from "../errors";
import { DateTime } from "luxon";

type TimeSlot = {
  weekDay: WeekDay;
  startTime: string; // HH:mm in UTC
};

type BookingDate = {
  startTime: DateTime;
  endTime: DateTime;
};

interface TimeSlotConflict {
  startTime: string; // ISO string
  alternativeTimes?: string[]; // HH:mm in UTC
}

export interface CreateRecurringBookingsCommand {
  title: string;
  description?: string;
  hostId: number;
  startDate: string; // ISO string
  recurrencePattern: RecurrencePattern;
  timeSlots: TimeSlot[];
  currentUser: User;
}

export interface RecurringBookingsResult {
  recurringTemplateId: number;
  conflicts?: TimeSlotConflict[];
}

export class CreateRecurringBookingsCommandHandler {
  private static readonly MAX_RECURRENCE_MONTHS = 1;
  private static readonly LESSON_DURATION_MINUTES = 60;

  static async execute(
    command: CreateRecurringBookingsCommand
  ): Promise<RecurringBookingsResult> {
    await this.validateCommand(command);

    return await prisma.$transaction(async (tx) => {
      await this.validatePriorBooking(command, tx);

      const startDate = DateTime.fromISO(command.startDate);
      const bookingDates = this.generateBookingDates(
        command.timeSlots,
        startDate,
        command.recurrencePattern
      );

      const conflicts = await this.checkConflicts(bookingDates, command, tx);
      if (conflicts.length > 0) {
        return { recurringTemplateId: -1, conflicts };
      }

      const template = await this.createTemplateAndBookings(
        command,
        bookingDates,
        tx
      );

      return { recurringTemplateId: template.id };
    });
  }

  private static async validatePriorBooking(
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<void> {
    const priorBooking = await tx.booking.findFirst({
      where: {
        hostId: command.hostId,
        participants: { some: { id: command.currentUser.id } },
        status: { in: [BookingStatus.COMPLETED, BookingStatus.SCHEDULED] },
      },
      select: { id: true },
    });

    if (!priorBooking) {
      throw new BookingValidationError(
        "NO_PRIOR_BOOKING",
        "You must have at least one completed lesson with this tutor"
      );
    }
  }

  private static async checkConflicts(
    bookingDates: BookingDate[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<TimeSlotConflict[]> {
    const conflicts: TimeSlotConflict[] = [];

    for (const { startTime, endTime } of bookingDates) {
      const conflictingBooking = await tx.booking.findFirst({
        where: {
          OR: [
            {
              hostId: command.hostId,
              OR: [
                {
                  AND: [
                    { startTime: { lte: startTime.toJSDate() } },
                    { endTime: { gt: startTime.toJSDate() } },
                  ],
                },
                {
                  AND: [
                    { startTime: { lt: endTime.toJSDate() } },
                    { endTime: { gte: endTime.toJSDate() } },
                  ],
                },
              ],
              status: {
                in: [
                  BookingStatus.AWAITING_STUDENT_CONFIRMATION,
                  BookingStatus.AWAITING_TUTOR_CONFIRMATION,
                  BookingStatus.AWAITING_PAYMENT,
                  BookingStatus.SCHEDULED,
                ],
              },
            },
            {
              participants: { some: { id: command.currentUser.id } },
              OR: [
                {
                  AND: [
                    { startTime: { lte: startTime.toJSDate() } },
                    { endTime: { gt: startTime.toJSDate() } },
                  ],
                },
                {
                  AND: [
                    { startTime: { lt: endTime.toJSDate() } },
                    { endTime: { gte: endTime.toJSDate() } },
                  ],
                },
              ],
              status: {
                in: [
                  BookingStatus.AWAITING_STUDENT_CONFIRMATION,
                  BookingStatus.AWAITING_TUTOR_CONFIRMATION,
                  BookingStatus.AWAITING_PAYMENT,
                  BookingStatus.SCHEDULED,
                ],
              },
            },
          ],
        },
      });

      if (conflictingBooking) {
        const alternatives = await this.findAlternativeTimes(
          startTime,
          command,
          tx
        );

        conflicts.push({
          startTime: startTime.toISO()!,
          alternativeTimes: alternatives,
        });
      }
    }

    return conflicts;
  }

  private static async findAlternativeTimes(
    originalTime: DateTime,
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<string[]> {
    const alternatives: string[] = [];
    const checkTimes = [-2, -1, 1, 2];

    for (const hourOffset of checkTimes) {
      const alternativeTime = originalTime.plus({ hours: hourOffset });

      const conflict = await tx.booking.findFirst({
        where: {
          OR: [
            {
              hostId: command.hostId,
              startTime: alternativeTime.toJSDate(),
              status: {
                notIn: [
                  BookingStatus.AWAITING_STUDENT_CONFIRMATION,
                  BookingStatus.AWAITING_TUTOR_CONFIRMATION,
                  BookingStatus.AWAITING_PAYMENT,
                  BookingStatus.SCHEDULED,
                ],
              },
            },
            {
              participants: { some: { id: command.currentUser.id } },
              startTime: alternativeTime.toJSDate(),
              status: {
                notIn: [
                  BookingStatus.AWAITING_STUDENT_CONFIRMATION,
                  BookingStatus.AWAITING_TUTOR_CONFIRMATION,
                  BookingStatus.AWAITING_PAYMENT,
                  BookingStatus.SCHEDULED,
                ],
              },
            },
          ],
        },
      });

      if (!conflict) {
        alternatives.push(alternativeTime.toFormat("HH:mm"));
      }
    }

    return alternatives;
  }

  private static async createTemplateAndBookings(
    command: CreateRecurringBookingsCommand,
    bookingDates: BookingDate[],
    tx: Transaction
  ) {
    return await tx.recurringTemplate.create({
      data: {
        title: command.title,
        description: command.description,
        hostId: command.hostId,
        status: RecurringTemplateStatus.ACTIVE,
        recurrencePattern: command.recurrencePattern,
        durationMinutes: this.LESSON_DURATION_MINUTES,
        timeSlots: {
          create: command.timeSlots.map((slot) => ({
            weekDay: slot.weekDay,
            startTime: DateTime.fromFormat(slot.startTime, "HH:mm", {
              zone: "UTC",
            }).toJSDate(),
          })),
        },
        bookings: {
          create: bookingDates.map(({ startTime, endTime }) => ({
            title: command.title,
            description: command.description,
            startTime: startTime.toJSDate(),
            endTime: endTime.toJSDate(),
            type: BookingType.LESSON,
            status: BookingStatus.AWAITING_STUDENT_CONFIRMATION,
            hostId: command.hostId,
            participants: {
              connect: [{ id: command.currentUser.id }],
            },
          })),
        },
      },
    });
  }

  private static async validateCommand(
    command: CreateRecurringBookingsCommand
  ): Promise<void> {
    const startDate = DateTime.fromISO(command.startDate);

    if (command.hostId === command.currentUser.id) {
      throw new BookingValidationError(
        "INVALID_INPUT",
        "Host cannot book lessons with themselves"
      );
    }

    if (command.currentUser.roles.includes(Role.TUTOR)) {
      throw new BookingValidationError(
        "INVALID_INPUT",
        "Tutors cannot create recurring lessons"
      );
    }

    if (command.timeSlots.length === 0) {
      throw new BookingValidationError(
        "INVALID_TIME_SLOTS",
        "At least one time slot must be provided"
      );
    }

    if (!this.isValidStartDate(startDate)) {
      throw new BookingValidationError(
        "INVALID_START_DATE",
        "Start date must be in the future and within the next month"
      );
    }

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

  private static isValidStartDate(startDate: DateTime): boolean {
    const now = DateTime.now().setZone("UTC");
    const maxDate = now.plus({ months: this.MAX_RECURRENCE_MONTHS });

    return startDate >= now && startDate <= maxDate;
  }

  private static generateBookingDates(
    timeSlots: TimeSlot[],
    startDate: DateTime,
    pattern: RecurrencePattern
  ): BookingDate[] {
    const dates: BookingDate[] = [];
    const endDate = startDate.plus({ months: this.MAX_RECURRENCE_MONTHS });

    for (const slot of timeSlots) {
      let currentDate = startDate.startOf("day");
      const [hours, minutes] = slot.startTime.split(":").map(Number);
      currentDate = currentDate.set({ hour: hours, minute: minutes });

      while (currentDate.weekday !== getWeekdayNumber(slot.weekDay)) {
        currentDate = currentDate.plus({ days: 1 });
      }

      while (currentDate < endDate) {
        const endTime = currentDate.plus({
          minutes: this.LESSON_DURATION_MINUTES,
        });

        dates.push({ startTime: currentDate, endTime });
        currentDate = this.getNextDate(currentDate, pattern);
      }
    }

    return dates.sort(
      (a, b) => a.startTime.toMillis() - b.startTime.toMillis()
    );
  }

  private static getNextDate(
    currentDate: DateTime,
    pattern: RecurrencePattern
  ): DateTime {
    switch (pattern) {
      case RecurrencePattern.WEEKLY:
        return currentDate.plus({ weeks: 1 });
      case RecurrencePattern.BIWEEKLY:
        return currentDate.plus({ weeks: 2 });
      case RecurrencePattern.MONTHLY:
        return currentDate.plus({ months: 1 });
      default:
        throw new BookingValidationError(
          "INVALID_RECURRENCE_PATTERN",
          "Unsupported recurrence pattern"
        );
    }
  }
}

const getWeekdayNumber = (weekDay: WeekDay): number => {
  // Luxon uses 1-7 for Monday-Sunday
  const weekdayMap: Record<WeekDay, number> = {
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
    SUNDAY: 7,
  };
  return weekdayMap[weekDay];
};
