export function makeActivationOwner<A>(options:{verifyExclusiveOwnership:()=>void|Promise<void>;loadFullApp:()=>A|Promise<A>}):Readonly<{start():Promise<A>}>;
