/**
 * Klien S3 yang sama untuk MinIO (lokal) dan Amazon S3 (EC2). Perbedaan
 * hanya dari variabel lingkungan:
 *   S3_ENDPOINT kosong        -> endpoint AWS bawaan
 *   S3_FORCE_PATH_STYLE=true  -> wajib untuk MinIO
 *   S3_ACCESS_KEY kosong      -> kredensial dari IAM role (LabRole di EC2)
 */
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

export function buatKlienS3(env = process.env) {
  const klien = new S3Client({
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    credentials:
      env.S3_ACCESS_KEY && env.S3_SECRET_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
        : undefined,
  });
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET belum diisi');
  const urlPublik = (env.S3_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (!urlPublik) throw new Error('S3_PUBLIC_BASE_URL belum diisi');

  return {
    bucket,
    urlPublik: (kunci) => `${urlPublik}/${kunci}`,
    async cekBucket() {
      await klien.send(new HeadBucketCommand({ Bucket: bucket }));
    },
    /** Unggah objek; kunci berversi sehingga aman diulang (idempoten). */
    async unggah(kunci, isi, tipe) {
      await klien.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: kunci,
          Body: isi,
          ContentType: tipe,
          // URL berversi tidak pernah berubah isinya: aman di-cache selamanya (Tier-1).
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    },
  };
}
