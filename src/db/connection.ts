import { drizzle } from "drizzle-orm/node-postgres";
import { DB_URL } from "../../constants";
import * as schema from "./schema";

/**
 * Query logging prints every statement together with its bound parameters, so
 * a single booking wrote the customer's name, email and phone number into the
 * host's logs in cleartext (SFS-12). Development only.
 */
const db = drizzle(DB_URL!, {
  schema,
  logger: process.env.NODE_ENV !== "production",
  casing: "snake_case",
});

export { db };
