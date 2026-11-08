import path from 'node:path';
import { verifyExperienceConsumers } from './consumer.mjs';
if (process.argv.length > 3) throw new Error('Usage: node mobile-experience/verify-consumers-cli.mjs [vendor/t3-mobile]');
console.log(await verifyExperienceConsumers(path.resolve(process.argv[2] ?? 'vendor/t3-mobile')));
