import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from ".";

await sql`CREATE EXTENSION IF NOT EXISTS vector`;
await migrate(db, { migrationsFolder: "./drizzle" });
await sql.end();
console.log("migraciones aplicadas");
