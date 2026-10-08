# Enable a second factor (MFA)

`AUTH_MFA` adds a step after the first login step:

| Value | Second factor | Who is affected |
| :-- | :-- | :-- |
| `none` (default) | nothing | nobody |
| `totp` | authenticator-app code (RFC 6238) or a recovery code | users who **enrolled**; others sign in without it |
| `otp` | a 6-digit code emailed at each login | every user (skipped after an emailed-code first step) |

## TOTP (authenticator app)

```env
AUTH_MFA=totp
AUTH_MFA_ENCRYPTION_KEY=<openssl rand -base64 32>   # encrypts the TOTP secrets at rest; required, 32 bytes base64
```

**Enrolment** (a signed-in user, from your settings screen):

```bash
# 1. get a pending secret + otpauth URI (render the URI as a QR code)
curl -s -X POST localhost:3000/auth/mfa/totp/setup -H "Authorization: Bearer $ACCESS"
# -> { "data": { "secret": "JBSW...", "otpauth_uri": "otpauth://totp/..." } }

# 2. confirm with the first code from the app: MFA is now on, recovery codes are returned ONCE
curl -s -X POST localhost:3000/auth/mfa/totp/confirm -H "Authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' -d '{"code":"482913"}'
# -> { "data": { "recovery_codes": ["ABCDE-FGHIJ", ... 10 codes] } }
```

Calling `setup` again before confirming only replaces the pending secret; once MFA is enabled `setup` and `confirm` answer `409`.

**Sign-in** then returns `status: "mfa_required"` with `mfa_method: "totp"`; send the code to `POST /auth/mfa/verify` with the `challenge_token`:

```bash
curl -s localhost:3000/auth/mfa/verify -H 'content-type: application/json' \
  -d '{"challenge_token":"<from login>","code":"482913"}'     # or a recovery code: "ABCDE-FGHIJ"
```

**Management** (all need the user to be signed in): `POST /auth/mfa/totp/disable` (password + a current code or recovery code), `POST /auth/mfa/totp/recovery-codes` (a current authenticator code; invalidates the old set).

Guarantees: the secret is encrypted (AES-256-GCM); a code can be used once (replay protection per time-step, window ±1 step); each recovery code works once; the challenge is single use and attempt-limited; wrong codes count towards the lockout. Every `/auth/mfa/totp/*` route answers `404` unless `AUTH_MFA=totp`.

**Enforcing enrolment** is a product decision the kit does not make: users without MFA still sign in. To require it, check `user.mfa_enabled` after login in your frontend, or add a guard that rejects users with `mfa_enabled = false` on sensitive routes.

**Lost device and no recovery codes:** there is no admin "reset MFA" endpoint. Either clear the user's `mfa_secrets` / `mfa_recovery_codes` rows and set `users.mfa_enabled = false` in the database, or add your own admin endpoint (permission-guarded, audited).

## Email code (`AUTH_MFA=otp`)

```env
AUTH_MFA=otp
AUTH_DELIVERY=email     # required in production (the app refuses to start otherwise)
```

After the first step the user gets `status: "mfa_required"`, `mfa_method: "otp"` and an emailed code, which they submit to `POST /auth/mfa/verify` exactly like TOTP. No enrolment is needed.

## Frontend contract

Switch on `status` only: `authenticated` → store tokens; `otp_required` → code form → `/auth/login/otp`; `mfa_required` → code form (label by `mfa_method`) → `/auth/mfa/verify`. The challenge token is valid for `AUTH_CHALLENGE_TTL_SECONDS` (300) and for `AUTH_OTP_MAX_ATTEMPTS` (5) wrong codes; on `INVALID_TOKEN` restart the login.

## Tests

`src/auth/login-flow.spec.ts` covers every `AUTH_METHODS` × `AUTH_MFA` combination, replay, recovery codes and attempt limits; `src/auth/account-flow.spec.ts` covers enrolment, disabling and recovery-code regeneration. The helper `totpNow(secret, offsetSteps)` produces codes for tests.
