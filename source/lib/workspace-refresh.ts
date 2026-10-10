export function canRefreshWorkspace(activity:{busy:boolean;modal:unknown;view:string},startedVersion:number,currentVersion:number){
 return !activity.busy&&!activity.modal&&activity.view!=='settings'&&startedVersion===currentVersion;
}
