/** Serialized, non-destructive catalog ownership. Codec is the pinned SDK codec. */
export function createCatalogState<T>(storage: {getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>}, codec: {decode(raw:string):T;encode(value:T):string;empty:T}, key="blackcrab.mobile.managedCatalog.v1") {
  let loaded=false, value:T=codec.empty;let tail:Promise<unknown>=Promise.resolve();
  const failure=()=>new Error("Could not access saved managed environments. Your saved data was preserved.");
  const locked=<A>(work:()=>Promise<A>):Promise<A>=>{const next=tail.catch(()=>{}).then(work);tail=next.catch(()=>{});return next;};
  const load=async()=>{if(loaded)return value;try{const raw=await storage.getItem(key);const next=raw===null?codec.empty:codec.decode(raw);value=next;loaded=true;return next;}catch{throw failure();}};
  return {
    read:()=>locked(load),
    update:(transform:(current:T)=>T)=>locked(async()=>{const current=await load();try{const next=transform(codec.decode(codec.encode(current)));const raw=codec.encode(next);await storage.setItem(key,raw);value=next;loaded=true;}catch{throw failure();}}),
  };
}
