import { parseArgs } from 'node:util';
import { prepareCloudClients } from '../managed-cloud/clients.mjs';
const { values } = parseArgs({ options: { archive: { type: 'string' }, cache: { type: 'string' } } });
if (!values.archive || !values.cache) throw new Error('Pass --archive <pinned T3 archive> --cache <private source directory>');
console.log(JSON.stringify(await prepareCloudClients({ archive: values.archive, cacheDir: values.cache })));
