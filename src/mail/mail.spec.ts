import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Transporter } from 'nodemailer';
import { EMAIL_TRANSPORT } from '../common/email/email-transport';
import { AppLogger } from '../common/logger/app.logger';
import { baseEnv, testEnv } from '../../test/helpers/test-env';
import { validateEnv } from '../config/env.schema';
import { ConsoleEmailTransport, SmtpEmailTransport } from './email-transports';
import { MailModule } from './mail.module';

const message = {
  to: 'ani@example.com',
  subject: 'Reset your password',
  text: 'link: https://app.example.com/reset?token=SECRET',
};

describe('ConsoleEmailTransport', () => {
  const make = (nodeEnv: string) => {
    const log = jest.fn();
    return {
      log,
      transport: new ConsoleEmailTransport(
        { log } as unknown as AppLogger,
        { get: () => nodeEnv } as never,
      ),
    };
  };

  it('prints the body (codes, links) only in development', async () => {
    const dev = make('development');
    await dev.transport.send(message);
    expect(JSON.stringify(dev.log.mock.calls)).toContain('SECRET');
  });

  it.each(['production', 'test'])(
    'keeps secrets out of the log in %s',
    async (env) => {
      const { log, transport } = make(env);
      await transport.send(message);
      const printed = JSON.stringify(log.mock.calls);
      expect(printed).not.toContain('SECRET');
      expect(printed).toContain(message.to);
      expect(printed).toContain(message.subject);
    },
  );
});

describe('SmtpEmailTransport', () => {
  const options = {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    from: 'My App <no-reply@example.com>',
  };

  it('configures nodemailer (TLS, auth only when credentials exist, timeouts)', () => {
    const create = jest.fn((_options: object) => ({ sendMail: jest.fn() }));
    new SmtpEmailTransport(options, create);
    new SmtpEmailTransport({ ...options, user: 'u', password: 'p' }, create);

    const [anonymous, authenticated] = create.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(anonymous).toMatchObject({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      connectionTimeout: 10_000,
    });
    expect(anonymous).not.toHaveProperty('auth');
    expect(authenticated).toMatchObject({ auth: { user: 'u', pass: 'p' } });
  });

  it('sends with the configured From address, plain text and optional html', async () => {
    const sendMail = jest
      .fn<Promise<unknown>, [object]>()
      .mockResolvedValue({});
    const transport = new SmtpEmailTransport(options, () => ({
      sendMail: sendMail as unknown as Transporter['sendMail'],
    }));
    await transport.send(message);
    await transport.send({ ...message, html: '<b>hi</b>' });
    expect(sendMail).toHaveBeenNthCalledWith(1, {
      from: options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    expect(sendMail.mock.calls[1][0]).toMatchObject({ html: '<b>hi</b>' });
  });

  it('lets SMTP failures reject so callers can log them', async () => {
    const transport = new SmtpEmailTransport(options, () => ({
      sendMail: jest.fn().mockRejectedValue(new Error('connection refused')),
    }));
    await expect(transport.send(message)).rejects.toThrow('connection refused');
  });
});

describe('MailModule', () => {
  const compile = (env: Record<string, string>) => {
    // MailModule expects the app-wide ConfigService and AppLogger (both global in the real app)
    @Global()
    @Module({
      providers: [
        { provide: AppLogger, useValue: { log: jest.fn() } },
        { provide: ConfigService, useValue: new ConfigService(testEnv(env)) },
      ],
      exports: [AppLogger, ConfigService],
    })
    class FakeCoreModule {}
    return Test.createTestingModule({
      imports: [FakeCoreModule, MailModule],
    }).compile();
  };

  it('provides the console transport by default', async () => {
    const moduleRef = await compile({});
    expect(moduleRef.get(EMAIL_TRANSPORT)).toBeInstanceOf(
      ConsoleEmailTransport,
    );
  });

  it('provides SMTP when configured', async () => {
    const moduleRef = await compile({
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'no-reply@example.com',
    });
    expect(moduleRef.get(EMAIL_TRANSPORT)).toBeInstanceOf(SmtpEmailTransport);
  });
});

describe('mail environment validation', () => {
  const env = (o: Record<string, string | undefined>) =>
    validateEnv({ ...baseEnv, ...o });

  it('smtp needs a host and a From address', () => {
    expect(() => env({ MAIL_TRANSPORT: 'smtp' })).toThrow(
      /SMTP_HOST and MAIL_FROM/,
    );
    expect(() => env({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'h' })).toThrow(
      /MAIL_FROM/,
    );
    expect(() =>
      env({
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'h',
        MAIL_FROM: 'a@example.com',
      }),
    ).not.toThrow();
  });

  it('SMTP credentials come as a pair; defaults are sane', () => {
    expect(() => env({ SMTP_USER: 'u' })).toThrow(/SMTP_PASSWORD/);
    expect(env({})).toMatchObject({
      MAIL_TRANSPORT: 'console',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
    });
  });
});
