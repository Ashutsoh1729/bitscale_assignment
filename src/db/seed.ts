import { db } from "./client";
import { contacts } from "./schema";

/**
 * Seed script to insert demo data for testing all 4 business logic cases.
 *
 * After seeding, the DB will have data that lets you test each case
 * by sending different POST /identify requests.
 *
 * ──────────────────────────────────────────────────────────
 *  SCENARIO A — For testing Case 1 (No match found)
 * ──────────────────────────────────────────────────────────
 *  No existing data matches. Just send a brand new email/phone:
 *    POST /identify { "email": "brand_new@example.com", "phoneNumber": "9999999999" }
 *  Expected: A new primary contact is created.
 *
 * ──────────────────────────────────────────────────────────
 *  SCENARIO B — For testing Case 2 (Exact match)
 * ──────────────────────────────────────────────────────────
 *  Rows seeded: id=1 (primary, george@example.com, 1111111111)
 *  Test request:
 *    POST /identify { "email": "george@example.com", "phoneNumber": "1111111111" }
 *  Expected: No new row created. Returns id=1 as primary.
 *
 * ──────────────────────────────────────────────────────────
 *  SCENARIO C — For testing Case 3 (Partial match — one field matches, other is new)
 * ──────────────────────────────────────────────────────────
 *  Rows seeded: id=2 (primary, alice@example.com, 2222222222)
 *  Test request:
 *    POST /identify { "email": "alice@example.com", "phoneNumber": "3333333333" }
 *  Expected: New secondary contact created with linkedId=2, same email, new phone.
 *
 *  Alternate test (new email, same phone):
 *    POST /identify { "email": "alice_new@example.com", "phoneNumber": "2222222222" }
 *  Expected: New secondary contact created with linkedId=2, new email, same phone.
 *
 * ──────────────────────────────────────────────────────────
 *  SCENARIO D — For testing Case 4 (Two separate primaries get linked)
 * ──────────────────────────────────────────────────────────
 *  Rows seeded:
 *    id=3 (primary, bob@example.com,   4444444444) — created first (older)
 *    id=4 (primary, carol@example.com, 5555555555) — created second (newer)
 *  Test request:
 *    POST /identify { "email": "bob@example.com", "phoneNumber": "5555555555" }
 *  Expected: id=4 is downgraded to secondary with linkedId=3.
 *            Consolidated response merges both groups under id=3 as primary.
 *
 * ──────────────────────────────────────────────────────────
 *  SCENARIO E — Pre-existing secondary chain (extended Case 3 / Case 2)
 * ──────────────────────────────────────────────────────────
 *  Rows seeded:
 *    id=5 (primary,   dave@example.com,      6666666666)
 *    id=6 (secondary, dave_alt@example.com,  6666666666, linkedId=5)
 *    id=7 (secondary, dave@example.com,      7777777777, linkedId=5)
 *  Test requests:
 *    POST /identify { "email": "dave@example.com", "phoneNumber": "6666666666" }
 *      → Exact match on id=5. No new row. Returns consolidated with all 3.
 *    POST /identify { "email": "dave_brand_new@example.com", "phoneNumber": "6666666666" }
 *      → Partial match. New secondary linked to id=5.
 */

