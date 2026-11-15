import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sql = postgres(env.databaseUrl, { max: 10, prepare: false }); // prepare:false: el pooler en modo transacción de Supabase no admite sentencias preparadas
export const db = drizzle(sql, { schema });
