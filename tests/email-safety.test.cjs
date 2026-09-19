const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const dependencyRequire = process.env.PPAT_TEST_NODE_MODULES
  ? createRequire(path.join(process.env.PPAT_TEST_NODE_MODULES, '../package.json')) : require;
const express = dependencyRequire('express');
const { rateLimit } = dependencyRequire('express-rate-limit');
const root = path.resolve(__dirname, '..');
function load(file, bindings, exports) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
    .replace(/export default router;/, '').replace(/export /g, '');
  const context = vm.createContext({ ...bindings });
  vm.runInContext(source + '\n;globalThis.out = {' + exports.join(',') + '};', context);
  return context.out;
}
const validation = load('middleware/emailValidation.js', {}, ['isValidEmail', 'validateEmailInput']);
const protection = load('middleware/emailProtection.js', {...crypto, rateLimit}, ['emailRateLimits', 'preventDuplicateEmails']);
const { normalizeTime } = load("utils/normalizeTime.js", {}, ["normalizeTime"]);
const quiet = {log(){},error(){}};
const validContact = {name:'John Doe',email:'john@example.com',phone:'+44 7700 900123',subject:'quote',message:'Please send a quote.',website:''};
const validBooking = {customer_name:'John Doe',customer_email:'john@example.com',service_type:'cdg-paris',pickup_location:'CDG',destination:'Paris',booking_date:'2026-12-01',booking_time:'12:00'};
function fixture(route, options={}) {
  const calls=[], logs=[], calendarCalls=[];
  let updates=0, inserts=0;
  let booking={...validBooking,id:1,booking_number:'TEST-1',status:'pending',price:80,original_price:80,trip_type:'one_way',...options.booking};
  const accepted = new Map();
  const resend={emails:{send:async (payload,sendOptions)=>{
    if (sendOptions.idempotencyKey && accepted.has(sendOptions.idempotencyKey)) {
      const previous=accepted.get(sendOptions.idempotencyKey);
      assert.equal(JSON.stringify(payload),previous.payload,"Resend retry payload must remain identical");
      return previous.result;
    }
    calls.push({payload,options:sendOptions});
    if(options.pause) await options.pause;
    if(options.failAt===calls.length)return {error:{message:'SENSITIVE PROVIDER DATA'}};
    const result = {data:{id:'test-id-'+calls.length}};
    if (sendOptions.idempotencyKey) accepted.set(sendOptions.idempotencyKey,{result,payload:JSON.stringify(payload)});
    return result;
  }}};
  const {sendEmail}=load('utils/sendEmail.js',{...crypto,resend,...validation,console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}},['sendEmail']);
  const supabase={from:()=>{
    const filters=[];
    const query={select(){return this},eq(key,value){filters.push([key,value]);return this},single:async()=>({data:options.enforceIdentity && !filters.every(([key,value])=>booking[key]===value) ? null : booking,error:null}),
      insert(data){inserts++;booking={...booking,...data};return this},
      update(data){updates++;booking={...booking,...data};return this},
      then(resolve){return Promise.resolve({data:booking,error:null}).then(resolve)}};
    return query;
  }};
  const originalValidation=load('middleware/validation.js',{},['validateBookingData']);
  const bindings={express,normalizeTime,console:quiet,...validation,...protection,...originalValidation,sendEmail,supabase,
    FROM_EMAIL:'Company <booking@example.com>',REPLY_TO:'company@gmail.com',
    process:{env:{ADMIN_EMAIL:'admin@example.com',CLIENT_URL:'https://example.com',RESEND_TEMPLATE_CONTACT:'contact-template',RESEND_TEMPLATE_PENDING:'pending-template',RESEND_TEMPLATE_CONFIRMED:'confirmed-template',RESEND_TEMPLATE_MODIFIED:'modified-template',RESEND_TEMPLATE_CANCELLED:'cancelled-template'}},
    sanitizeMarketingAttribution:()=>null,cleanMarketingService:()=>'',formatInternalMarketingAttribution:()=>'',
    syncBookingCalendarEvents:async(value)=>{calendarCalls.push({...value});return {outboundEventId:null,returnEventId:null}},generateReference:async()=>'TEST-1',generateToken:()=> 'synthetic-test-token',
    requireAdmin:(req,res,next)=>next(),isSupportedService:()=>true,
    calculateBookingPrice:()=>({base:80,night:0,outboundNight:0,returnNight:0}),
    calculatePublicBookingPrice:()=>({finalPrice:80,discountAmount:0,discountLabel:''}),calculateAdminFinalPrice:()=>({finalPrice:80,discountAmount:0,discountLabel:''})};
  const {router}=load('routes/'+route+'.js',bindings,['router']);
  const app=express(); app.set('trust proxy',1); app.use(express.json());app.use(router);
  return {app,calls,logs,calendarCalls,get updates(){return updates},get inserts(){return inserts},get booking(){return booking}};
}
async function serve(t,fixture,fn){
 const server=fixture.app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections()}));
 const request=async(body,url='/',ip='203.0.113.10',operation='00000000-0000-4000-8000-000000000001')=>{
  const r=await fetch('http://127.0.0.1:'+server.address().port+url,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip,...(operation ? {'Idempotency-Key':operation} : {})},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),headers:r.headers};
 };
 await fn(request);
}
for(const email of ['', 'abc','abc@','abc@gmail','@gmail.com','test gmail.com','test\\@gmail.com',null,{},123])test('contact rejects email '+JSON.stringify(email),async t=>{
 const f=fixture('contact'); await serve(t,f,async post=>{assert.equal((await post({...validContact,email})).status,400);assert.equal(f.calls.length,0)});
});
test('contact preserves two emails, replyTo, template variable and duplicate response',async t=>{
 const f=fixture('contact');await serve(t,f,async post=>{
  const a=await post({...validContact,email:'  john@example.com  '});assert.equal(a.status,200);assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].payload.replyTo,validContact.email);assert.equal(f.calls[1].payload.replyTo,'company@gmail.com');
  assert.equal(f.calls[0].payload.template.variables.reply_to,validContact.email);
  assert.equal(f.calls[0].payload.template.id,'contact-template');assert.equal(f.calls[1].payload.to,validContact.email);
  assert.notEqual(f.calls[0].options.idempotencyKey,f.calls[1].options.idempotencyKey);
  const b=await post(validContact);assert.deepEqual(b.body,a.body);assert.equal(f.calls.length,2);
  assert.ok(!JSON.stringify(f.logs).includes(validContact.email));
 });
});
test('contact whitelist uses safe fallback',async t=>{
 const f=fixture('contact');await serve(t,f,async post=>{assert.equal((await post({...validContact,subject:'Untrusted subject'})).status,200);assert.equal(f.calls[0].payload.subject,'New Contact Request • Contact request')});
});
test('honeypot remains silent even for otherwise invalid body',async t=>{
 const f=fixture('contact');await serve(t,f,async post=>{assert.equal((await post({website:'bot'})).status,200);assert.equal(f.calls.length,0)});
});
for(const [field,value] of [['name','x'.repeat(151)],['message','x'.repeat(5001)],['phone','x'.repeat(51)],['subject','x'.repeat(81)],['phone','hello']])test('contact rejects invalid '+field,async t=>{
 const f=fixture('contact');await serve(t,f,async post=>{assert.equal((await post({...validContact,[field]:value})).status,400);assert.equal(f.calls.length,0)});
});
test('rate limiter returns 429 for one IP and permits another',async t=>{
 const f=fixture('contact');await serve(t,f,async post=>{for(let i=0;i<6;i++)assert.equal((await post(validContact)).status,200);const limited=await post(validContact);assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));assert.equal((await post(validContact,'/','203.0.113.11')).status,200)});
});
test('concurrent duplicate is rejected without a second send',async t=>{
 let release;const pause=new Promise(r=>release=r);const f=fixture('contact',{pause});await serve(t,f,async post=>{
  const first=post(validContact);while(!f.calls.length)await new Promise(r=>setTimeout(r,5));assert.equal((await post(validContact)).status,409);release();assert.equal((await first).status,200);assert.equal(f.calls.length,2);
 });
});
for(const [route,url,body] of [['contact','/',validContact],['booking','/',validBooking],['confirm','/',{token:'synthetic-test-token'}],['manage','/modify',{booking_number:'TEST-1',customer_email:validBooking.customer_email,notes:'Changed'}],['manage','/cancel',{booking_number:'TEST-1',customer_email:validBooking.customer_email}]]){
 test(route+url+' valid flow sends two emails',async t=>{const f=fixture(route);await serve(t,f,async post=>{assert.equal((await post(body,url)).status,200);assert.equal(f.calls.length,2);for(const c of f.calls){assert.ok(c.payload.replyTo);assert.equal(c.payload.reply_to,undefined)}})});
 for(const failAt of [1,2])test(route+url+' provider failure '+failAt+' returns 500 safely',async t=>{
  const f=fixture(route,{failAt});await serve(t,f,async post=>{const r=await post(body,url);assert.equal(r.status,500);assert.equal(r.body.success,false);assert.equal(f.calls.length,failAt);assert.ok(!JSON.stringify(f.logs).includes('SENSITIVE'));assert.equal((await post(body,url)).status,200);assert.equal(f.calls.length,3);if(route==="booking")assert.equal(f.inserts,1)});
 });
}
test('unchanged modification sends no email or DB update',async t=>{
 const f=fixture('manage');await serve(t,f,async post=>{const r=await post({booking_number:'TEST-1',customer_email:validBooking.customer_email},'/modify');assert.equal(r.status,200);assert.equal(f.calls.length,0);assert.equal(f.updates,0)});
});
for(const [field,value] of [['customer_email','abc'],['customer_email',{}],['notes','x'.repeat(5001)],['pickup_location','x'.repeat(501)],['terminal','x'.repeat(101)]])test('booking rejects '+field+' before DB and email',async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{assert.equal((await post({...validBooking,[field]:value})).status,400);assert.equal(f.inserts,0);assert.equal(f.calls.length,0)});
});
test('helper handles thrown transport errors, missing ID and invalid stored recipients',async()=>{
 for(const mode of ['throw','missing','recipient']){
  let calls=0;const logs=[];const {sendEmail}=load('utils/sendEmail.js',{...crypto,...validation,resend:{emails:{send:async()=>{calls++;if(mode==='throw')throw Error('SENSITIVE');return {data:{}}}}},console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}},['sendEmail']);
  await assert.rejects(sendEmail('test',{to:mode==='recipient'?'abc':'client@example.com'}));assert.equal(calls,mode==='recipient'?0:1);assert.ok(!JSON.stringify(logs).includes('SENSITIVE'));
 }
});

