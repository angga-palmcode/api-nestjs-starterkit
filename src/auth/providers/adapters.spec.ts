import type { EmailMessage } from '../../common/email/email-transport';
import { AppLogger } from '../../common/logger/app.logger';
import { ConsoleAuthNotifier, ConsoleOtpSender } from './console-adapters';
import { EmailAuthNotifier, EmailOtpSender } from './email-adapters';

const link = {
  email: 'a@example.com',
  name: 'Ani',
  link: 'https://app.example.com/x?token=SECRET',
  expires_at: new Date(Date.now() + 30 * 60_000),
};

function consoleAdapters(nodeEnv: string) {
  const log = jest.fn();
  const config = { get: () => nodeEnv } as never;
  const logger = { log } as unknown as AppLogger;
  return {
    log,
    otp: new ConsoleOtpSender(logger, config),
    notifier: new ConsoleAuthNotifier(logger, config),
  };
}

describe('console adapters', () => {
  it('print codes and links only in development', async () => {
    const { log, otp, notifier } = consoleAdapters('development');
    await otp.send({
      email: 'a@example.com',
      code: '123456',
      purpose: 'login',
      expires_at: new Date(),
    });
    await notifier.sendEmailVerification(link);
    await notifier.sendPasswordReset(link);
    const printed = JSON.stringify(log.mock.calls);
    expect(printed).toContain('123456');
    expect(printed).toContain('SECRET');
    expect(log).toHaveBeenCalledTimes(3);
  });

  it.each(['production', 'test'])('never print secrets in %s', async (env) => {
    const { log, otp, notifier } = consoleAdapters(env);
    await otp.send({
      email: 'a@example.com',
      code: '123456',
      purpose: 'mfa',
      expires_at: new Date(),
    });
    await notifier.sendEmailVerification(link);
    await notifier.sendPasswordReset(link);
    await notifier.sendAccountLocked({
      email: 'a@example.com',
      locked_until: new Date(),
    });
    const printed = JSON.stringify(log.mock.calls);
    expect(printed).not.toContain('123456');
    expect(printed).not.toContain('SECRET');
    expect(printed).toContain('_not_delivered');
  });
});

describe('email adapters', () => {
  const send = jest.fn<Promise<void>, [EmailMessage]>().mockResolvedValue();
  const transport = { send };
  beforeEach(() => send.mockClear());

  it('send OTP codes through the transport', async () => {
    await new EmailOtpSender(transport).send({
      email: 'a@example.com',
      code: '482913',
      purpose: 'login',
      expires_at: new Date(Date.now() + 5 * 60_000),
    });
    expect(send).toHaveBeenCalledWith({
      to: 'a@example.com',
      subject: 'Your verification code: 482913',
      text: expect.stringContaining('482913') as string,
    });
    const text = send.mock.calls[0][0].text;
    expect(text).toContain('sign in');
    expect(text).toMatch(/expires in [45] minutes/);
  });

  it('send the lifecycle emails', async () => {
    const notifier = new EmailAuthNotifier(transport);
    await notifier.sendEmailVerification(link);
    await notifier.sendPasswordReset(link);
    await notifier.sendAccountLocked({
      email: 'a@example.com',
      locked_until: new Date('2026-10-08T10:00:00Z'),
    });
    const sent = send.mock.calls.map((c) => c[0]);
    expect(sent.map((m) => m.subject)).toEqual([
      'Verify your email address',
      'Reset your password',
      'Your account was temporarily locked',
    ]);
    expect(sent[0].text).toContain('Hello Ani');
    expect(sent[0].text).toContain(link.link);
    expect(sent[2].text).toContain('2026-10-08T10:00:00.000Z');
  });
});
