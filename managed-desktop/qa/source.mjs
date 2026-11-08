import fs from 'node:fs/promises';import path from 'node:path';import {digest} from '../artifact.mjs';
/** These explicit QA-only deltas never enter the production patch registry or package. */
export async function applyQAPolicy(source){const changes=[];
 async function change(target,replacements){const file=path.join(source,target),before=await fs.readFile(file,'utf8');let after=before;for(const [a,b]of replacements){if(after.split(a).length!==2)throw Error('Private QA policy does not match uniquely');after=after.replace(a,()=>b);}await fs.writeFile(file,after);changes.push({target,beforeSha256:digest(before),afterSha256:digest(after),replacements});}
 await change('apps/desktop/src/main.ts',[[`import "./app/ManagedBootstrap.mjs";`,`import "./app/ManagedBootstrap.mjs";\nimport * as ManagedQA from "./app/ManagedQA.ts";`],['ElectronSafeStorage.layer,','ManagedQA.layerSafe,'],['BrowserImport.layer.pipe','ManagedQA.layerImport.pipe'],['Layer.provideMerge(PreviewPasskeys.layer)','Layer.provideMerge(ManagedQA.layerPasskey)']]);
 await change('apps/desktop/src/app/DesktopApp.ts',[['yield* snapShot.initialize;','yield* Effect.void; // Private QA: no capture shortcut or permission startup.']]);
 await change('apps/desktop/src/app/ManagedAuth.ts',[[`import { descriptor } from "./ManagedBootstrap.mjs";`,`import { descriptor } from "./ManagedBootstrap.mjs";\nimport * as ManagedQA from "./ManagedQA.ts";`],['createAccessSession({onRevoked:','createAccessSession({now:ManagedQA.now,onRevoked:']]);
 const payload=await fs.readFile(new URL('./ManagedQA.ts',import.meta.url));await fs.writeFile(path.join(source,'apps/desktop/src/app/ManagedQA.ts'),payload);changes.push({target:'apps/desktop/src/app/ManagedQA.ts',beforeSha256:null,afterSha256:digest(payload)});return changes;
}
