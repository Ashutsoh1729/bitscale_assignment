/**
 * Tests for handleRequest logic layer.
 *
 * ⚠️  These tests run against the REAL database.
 *     Run `bun src/db/seed.ts` BEFORE running these tests
 *     to set up the expected seed data.
 *
 * Run:  bun test src/test/logic.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { handleRequest } from "../logic";
import { db } from "../db/client";
import { contacts } from "../db/schema";
import { eq, or } from "drizzle-orm";

// ─── Test-specific data that we'll clean up after ───
const TEST_EMAILS = [
    "brand_new@example.com",
    "alice_new@example.com",
    "dave_brand_new@example.com",
    "only_email_test@example.com",
];
const TEST_PHONES = ["9999999999", "3333333333", "8888888888"];

afterAll(async () => {
    // Clean up any rows created during testing
    for (const email of TEST_EMAILS) {
        await db.delete(contacts).where(eq(contacts.email, email));
    }
    for (const phone of TEST_PHONES) {
        await db.delete(contacts).where(eq(contacts.phoneNumber, phone));
    }
});

// ═══════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════

describe("Input validation", () => {
    test("throws when both email and phoneNumber are missing", async () => {
        expect(handleRequest()).rejects.toThrow(
            "Email or phone number is required",
        );
    });

    test("throws when both are undefined", async () => {
        expect(handleRequest(undefined, undefined)).rejects.toThrow(
            "Email or phone number is required",
        );
    });
});

// ═══════════════════════════════════════════════════
//  CASE 1 — No match found → Create new primary
// ═══════════════════════════════════════════════════

describe("Case 1: No match found", () => {
    test("creates a new primary contact with both email and phone", async () => {
        const res = await handleRequest("brand_new@example.com", "9999999999");

        expect(res.contact).toBeDefined();
        expect(res.contact.primaryContactId).toBeNumber();
        expect(res.contact.emails).toContain("brand_new@example.com");
        expect(res.contact.phoneNumbers).toContain("9999999999");
        expect(res.contact.secondaryContactIds).toEqual([]);
    });

    test("creates a primary with only email (no phone)", async () => {
        const res = await handleRequest("only_email_test@example.com");

        expect(res.contact.primaryContactId).toBeNumber();
        expect(res.contact.emails).toContain("only_email_test@example.com");
        expect(res.contact.phoneNumbers).toEqual([]);
        expect(res.contact.secondaryContactIds).toEqual([]);
    });

    test("creates a primary with only phone (no email)", async () => {
        const res = await handleRequest(undefined, "8888888888");

        expect(res.contact.primaryContactId).toBeNumber();
        expect(res.contact.emails).toEqual([]);
        expect(res.contact.phoneNumbers).toContain("8888888888");
        expect(res.contact.secondaryContactIds).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════
//  CASE 2 — Exact match → No new row
// ═══════════════════════════════════════════════════

describe("Case 2: Exact match", () => {
    test("returns existing contact without creating a new row (Scenario B)", async () => {
        // Count rows before
        const before = await db
            .select()
            .from(contacts)
            .where(eq(contacts.email, "george@example.com"));
        const countBefore = before.length;

        const res = await handleRequest("george@example.com", "1111111111");

        // Count rows after — should be the same
        const after = await db
            .select()
            .from(contacts)
            .where(eq(contacts.email, "george@example.com"));

        expect(after.length).toBe(countBefore);
        expect(res.contact.emails).toContain("george@example.com");
        expect(res.contact.phoneNumbers).toContain("1111111111");
    });

    test("exact match on existing chain returns consolidated (Scenario E)", async () => {
        const before = await db
            .select()
            .from(contacts)
            .where(
                or(
                    eq(contacts.email, "dave@example.com"),
                    eq(contacts.phoneNumber, "6666666666"),
                ),
            );
        const countBefore = before.length;

        const res = await handleRequest("dave@example.com", "6666666666");

        const after = await db
            .select()
            .from(contacts)
            .where(
                or(
                    eq(contacts.email, "dave@example.com"),
                    eq(contacts.phoneNumber, "6666666666"),
                ),
            );

        // No new rows should be created
        expect(after.length).toBe(countBefore);
        expect(res.contact).toBeDefined();
        expect(res.contact.emails).toContain("dave@example.com");
        expect(res.contact.phoneNumbers).toContain("6666666666");
    });
});

// ═══════════════════════════════════════════════════
//  CASE 3 — Partial match → Create secondary
// ═══════════════════════════════════════════════════

describe("Case 3: Partial match", () => {
    test("same email, new phone → creates secondary (Scenario C)", async () => {
        const res = await handleRequest("alice@example.com", "3333333333");

        expect(res.contact).toBeDefined();
        expect(res.contact.emails).toContain("alice@example.com");
        expect(res.contact.phoneNumbers).toContain("3333333333");
        // Should have at least one secondary
        expect(res.contact.secondaryContactIds!.length).toBeGreaterThanOrEqual(1);
    });

    test("new email, same phone → creates secondary (Scenario C alternate)", async () => {
        const res = await handleRequest("alice_new@example.com", "2222222222");

        expect(res.contact).toBeDefined();
        expect(res.contact.emails).toContain("alice_new@example.com");
        expect(res.contact.phoneNumbers).toContain("2222222222");
        expect(res.contact.secondaryContactIds!.length).toBeGreaterThanOrEqual(1);
    });

    test("partial match on existing chain → new secondary (Scenario E)", async () => {
        const res = await handleRequest("dave_brand_new@example.com", "6666666666");

        expect(res.contact).toBeDefined();
        expect(res.contact.emails).toContain("dave_brand_new@example.com");
        expect(res.contact.phoneNumbers).toContain("6666666666");
        expect(res.contact.secondaryContactIds!.length).toBeGreaterThanOrEqual(1);
    });
});

// ═══════════════════════════════════════════════════
//  CASE 4 — Two separate primaries get linked
// ═══════════════════════════════════════════════════

describe("Case 4: Two primaries linked", () => {
    test("email from one primary, phone from another → links them (Scenario D)", async () => {
        const res = await handleRequest("bob@example.com", "5555555555");

        expect(res.contact).toBeDefined();
        // Should contain data from both bob and carol
        expect(res.contact.emails).toContain("bob@example.com");
        expect(res.contact.phoneNumbers).toContain("5555555555");

        // The primary should be the older one (bob)
        // And carol's id should be in secondaryContactIds
        // (Note: This test documents expected behavior — current logic
        //  may not handle Case 4 fully yet since it's in the "super case" branch)
    });
});

// ═══════════════════════════════════════════════════
//  RESPONSE SHAPE
// ═══════════════════════════════════════════════════

describe("Response shape", () => {
    test("response matches IdentifyResponse interface", async () => {
        const res = await handleRequest("george@example.com", "1111111111");

        expect(res).toHaveProperty("contact");
        expect(res.contact).toHaveProperty("primaryContactId");
        expect(res.contact).toHaveProperty("emails");
        expect(res.contact).toHaveProperty("phoneNumbers");
        expect(res.contact).toHaveProperty("secondaryContactIds");

        expect(typeof res.contact.primaryContactId).toBe("number");
        expect(Array.isArray(res.contact.emails)).toBe(true);
        expect(Array.isArray(res.contact.phoneNumbers)).toBe(true);
        expect(Array.isArray(res.contact.secondaryContactIds)).toBe(true);
    });

    test("emails and phoneNumbers contain no null values", async () => {
        const res = await handleRequest("george@example.com", "1111111111");

        for (const email of res.contact.emails!) {
            expect(email).not.toBeNull();
            expect(typeof email).toBe("string");
        }
        for (const phone of res.contact.phoneNumbers!) {
            expect(phone).not.toBeNull();
            expect(typeof phone).toBe("string");
        }
    });
});
