import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Инициализация S3 клиента для Cloudflare Workers.
 */
const getS3Client = (env) => {
  // Очищаем эндпоинт от протокола, если он там есть
  const cleanEndpoint = (env.B2_ENDPOINT || '').replace(/^https?:\/\//, '');

  // Для Backblaze B2 регион обычно берется из эндпоинта, например 'us-east-005'
  const region = cleanEndpoint.split('.')[1] || 'us-east-005';

  if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY) {
    console.error('B2 Credentials missing in environment');
  } else {
    console.log(`B2 Config: endpoint=${cleanEndpoint}, region=${region}, keyIdLength=${env.B2_KEY_ID.length}`);
  }

  return new S3Client({
    region: region,
    endpoint: `https://${cleanEndpoint}`,
    credentials: {
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APPLICATION_KEY,
    },
    forcePathStyle: true, 
  });
};

/**
 * Загрузка файла через подписанную ссылку.
 * Это позволяет избежать использования внутреннего XML-парсера SDK,
 * который вызывает ошибку "DOMParser is not defined" в Workers.
 */
export async function uploadFile(env, fileName, body, contentType) {
  const client = getS3Client(env);
  
  // Создаем команду для загрузки
  const command = new PutObjectCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: fileName,
    ContentType: contentType,
  });

  // Генерируем подписанный URL на 10 минут
  const signedUrl = await getSignedUrl(client, command, { expiresIn: 600 });

  // Отправляем файл напрямую через fetch
  const response = await fetch(signedUrl, {
    method: 'PUT',
    body: body,
    headers: {
      'Content-Type': contentType,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`B2 Upload Error (${response.status}):`, errorText);
    throw new Error(`B2 Upload failed: ${response.status} ${errorText}`);
  }

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
  
  // Удаление обычно не возвращает контента, который нужно парсить, 
  // но на всякий случай можно тоже переделать на подписанный URL, если будет падать.
  // Пока оставим стандартный метод для простоты.
  await client.send(command);
}
