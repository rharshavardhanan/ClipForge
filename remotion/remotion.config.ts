import { Config } from '@remotion/cli/config';
Config.setVideoImageFormat('png');
Config.overrideWebpackConfig((c) => c);
Config.setEntryPoint('./src/index.ts');
// Browser/bundle setup shares this timeout (default 30s) — too tight when the Mac is under
// load (parallel test suites, batch renders, dev servers): setPropsAndEnv times out and the
// clip dies after retries. 120s absorbs load spikes; the renderers' own 180s no-output stall
// watchdog still kills truly hung renders.
Config.setTimeoutInMilliseconds(120_000);