async function seed() {
    console.log("🌱 Seeding database...\n");

    // Clean existing data
    await db.delete(contacts);
    console.log("🗑️  Cleared existing contacts.\n");

    const now = new Date();

    const rows = [
        // ── Scenario B: Exact match ──
        {
            phoneNumber: "1111111111",
            email: "george@example.com",
            linkedId: null,
            linkPrecedence: "primary" as const,
            createdAt: new Date(now.getTime() - 10 * 60000), // 10 min ago
            updatedAt: new Date(now.getTime() - 10 * 60000),
        },

        // ── Scenario C: Partial match ──
        {
            phoneNumber: "2222222222",
            email: "alice@example.com",
            linkedId: null,
            linkPrecedence: "primary" as const,
            createdAt: new Date(now.getTime() - 9 * 60000),
            updatedAt: new Date(now.getTime() - 9 * 60000),
        },

        // ── Scenario D: Two separate primaries (will get linked) ──
        {
            phoneNumber: "4444444444",
            email: "bob@example.com",
            linkedId: null,
            linkPrecedence: "primary" as const,
            createdAt: new Date(now.getTime() - 8 * 60000), // older
            updatedAt: new Date(now.getTime() - 8 * 60000),
        },
        {
            phoneNumber: "5555555555",
            email: "carol@example.com",
            linkedId: null,
            linkPrecedence: "primary" as const,
            createdAt: new Date(now.getTime() - 7 * 60000), // newer
            updatedAt: new Date(now.getTime() - 7 * 60000),
        },

        // ── Scenario E: Pre-existing secondary chain ──
        {
            phoneNumber: "6666666666",
            email: "dave@example.com",
            linkedId: null,
            linkPrecedence: "primary" as const,
            createdAt: new Date(now.getTime() - 6 * 60000),
            updatedAt: new Date(now.getTime() - 6 * 60000),
        },
    ];

    const insertedRows = await db.insert(contacts).values(rows).returning();
    console.log(`✅ Inserted ${insertedRows.length} base contacts.\n`);

    // Insert secondary contacts for Scenario E (need the primary ID)
    const daveRow = insertedRows[4];
    if (!daveRow) throw new Error("Seed failed: missing row for Scenario E primary");
    const daveId = daveRow.id;

    const secondaryRows = [
        {
            phoneNumber: "6666666666",
            email: "dave_alt@example.com",
            linkedId: daveId,
            linkPrecedence: "secondary" as const,
            createdAt: new Date(now.getTime() - 5 * 60000),
            updatedAt: new Date(now.getTime() - 5 * 60000),
        },
        {
            phoneNumber: "7777777777",
            email: "dave@example.com",
            linkedId: daveId,
            linkPrecedence: "secondary" as const,
            createdAt: new Date(now.getTime() - 4 * 60000),
            updatedAt: new Date(now.getTime() - 4 * 60000),
        },
    ];

    const insertedSecondaries = await db
        .insert(contacts)
        .values(secondaryRows)
        .returning();
    console.log(`✅ Inserted ${insertedSecondaries.length} secondary contacts.\n`);

    // Print summary
    console.log("─── Seeded Data Summary ───\n");
    for (const row of [...insertedRows, ...insertedSecondaries]) {
        console.log(
            `  id=${row.id} | ${row.linkPrecedence.padEnd(9)} | ` +
            `email=${(row.email ?? "null").padEnd(24)} | ` +
            `phone=${(row.phoneNumber ?? "null").padEnd(12)} | ` +
            `linkedId=${row.linkedId ?? "null"}`
        );
    }

    console.log("\n─── Test Requests ───\n");
    console.log("Case 1 (No match):");
    console.log('  POST /identify { "email": "brand_new@example.com", "phoneNumber": "9999999999" }\n');
    console.log("Case 2 (Exact match):");
    console.log('  POST /identify { "email": "george@example.com", "phoneNumber": "1111111111" }\n');
    console.log("Case 3 (Partial match — new phone):");
    console.log('  POST /identify { "email": "alice@example.com", "phoneNumber": "3333333333" }\n');
    console.log("Case 3 (Partial match — new email):");
    console.log('  POST /identify { "email": "alice_new@example.com", "phoneNumber": "2222222222" }\n');
    console.log("Case 4 (Two primaries linked):");
    console.log('  POST /identify { "email": "bob@example.com", "phoneNumber": "5555555555" }\n');
    console.log("Case 2 on chain (Exact match with existing chain):");
    console.log('  POST /identify { "email": "dave@example.com", "phoneNumber": "6666666666" }\n');
    console.log("Case 3 on chain (Partial match on chain):");
    console.log('  POST /identify { "email": "dave_brand_new@example.com", "phoneNumber": "6666666666" }\n');

    console.log("🌱 Seeding complete!");
}

seed()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Seeding failed:", err);
        process.exit(1);
    });
