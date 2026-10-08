import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/** bcrypt only uses the first 72 bytes, so longer passwords are rejected instead of silently truncated. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class LoginDto {
  @ApiProperty({ example: 'ani.wijaya@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({
    example: 'correct horse battery staple',
    description:
      'Omit to start a passwordless email-code login (only when AUTH_METHODS includes otp).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ description: 'From the `otp_required` login response' })
  @IsString()
  @IsNotEmpty()
  challenge_token!: string;

  @ApiProperty({ example: '482913' })
  @Transform(trim)
  @IsString()
  @Length(4, 12)
  code!: string;
}

export class VerifyMfaDto {
  @ApiProperty({ description: 'From the `mfa_required` login response' })
  @IsString()
  @IsNotEmpty()
  challenge_token!: string;

  @ApiProperty({
    example: '482913',
    description:
      'Authenticator code, emailed code, or (TOTP mode) a recovery code like ABCDE-FGHIJ',
  })
  @Transform(trim)
  @IsString()
  @Length(4, 32)
  code!: string;
}

export class RefreshDto {
  @ApiProperty({ example: 'v3x0S3m1o0Ck-ReFrEsH-ToKeN-ExAmPlE_0123456789ab' })
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ani.wijaya@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the reset link' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'a-new-long-passphrase' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MaxLength(PASSWORD_MAX)
  current_password!: string;

  @ApiProperty({ example: 'a-new-long-passphrase' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  new_password!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token from the verification link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'ani.wijaya@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class AcceptInviteDto {
  @ApiProperty({ description: 'Token from the invitation link' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'a-long-passphrase-of-your-own' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiPropertyOptional({ example: 'Budi Santoso' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'ani.wijaya@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'a-long-passphrase-of-your-own' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiProperty({ example: 'Ani Wijaya' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class UpdateMeDto {
  @ApiProperty({ example: 'Ani Wijaya' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class TotpConfirmDto {
  @ApiProperty({ example: '482913' })
  @Transform(trim)
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class TotpDisableDto {
  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiProperty({
    example: '482913',
    description: 'Authenticator code or an unused recovery code',
  })
  @Transform(trim)
  @IsString()
  @Length(6, 32)
  code!: string;
}
