import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE = 'skip_envelope';

/** Opt a controller/route out of the `{ data }` wrapper (probes, file downloads). */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE, true);
