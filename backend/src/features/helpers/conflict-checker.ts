import { BookingStatus } from "@prisma/client";
import { BookingDate } from "./booking-date-generator";
import { CreateRecurringBookingsCommand } from "../booking-recurring";
import { Transaction } from "@/lib/prisma";
import { DateTime } from "luxon";
import { TimeSlotValidator } from "./time-slot-validator";
import { BookingUtils } from "../utils/booking-utils";

export interface TimeSlotConflict {
  conflictTime: string;
  alternativeTimes?: string[];
}

export class ConflictChecker {
  private static readonly LESSON_DURATION_MINUTES =
    TimeSlotValidator.LESSON_DURATION_MINUTES;

  static async checkConflicts(
    bookingDates: BookingDate[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<TimeSlotConflict[]> {
    const busyBookings = await this.findConflictingBookings(
      bookingDates,
      command,
      tx
    );

    if (busyBookings.length === 0) {
      return [];
    }

    return this.buildConflictList(bookingDates, busyBookings, command, tx);
  }

  private static async findConflictingBookings(
    bookingDates: BookingDate[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ) {
    return await tx.booking.findMany({
      where: {
        OR: this.buildConflictQuery(bookingDates, command),
      },
      select: {
        startTime: true,
        endTime: true,
      },
    });
  }

  private static buildConflictQuery(
    bookingDates: BookingDate[],
    command: CreateRecurringBookingsCommand
  ) {
    return [
      {
        hostId: command.hostId,
        OR: this.buildTimeRangeQueries(bookingDates),
        status: { in: BookingUtils.getActiveBookingStatuses() },
      },
      {
        participants: { some: { id: command.currentUser.id } },
        OR: this.buildTimeRangeQueries(bookingDates),
        status: { in: BookingUtils.getActiveBookingStatuses() },
      },
    ];
  }

  private static getActiveBookingStatuses() {
    return [
      BookingStatus.AWAITING_STUDENT_CONFIRMATION,
      BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      BookingStatus.AWAITING_PAYMENT,
      BookingStatus.SCHEDULED,
    ];
  }

  private static buildTimeRangeQueries(bookingDates: BookingDate[]) {
    return bookingDates.map(({ startTime }) => {
      const endTime = startTime.plus({ minutes: this.LESSON_DURATION_MINUTES });
      return {
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
      };
    });
  }

  private static async buildConflictList(
    bookingDates: BookingDate[],
    busyBookings: { startTime: Date; endTime: Date }[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<TimeSlotConflict[]> {
    const conflicts: TimeSlotConflict[] = [];
    const busyRanges = this.createBusyTimeRanges(busyBookings);

    for (const { startTime } of bookingDates) {
      const potentialEndTime = startTime.plus({
        minutes: this.LESSON_DURATION_MINUTES,
      });
      if (this.hasTimeConflict(startTime, potentialEndTime, busyRanges)) {
        conflicts.push({
          conflictTime: BookingUtils.formatToUTCString(startTime),
          alternativeTimes: [], // Will be filled in the next step
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

  private static createBusyTimeRanges(
    busyBookings: { startTime: Date; endTime: Date }[]
  ) {
    return busyBookings.map((booking) => ({
      start: DateTime.fromJSDate(booking.startTime),
      end: DateTime.fromJSDate(booking.endTime),
    }));
  }

  private static hasTimeConflict(
    startTime: DateTime,
    endTime: DateTime,
    busyRanges: Array<{ start: DateTime; end: DateTime }>
  ): boolean {
    return busyRanges.some(
      (range) =>
        (startTime >= range.start && startTime < range.end) ||
        (endTime > range.start && endTime <= range.end) ||
        (startTime <= range.start && endTime >= range.end)
    );
  }

  private static async findAlternativeTimesInBatch(
    conflictingTimes: DateTime[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<string[][]> {
    const checkTimes = [-2, -1, 1, 2]; // Check 2 hours before and after
    const allPotentialTimes: Array<{ start: DateTime; end: DateTime }> = [];

    conflictingTimes.forEach((originalTime) => {
      checkTimes.forEach((hourOffset) => {
        const alternativeStart = originalTime.plus({ hours: hourOffset });
        if (TimeSlotValidator.isValidTimeSlot(alternativeStart)) {
          const alternativeEnd = alternativeStart.plus({
            minutes: this.LESSON_DURATION_MINUTES,
          });
          allPotentialTimes.push({
            start: alternativeStart,
            end: alternativeEnd,
          });
        }
      });
    });

    const busyTimes = await this.findBusyTimes(
      allPotentialTimes.map((t) => t.start),
      command,
      tx
    );

    const busyRanges = this.createBusyTimeRanges(
      busyTimes.map((bt) => ({
        startTime: bt.startTime,
        endTime: new Date(
          bt.startTime.getTime() + this.LESSON_DURATION_MINUTES * 60000
        ),
      }))
    );

    return conflictingTimes.map((originalTime) => {
      const alternatives: string[] = [];
      checkTimes.forEach((hourOffset) => {
        const alternativeStart = originalTime.plus({ hours: hourOffset });
        const alternativeEnd = alternativeStart.plus({
          minutes: this.LESSON_DURATION_MINUTES,
        });

        if (
          TimeSlotValidator.isValidTimeSlot(alternativeStart) &&
          !this.hasTimeConflict(alternativeStart, alternativeEnd, busyRanges)
        ) {
          alternatives.push(alternativeStart.toFormat("HH:mm"));
        }
      });
      return alternatives;
    });
  }

  private static async findBusyTimes(
    potentialTimes: DateTime[],
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ) {
    return await tx.booking.findMany({
      where: {
        OR: [
          {
            hostId: command.hostId,
            startTime: { in: potentialTimes.map((t) => t.toJSDate()) },
            status: { in: this.getActiveBookingStatuses() },
          },
          {
            participants: { some: { id: command.currentUser.id } },
            startTime: { in: potentialTimes.map((t) => t.toJSDate()) },
            status: { in: this.getActiveBookingStatuses() },
          },
        ],
      },
      select: { startTime: true },
    });
  }
}
