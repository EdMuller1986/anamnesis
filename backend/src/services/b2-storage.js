import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const getS3Client = (env) => {
  return new S3Client({
    region: env.B2_ENDPOINT.split('.')[1], // Извлекаем регион из эндпоинта
    endpoint: `https://${env.B2_ENDPOINT}`,
    credentials: {
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APPLICATION_KEY,
    },
  });
};

export async function uploadFile(env, fileName, body, contentType) {
  const client = getS3Client(env);
  const command = new PutObjectCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: fileName,
    Body: body,
    ContentType: contentType,
  });
  await client.send(command);
  return fileName;
}

export async function getDownloadUrl(env, fileName) {
  const client = getS3Client(env);
  const command = new GetObjectCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: fileName,
  });
  // Ссылка будет работать 1 час
  return await getSignedUrl(client, command, { expiresIn: 3600 });
}

export async function deleteFile(env, fileName) {
  const client = getS3Client(env);
  const command = new DeleteObjectCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: fileName,
  });
  await client.send(command);
}
