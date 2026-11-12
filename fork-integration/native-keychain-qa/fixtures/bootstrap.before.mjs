import * as Electron from 'electron';
import { readDescriptor, inspectProfile } from './managed-desktop/descriptor.mjs';
import { configureManagedEnvironment } from './managed-desktop/environment.mjs';
export const descriptor = readDescriptor(3);
const root = inspectProfile(descriptor);
configureManagedEnvironment(Electron.app,root,process.env);
