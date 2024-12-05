export enum BookingStatus {
  AWAITING_TUTOR_CONFIRMATION = "AWAITING_TUTOR_CONFIRMATION",
  AWAITING_STUDENT_CONFIRMATION = "AWAITING_STUDENT_CONFIRMATION",
  AWAITING_PAYMENT = "AWAITING_PAYMENT",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  SCHEDULED = "SCHEDULED",
  CANCELED = "CANCELED",
  COMPLETED = "COMPLETED",
}

export enum BookingType {
  FREE_MEETING = "FREE_MEETING",
  LESSON = "LESSON",
}

export type Booking = {
  id: number;
  startTime: string;
  endTime: string;
  hostUsername: string;
  participantsUsernames: string[];
  type: BookingType;
  status: BookingStatus;
  payment?: {
    sessionId: string;
  };
};

export const fakeDatabase: Booking[] = [
  {
    id: 1,
    startTime: "2021-07-01T10:00:00Z",
    endTime: "2021-07-01T11:00:00Z",
    hostUsername: "TutorJane",
    participantsUsernames: ["JohnDoe"],
    type: BookingType.FREE_MEETING,
    status: BookingStatus.SCHEDULED,
  },
  {
    id: 2,
    startTime: "2021-07-01T10:00:00Z",
    endTime: "2021-07-01T11:00:00Z",
    hostUsername: "TutorJane",
    participantsUsernames: ["JohnDoe"],
    type: BookingType.LESSON,
    status: BookingStatus.AWAITING_STUDENT_CONFIRMATION,
  },
];
