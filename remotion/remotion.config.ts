import { Config } from '@remotion/cli/config';
Config.setVideoImageFormat('png');
Config.overrideWebpackConfig((c) => c);
Config.setEntryPoint('./src/index.ts');
