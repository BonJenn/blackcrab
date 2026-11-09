import {parseArgs} from 'node:util';
import {prepareRegistryMetadata} from './registry-metadata.mjs';
const {values}=parseArgs({options:{output:{type:'string'}}});
if(!values.output)throw Error('Pass --output <new absent owned public metadata directory>');
console.log(JSON.stringify(await prepareRegistryMetadata(values.output)));
