import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Config } from "../config";

const pool = new Pool({ connectionString: Config.DatabaseUrl! });
export const db = drizzle({ client: pool });
