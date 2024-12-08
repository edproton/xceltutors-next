import { env } from "@/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Initialize the S3 client
const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

// Function to upload an image to S3 and return the public URL
export async function uploadToS3(
  key: string, // File name with prefix (e.g., "profile-pictures/image.jpg")
  fileBuffer: Buffer,
  mimeType: string,
  bucketName: string = env.AWS_BUCKET_NAME
): Promise<string> {
  try {
    // Upload the object to S3
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key, // Ensure the prefix "profile-pictures/" is included
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await s3Client.send(command);

    // Return the public URL
    const publicUrl = `https://${bucketName}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;

    return publicUrl;
  } catch (error) {
    console.error("[S3] Error uploading image:", error);
    throw error;
  }
}
