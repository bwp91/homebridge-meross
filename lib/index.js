import { createRequire } from 'module';
import merossPlatform from './platform.js';

const require = createRequire(import.meta.url);
const plugin = require('../package.json');

export default (hb) => hb.registerPlatform(plugin.alias, merossPlatform);
