import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Инициализация S3 клиента для Cloudflare Workers.
 */
const getS3Client = (env) => {
  const endpoint = (env.B2_ENDPOINT || '').trim();
  const cleanEndpoint = endpoint.replace(/^https?:\/\//, '');

  // Улучшенное извлечение региона: 
  // Эндпоинты бывают s3.us-west-004.backblazeb2.com или us-west-004.backblazeb2.com
  const parts = cleanEndpoint.split('.');
  let region = 'us-east-005'; // fallback

  if (parts.length >= 3) {
    // Если начинается с s3, берем вторую часть, иначе первую
    region = parts[0] === 's3' ? parts[1] : parts[0];
  }

  const keyId = (env.B2_KEY_ID || '').trim();
  const appKey = (env.B2_APPLICATION_KEY || '').trim();

  if (!keyId || !appKey) {
    console.error('B2 Credentials missing');
  } else {
    // Детекция Master Key (они обычно 12 символов и не работают с S3 API)
    if (keyId.length <= 12) {
      console.warn(`⚠️ B2_KEY_ID looks like a Master Key (length ${keyId.length}). Master keys are NOT compatible with S3 API. Please create a normal Application Key.`);
    }
    console.log(`B2 S3 Config: endpoint=${cleanEndpoint}, region=${region}, keyIdLen=${keyId.length}`);
  }

  return new S3Client({
    region: region,
    endpoint: `https://${cleanEndpoint}`,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: appKey,
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
