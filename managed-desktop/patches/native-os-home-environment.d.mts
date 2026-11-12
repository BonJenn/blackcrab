export type ManagedShellAuthority = Readonly<Record<string,string>>;
export function captureManagedShellAuthority(env:Readonly<Record<string,unknown>>):ManagedShellAuthority;
export function filterManagedShellEnvironment(authority:ManagedShellAuthority,candidate:Readonly<Record<string,string|null|undefined>>):Record<string,string|null|undefined>;
export function configureManagedEnvironment(app:{name:string;setPath(name:string,path:string):void;setAppLogsPath(path:string):void},root:string,env:Record<string,string|undefined>):Readonly<Record<string,string>>;
export function restoreManagedShellAuthority(env:Record<string,string|undefined>,authority:ManagedShellAuthority):void;
