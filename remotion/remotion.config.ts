import { Config } from '@remotion/cli/config';
Config.setVideoImageFormat('jpeg');
Config.overrideWebpackConfig((c) => c);
Config.setEntryPoint('./src/index.ts');
