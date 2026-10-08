import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.dto';

export enum LoginStatus {
  authenticated = 'authenticated',
  otp_required = 'otp_required',
  mfa_required = 'mfa_required',
}

export enum NextStep {
  verify_otp = 'verify_otp',
  verify_mfa = 'verify_mfa',
}

/**
 * The single response contract of the login state machine (Blueprint A5). It is the same
 * shape for every AUTH_METHODS / AUTH_MFA combination, so a frontend only switches on `status`:
 *
 *   credentials -> [otp_required -> POST /auth/login/otp] -> [mfa_required -> POST /auth/mfa/verify] -> authenticated
 */
export class LoginResponseDto {
  @ApiProperty({ enum: LoginStatus, example: LoginStatus.authenticated })
  status!: LoginStatus;

  @ApiProperty({
    enum: NextStep,
    nullable: true,
    example: null,
    description: 'Which endpoint finishes the login; null once authenticated',
  })
  next_step!: NextStep | null;

  @ApiPropertyOptional({
    description: 'Short-lived, single-use; send it back with the code',
  })
  challenge_token?: string;

  @ApiPropertyOptional({
    enum: ['totp', 'otp'],
    description: 'Present with mfa_required',
  })
  mfa_method?: 'totp' | 'otp';

  @ApiPropertyOptional({
    example: 900,
    description: 'Seconds the access token / challenge is valid',
  })
  expires_in?: number;

  @ApiPropertyOptional()
  access_token?: string;

  @ApiPropertyOptional()
  refresh_token?: string;

  @ApiPropertyOptional({ example: 'Bearer' })
  token_type?: 'Bearer';

  @ApiPropertyOptional({ type: UserDto })
  user?: UserDto;
}

const JWT_EXAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjhmYWQ1YiIsInNpZCI6IjZmYTQ1OWVhIiwidmVyIjowfQ.k3Jx0w1e9Qd2n8c0Yp5uB7sT4vR6mZ1aH3lKq9XoE2g';

const USER_EXAMPLE = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  email: 'ani.wijaya@example.com',
  name: 'Ani Wijaya',
  role: 'admin',
  is_active: true,
  email_verified: true,
  mfa_enabled: false,
  last_login_at: '2026-10-08T09:30:00.000Z',
  created_at: '2026-09-01T08:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
};

/** One example per state of the login state machine (shown in Swagger). */
export const LOGIN_EXAMPLES = {
  authenticated: {
    summary: 'authenticated: tokens issued',
    value: {
      data: {
        status: 'authenticated',
        next_step: null,
        access_token: JWT_EXAMPLE,
        refresh_token: 'v3x0S3m1o0Ck-ReFrEsH-ToKeN-ExAmPlE_0123456789ab',
        token_type: 'Bearer',
        expires_in: 900,
        user: USER_EXAMPLE,
      },
    },
  },
  otp_required: {
    summary:
      'otp_required: an emailed code must be submitted to POST /auth/login/otp',
    value: {
      data: {
        status: 'otp_required',
        next_step: 'verify_otp',
        challenge_token: JWT_EXAMPLE,
        expires_in: 300,
      },
    },
  },
  mfa_required_totp: {
    summary:
      'mfa_required (totp): authenticator or recovery code, POST /auth/mfa/verify',
    value: {
      data: {
        status: 'mfa_required',
        next_step: 'verify_mfa',
        mfa_method: 'totp',
        challenge_token: JWT_EXAMPLE,
        expires_in: 300,
      },
    },
  },
  mfa_required_otp: {
    summary: 'mfa_required (otp): emailed code, POST /auth/mfa/verify',
    value: {
      data: {
        status: 'mfa_required',
        next_step: 'verify_mfa',
        mfa_method: 'otp',
        challenge_token: JWT_EXAMPLE,
        expires_in: 300,
      },
    },
  },
} as const;

export class TokenPairDto {
  @ApiProperty()
  access_token!: string;

  @ApiProperty()
  refresh_token!: string;

  @ApiProperty({ example: 'Bearer' })
  token_type!: 'Bearer';

  @ApiProperty({ example: 900 })
  expires_in!: number;
}

export class MessageDto {
  @ApiProperty({
    example: 'If the address is registered, an email is on its way.',
  })
  message!: string;
}

export class SessionDto {
  @ApiProperty({ example: '6fa459ea-ee8a-3ca4-894e-db77e160355e' })
  id!: string;

  @ApiPropertyOptional({
    example: 'Mozilla/5.0 (X11; Linux x86_64)',
    nullable: true,
  })
  user_agent!: string | null;

  @ApiPropertyOptional({ example: '203.0.113.7', nullable: true })
  ip!: string | null;

  @ApiProperty({ example: '2026-10-08T09:30:00.000Z' })
  created_at!: Date;

  @ApiProperty({ example: '2026-10-08T10:15:00.000Z' })
  last_seen_at!: Date;

  @ApiProperty({
    example: true,
    description: 'The session of the token used for this request',
  })
  current!: boolean;
}

export class TotpSetupDto {
  @ApiProperty({ example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' })
  secret!: string;

  @ApiProperty({
    example:
      'otpauth://totp/Nest%20Starter%20Kit:ani%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nest+Starter+Kit',
    description: 'Render as a QR code for the authenticator app',
  })
  otpauth_uri!: string;
}

export class RecoveryCodesDto {
  @ApiProperty({
    type: [String],
    example: ['ABCDE-FGHIJ', 'KLMNO-PQRST'],
    description: 'Shown once. Each code works a single time.',
  })
  recovery_codes!: string[];
}
