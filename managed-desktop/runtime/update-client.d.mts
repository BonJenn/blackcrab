export interface LauncherUpdateState {
  status: 'idle'|'checking'|'available'|'up-to-date'|'downloading'|'downloaded'|'error';
  currentVersion: string; availableVersion: string|null; downloadPercent: number|null;
  message: string|null; installing: boolean;
}
export interface LauncherUpdateReply { accepted:boolean; state:LauncherUpdateState }
export interface UpdateClient { close():void; request(action:'status'|'check'|'download'|'install', expectedVersion?:string|null):Promise<LauncherUpdateReply> }
export function openUpdateClient(control:{readonly kind:string;readonly fd?:number}):UpdateClient;
