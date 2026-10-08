import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InviteUserDto } from './invite-user.dto';
import { UpdateUserDto } from './update-user.dto';

const errorsFor = async <T extends object>(cls: new () => T, plain: object) =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('InviteUserDto', () => {
  it('trims and lower-cases the email', async () => {
    const dto = plainToInstance(InviteUserDto, {
      email: '  Budi@Example.COM ',
      role: 'user',
    });
    expect(dto.email).toBe('budi@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    [{ email: 'nope', role: 'user' }, 'email'],
    [{ email: 'a@example.com', role: 'owner' }, 'role'],
    [{ email: 'a@example.com' }, 'role'],
    [{ email: `${'a'.repeat(250)}@example.com`, role: 'user' }, 'email'],
    [{ email: 'a@example.com', role: 'user', name: 'x'.repeat(121) }, 'name'],
  ])('rejects %j', async (plain, property) => {
    expect(await errorsFor(InviteUserDto, plain)).toContain(property);
  });

  it('keeps a non-string email so validation can reject it', async () => {
    expect(
      await errorsFor(InviteUserDto, { email: 42, role: 'user' }),
    ).toContain('email');
  });
});

describe('UpdateUserDto', () => {
  it('accepts partial updates', async () => {
    expect(await errorsFor(UpdateUserDto, {})).toEqual([]);
    expect(await errorsFor(UpdateUserDto, { name: 'Ani' })).toEqual([]);
    expect(await errorsFor(UpdateUserDto, { role: 'admin' })).toEqual([]);
  });

  it.each([{ name: '' }, { name: 'x'.repeat(121) }, { role: 'owner' }])(
    'rejects %j',
    async (plain) => {
      expect((await errorsFor(UpdateUserDto, plain)).length).toBeGreaterThan(0);
    },
  );
});
