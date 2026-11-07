import { smokeManagedHost } from '../managed-host/smoke.mjs';
if (process.argv.length !== 3) throw new Error('Pass the relocated managed-host artifact directory');
const report = await smokeManagedHost(process.argv[2]);
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
