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

type ValidMinutes = 0 | 15 | 30 | 45;

interface ParsedTime {
  hours: number;
  minutes: ValidMinutes;
}

type TimeSlot = {
  weekDay: WeekDay;
  startTime: string; // HH:mm in UTC
};

type BookingDate = {
  startTime: DateTime;
  endTime: DateTime;
};

export interface CreateRecurringBookingsCommand {
  title: string;
  description?: string;
  hostId: number;
  recurrencePattern: RecurrencePattern;
  timeSlots: TimeSlot[];
  currentUser: User;
  overrides?: Array<{
    conflictTime: string;
    newStartTime: string;
  }>;
}

export interface RecurringBookingsResult {
  recurringTemplateId: number;
  conflicts?: TimeSlotConflict[];
}

interface TimeSlotConflict {
  conflictTime: string;
  alternativeTimes?: string[];
}

export class CreateRecurringBookingsCommandHandler {
  private static readonly MAX_RECURRENCE_MONTHS = 1;
  private static readonly LESSON_DURATION_MINUTES = 60;
  private static readonly VALID_END_TIMES = new Set([0, 15, 30, 45]);

  private static async validateExistingRecurringBookings(
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<void> {
    // Get all active recurring templates for the host
    const existingTemplates = await tx.recurringTemplate.findMany({
      where: {
        hostId: command.hostId,
        status: RecurringTemplateStatus.ACTIVE,
      },
      include: {
        timeSlots: true,
      },
    });

    // For each new time slot, check if it overlaps with existing template slots
    for (const newSlot of command.timeSlots) {
      const [newHours, newMinutes] = newSlot.startTime.split(":").map(Number);
      const newSlotStart = newHours * 60 + newMinutes;
      const newSlotEnd = newSlotStart + this.LESSON_DURATION_MINUTES;

      for (const template of existingTemplates) {
        const conflictingSlots = template.timeSlots.filter((existingSlot) => {
          if (existingSlot.weekDay !== newSlot.weekDay) {
            return false;
          }

          const existingTime = existingSlot.startTime;
          const existingHours = existingTime.getUTCHours();
          const existingMinutes = existingTime.getUTCMinutes();
          const existingSlotStart = existingHours * 60 + existingMinutes;
          const existingSlotEnd =
            existingSlotStart + this.LESSON_DURATION_MINUTES;

          // Check for overlap
          return (
            (newSlotStart >= existingSlotStart &&
              newSlotStart < existingSlotEnd) ||
            (newSlotEnd > existingSlotStart && newSlotEnd <= existingSlotEnd) ||
            (newSlotStart <= existingSlotStart && newSlotEnd >= existingSlotEnd)
          );
        });

        if (conflictingSlots.length > 0) {
          const conflictingTime = conflictingSlots[0].startTime;
          throw new BookingValidationError(
            "EXISTING_RECURRING_CONFLICT",
            `Time slot ${newSlot.weekDay} ${newSlot.startTime} conflicts with existing recurring booking at ${conflictingTime.getUTCHours()}:${String(
              conflictingTime.getUTCMinutes()
            ).padStart(2, "0")} (Template ID: ${template.id})`
          );
        }
      }
    }
  }

  private static async handleOverrides(
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<void> {
    if (!command.overrides?.length) return;

    for (const override of command.overrides) {
      const conflictTime = DateTime.fromISO(override.conflictTime);
      const newStartTime = DateTime.fromISO(override.newStartTime);
      const newEndTime = newStartTime.plus({
        minutes: this.LESSON_DURATION_MINUTES,
      });

      // Validate the time format
      const timeStr = newStartTime.toFormat("HH:mm");
      const parsedTime = this.parseAndValidateTime(timeStr);
      if (!parsedTime) {
        throw new BookingValidationError(
          "INVALID_OVERRIDE_TIME",
          `Invalid override time format: ${timeStr}`
        );
      }

      // Find the conflicting booking
      const conflictingBooking = await tx.booking.findFirst({
        where: {
          OR: [
            { hostId: command.hostId },
            { participants: { some: { id: command.currentUser.id } } },
          ],
          startTime: conflictTime.toJSDate(),
          status: {
            in: [
              BookingStatus.AWAITING_STUDENT_CONFIRMATION,
              BookingStatus.AWAITING_TUTOR_CONFIRMATION,
              BookingStatus.AWAITING_PAYMENT,
              BookingStatus.SCHEDULED,
            ],
          },
        },
      });

      if (!conflictingBooking) {
        throw new BookingValidationError(
          "INVALID_OVERRIDE",
          `No booking found at conflict time ${override.conflictTime}`
        );
      }

      // Check if the new time slot is available
      const timeConflict = await tx.booking.findFirst({
        where: {
          OR: [
            { hostId: command.hostId },
            { participants: { some: { id: command.currentUser.id } } },
          ],
          AND: [
            { id: { not: conflictingBooking.id } },
            {
              OR: [
                {
                  startTime: {
                    gte: newStartTime.toJSDate(),
                    lt: newEndTime.toJSDate(),
                  },
                },
                {
                  endTime: {
                    gt: newStartTime.toJSDate(),
                    lte: newEndTime.toJSDate(),
                  },
                },
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
      });

      if (timeConflict) {
        throw new BookingValidationError(
          "OVERRIDE_CONFLICT",
          `New time slot ${override.newStartTime} conflicts with existing booking`
        );
      }

      // Update the booking with the new time slot
      await tx.booking.update({
        where: { id: conflictingBooking.id },
        data: {
          startTime: newStartTime.toJSDate(),
          endTime: newEndTime.toJSDate(),
        },
      });
    }
  }

  static async execute(
    command: CreateRecurringBookingsCommand
  ): Promise<RecurringBookingsResult> {
    await this.validateCommand(command);

    return await prisma.$transaction(async (tx) => {
      await this.validatePriorBooking(command, tx);
      await this.validateExistingRecurringBookings(command, tx);

      const startDate = DateTime.now().setZone("UTC").startOf("day");
      const bookingDates = this.generateBookingDates(
        command.timeSlots,
        startDate,
        command.recurrencePattern
      );

      // First check for conflicts
      const conflicts = await this.checkConflicts(bookingDates, command, tx);

      // If there are conflicts but no overrides provided, return the conflicts
      if (conflicts.length > 0 && !command.overrides?.length) {
        return { recurringTemplateId: -1, conflicts };
      }

      // If there are conflicts and overrides, handle the overrides
      if (conflicts.length > 0 && command.overrides?.length) {
        const providedOverrides = new Set(
          command.overrides.map((o) => o.conflictTime)
        );
        const unhandledConflicts = conflicts.filter(
          (c) => !providedOverrides.has(c.conflictTime)
        );

        if (unhandledConflicts.length > 0) {
          return {
            recurringTemplateId: -1,
            conflicts: unhandledConflicts,
          };
        }

        await this.handleOverrides(command, tx);
      }

      const template = await this.createTemplateAndBookings(
        command,
        bookingDates,
        tx
      );

      return { recurringTemplateId: template.id };
    });
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

      // Set the time for the current date
      currentDate = currentDate.set({ hour: hours, minute: minutes });

      // Find the next occurrence of this weekday
      while (currentDate.weekday !== getWeekdayNumber(slot.weekDay)) {
        currentDate = currentDate.plus({ days: 1 });
      }

      // If the time has already passed today, skip to next week
      if (
        currentDate.weekday === startDate.weekday &&
        currentDate < DateTime.now().setZone("UTC")
      ) {
        currentDate = this.getNextDate(currentDate, pattern);
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

  private static formatToUTCString(dateTime: DateTime): string {
    return dateTime.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  }

  private static async checkConflicts(
    bookingDates: BookingDate[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<TimeSlotConflict[]> {
    const busyBookings = await tx.booking.findMany({
      where: {
        OR: [
          {
            hostId: command.hostId,
            OR: bookingDates.map(({ startTime, endTime }) => ({
              OR: [
                {
                  startTime: {
                    gte: startTime.toJSDate(),
                    lt: endTime.toJSDate(),
                  },
                },
                {
                  endTime: {
                    gt: startTime.toJSDate(),
                    lte: endTime.toJSDate(),
                  },
                },
                {
                  AND: [
                    { startTime: { lte: startTime.toJSDate() } },
                    { endTime: { gte: endTime.toJSDate() } },
                  ],
                },
              ],
            })),
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
            OR: bookingDates.map(({ startTime, endTime }) => ({
              OR: [
                {
                  startTime: {
                    gte: startTime.toJSDate(),
                    lt: endTime.toJSDate(),
                  },
                },
                {
                  endTime: {
                    gt: startTime.toJSDate(),
                    lte: endTime.toJSDate(),
                  },
                },
                {
                  AND: [
                    { startTime: { lte: startTime.toJSDate() } },
                    { endTime: { gte: endTime.toJSDate() } },
                  ],
                },
              ],
            })),
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
      select: {
        startTime: true,
        endTime: true,
      },
    });

    if (busyBookings.length === 0) {
      return [];
    }

    const conflicts: TimeSlotConflict[] = [];
    const busyTimeRanges = new Set(
      busyBookings.map((booking) => booking.startTime.toISOString())
    );

    for (const { startTime } of bookingDates) {
      if (busyTimeRanges.has(startTime.toJSDate().toISOString())) {
        conflicts.push({
          conflictTime: this.formatToUTCString(startTime),
          alternativeTimes: [], // We'll fill this in the next step
        });
      }
    }

    if (conflicts.length > 0) {
      const allAlternatives = await this.findAlternativeTimesInBatch(
        conflicts.map((c) => DateTime.fromISO(c.conflictTime)),
        command,
        tx
      );

      conflicts.forEach((conflict, index) => {
        conflict.alternativeTimes = allAlternatives[index];
      });
    }

    return conflicts;
  }

  private static async findAlternativeTimesInBatch(
    conflictingTimes: DateTime[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<string[][]> {
    const checkTimes = [-2, -1, 1, 2];
    const allPotentialTimes: DateTime[] = [];

    conflictingTimes.forEach((originalTime) => {
      checkTimes.forEach((hourOffset) => {
        const alternativeTime = originalTime.plus({ hours: hourOffset });
        // Validate the alternative time is within bounds
        const parsedTime = this.parseAndValidateTime(
          alternativeTime.toFormat("HH:mm")
        );
        if (parsedTime) {
          allPotentialTimes.push(alternativeTime);
        }
      });
    });

    const busyTimes = await tx.booking.findMany({
      where: {
        OR: [
          {
            hostId: command.hostId,
            startTime: { in: allPotentialTimes.map((t) => t.toJSDate()) },
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
            startTime: { in: allPotentialTimes.map((t) => t.toJSDate()) },
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
      select: { startTime: true },
    });

    const busyTimeSet = new Set(
      busyTimes.map((b) => b.startTime.toISOString())
    );

    return conflictingTimes.map((originalTime) => {
      const alternatives: string[] = [];
      checkTimes.forEach((hourOffset) => {
        const alternativeTime = originalTime.plus({ hours: hourOffset });
        const timeStr = alternativeTime.toFormat("HH:mm");
        if (
          this.parseAndValidateTime(timeStr) &&
          !busyTimeSet.has(alternativeTime.toJSDate().toISOString())
        ) {
          alternatives.push(timeStr);
        }
      });
      return alternatives;
    });
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

    this.validateTimeSlots(command.timeSlots);

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

  private static validateTimeSlots(timeSlots: TimeSlot[]): void {
    timeSlots.forEach((slot) => {
      const parsedTime = this.parseAndValidateTime(slot.startTime);
      if (!parsedTime) {
        throw new BookingValidationError(
          "INVALID_TIME_SLOT",
          "Time slots must be on 15-minute boundaries (00, 15, 30, 45)"
        );
      }
    });

    const slotsByDay = new Map<WeekDay, ParsedTime[]>();

    timeSlots.forEach((slot) => {
      const parsed = this.parseAndValidateTime(slot.startTime)!;
      const existing = slotsByDay.get(slot.weekDay) || [];
      slotsByDay.set(slot.weekDay, [...existing, parsed]);
    });

    for (const [weekDay, times] of Array.from(slotsByDay.entries())) {
      const sortedTimes = times.sort((a, b) => {
        return a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes);
      });

      for (let i = 0; i < sortedTimes.length - 1; i++) {
        const currentSlotStart =
          sortedTimes[i].hours * 60 + sortedTimes[i].minutes;
        const currentSlotEnd = currentSlotStart + this.LESSON_DURATION_MINUTES;
        const nextSlotStart =
          sortedTimes[i + 1].hours * 60 + sortedTimes[i + 1].minutes;

        if (currentSlotEnd > nextSlotStart) {
          throw new BookingValidationError(
            "OVERLAPPING_TIME_SLOTS",
            `Overlapping time slots found on ${weekDay}. A slot starting at ${this.formatTime(sortedTimes[i])} overlaps with the next slot at ${this.formatTime(sortedTimes[i + 1])}`
          );
        }
      }
    }
  }

  private static formatTime(time: ParsedTime): string {
    return `${time.hours.toString().padStart(2, "0")}:${time.minutes.toString().padStart(2, "0")}`;
  }

  private static parseAndValidateTime(timeString: string): ParsedTime | null {
    const [hoursStr, minutesStr] = timeString.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (
      isNaN(hours) ||
      isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      !this.VALID_END_TIMES.has(minutes)
    ) {
      return null;
    }

    // Check if the lesson would extend past midnight
    const endHour =
      hours + Math.floor((minutes + this.LESSON_DURATION_MINUTES) / 60);
    if (endHour >= 24) {
      throw new BookingValidationError(
        "INVALID_TIME_SLOT",
        `Cannot schedule a ${this.LESSON_DURATION_MINUTES}-minute lesson that extends past midnight`
      );
    }

    return { hours, minutes: minutes as ValidMinutes };
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
