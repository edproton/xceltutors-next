// src/features/bookings/utils/weekday.ts

import { WeekDay } from "@prisma/client";

export const getWeekdayNumber = (weekDay: WeekDay): number => {
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
