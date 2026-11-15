export function loadConfig() {
  const serviceUrls = Object.fromEntries(
    Object.entries(process.env)
      .filter(([key, value]) => key.endsWith("_SERVICE_URL") && value)
      .map(([key, value]) => [
        key.replace(/_SERVICE_URL$/, "").toLowerCase(),
        value,
      ]),
  );

  return {
    serviceName: process.env.SERVICE_NAME || "node-service",
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 8080),
    databaseUrl: process.env.DATABASE_URL || null,
    amqpUrl: process.env.AMQP_URL || null,
    redisUrl: process.env.REDIS_URL || null,
    s3Endpoint: process.env.S3_ENDPOINT || null,
    smtpHost: process.env.SMTP_HOST || null,
    serviceUrls,
  };
}
