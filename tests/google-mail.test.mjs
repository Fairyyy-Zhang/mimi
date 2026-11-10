import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHmac} from 'node:crypto';
import {mailEdition} from '../supabase/functions/_shared/editions.mjs';
test('Apps Script 签名、过期、重复与投递不确定保护',()=>{
 const props=new Map([['MIMI_MAIL_SIGNING_SECRET','test-secret']]);let sent=0,fail=false;
 const context=vm.createContext({ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(p,s)=>Array.from(createHmac('sha256',s).update(p).digest())},MailApp:{getRemainingDailyQuota:()=>10,sendEmail:()=>{sent++;if(fail)throw Error('network');}}});
 vm.runInContext(fs.readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context);
 const checkPayload=JSON.stringify({action:'check',timestamp:Date.now()});
 const probe=()=>context.doPost({postData:{contents:JSON.stringify({payload:checkPayload,signature:createHmac('sha256','test-secret').update(checkPayload).digest('hex')})}});
 assert.equal(probe().status,'ready');
 props.set('MIMI_MAIL_SIGNING_SECRET','different');
 assert.equal(probe().error,'signature_mismatch');
 props.set('MIMI_MAIL_SIGNING_SECRET','test-secret');
 context.MailApp.getRemainingDailyQuota=()=>0;
 assert.equal(probe().error,'quota');
 context.MailApp.getRemainingDailyQuota=()=>{throw Error('private provider message');};
 assert.equal(probe().error,'quota_check_failed');
 context.MailApp.getRemainingDailyQuota=()=>10;
 assert.equal(props.size,1);
 assert.equal(sent,0);
 const call=(id,ts=Date.now(),bad=false)=>{const payload=JSON.stringify({id,timestamp:ts,to:'1436035656@qq.com',subject:'test',html:'test'});return context.doPost({postData:{contents:JSON.stringify({payload,signature:bad?'bad':createHmac('sha256','test-secret').update(payload).digest('hex')})}});};
 assert.equal(call('mimi-ab-2026-11-09',Date.now(),true).status,'failed');
 assert.equal(call('mimi-ab-2026-11-09',Date.now()-600000).status,'failed');assert.equal(sent,0);
 assert.equal(call('mimi-ab-2026-11-09').status,'sent');assert.equal(call('mimi-ab-2026-11-09').status,'sent');assert.equal(sent,1);
 fail=true;assert.equal(call('mimi-ab-2026-11-10').status,'uncertain');assert.equal(call('mimi-ab-2026-11-10').status,'uncertain');assert.equal(sent,2);
 fail=false;
 for (const slot of ['morning','afternoon','evening']) {
   const {id}=mailEdition(slot, Date.parse('2026-11-11T14:30:00+08:00'), 'abcdef01-0000-0000-0000-000000000001');
   assert.equal(call(id).status,'sent');
   assert.equal(call(id).status,'sent');
 }
 assert.equal(sent,5);
});
