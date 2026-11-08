import { prepareExperienceConsumers } from './consumer.mjs';
const [preparation, output, ...extra] = process.argv.slice(2);
if (!preparation || !output || extra.length) throw new Error('Usage: node mobile-experience/build-consumers-cli.mjs <authenticated-preparation> <absent-output>');
console.log(await prepareExperienceConsumers({ preparation, output }));
