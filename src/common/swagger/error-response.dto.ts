import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-code';

export class ErrorDetailDto {
  @ApiPropertyOptional({ example: 'email', description: 'Dotted input path' })
  field?: string;

  @ApiProperty({ example: 'email must be an email' })
  message!: string;
}

/** Schema of every non-2xx response (Blueprint A9). */
export class ErrorResponseDto {
  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiProperty({ enum: ErrorCode, example: ErrorCode.VALIDATION_ERROR })
  error_code!: ErrorCode;

  @ApiProperty({ example: '2026-10-08T10:00:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    description: 'Matches the X-Request-ID response header and server logs',
  })
  request_id?: string;

  @ApiPropertyOptional({
    type: [ErrorDetailDto],
    description: 'Present for validation failures',
  })
  errors?: ErrorDetailDto[];
}
