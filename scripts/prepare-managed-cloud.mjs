import {parseArgs} from 'node:util';
import {prepareCloudSource} from '../managed-cloud/source.mjs';

const {values} = parseArgs({options: {archive: {type: 'string'}, 'cache-dir': {type: 'string'}}, strict: true});
if (!values.archive || !values['cache-dir']) {
  throw new Error('Usage: node scripts/prepare-managed-cloud.mjs --archive <pinned-t3.tar.gz> --cache-dir <new-source-parent>');
}
const result = await prepareCloudSource({archive: values.archive, cacheDir: values['cache-dir']});
console.log(JSON.stringify({state: 'ORIGINAL_CLOUD_SOURCE_PREPARED', root: result.root,
  manifest: result.manifestPath, typecheckPassed: false, deployed: false}, null, 2));
