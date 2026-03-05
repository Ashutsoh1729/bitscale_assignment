/**
 * 🏁 Race Condition Demo — Case 1 (No match → Create primary)
 *
 * This script simulates two concurrent requests that both try to create
 * a brand-new primary contact with the SAME email + phone.
 *
 * WITHOUT a transaction, both requests see 0 existing rows,
 * so both insert a new primary → DUPLICATE primaries.
 *
 * Run:  bun src/db/test/race-condition-demo.ts
 * Cleanup:  bun src/db/test/race-condition-cleanup.ts
 */

import { db } from "../../client";
import { contacts } from "../../schema";
import { eq, or } from "drizzle-orm";

const TEST_EMAIL = "race_test@example.com";
const TEST_PHONE = "0000000000";

async function simulateRequest(label: string, delayMs: number) {
    // Artificial delay to control timing
    await new Promise((r) => setTimeout(r, delayMs));

    console.log(`[${label}] 🔍 SELECT — looking for existing contacts...`);

    const existing = await db
        .select()
        .from(contacts)
        .where(
            or(
                eq(contacts.email, TEST_EMAIL),
                eq(contacts.phoneNumber, TEST_PHONE),
            ),
        );

    console.log(`[${label}] 📊 Found ${existing.length} existing row(s).`);

    if (existing.length === 0) {
        console.log(`[${label}] ✏️  INSERT — creating new primary contact...`);

        const [newRow] = await db
            .insert(contacts)
            .values({
                email: TEST_EMAIL,
                phoneNumber: TEST_PHONE,
                linkPrecedence: "primary",
            })
            .returning();

        console.log(`[${label}] ✅ Created primary contact with id=${newRow?.id}`);
    } else {
        console.log(`[${label}] ⏭️  Skipped — contact already exists.`);
    }
}

async function main() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🏁  RACE CONDITION DEMO — Case 1 (No match found)");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log(`Test data: email="${TEST_EMAIL}", phone="${TEST_PHONE}"\n`);

    // First, make sure no test data exists
    await db
        .delete(contacts)
        .where(
            or(
                eq(contacts.email, TEST_EMAIL),
                eq(contacts.phoneNumber, TEST_PHONE),
            ),
        );
    console.log("🗑️  Cleaned any pre-existing test data.\n");

    // Fire two "requests" at the same time (no transaction)
    console.log("🚀 Firing two concurrent requests...\n");

    await Promise.all([
        simulateRequest("Request A", 0),
        simulateRequest("Request B", 0),
    ]);

    // Now check what's in the DB
    console.log("\n─── Final DB State ───\n");

    const allTestRows = await db
        .select()
        .from(contacts)
        .where(
            or(
                eq(contacts.email, TEST_EMAIL),
                eq(contacts.phoneNumber, TEST_PHONE),
            ),
        );

    console.log(`Total rows with email="${TEST_EMAIL}" or phone="${TEST_PHONE}": ${allTestRows.length}\n`);

    for (const row of allTestRows) {
        console.log(
            `  id=${row.id} | ${row.linkPrecedence.padEnd(9)} | ` +
            `email=${row.email ?? "null"} | ` +
            `phone=${row.phoneNumber ?? "null"} | ` +
            `linkedId=${row.linkedId ?? "null"}`,
        );
    }

    if (allTestRows.length > 1) {
        console.log("\n💥 RACE CONDITION DETECTED!");
        console.log(`   Expected: 1 primary contact`);
        console.log(`   Got:      ${allTestRows.length} contacts — all "primary"!`);
        console.log(`   This is the duplicate-primary bug.\n`);
    } else if (allTestRows.length === 1) {
        console.log("\n✅ No race condition this time (requests didn't overlap perfectly).");
        console.log("   Try running again — the race is timing-dependent.\n");
    }

    console.log("Run cleanup:  bun src/db/test/race-condition-cleanup.ts\n");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Demo failed:", err);
        process.exit(1);
    });
