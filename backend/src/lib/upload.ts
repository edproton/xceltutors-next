import { env } from "@/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const BUCKET_NAME = "xceltutors";
const REGION = "eu-north-1";

// Initialize the S3 client
const s3Client = new S3Client({
  region: REGION,
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
  bucketName: string = BUCKET_NAME
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
    console.log(`[S3] Image uploaded successfully: ${key}`);

    // Return the public URL
    const publicUrl = `https://${bucketName}.s3.${REGION}.amazonaws.com/${key}`;
    console.log(`[S3] Public URL: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error("[S3] Error uploading image:", error);
    throw error;
  }
}
