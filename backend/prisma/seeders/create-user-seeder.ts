import { PrismaClient, Role } from "@prisma/client";
import { createHash } from "crypto";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { faker } from "@faker-js/faker";
import { uploadToR2 } from "@/lib/upload";
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { env } from "@/config";

export class TutorSeeder {
  private static prisma = new PrismaClient();
  private static r2Client = new S3Client({
    region: "auto",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_ACCESS_KEY_SECRET,
    },
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
  });

  public static async seedTutorsFromAvatars(
    avatarDirPath: string
  ): Promise<void> {
    try {
      console.log("Starting cleanup of existing example data...");
      await this.cleanupExistingData();

      console.log("Starting tutors seed...");

      const imageFiles = await readdir(avatarDirPath);
      const subjects = await this.prisma.subject.findMany({
        include: { levels: true },
      });

      for (const imageFile of imageFiles) {
        await this.createTutorFromImage(imageFile, avatarDirPath, subjects);
      }

      console.log("Tutors seed completed successfully");
    } catch (error) {
      console.error("Error during tutors seed:", error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  private static async cleanupExistingData(): Promise<void> {
    try {
      // 1. Get all example users and their images
      const users = await this.prisma.user.findMany({
        where: {
          credentials: {
            email: {
              endsWith: "@example.com",
            },
          },
        },
        include: {
          credentials: true,
          Tutor: {
            include: {
              services: true,
            },
          },
          hostedBookings: {
            include: {
              payment: true,
            },
          },
          recurringTemplates: true,
        },
      });

      console.log(`Found ${users.length} example users to delete`);

      // 2. Extract image URLs and create R2 keys
      const imageKeys = users
        .map((user) => user.image)
        .filter(Boolean)
        .map((imageUrl) => {
          const urlParts = imageUrl!.split("/");
          return urlParts.slice(urlParts.indexOf("profile-pictures")).join("/");
        });

      // 3. Delete data in the correct order to handle foreign key constraints
      await this.prisma.$transaction(async (tx) => {
        // First, delete all payments related to bookings
        for (const user of users) {
          for (const booking of user.hostedBookings) {
            if (booking.payment) {
              await tx.payment.delete({
                where: { id: booking.payment.id },
              });
            }
          }
        }

        // Delete all bookings
        await tx.booking.deleteMany({
          where: {
            hostId: {
              in: users.map((u) => u.id),
            },
          },
        });

        // Delete all recurring templates
        await tx.recurringTemplate.deleteMany({
          where: {
            hostId: {
              in: users.map((u) => u.id),
            },
          },
        });

        // Delete all services
        for (const user of users) {
          if (user.Tutor) {
            await tx.service.deleteMany({
              where: {
                tutorId: user.Tutor.id,
              },
            });
          }
        }

        // Delete all tutors
        await tx.tutor.deleteMany({
          where: {
            userId: {
              in: users.map((u) => u.id),
            },
          },
        });

        // Delete all sessions
        await tx.session.deleteMany({
          where: {
            userId: {
              in: users.map((u) => u.id),
            },
          },
        });

        // Finally, delete the users (this will cascade to credentials)
        await tx.user.deleteMany({
          where: {
            credentials: {
              email: {
                endsWith: "@example.com",
              },
            },
          },
        });
      });

      console.log("Deleted users and related data from database");

      // 4. Delete images from R2
      for (const key of imageKeys) {
        try {
          await this.r2Client.send(
            new DeleteObjectCommand({
              Bucket: env.R2_BUCKET_NAME,
              Key: key,
            })
          );
          console.log(`Deleted image: ${key}`);
        } catch (error) {
          console.error(`Failed to delete image ${key}:`, error);
        }
      }

      console.log("Cleanup completed successfully");
    } catch (error) {
      console.error("Cleanup failed:", error);
      throw error;
    }
  }

  private static async createTutorFromImage(
    imageFile: string,
    avatarDirPath: string,
    subjects: any[]
  ): Promise<void> {
    const gender = this.determineGenderFromImage(imageFile);
    const imageBuffer = await readFile(join(avatarDirPath, imageFile));
    const tutorSubjects = subjects.slice(0, 3);
    const bios = this.generateBios(
      tutorSubjects.map((s) => s.name).join(", "),
      gender
    );

    // Create the S3 key with profile-pictures prefix
    const s3Key = `profile-pictures/${Date.now()}-${imageFile}`;
    // Upload image to S3 with correct parameters
    const imageUrl = await uploadToR2(s3Key, imageBuffer, "image/webp");

    const defaultPassword = "password123";
    const passwordHash = this.hashPassword(defaultPassword);

    await this.prisma.$transaction(async (tx) => {
      // Create user with credentials
      const user = await tx.user.create({
        data: {
          name: bios.name,
          roles: [Role.TUTOR],
          image: imageUrl,
          credentials: {
            create: {
              email: `${bios.name.toLowerCase().replace(/ /g, ".")}@example.com`,
              passwordHash,
            },
          },
        },
      });

      // Create tutor profile
      const tutor = await tx.tutor.create({
        data: {
          userId: user.id,
          bio: bios.main,
          mainSession: bios.session,
          cardSession: bios.short,
        },
      });

      // Create services for each subject and level
      for (const subject of tutorSubjects) {
        const subjectLevels = subject.levels.slice(0, 3);
        for (const level of subjectLevels) {
          const price = [30, 45, 65, 90][Math.floor(Math.random() * 4)];
          await tx.service.create({
            data: {
              tutorId: tutor.id,
              levelId: level.id,
              price,
            },
          });
        }
      }

      console.log(`Created tutor: ${bios.name} with image: ${imageUrl}`);
    });
  }

  private static determineGenderFromImage(
    imageName: string
  ): "male" | "female" {
    return imageName.startsWith("fem") ? "female" : "male";
  }

  private static generateBios(
    subjects: string,
    gender: "male" | "female"
  ): {
    name: string;
    short: string;
    main: string;
    session: string;
  } {
    const name = faker.person.fullName({ sex: gender });
    const degreeSubject = faker.helpers.arrayElement([
      "Mathematics",
      "Physics",
      "Computer Science",
      "Engineering",
    ]);
    const university = faker.helpers.arrayElement([
      "Oxford University",
      "Cambridge University",
      "Imperial College London",
      "UCL",
    ]);
    const yearsExperience = faker.number.int({ min: 3, max: 15 });

    return {
      name,
      short: `${name} is a ${degreeSubject} graduate from ${university} with ${yearsExperience} years of tutoring experience in ${subjects}.`,
      main: faker.lorem.paragraphs(3),
      session: faker.lorem.paragraph(),
    };
  }

  private static hashPassword(password: string): string {
    return createHash("sha256").update(password).digest("hex");
  }
}
