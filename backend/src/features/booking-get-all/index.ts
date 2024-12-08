// src/bookings/commands/get-bookings.command.ts
import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  BookingType,
  User,
  Prisma,
} from "@prisma/client";

export interface GetBookingsCommand {
  currentUser: User;
  page?: number;
  limit?: number;
  filters?: {
    startDate?: string;
    endDate?: string;
    status?: BookingStatus[];
    type?: BookingType;
    search?: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  metadata: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export class GetBookingsCommandHandler {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_LIMIT = 10;

  static async execute(
    command: GetBookingsCommand
  ): Promise<PaginatedResponse<Booking>> {
    const page = command.page || this.DEFAULT_PAGE;
    const limit = command.limit || this.DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    // Build where clause dynamically
    const where: Prisma.BookingWhereInput = {
      OR: [
        { hostId: command.currentUser.id },
        {
          participants: {
            some: {
              id: command.currentUser.id,
            },
          },
        },
      ],
    };

    // Add dynamic filters if they exist
    if (command.filters) {
      if (command.filters.status?.length) {
        where.status = {
          in: command.filters.status,
        };
      }

      if (command.filters.type) {
        where.type = command.filters.type;
      }

      if (command.filters.startDate) {
        where.startTime = {
          gte: new Date(command.filters.startDate),
        };
      }

      if (command.filters.endDate) {
        where.endTime = {
          lte: new Date(command.filters.endDate),
        };
      }

      if (command.filters.search) {
        where.OR = [
          {
            title: {
              contains: command.filters.search,
              mode: "insensitive",
            },
          },
          {
            host: {
              name: {
                contains: command.filters.search,
                mode: "insensitive",
              },
            },
          },
          {
            participants: {
              some: {
                name: {
                  contains: command.filters.search,
                  mode: "insensitive",
                },
              },
            },
          },
        ];
      }
    }

    // Get total count for pagination
    const total = await prisma.booking.count({ where });

    // Get paginated results
    const bookings = await prisma.booking.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        startTime: "desc",
      },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        participants: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return {
      items: bookings,
      metadata: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }
}
