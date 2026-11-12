import {ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
/** In-memory actual ChildProcess references only. No PID-file, report or RPC import. */
export class BuildLifecycle {
 constructor({termMs=10000,killMs=5000}={}){this.controller=new AbortController();this.signal=this.controller.signal;this.records=new Set();this.termMs=termMs;this.killMs=killMs;this.reason=null;this.cancellation=null;}
 assertRunning(){if(this.signal.aborted)throw Error('Build cancelled');}
 capture(child,{label,detached}){
  if(!(child instanceof ChildProcess)||detached!==true)throw Error('Controlled build children require their own captured process group');
  const r={child,label,pid:child.pid??null,spawned:false,settled:false,retired:false,permissionUncertain:false};this.records.add(r);
  child.once('spawn',()=>{r.spawned=true;r.pid=child.pid;if(this.signal.aborted)this.send(r,'SIGTERM');});
  child.once('error',()=>{if(!r.spawned)r.retired=true;r.settled=true;});child.once('exit',()=>{r.settled=true;});
  if(this.signal.aborted&&r.pid)this.send(r,'SIGTERM');
 }
 alive(r){if(r.retired)return false;if(!r.spawned)return !r.settled;if(!r.pid)return !r.settled;if(r.child.pid!==r.pid||r.pid<=1||r.pid===process.pid)throw Error('Captured build child identity changed');try{process.kill(-r.pid,0);return true;}catch(e){if(e.code==='ESRCH'){r.retired=true;return false;}if(e.code==='EPERM'){r.permissionUncertain=true;return true;}throw e;}}
 send(r,signal){if(!r.pid||!r.spawned)return;if(this.alive(r)&&!r.permissionUncertain)try{process.kill(-r.pid,signal);}catch(e){if(e.code==='ESRCH')r.retired=true;else if(e.code==='EPERM')r.permissionUncertain=true;else throw e;}}
 async waitUntilEmpty(ms){const end=performance.now()+ms;while(performance.now()<end){if(![...this.records].some(r=>this.alive(r)))return true;await delay(50);}return ![...this.records].some(r=>this.alive(r));}
 cancel(reason){
  if(this.cancellation)return this.cancellation;if(this.reason===null)this.reason=reason;this.controller.abort();
  this.cancellation=(async()=>{for(const r of this.records)this.send(r,'SIGTERM');if(!await this.waitUntilEmpty(this.termMs)){for(const r of this.records)this.send(r,'SIGKILL');if(!await this.waitUntilEmpty(this.killMs))throw Error('Captured build groups did not quiesce');}return this.summary();})();const pending=this.cancellation;pending.then(()=>{if(this.cancellation===pending)this.cancellation=null;},()=>{if(this.cancellation===pending)this.cancellation=null;});return pending;
 }
 async finish(){if(this.signal.aborted)return this.cancel(this.reason??'cancelled');if(!await this.waitUntilEmpty(1000)){await this.cancel('build-left-owned-process-group');throw Error('Build left a captured process group');}return this.summary();}
 summary(){return {cancelled:this.signal.aborted,reason:this.reason,children:[...this.records].map(r=>({label:r.label,pid:r.pid,spawned:r.spawned,settled:r.settled,quiescent:r.retired,groupPermissionUncertain:r.permissionUncertain}))};}
}
