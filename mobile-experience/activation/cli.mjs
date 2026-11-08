import {generateActivation,verifyActivation} from './generator.mjs';
const [mode,consumer,output]=process.argv.slice(2);
if(!['generate','verify'].includes(mode)||!consumer||!output)throw Error('Usage: node cli.mjs generate|verify VERIFIED_CONSUMER ABSENT_GENERATED_TREE');
console.log(JSON.stringify(await(mode==='generate'?generateActivation:verifyActivation)({consumer,output})));
