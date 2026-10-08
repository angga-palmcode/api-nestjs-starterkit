import { ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, Min, ValidateNested } from 'class-validator';
import { AppException } from '../errors/app.exception';
import { createValidationPipe } from './validation.pipe';

class ChildDto {
  @IsEmail()
  email!: string;
}
class ParentDto {
  @IsInt()
  @Min(1)
  age!: number;

  @ValidateNested()
  @Type(() => ChildDto)
  child!: ChildDto;
}

const meta: ArgumentMetadata = { type: 'body', metatype: ParentDto };

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('passes valid input through (transformed to the DTO class)', async () => {
    const out: unknown = await pipe.transform(
      { age: 3, child: { email: 'a@example.com' } },
      meta,
    );
    expect(out).toBeInstanceOf(ParentDto);
  });

  it('throws a 422 AppException with flattened, dotted field errors', async () => {
    const err: unknown = await pipe
      .transform({ age: 0, child: { email: 'nope' }, extra: true }, meta)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    const exception = err as AppException;
    expect(exception.getStatus()).toBe(422);
    expect(exception.code).toBe('VALIDATION_ERROR');
    expect(exception.errors).toEqual(
      expect.arrayContaining([
        { field: 'age', message: 'age must not be less than 1' },
        { field: 'child.email', message: 'email must be an email' },
        { field: 'extra', message: 'property extra should not exist' },
      ]),
    );
  });
});
