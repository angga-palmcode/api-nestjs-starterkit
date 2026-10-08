import { AppLogger, LogFormat, LogLevel } from './app.logger';
import { requestContext } from '../request-context/request-context';

const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

function make(level: LogLevel = 'log', format: LogFormat = 'json') {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  const logger = new AppLogger({
    level,
    format,
    write: (line, lvl) => lines.push({ line, level: lvl }),
  });
  return { logger, lines };
}

describe('AppLogger', () => {
  it('writes one JSON entry with context', () => {
    const { logger, lines } = make();
    logger.log('hello', 'Bootstrap');
    const entry = parse(lines[0].line);
    expect(entry).toMatchObject({
      level: 'log',
      message: 'hello',
      context: 'Bootstrap',
    });
    expect(entry.timestamp).toEqual(expect.any(String));
  });

  it('merges object messages into the entry', () => {
    const { logger, lines } = make();
    logger.log({ message: 'http_request', status: 200 }, 'HTTP');
    expect(parse(lines[0].line)).toMatchObject({
      message: 'http_request',
      status: 200,
      context: 'HTTP',
    });
  });

  it('filters entries below the configured level', () => {
    const { logger, lines } = make('warn');
    logger.debug('no');
    logger.log('no');
    logger.warn('yes');
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
  });

  it('includes the request id from the current request context', () => {
    const { logger, lines } = make();
    requestContext.run({ request_id: 'req-12345678' }, () => logger.log('x'));
    expect(parse(lines[0].line).request_id).toBe('req-12345678');
  });

  it('captures the stack for errors (Nest style and Error instances)', () => {
    const { logger, lines } = make();
    logger.error('boom', 'at somewhere', 'Svc');
    logger.error(new Error('kaboom'));
    expect(parse(lines[0].line)).toMatchObject({
      message: 'boom',
      stack: 'at somewhere',
      context: 'Svc',
    });
    const second = parse(lines[1].line);
    expect(second.message).toBe('kaboom');
    expect(second.stack).toContain('Error: kaboom');
  });

  it('renders a readable line in pretty mode', () => {
    const { logger, lines } = make('verbose', 'pretty');
    logger.warn({ message: 'slow', ms: 12 }, 'Db');
    expect(lines[0].line).toMatch(/WARN\s+\[Db\] slow \{"ms":12\}$/);
  });

  it.each(['verbose', 'debug', 'fatal'] as const)('supports %s', (lvl) => {
    const { logger, lines } = make('verbose');
    logger[lvl]('m');
    expect(parse(lines[0].line).level).toBe(lvl);
  });
});
