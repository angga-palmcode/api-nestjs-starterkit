# Enable passwordless email-code login (OTP)

With `AUTH_METHODS=password,otp` a user can sign in with an emailed 6-digit code **instead of** a password. It adds an alternative first step to the login state machine; it is not a second factor (for that see [enable-mfa.md](enable-mfa.md)).

## Turn it on

```env
AUTH_METHODS=password,otp
AUTH_DELIVERY=console          # development: the code is printed in the server log
AUTH_OTP_MAX_ATTEMPTS=5        # wrong codes allowed per challenge
AUTH_CHALLENGE_TTL_SECONDS=300 # code and challenge validity
```

Production needs a real channel, and the app refuses to start without it:

```env
AUTH_DELIVERY=email            # needs the mail module (MAIL_TRANSPORT=smtp) or your own EMAIL_TRANSPORT
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example.com
MAIL_FROM="My App <no-reply@example.com>"
```

## The flow

```bash
# 1. ask for a code: send the email WITHOUT a password
curl -s localhost:3000/auth/login -H 'content-type: application/json' -d '{"email":"ani@example.com"}'
# -> { "data": { "status": "otp_required", "next_step": "verify_otp", "challenge_token": "...", "expires_in": 300 } }

# 2. submit the code from the email
curl -s localhost:3000/auth/login/otp -H 'content-type: application/json' \
  -d '{"challenge_token":"<from step 1>","code":"482913"}'
# -> authenticated (tokens), or mfa_required if AUTH_MFA=totp and the user enrolled
```

Frontend: switch on `status`. `otp_required` shows a code input and keeps `challenge_token`; on `authenticated` store the tokens. The same response shape is used for every flag combination.

In development the code appears in the server log (`otp_code`) because the console adapter prints secrets only when `NODE_ENV=development`.

## Behaviour worth knowing

- The challenge is **single use** and allows `AUTH_OTP_MAX_ATTEMPTS` wrong codes; after that even the right code is refused and the user starts over.
- Step 1 answers identically for an unknown, disabled or locked address (a decoy challenge is returned, no email is sent), so it cannot be used to discover accounts.
- Receiving the code proves the mailbox, so an unverified address becomes verified.
- Wrong codes count towards the account lockout; the lockout check also runs at step 2.
- After an emailed-code login the **email** second factor (`AUTH_MFA=otp`) is skipped (the mailbox was just proven); a TOTP second factor is still required for users who enrolled.
- Requests are rate limited (`POST /auth/login` and `/auth/login/otp`: 10 per minute per client by default, plus the global limit).
- There is no "resend code" endpoint: starting again from step 1 sends a fresh code.

## Tests

`src/auth/login-flow.spec.ts` ("passwordless OTP login: security") shows how to drive and assert this flow with `bootAuth` and the captured mail.
