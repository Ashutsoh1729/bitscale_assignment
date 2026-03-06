# ═══════════════════════════════════════════════════════════
#  Hurl Integration Tests for POST /identify
#
#  Prerequisites:
#    1. Seed the DB:  bun src/db/seed.ts
#    2. Start server: bun run dev
#
#  Run all requests (local):
#    hurl --test --variables-file src/test/vars.env src/test/identify.hurl
#
#  Run with verbose output (see response bodies):
#    hurl --very-verbose --variables-file src/test/vars.env src/test/identify.hurl
# ═══════════════════════════════════════════════════════════


# ─── Health check ───

GET {{base_url}}/
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"


# ─── Case 1: No match → new primary ───

POST {{base_url}}/identify
Content-Type: application/json
{
    "email": "hurl_test_new@example.com",
    "phoneNumber": "1010101010"
}
HTTP 200
[Asserts]
jsonpath "$.contact.primaryContactId" isInteger
jsonpath "$.contact.emails" contains "hurl_test_new@example.com"
jsonpath "$.contact.phoneNumbers" contains "1010101010"
jsonpath "$.contact.secondaryContactIds" count == 0


# ─── Case 2: Exact match → no new row (Scenario B) ───

POST {{base_url}}/identify
Content-Type: application/json
{
    "email": "george@example.com",
    "phoneNumber": "1111111111"
}
HTTP 200
[Asserts]
jsonpath "$.contact.primaryContactId" isInteger
jsonpath "$.contact.emails" contains "george@example.com"
jsonpath "$.contact.phoneNumbers" contains "1111111111"


# ─── Case 2: Exact match on chain (Scenario E) ───

POST {{base_url}}/identify
Content-Type: application/json
{
    "email": "dave@example.com",
    "phoneNumber": "6666666666"
}
HTTP 200
[Asserts]
jsonpath "$.contact.primaryContactId" isInteger
jsonpath "$.contact.emails" contains "dave@example.com"
jsonpath "$.contact.phoneNumbers" contains "6666666666"


# ─── Case 3: Partial match — same email, new phone (Scenario C) ───

POST {{base_url}}/identify
Content-Type: application/json
{
    "email": "alice@example.com",
    "phoneNumber": "3333333333"
}
HTTP 200
[Asserts]
jsonpath "$.contact.primaryContactId" isInteger
jsonpath "$.contact.emails" contains "alice@example.com"
jsonpath "$.contact.phoneNumbers" contains "3333333333"
jsonpath "$.contact.secondaryContactIds" count >= 1


# ─── Case 3: Partial match — new email, same phone (Scenario C alt) ───

POST {{base_url}}/identify
Content-Type: application/json
{
    "email": "alice_hurl_new@example.com",
    "phoneNumber": "2222222222"
}
HTTP 200
[Asserts]
jsonpath "$.contact.primaryContactId" isInteger
jsonpath "$.contact.emails" contains "alice_hurl_new@example.com"
jsonpath "$.contact.phoneNumbers" contains "2222222222"
jsonpath "$.contact.secondaryContactIds" count >= 1


# ─── Case 4: Two primaries linked (Scenario D) ───

POST {{base_url}}/identify
Content-Type: application/json
{
    "email": "bob@example.com",
    "phoneNumber": "5555555555"
}
HTTP 200
[Asserts]
jsonpath "$.contact.primaryContactId" isInteger
jsonpath "$.contact.emails" contains "bob@example.com"
jsonpath "$.contact.phoneNumbers" contains "5555555555"


# ─── Validation: missing both fields → 400 ───

POST {{base_url}}/identify
Content-Type: application/json
{}
HTTP 400
[Asserts]
jsonpath "$.error" == "Email or phone number is required"


# ─── 404: wrong route ───

GET {{base_url}}/nonexistent
HTTP 404
