# Seed Script Report — `seed.ts`

**Date:** 2026-03-05  
**File:** [`src/db/seed.ts`](file:///Users/ashutoshhota/Coding/play_ground/assignments/bitscale_assignment/src/db/seed.ts)  
**Schema:** [`src/db/schema.ts`](file:///Users/ashutoshhota/Coding/play_ground/assignments/bitscale_assignment/src/db/schema.ts)

---

## 1. Purpose

The `seed.ts` script populates the `contacts` table with demo data so that all business logic cases of the `POST /identify` endpoint can be tested without manual setup. It is designed to be **idempotent** — it clears all existing contacts before inserting fresh rows.

---

## 2. Schema Reference

The seed script targets the `contacts` table defined in `schema.ts`:

| Column            | Type        | Notes                                       |
|-------------------|-------------|---------------------------------------------|
| `id`              | `serial`    | Primary key, auto-increment                 |
| `phoneNumber`     | `text`      | Nullable                                    |
| `email`           | `text`      | Nullable                                    |
| `linkedId`        | `integer`   | Nullable, FK → `contacts.id`               |
| `linkPrecedence`  | `enum`      | `"primary"` or `"secondary"`, not null      |
| `createdAt`       | `timestamp` | Defaults to `now()`, not null               |
| `updatedAt`       | `timestamp` | Defaults to `now()`, not null               |
| `deletedAt`       | `timestamp` | Nullable                                    |

---

## 3. What the Script Does

### Step 1 — Clean slate
Deletes all existing rows from `contacts`.

### Step 2 — Insert 5 primary contacts
These cover Scenarios B through E (Scenario A requires no pre-existing data):

| Seed Index | Scenario | Email                  | Phone        | Precedence | Purpose                            |
|------------|----------|------------------------|--------------|------------|------------------------------------|
| 0          | B        | `george@example.com`   | `1111111111` | primary    | Exact match test                   |
| 1          | C        | `alice@example.com`    | `2222222222` | primary    | Partial match test                 |
| 2          | D        | `bob@example.com`      | `4444444444` | primary    | Two-primaries-linked (older)       |
| 3          | D        | `carol@example.com`    | `5555555555` | primary    | Two-primaries-linked (newer)       |
| 4          | E        | `dave@example.com`     | `6666666666` | primary    | Pre-existing secondary chain head  |

Each row is given a staggered `createdAt` timestamp (10 → 6 minutes ago) to simulate temporal ordering, which is critical for Case 4 logic (older contact becomes the primary).

### Step 3 — Insert 2 secondary contacts (Scenario E)
After inserting the primaries, the script retrieves the auto-generated `id` of the Scenario E primary (`dave@example.com`) and uses it as `linkedId` for two secondaries:

| Email                   | Phone        | Precedence | linkedId     |
|-------------------------|--------------|------------|--------------|
| `dave_alt@example.com`  | `6666666666` | secondary  | dave's `id`  |
| `dave@example.com`      | `7777777777` | secondary  | dave's `id`  |

### Step 4 — Print summary & test requests
The script logs a table of all seeded rows and a list of ready-to-use `POST /identify` curl payloads for each test case.

---

## 4. Test Scenarios Covered

| Scenario | Case | Description                        | Test Payload                                                                    | Expected Result                                      |
|----------|------|------------------------------------|---------------------------------------------------------------------------------|------------------------------------------------------|
| A        | 1    | No match found                     | `{ "email": "brand_new@example.com", "phoneNumber": "9999999999" }`             | New primary contact created                          |
| B        | 2    | Exact match                        | `{ "email": "george@example.com", "phoneNumber": "1111111111" }`                | No new row; returns existing primary                 |
| C        | 3    | Partial match (new phone)          | `{ "email": "alice@example.com", "phoneNumber": "3333333333" }`                 | New secondary created with `linkedId` → Alice        |
| C        | 3    | Partial match (new email)          | `{ "email": "alice_new@example.com", "phoneNumber": "2222222222" }`             | New secondary created with `linkedId` → Alice        |
| D        | 4    | Two primaries linked               | `{ "email": "bob@example.com", "phoneNumber": "5555555555" }`                   | Carol demoted to secondary; both merge under Bob     |
| E        | 2    | Exact match on existing chain      | `{ "email": "dave@example.com", "phoneNumber": "6666666666" }`                  | No new row; returns consolidated chain of 3          |
| E        | 3    | Partial match on existing chain    | `{ "email": "dave_brand_new@example.com", "phoneNumber": "6666666666" }`        | New secondary linked to Dave's primary               |

---

## 5. TypeScript Bug Fix

### Problem
Line 125 originally read:
```ts
const daveId = insertedRows[4].id;
```
TypeScript flagged **"Object is possibly 'undefined'"** because array index access returns `T | undefined` under strict mode (`noUncheckedIndexedAccess`). The compiler cannot guarantee at compile time that index `4` exists.

### Fix Applied
```diff
- const daveId = insertedRows[4].id; // Scenario E primary
+ const daveRow = insertedRows[4];
+ if (!daveRow) throw new Error("Seed failed: missing row for Scenario E primary");
+ const daveId = daveRow.id;
```

This adds a **runtime guard** that:
1. Satisfies TypeScript's type narrowing (eliminates the `undefined` possibility after the check).
2. Provides a clear error message if the seed data shape ever changes unexpectedly.

---

## 6. How to Run

```bash
npx tsx src/db/seed.ts
```

> The script calls `process.exit(0)` on success and `process.exit(1)` on failure, making it safe to use in CI/CD pipelines.