const opA='00000000-0000-4000-8000-00000000000a';
const opB='00000000-0000-4000-8000-00000000000b';
const opC='00000000-0000-4000-8000-00000000000c';
test('two legitimate identical bookings with different operation IDs',async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{
  assert.equal((await post(validBooking,'/','203.0.113.10',opA)).status,200);
  assert.equal((await post(validBooking,'/','203.0.113.10',opB)).status,200);
  assert.equal(f.inserts,2);assert.equal(f.calls.length,4);
 });
});
test('legacy requests without an operation ID are not deduplicated by payload',async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{
  await post(validBooking,'/','203.0.113.10',null);await post(validBooking,'/','203.0.113.10',null);assert.equal(f.inserts,2);
 });
});
test('same booking operation replay returns original response without another insert',async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{
  const first=await post(validBooking);assert.deepEqual((await post(validBooking)).body,first.body);
  assert.equal(f.inserts,1);assert.equal(f.calls.length,2);
 });
});
test('modification A to B to A restores the latest requested state',async t=>{
 const f=fixture('manage');await serve(t,f,async post=>{
  const body={booking_number:'TEST-1',customer_email:validBooking.customer_email};
  for(const [notes,id] of [['A',opA],['B',opB],['A',opC]]){
   assert.equal((await post({...body,notes},'/modify','203.0.113.10',id)).status,200);
   assert.equal(f.booking.notes,notes);
  }
  assert.equal(f.calls.length,6);
 });
});
test('same operation ID cannot be reused with different input',async t=>{
 const f=fixture('contact');await serve(t,f,async post=>{
  await post(validContact);assert.equal((await post({...validContact,message:'Changed'})).status,409);assert.equal(f.calls.length,2);
 });
});
test('time normalization preserves real differences including seconds',()=>{
 assert.equal(normalizeTime('12:00'),normalizeTime('12:00:00'));
 assert.equal(normalizeTime('12:00:00.000'),normalizeTime('12:00'));
 assert.notEqual(normalizeTime('12:00'),normalizeTime('12:30'));
 assert.notEqual(normalizeTime('12:00:01'),normalizeTime('12:00'));
});
for(const [time,count] of [['12:00',0],['12:30',2]])test('SQL time versus frontend '+time,async t=>{
 const f=fixture('manage',{booking:{booking_time:'12:00:00'}});await serve(t,f,async post=>{
  assert.equal((await post({booking_number:'TEST-1',customer_email:validBooking.customer_email,booking_time:time},'/modify')).status,200);
  assert.equal(f.calls.length,count);
 });
});
test('proxy one-hop verification: spoofed prefix ignored, additional hop detectable',async t=>{
 const app=express();app.set('trust proxy',1);app.use(express.json());app.post('/',(req,res)=>res.json({ip:req.ip,ips:req.ips}));
 await serve(t,{app},async post=>{
  assert.equal((await post({},'/', '198.51.100.99, 203.0.113.10')).body.ip,'203.0.113.10');
  assert.equal((await post({},'/', '203.0.113.10, 192.0.2.1')).body.ip,'192.0.2.1');
 });
});

