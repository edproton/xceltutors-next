import { Booking, BookingStatus, BookingType } from "@/lib/mock";

export interface IBookingRepository {
  saveBooking(booking: Omit<Booking, "id">): Promise<Booking>;
  getAllBookings(): Promise<Booking[]>;
  getBookingById(id: number): Promise<Booking | undefined>;
  checkBookingConflict(
    hostUsername: string,
    startTime: Date,
    endTime: Date
  ): Promise<boolean>;
  updateBookingStatus(
    id: number,
    status: BookingStatus
  ): Promise<Booking | undefined>;
  hasAlreadyHadFreeMeeting(
    hostUsername: string,
    username: string
  ): Promise<boolean>;
}

export class BookingRepository implements IBookingRepository {
  private database: Booking[] = [];

  async saveBooking(booking: Booking): Promise<Booking> {
    booking.id = this.database.length + 1;
    this.database.push(booking);
    return booking;
  }

  async getAllBookings(): Promise<Booking[]> {
    return this.database;
  }

  async getBookingById(id: number): Promise<Booking | undefined> {
    return this.database.find((booking) => booking.id === id);
  }

  async hasAlreadyHadFreeMeeting(
    hostUsername: string,
    username: string
  ): Promise<boolean> {
    // const validFreeMeetingStatuses = [
    //   BookingStatus.AWAITING_TUTOR_CONFIRMATION,
    //   BookingStatus.AWAITING_STUDENT_CONFIRMATION,
    //   BookingStatus.SCHEDULED,
    // ];

    return this.database.some(
      (booking) =>
        booking.hostUsername === hostUsername &&
        booking.participantsUsernames.includes(username) &&
        booking.type === BookingType.FREE_MEETING
    );
  }

  async checkBookingConflict(
    hostUsername: string,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    return this.database.some(
      (booking) =>
        booking.hostUsername === hostUsername &&
        new Date(booking.startTime) < endTime &&
        new Date(booking.endTime) > startTime
    );
  }

  async updateBookingStatus(
    id: number,
    status: BookingStatus
  ): Promise<Booking | undefined> {
    const booking = await this.getBookingById(id);
    if (booking) {
      booking.status = status; // Update the status
      return this.saveBooking(booking); // Save the updated booking
    }

    return undefined; // If booking not found
  }
}
