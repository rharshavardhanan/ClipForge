import { join } from 'node:path';
import ora from 'ora';
import { download } from '../../ingest/downloader.js';
import { extractMetadata } from '../../ingest/metadataExtractor.js';
import { getTranscript } from '../../transcript/transcriptManager.js';
import { resolveJobId } from './all.js';
import { logger } from '../../utils/logger.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export async function runIngest(url: string): Promise<void> {
  const jobId = resolveJobId(url);
  const sp = ora('Ingesting…').start();
  const dl = await download(url, join(WS, 'downloads', jobId));
  const meta = await extractMetadata(dl.videoPath, dl.infoJsonPath, jobId, join(WS, 'transcripts', jobId, 'metadata.json'));
  const segments = await getTranscript({ jobId, videoPath: dl.videoPath, subtitlePath: dl.subtitlePath, outPath: join(WS, 'transcripts', jobId, 'transcript.json') });
  sp.succeed(`Ingested "${meta.title}" — ${segments.length} segments. jobId=${jobId}`);
  logger.info(`Artifacts in ${join(WS, 'downloads', jobId)} and ${join(WS, 'transcripts', jobId)}`);
}