test('proxy diagnostic compares chain without exposing addresses or headers',()=>{
 const {inspectProxyChain}=load('utils/proxyDiagnostics.js',{},['inspectProxyChain']);
 const report=inspectProxyChain({ip:'203.0.113.10',ips:['203.0.113.10'],socket:{remoteAddress:'127.0.0.1'},get:()=> '198.51.100.99, 203.0.113.10'},'203.0.113.10');
 assert.equal(report.ipMatchesExpectedClient,true);assert.equal(report.ipMatchesFirstForwarded,false);assert.equal(report.ipMatchesLastForwarded,true);
 assert.ok(!JSON.stringify(report).includes('203.0.113.10'));assert.ok(!JSON.stringify(report).includes('198.51.100.99'));
});
test('confirmation operation token supports a retry without a client header',async t=>{
 const f=fixture('confirm',{failAt:2});await serve(t,f,async post=>{
  const body={token:'synthetic-test-token'};
  assert.equal((await post(body,'/','203.0.113.10',null)).status,500);
  assert.equal((await post(body,'/','203.0.113.10',null)).status,200);
  assert.equal(f.calls.length,3);
 });
});

// The real manage routes run against mocked persistence, Calendar and Resend.
for (const metadata of [{}, {admin_user_id:'admin-test',price_override:false},
  {admin_user_id:'admin-test',price_override:true},
  {admin_user_id:'admin-test',price_override:true,service_type:'other'}]) {
 test('confirmed booking lookup and cancellation preserve administrative history '+JSON.stringify(metadata),async t=>{
  const history={price:185,calculated_price:240,discount_amount:25,original_price:210,
   internal_note:'Test note',internal_reference:'TEST-INTERNAL',override_reason:'Agreed price',...metadata};
  const f=fixture('manage',{enforceIdentity:true,booking:{...history,status:'confirmed'}});
  await serve(t,f,async post=>{
   const identity={booking_number:'TEST-1',customer_email:validBooking.customer_email};
   const found=await post(identity,'/find');assert.equal(found.status,200);
   assert.equal(found.body.booking.price,185);assert.equal(found.body.booking.internal_note,undefined);
   const cancelled=await post(identity,'/cancel');assert.equal(cancelled.status,200);
   assert.equal(f.booking.status,'cancelled');assert.ok(Number.isFinite(Date.parse(f.booking.cancelled_at)));
   for(const [field,value] of Object.entries(history))assert.equal(f.booking[field],value,field+' must remain unchanged');
   assert.equal(f.calendarCalls.length,1);assert.equal(f.calendarCalls[0].status,'cancelled');assert.equal(f.calendarCalls[0].price,185);
   assert.equal(f.calls.length,2);assert.equal(f.calls[0].payload.template.id,'cancelled-template');assert.equal(f.calls[0].payload.to,identity.customer_email);
   const updates=f.updates;
   const again=await post(identity,'/cancel','203.0.113.10',opB);assert.equal(again.status,200);assert.equal(again.body.message,'Booking already cancelled.');assert.equal(f.updates,updates);assert.equal(f.calendarCalls.length,1);assert.equal(f.calls.length,2);
  });
 });
}
for(const identity of [{booking_number:'TEST-1',customer_email:'wrong@example.com'},
 {booking_number:'WRONG',customer_email:validBooking.customer_email}, {booking_number:'TEST-1'}]) {
 test('find and cancel reject mismatched or missing identity '+JSON.stringify(identity),async t=>{
  const f=fixture('manage',{enforceIdentity:true,booking:{status:'confirmed',admin_user_id:'admin-test',price_override:true}});
  await serve(t,f,async post=>{
   for(const url of ['/find','/cancel'])assert.equal((await post(identity,url)).status,identity.customer_email?404:400);
   assert.equal(f.updates,0);assert.equal(f.calls.length,0);assert.equal(f.calendarCalls.length,0);
  });
 });
}
