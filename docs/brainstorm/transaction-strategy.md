# Brainstorm: Should We Use a DB Transaction in `/identify`?

**Date:** 2026-03-05  
**Context:** The `/identify` endpoint follows a **read → decide → write** pattern. This document explores whether that pattern needs a database transaction.

---

## The Core Problem

Every `/identify` request does:

1. **Query** — find all contacts matching the incoming `email` and/or `phoneNumber`.
2. **Process** — determine which of the 4 cases applies.
3. **Mutate** (maybe) — insert a new row, or update an existing row's `linkPrecedence` / `linkedId`.

The gap between step 1 (read) and step 3 (write) is the danger zone. If two concurrent requests hit the endpoint with overlapping data, they could both read the same state, both decide independently, and both write — producing **duplicate rows** or **inconsistent links**.

---

## Case-by-Case Concurrency Analysis

### Case 1 — No match → Create primary

**Risk:** Two identical requests arrive simultaneously. Both see "no match" → both insert a new primary → **two duplicate primaries exist**.

Without a transaction: **Broken.** You get duplicates.

---

### Case 2 — Exact match → No-op

**Risk:** Low. No writes happen. But it still reads stale data if another request is mid-flight creating a related contact.

Without a transaction: **Mostly safe**, but could return slightly stale consolidated data.

---

### Case 3 — Partial match → Create secondary

**Risk:** Two requests with the same partial overlap arrive together. Both see the same primary, both create a secondary → **two duplicate secondaries**.

Without a transaction: **Broken.** Duplicate secondaries.

---

### Case 4 — Two primaries linked → Downgrade newer

**Risk:** This is the most dangerous case. It involves:
- Reading two separate contact groups
- Deciding which is older
- **Updating** the newer primary's `linkPrecedence` to `"secondary"`
- **Re-linking** all of the newer primary's secondaries to the older primary

If two requests trigger this concurrently (e.g., different pairs of contacts that overlap), you could get **circular links** or **orphaned secondaries**.

Without a transaction: **Critically broken.** Data corruption is possible.

---

## Verdict: Yes, Use a Transaction

> **Every case except the pure read (Case 2) has a concurrency risk.** A transaction is not optional — it's required for correctness.

### What kind of transaction?

| Strategy | Guarantees | Performance | Recommendation |
|---|---|---|---|
| **`READ COMMITTED`** (Postgres default) | Prevents dirty reads, but two transactions can still read the same snapshot and both proceed | Good | ❌ Not sufficient alone |
| **`SERIALIZABLE`** | Full isolation — if two transactions conflict, one is aborted and retried | Slight overhead | ✅ Safest, simplest to reason about |
| **`READ COMMITTED` + advisory lock** | Lock on a deterministic key (e.g., hash of email+phone) so conflicting requests serialize | Good, minimal lock contention | ✅ Production-grade alternative |
| **`READ COMMITTED` + `SELECT ... FOR UPDATE`** | Lock the rows you read so no one else can modify them until you commit | Good | ✅ Best balance of safety and performance |

---

## Recommended Approach: `SELECT ... FOR UPDATE` inside a Transaction

```
BEGIN;

  -- Step 1: Query + lock matching rows
  SELECT * FROM contacts
  WHERE email = $email OR phone_number = $phone
  FOR UPDATE;

  -- Step 2: Process (in application code)
  -- Determine which case applies

  -- Step 3: Mutate
  -- INSERT / UPDATE as needed

COMMIT;
```

### Why this approach?

1. **`FOR UPDATE`** locks the matched rows — any concurrent request trying to read the same contacts will **block** until this transaction commits.
2. **Minimal lock scope** — only the rows involved in *this* request are locked. Unrelated contacts are unaffected.
3. **No retry logic needed** — unlike `SERIALIZABLE` (which can throw serialization errors requiring retry), `FOR UPDATE` simply blocks the second transaction until the first finishes.
4. **Simple in Drizzle** — Drizzle supports `db.transaction()` and raw SQL for `FOR UPDATE`.

---

## Drizzle Implementation Sketch

```typescript
import { db } from "./client";
import { contacts } from "./schema";
import { eq, or, sql } from "drizzle-orm";

const result = await db.transaction(async (tx) => {
  // 1. Query + lock
  const matches = await tx
    .select()
    .from(contacts)
    .where(
      or(
        email ? eq(contacts.email, email) : undefined,
        phoneNumber ? eq(contacts.phoneNumber, phoneNumber) : undefined
      )
    )
    .for("update");   // <-- locks the rows

  // 2. Decide which case
  // ... business logic ...

  // 3. Mutate if needed
  // await tx.insert(contacts).values({ ... });
  // await tx.update(contacts).set({ ... }).where( ... );

  // 4. Return consolidated response
  return consolidatedResponse;
});
```

> [!NOTE]
> Drizzle's `.for("update")` maps directly to `SELECT ... FOR UPDATE`. Check your Drizzle version supports it — if not, use `sql` template literals for the locking clause.

---

## What If We Don't Use Transactions?

Without any concurrency control:

| Scenario | Failure Mode |
|---|---|
| Two "brand new" requests with same data | Duplicate primary contacts |
| Two "partial match" requests | Duplicate secondary contacts |
| Two "link primaries" requests | Circular `linkedId` references, orphaned secondaries |
| High-traffic bursts | Unpredictable data corruption |

These are **not theoretical** — they *will* happen under any non-trivial load.

---

## Summary

| Question | Answer |
|---|---|
| Do we need a transaction? | **Yes, absolutely** |
| Which isolation level? | `READ COMMITTED` (default) is fine |
| What locking strategy? | `SELECT ... FOR UPDATE` on matching contact rows |
| Retry logic needed? | No (blocking, not aborting) |
| Performance impact? | Negligible — locks are row-level and short-lived |
