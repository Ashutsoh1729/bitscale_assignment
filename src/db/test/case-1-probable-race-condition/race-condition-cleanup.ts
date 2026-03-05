/**
 * 🧹 Cleanup script — removes all rows created by race-condition-demo.ts
 *
 * Run:  bun src/db/test/race-condition-cleanup.ts
 */

import { db } from "../../client";
import { contacts } from "../../schema";
import { eq, or } from "drizzle-orm";

const TEST_EMAIL = "race_test@example.com";
const TEST_PHONE = "0000000000";

async function cleanup() {
    console.log("🧹 Cleaning up race condition test data...\n");

    const deleted = await db
        .delete(contacts)
        .where(
            or(
                eq(contacts.email, TEST_EMAIL),
                eq(contacts.phoneNumber, TEST_PHONE),
            ),
        )
        .returning();

    console.log(`🗑️  Deleted ${deleted.length} row(s):`);
    for (const row of deleted) {
        console.log(
            `  id=${row.id} | ${row.linkPrecedence} | ` +
            `email=${row.email ?? "null"} | phone=${row.phoneNumber ?? "null"}`,
        );
    }

    console.log("\n✅ Cleanup complete.");
}

cleanup()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Cleanup failed:", err);
        process.exit(1);
    });
