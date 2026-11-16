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
const phone = require('../utils/phone.cjs');

function load(file, bindings, exports) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
    .replace(/export default router;/, '').replace(/export /g, '');
  const context = vm.createContext({ ...bindings });
  vm.runInContext(source + '\n;globalThis.out = {' + exports.join(',') + '};', context);
  return context.out;
}
const phoneValidation = load('middleware/phoneValidation.js', {phone}, ['validatePhoneInput']);
const validation = load('middleware/emailValidation.js', {}, ['isValidEmail', 'validateEmailInput']);
const protection = load('middleware/emailProtection.js', {...crypto, rateLimit}, ['emailRateLimits', 'preventDuplicateEmails']);
const { normalizeTime } = load("utils/normalizeTime.js", {}, ["normalizeTime"]);
const quiet = {log(){},error(){}};
const unusedContact = {name:'John Doe',email:'john@example.com',phone:'+44 7400 123456',subject:'quote',message:'Please send a quote.',website:''};
const validBooking = {customer_phone:'+12025550123',customer_name:'John Doe',customer_email:'john@example.com',service_type:'cdg-paris',pickup_location:'CDG',destination:'Paris',booking_date:'2026-12-01',booking_time:'12:00'};
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
  const bindings={...load("utils/bookingCapacity.js",{},["bookingCapacityIssue","validateBookingCapacity","displayBookingVehicle","CHILD_SEAT_POLICY"]),...phoneValidation,express,normalizeTime,console:quiet,...validation,...protection,...originalValidation,sendEmail,supabase,
    FROM_EMAIL:'Company <booking@example.com>',REPLY_TO:'company@gmail.com',
    process:{env:{ADMIN_EMAIL:'admin@example.com',CLIENT_URL:'https://example.com',RESEND_TEMPLATE_CONTACT:'contact-template',RESEND_TEMPLATE_PENDING:'pending-template',RESEND_TEMPLATE_CONFIRMED:'confirmed-template',RESEND_TEMPLATE_MODIFIED:'modified-template',RESEND_TEMPLATE_CANCELLED:'cancelled-template'}},
    sanitizeMarketingAttribution:()=>null,cleanMarketingService:()=>'',formatInternalMarketingAttribution:()=>'',
    syncBookingCalendarEvents:async(value)=>{calendarCalls.push({...value});return {outboundEventId:null,returnEventId:null}},generateReference:async()=>'TEST-1',generateToken:()=> 'synthetic-test-token',
    requireAdmin:(req,res,next)=>{req.adminUser={id:"synthetic-admin"};next();},isSupportedService:()=>true,
    calculateBookingPrice:()=>({base:80,night:0,outboundNight:0,returnNight:0}),
    calculatePublicBookingPrice:()=>({finalPrice:80,discountAmount:0,discountLabel:''}),calculateAdminFinalPrice:()=>({finalPrice:80,discountAmount:0,discountLabel:''})};
  Object.assign(bindings,load('utils/pricing.js',{},['calculateBookingPrice','calculatePublicBookingPrice','calculateAdminFinalPrice','isSupportedService']));
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


