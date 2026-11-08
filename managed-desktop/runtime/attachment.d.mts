export function createAttachment(input:{verify:()=>Promise<void>;onReady:()=>Promise<void>|void;onDetach?:()=>void}):Readonly<{readonly ready:boolean;start:()=>Promise<void>;stop:()=>void}>;
