/** Optional build-controller hook. Never reconstructs process authority from disk. */
import {spawn} from 'node:child_process';
export async function controlledCommand(command,args,options,control){
 control.assertRunning();
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',overflow=false,timedOut=false;const timer=setTimeout(()=>{timedOut=true;void control.cancel('command-deadline-exceeded').catch(()=>{});},options.timeoutMs??30000);const maximum=options.maxBuffer??1024*1024;
  function collect(which,bytes){if(overflow)return;const text=bytes.toString();if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)+bytes.length>maximum){overflow=true;void control.cancel('bounded-command-output-exceeded').catch(()=>{});return;}if(which==='stdout')stdout+=text;else stderr+=text;}
  child.stdout.on('data',b=>collect('stdout',b));child.stderr.on('data',b=>collect('stderr',b));
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);if(timedOut||overflow||code!==0||control.signal.aborted)reject(Error('Controlled build command failed: '+(options.label??'build-command')+' (exit '+String(code)+')'));else resolve({stdout,stderr});});
  control.capture(child,{label:options.label??'build-command',detached:true});
 });
}
