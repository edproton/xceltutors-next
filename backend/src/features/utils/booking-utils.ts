// src/features/bookings/utils/booking-utils.ts
import { DateTime } from "luxon";
import { TimeSlot } from "../booking-recurring";
import { BookingStatus } from "@prisma/client";

export interface TimeRange {
  start: number;
  end: number;
}

export class BookingUtils {
  static formatToUTCString(dateTime: DateTime): string {
    return dateTime.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  }

  static formatTimeHHMM(hours: number, minutes: number): string {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  static parseTimeToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
  }

  static getTimeFromSlot(slot: TimeSlot): { hours: number; minutes: number } {
    const [hours, minutes] = slot.startTime.split(":").map(Number);
    return { hours, minutes };
  }

  static getActiveBookingStatuses(): BookingStatus[] {
    return [
      BookingStatus.AWAITING_STUDENT_CONFIRMATION,
      BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      BookingStatus.AWAITING_PAYMENT,
      BookingStatus.SCHEDULED,
    ];
  }

  static hasTimeRangeOverlap(range1: TimeRange, range2: TimeRange): boolean {
    return (
      (range1.start >= range2.start && range1.start < range2.end) ||
      (range1.end > range2.start && range1.end <= range2.end) ||
      (range1.start <= range2.start && range1.end >= range2.end)
    );
  }

  static createTimeRange(
    startTime: DateTime | Date,
    durationMinutes: number
  ): TimeRange {
    const start =
      startTime instanceof DateTime
        ? startTime
        : DateTime.fromJSDate(startTime);

    const end = start.plus({ minutes: durationMinutes });
    return {
      start: start.toMillis(),
      end: end.toMillis(),
    };
  }
}
