/** Own only a reconnecting client lease. Never a listener, host process, or replay queue. */
export function createBrowserPeer({connect,config,validateCommand,begin,end,subscribe,dispatch,schedule=(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return()=>clearTimeout(timer);}}){
 let running=false,attempt=null,cancelRetry=null,failures=0;
 const current=a=>running&&attempt===a&&!a.retired;
 function retire(a){if(a.retired)return;a.retired=true;for(const work of a.commands)work.cancel();a.commands.clear();a.unsubscribe?.();a.unsubscribe=null;if(a.epoch)end(a.epoch);}
 function retry(){if(!running||cancelRetry)return;cancelRetry=schedule(()=>{cancelRetry=null;open();},Math.min(5000,100*2**Math.min(failures++,6)));}
 function open(){if(!running)return;const a={client:null,retired:false,epoch:null,unsubscribe:null,commands:new Set()};attempt=a;
  try{a.client=connect(config,{validateCommand,ready:epoch=>{if(!current(a)||a.epoch)return;failures=0;a.epoch=epoch;begin(epoch);void Promise.resolve().then(()=>{if(!current(a))return;a.unsubscribe=subscribe(event=>current(a)?a.client.send(event):Promise.resolve(false));}).catch(()=>{if(!current(a))return;a.client.close();retire(a);attempt=null;retry();});},command:(command,identity)=>{if(!current(a))return;const epoch=typeof identity==='string'?identity:identity.peerEpoch;const live=()=>current(a)&&a.epoch===epoch&&(typeof identity==='string'?a.client.state.peer?.epoch===identity:a.client.state.current(identity));if(live()){if(a.commands.size>=64){a.client.close();return;}const work=dispatch(command,epoch,live);if(work){a.commands.add(work);void Promise.resolve(work.done).catch(()=>{}).finally(()=>a.commands.delete(work));}}},retired:()=>{if(!current(a))return;retire(a);attempt=null;retry();}});a.client.socket.once('close',()=>{if(attempt!==a||!running)return;retire(a);attempt=null;retry();});}
  catch{retire(a);if(attempt===a)attempt=null;retry();}
 }
 return Object.freeze({start(){if(running)return;running=true;open();},stop(){running=false;cancelRetry?.();cancelRetry=null;const a=attempt;attempt=null;if(a){retire(a);a.client?.close();}}});
}
