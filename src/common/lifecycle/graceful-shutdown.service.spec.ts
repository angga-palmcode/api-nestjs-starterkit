import { GracefulShutdownService } from './graceful-shutdown.service';
import { AppLogger } from '../logger/app.logger';

describe('GracefulShutdownService', () => {
  const log = jest.fn();
  const logger = { log, error: jest.fn() } as unknown as AppLogger;
  const config = (timeout: number) => ({ get: () => timeout }) as never;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('does nothing for a programmatic close', () => {
    new GracefulShutdownService(
      config(1000),
      logger,
    ).beforeApplicationShutdown();
    expect(log).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('logs and arms a watchdog on a signal', () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    new GracefulShutdownService(config(1000), logger).beforeApplicationShutdown(
      'SIGTERM',
    );
    expect(log).toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });

  it('skips the watchdog when the timeout is 0', () => {
    new GracefulShutdownService(config(0), logger).beforeApplicationShutdown(
      'SIGINT',
    );
    expect(jest.getTimerCount()).toBe(0);
  });
});
