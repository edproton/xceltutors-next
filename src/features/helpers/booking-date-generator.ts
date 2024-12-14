// src/features/bookings/helpers/booking-date-generator.ts
import { DateTime } from "luxon";
import { RecurrencePattern } from "@prisma/client";
import { BookingValidationError } from "../errors";
import { TimeSlot } from "../booking-recurring";
import { getWeekdayNumber } from "../utils/weekday";
import { TimeSlotValidator } from "./time-slot-validator";
import { BookingUtils } from "../utils/booking-utils";

export interface BookingDate {
  startTime: DateTime;
  endTime: DateTime;
}

export class BookingDateGenerator {
  private static readonly MAX_RECURRENCE_MONTHS = 1;
  private static readonly LESSON_DURATION_MINUTES =
    TimeSlotValidator.LESSON_DURATION_MINUTES;

  static generateBookingDates(
    timeSlots: TimeSlot[],
    startDate: DateTime,
    pattern: RecurrencePattern
  ): BookingDate[] {
    const dates: BookingDate[] = [];
    const endDate = startDate.plus({ months: this.MAX_RECURRENCE_MONTHS });

    for (const slot of timeSlots) {
      let currentDate = this.initializeSlotDate(startDate, slot);

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

  private static initializeSlotDate(
    startDate: DateTime,
    slot: TimeSlot
  ): DateTime {
    const { hours, minutes } = BookingUtils.getTimeFromSlot(slot);
    let currentDate = startDate
      .startOf("day")
      .set({ hour: hours, minute: minutes });

    // Find the next occurrence of this weekday
    while (currentDate.weekday !== getWeekdayNumber(slot.weekDay)) {
      currentDate = currentDate.plus({ days: 1 });
    }

    // If the time has already passed today, skip to next week
    if (
      currentDate.weekday === startDate.weekday &&
      currentDate < DateTime.now().setZone("UTC")
    ) {
      currentDate = this.getNextDate(currentDate, RecurrencePattern.WEEKLY);
    }

    return currentDate;
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
