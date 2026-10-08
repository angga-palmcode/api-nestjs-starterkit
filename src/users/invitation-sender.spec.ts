import { AppLogger } from '../common/logger/app.logger';
import { ConsoleInvitationSender } from './invitation-sender';

const message = {
  email: 'a@example.com',
  role: 'user' as const,
  link: 'https://app.example.com/accept-invite?token=SECRET',
  expires_at: new Date(),
};

function make(nodeEnv: string) {
  const log = jest.fn();
  const config = { get: () => nodeEnv };
  const sender = new ConsoleInvitationSender(
    { log } as unknown as AppLogger,
    config as never,
  );
  return { sender, log };
}

describe('ConsoleInvitationSender', () => {
  it('prints the link in development', async () => {
    const { sender, log } = make('development');
    await sender.send(message);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ link: message.link }),
      'Invitations',
    );
  });

  it.each(['production', 'test'])(
    'never logs the secret link in %s',
    async (env) => {
      const { sender, log } = make(env);
      await sender.send(message);
      expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'invitation_created_without_sender',
        }),
        'Invitations',
      );
    },
  );
});