const van='Luxury Van 7 seats';
function noEffects(f){assert.equal(f.inserts,0);assert.equal(f.updates,0);assert.equal(f.calls.length,0);assert.equal(f.calendarCalls.length,0);}
for(const route of ['public','admin','modify','confirm'])for(let bags=0;bags<=8;bags++)test(route+' exact suitcase count '+bags+' is retained with unchanged fares',async t=>{
 const f=fixture(route==='public'||route==='admin'?'booking':route==='confirm'?'confirm':'manage',{booking:{passengers:2,children:0,luggage:route==='confirm'?bags:1,vehicle_type:van}});
 await serve(t,f,async post=>{
  const body=route==='confirm'?{token:'synthetic-token'}:{...validBooking,booking_number:'TEST-1',passengers:2,children:0,luggage:bags,vehicle_type:van,notes:'Two hand luggage items; please confirm space.'};
  const url=route==='admin'?'/admin':route==='modify'?'/modify':'/';const r=await post(body,url);assert.equal(r.status,200);assert.equal(f.booking.luggage,bags);assert.equal(f.booking.price,80);
  for(const {payload}of f.calls){assert.equal(payload.template.variables.luggage,String(bags));assert.ok(!Object.hasOwn(payload.template.variables,'suitcases'));assert.ok(!Object.hasOwn(payload.template.variables,'hand_luggage'));}
  if(route!=='confirm')assert.equal(f.booking.notes,body.notes);
 });
});
for(const route of ['public','admin','modify','confirm'])for(const bad of [9,10,'9','more-than-8',-1,null,true,[],[8],{},1.5,'8x','8+','0x8','1e0',Number.MAX_SAFE_INTEGER+1])test(route+' rejects direct invalid/excess luggage '+JSON.stringify(bad),async t=>{
 const f=fixture(route==='public'||route==='admin'?'booking':route==='confirm'?'confirm':'manage',{booking:{passengers:2,children:0,luggage:route==='confirm'?bad:0,vehicle_type:van}});
 await serve(t,f,async post=>{const r=await post(route==='confirm'?{token:'synthetic-token'}:{...validBooking,booking_number:'TEST-1',passengers:2,children:0,luggage:bad,vehicle_type:van},route==='admin'?'/admin':route==='modify'?'/modify':'/');assert.equal(r.status,400);if([9,10,'9','more-than-8'].includes(bad)){assert.equal(r.body.code,'LUGGAGE_CONTACT_REQUIRED');assert.match(r.body.message,/suitable vehicle solution/);assert.equal(new URL(r.body.contact_url).pathname,'/contact');}noEffects(f);});
});
for(const route of ['public','admin','modify','confirm'])for(const bags of [2,3])test(route+' sedan luggage limit '+bags,async t=>{
 const f=fixture(route==='public'||route==='admin'?'booking':route==='confirm'?'confirm':'manage',{booking:{passengers:2,children:0,luggage:bags,vehicle_type:'Premium Sedan'}});
 await serve(t,f,async post=>{const r=await post(route==='confirm'?{token:'synthetic-token'}:{...validBooking,booking_number:'TEST-1',passengers:2,children:0,luggage:bags,vehicle_type:'Premium Sedan',notes:'New note'},route==='admin'?'/admin':route==='modify'?'/modify':'/');assert.equal(r.status,bags===2?200:400);if(bags===3){assert.equal(r.body.code,'SEDAN_LUGGAGE_CAPACITY_EXCEEDED');noEffects(f);}});
});
for(const [passengers,children,bags,code]of [[8,0,8,null],[6,2,8,null],[8,1,8,'GROUP_CONTACT_REQUIRED'],[8,0,9,'LUGGAGE_CONTACT_REQUIRED'],[8,1,9,'GROUP_CONTACT_REQUIRED']])test('combined people/large suitcases '+[passengers,children,bags],async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{const r=await post({...validBooking,passengers,children,luggage:bags,vehicle_type:van,baby_seats:1,child_seats:1});assert.equal(r.status,code?400:200);if(code){assert.equal(r.body.code,code);noEffects(f);}else{assert.equal(f.booking.luggage,bags);assert.equal(f.booking.price,130);}});
});
test('partial/no-op edit validates stored luggage above eight; lookup and cancellation remain available',async t=>{
 const f=fixture('manage',{booking:{passengers:2,children:0,luggage:9,vehicle_type:van}});await serve(t,f,async post=>{const body={booking_number:'TEST-1',customer_email:validBooking.customer_email};assert.equal((await post(body,'/modify')).status,400);noEffects(f);assert.equal((await post(body,'/find')).status,200);assert.equal((await post(body,'/cancel')).status,200);assert.equal(f.booking.luggage,9);assert.equal(f.booking.status,'cancelled');});
});
for(const field of ['suitcases','suitcase_count','large_suitcases','bags'])test('alternative field is not silently discarded: '+field,async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{const r=await post({...validBooking,passengers:2,children:0,luggage:0,vehicle_type:van,[field]:9});assert.equal(r.status,400);noEffects(f);});
});
test('fare tables, caps and surcharges remain identical to the pre-luggage baseline',()=>{
 const values=load('utils/pricing.js',{},['PRICING','SERVICE_MAX','NIGHT_SURCHARGE','calculateBookingPrice']);
 assert.deepEqual(JSON.parse(JSON.stringify({PRICING:values.PRICING,SERVICE_MAX:values.SERVICE_MAX,NIGHT_SURCHARGE:values.NIGHT_SURCHARGE})),require('./fixtures/phase2d-pricing-baseline.json'));
 for(const service_type of Object.keys(values.PRICING))for(const passengers of [1,6,8])for(let luggage=0;luggage<=8;luggage++){
  const data={service_type,passengers,children:0,luggage,baby_seats:1,child_seats:1,trip_type:'round_trip',booking_time:'23:00',return_time:'05:00'};
  const current=values.calculateBookingPrice(data);const base=values.PRICING[service_type].default??values.PRICING[service_type][passengers];assert.equal(current.total,base*2+20);
 }
});

test('excess suitcases direct a manually unsuitable sedan request to contact before ordinary vehicle correction',async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{const r=await post({...validBooking,passengers:3,children:0,luggage:9,vehicle_type:'Premium Sedan'});assert.equal(r.status,400);assert.equal(r.body.code,'LUGGAGE_CONTACT_REQUIRED');assert.match(r.body.message,/suitable vehicle solution/);noEffects(f);});
});
