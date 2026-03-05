# Case 1 Deep Dive: Do We Need a Transaction?

**Date:** 2026-03-05  
**Current code:**

```typescript
// CASE: 1 - No prior data exists
if (existingContacts.length === 0) {
    await db.insert(contacts).values({
        email,
        phoneNumber,
        linkPrecedence: "primary",
    });
}
```

---

## Your Question

> "For Case 1, we just insert a new row. Why can't we just insert directly? How does a transaction help here?"

Good question. Let's walk through it.

---

## What Happens Without a Transaction

Your current code does two **separate** database operations:

```
  Time
   │
   ▼
   ── SELECT (find matches) ──────── no results ✓
   │
   │   ← gap (you're back in Node.js, deciding) 
   │
   ── INSERT (create primary) ────── done ✓
```

A single request in isolation? This works perfectly.

---

## The Problem: Two Concurrent Requests

Imagine two identical requests arrive at the **exact same time** with `{ email: "new@test.com", phoneNumber: "9999" }`:

```
  Request A                              Request B
   │                                       │
   ── SELECT → 0 rows ✓                   │
   │                                       ── SELECT → 0 rows ✓  (A hasn't inserted yet!)
   │                                       │
   ── INSERT primary ✓                     │
   │                                       ── INSERT primary ✓   (doesn't know about A's row)
   │                                       │
   ▼                                       ▼

  Result: TWO primary contacts with the same email + phone 💥
```

Both SELECTs ran before either INSERT, so both saw 0 rows, and both decided to create a new primary. Now you have **duplicate primaries** — violating the "one primary per identity" rule.

---

## How a Transaction Fixes This

Wrap the SELECT + INSERT in a transaction with `FOR UPDATE` (or use `SERIALIZABLE` isolation):

```
  Request A                              Request B
   │                                       │
   ── BEGIN                                │
   ── SELECT FOR UPDATE → 0 rows ✓        │
   │                                       ── BEGIN
   │                                       ── SELECT FOR UPDATE → ⏳ BLOCKED
   ── INSERT primary ✓                     │  (waiting for A's transaction to finish)
   ── COMMIT                               │
   │                                       ── (A committed, B's SELECT now runs)
   │                                       ── SELECT FOR UPDATE → 1 row found!
   │                                       ── (Not Case 1 anymore — falls into Case 2 or 3)
   │                                       ── COMMIT
   ▼                                       ▼

  Result: ONE primary, no duplicates ✓
```

The transaction ensures that between reading and writing, **no one else can sneak in a conflicting write**.

---

## But Wait — `FOR UPDATE` Locks Rows. Case 1 Has No Rows to Lock!

This is a very sharp observation if you're thinking it. `SELECT ... FOR UPDATE` locks **existing rows**. When there are zero matches, there are zero rows to lock — so another transaction can still slip through.

### Solutions for the "zero rows" problem:

| Approach | How it works | Trade-off |
|---|---|---|
| **Unique constraint** on `(email, phoneNumber)` | The second INSERT would fail with a DB constraint error. Catch it and retry. | You probably don't want a unique constraint on *both* columns together, since the same email can appear with different phones (that's the whole point of linking). |
| **Advisory lock** | `SELECT pg_advisory_xact_lock(hash(email, phone))` — acquires a virtual lock on a computed key. No rows needed. | Clean solution. Slightly more complex. |
| **`SERIALIZABLE` isolation** | Postgres detects the read-write conflict automatically and aborts one transaction. You retry. | Simplest code. Requires a retry loop. |
| **Partial unique indexes** | Create a unique index on `email` WHERE `linkPrecedence = 'primary'` and another on `phoneNumber` WHERE `linkPrecedence = 'primary'`. | Catches duplicates at the DB level as a safety net. Good to have regardless. |

### Recommended: Advisory Lock + Unique Index as Safety Net

```typescript
const result = await db.transaction(async (tx) => {
    // Lock on a deterministic key — prevents concurrent identical requests
    const lockKey = hashCode(`${email}:${phoneNumber}`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    // Now query safely
    const existing = await tx
        .select()
        .from(contacts)
        .where(or(
            email ? eq(contacts.email, email) : undefined,
            phoneNumber ? eq(contacts.phoneNumber, phoneNumber) : undefined,
        ));

    if (existing.length === 0) {
        const [newContact] = await tx
            .insert(contacts)
            .values({ email, phoneNumber, linkPrecedence: "primary" })
            .returning();
        return newContact;
    }

    // ... handle other cases
});
```

The advisory lock serializes requests with the same email/phone combo. The lock is automatically released when the transaction commits or rolls back.

---

## Do You Need This Right Now?

Honestly, for an assignment, the risk of concurrent duplicate requests is near zero. But here's how to think about it:

| Context | Recommendation |
|---|---|
| **Assignment / demo** | Your current code is fine. Maybe add a comment noting the race condition. |
| **Production** | Transaction + advisory lock (or SERIALIZABLE + retry). |
| **Middle ground** | Use `db.transaction()` wrapper now, add advisory locks later if needed. |

The transaction wrapper is cheap to add and doesn't hurt anything, so wrapping it now is a good habit even for the assignment.

---

## Summary

- **Without a transaction:** Two concurrent Case 1 requests can both create primaries → duplicates.
- **`FOR UPDATE` alone** doesn't help for Case 1 because there are no rows to lock.
- **Advisory locks** or **`SERIALIZABLE` isolation** solve the "no rows to lock" problem.
- **Unique partial indexes** are a great DB-level safety net regardless of application logic.
- For an assignment, your current approach works. Just be aware of the gap.
