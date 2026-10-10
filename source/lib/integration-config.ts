import {makeReady,type MakeConfig} from './make';
export type IntegrationConfig=MakeConfig&{MAKE_SYNC_ENABLED?:string;AI_ENABLED?:string;AI_API_KEY?:string;COMPANY_MAILBOX?:string};
export const syncEnabled=(config:IntegrationConfig)=>config.MAKE_SYNC_ENABLED==='true'&&makeReady(config)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.COMPANY_MAILBOX?.trim()??'');
export const aiEnabled=(config:IntegrationConfig)=>config.AI_ENABLED==='true'&&!!config.AI_API_KEY?.trim();
export function integrationStatus(config:IntegrationConfig){return {make:makeReady(config),syncEnabled:syncEnabled(config),ai:aiEnabled(config),mailbox:config.COMPANY_MAILBOX?.trim()??''};}
