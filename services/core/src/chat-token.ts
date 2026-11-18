import { createHmac } from "node:crypto";
import { env } from "./env";

/** Token `base64url({c: conversación, e: expira})` + `.` + HMAC-SHA256. Lo verifica el servicio de IA con el mismo secreto. */
export const signChatToken = (conversationId: string, ttlSeconds = 7200) => {
  const body = Buffer.from(JSON.stringify({ c: conversationId, e: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${createHmac("sha256", env.chatTokenSecret).update(body).digest("base64url")}`;
};
