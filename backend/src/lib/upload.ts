import { env } from "@/config";
import {
  PutObjectCommand,
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

// Initialize the R2 client
const r2Client = new S3Client({
  region: "auto",
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_ACCESS_KEY_SECRET,
  },
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
});

async function ensureBucketExists(bucketName: string): Promise<void> {
  try {
    await r2Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (error: any) {
    if (error.name === "NotFound" || error.name === "NoSuchBucket") {
      try {
        await r2Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`[R2] Created bucket: ${bucketName}`);
      } catch (createError) {
        console.error("[R2] Error creating bucket:", createError);
        throw createError;
      }
    } else {
      console.error("[R2] Error checking bucket:", error);
      throw error;
    }
  }
}

export async function uploadToR2(
  key: string,
  fileBuffer: Buffer,
  mimeType: string,
  bucketName: string = env.R2_BUCKET_NAME
): Promise<string> {
  try {
    await ensureBucketExists(bucketName);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await r2Client.send(command);

    // Use the new custom domain
    const publicUrl = `https://${env.R2_PUBLIC_DOMAIN}/${key}`;
    return publicUrl;
  } catch (error) {
    console.error("[R2] Error uploading file:", error);
    throw error;
  }
}
