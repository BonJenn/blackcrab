import {parseArgs} from 'node:util';
import {verifyArtifact} from '../managed-desktop/artifact.mjs';
const {values}=parseArgs({options:{artifact:{type:'string'},'manifest-sha256':{type:'string'}}});if(!values.artifact)throw Error('Pass --artifact <package> and optional trusted --manifest-sha256');
const manifest=await verifyArtifact(values.artifact,{expectedManifestSha256:values['manifest-sha256']});console.log(JSON.stringify({verified:true,kind:manifest.kind,files:manifest.files.length,electron:manifest.electron.version,availability:manifest.availability}));
