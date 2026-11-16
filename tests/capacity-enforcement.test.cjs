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
const policy="Baby seats and child seats are available free of charge upon request.";
function noEffects(f){assert.equal(f.inserts,0);assert.equal(f.updates,0);assert.equal(f.calls.length,0);assert.equal(f.calendarCalls.length,0);}
for(const url of ['/','/admin']){
 for(const count of [1,6,8])test('direct create '+url+' accepts '+count+' with unchanged price and email labels',async t=>{
  const f=fixture('booking');await serve(t,f,async post=>{
   const r=await post({...validBooking,passengers:count,children:0,vehicle_type:van},url);
   assert.equal(r.status,200);assert.equal(f.booking.passengers,count);assert.equal(f.booking.children,0);
   assert.equal(f.booking.price,({1:80,6:110,8:130})[count]);assert.equal(f.booking.status,'pending');assert.equal(f.booking.payment_status,'unpaid');
   assert.equal(f.calls.length,2);
   for(const {payload} of f.calls){assert.equal(payload.template.variables.vehicle,'Private van (1–8 passengers, excluding the chauffeur)');assert.ok(payload.template.variables.child_seat_policy.startsWith(policy));}
   assert.equal(f.booking.vehicle_type,van);
  });
 });
 for(const counts of [{passengers:9,children:0},{passengers:8,children:1},{passengers:1,children:8},{passengers:8,children:8},{passengers:99,children:0}])test('direct create '+url+' rejects oversized group '+JSON.stringify(counts),async t=>{
  const f=fixture('booking');await serve(t,f,async post=>{
   const r=await post({...validBooking,...counts,vehicle_type:van},url);assert.equal(r.status,400);assert.equal(r.body.code,'GROUP_CONTACT_REQUIRED');assert.match(r.body.message,/two vehicles/);assert.equal(new URL(r.body.contact_url).pathname,'/contact');noEffects(f);
  });
 });
}
for(const [adults,children,babySeats,childSeats] of [[1,0,0,0],[6,2,1,1],[1,7,2,2]])test('infants included in children; equipment is not extra passengers '+[adults,children,babySeats,childSeats],async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{
  const r=await post({...validBooking,passengers:adults,children,vehicle_type:van,baby_seats:babySeats,child_seats:childSeats,luggage:5});assert.equal(r.status,200);
  assert.equal(f.booking.passengers+f.booking.children,adults+children);assert.equal(f.booking.baby_seats,babySeats);assert.equal(f.booking.child_seats,childSeats);assert.equal(f.booking.luggage,5);
  assert.equal(f.booking.price,adults+children===8?130:80);
 });
});
for(const value of [-1,0,1.5,null,true,{},[],[8],'','1e0','0x8','NaN','Infinity','8x',Number.MAX_SAFE_INTEGER])for(const route of ['booking','manage'])test(route+' rejects manipulated adults '+JSON.stringify(value),async t=>{
 const f=fixture(route,{booking:{passengers:2,children:0,vehicle_type:van}});await serve(t,f,async post=>{
  const body={...validBooking,booking_number:'TEST-1',passengers:value,children:0,vehicle_type:van};
  const r=await post(body,route==='manage'?'/modify':'/');assert.equal(r.status,400);noEffects(f);
 });
});
for(const field of ['infants','infant_count','adults','total_passengers','passenger_count'])test('unsupported alternative count cannot be silently discarded: '+field,async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{const r=await post({...validBooking,passengers:8,children:0,[field]:1,vehicle_type:van});assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_PASSENGER_COUNTS');assert.match(r.body.message,/including infants/);noEffects(f);});
});
for(const route of ['booking','manage','confirm'])for(const total of [2,3])test(route+' preserves sedan maximum at '+total,async t=>{
 const f=fixture(route,{booking:{passengers:total,children:0,vehicle_type:'Premium Sedan'}});await serve(t,f,async post=>{
  const body=route==='confirm'?{token:'synthetic-token'}:{...validBooking,booking_number:'TEST-1',passengers:total,children:0,vehicle_type:'Premium Sedan',notes:'Capacity regression'};
  const r=await post(body,route==='manage'?'/modify':'/');assert.equal(r.status,total===2?200:400);
  if(total===3){assert.equal(r.body.code,'SEDAN_CAPACITY_EXCEEDED');noEffects(f);}
  else for(const {payload} of f.calls)assert.equal(payload.template.variables.vehicle,'Premium Sedan');
 });
});
for(const count of [1,6,8,9])for(const route of ['manage','confirm'])test(route+' stored/request capacity '+count,async t=>{
 const f=fixture(route,{booking:{passengers:count,children:0,vehicle_type:van}});await serve(t,f,async post=>{
  const body=route==='confirm'?{token:'synthetic-token'}:{...validBooking,booking_number:'TEST-1',notes:'New pickup instructions'};
  const r=await post(body,route==='manage'?'/modify':'/');assert.equal(r.status,count<=8?200:400);
  if(count>8){assert.equal(r.body.code,'GROUP_CONTACT_REQUIRED');noEffects(f);}else {assert.equal(f.calls.length,2);for(const {payload} of f.calls)assert.match(payload.template.variables.vehicle,/1–8 passengers/);}
 });
});
test('partial edit uses existing children and rejects combined nine before unchanged shortcut',async t=>{
 const f=fixture('manage',{booking:{passengers:6,children:3,vehicle_type:van}});await serve(t,f,async post=>{const r=await post({booking_number:'TEST-1',customer_email:validBooking.customer_email},'/modify');assert.equal(r.status,400);noEffects(f);});
});
test('legacy large group can still find and cancel; notification does not imply single van acceptance',async t=>{
 const f=fixture('manage',{booking:{passengers:8,children:1,vehicle_type:van}});await serve(t,f,async post=>{
  const identity={booking_number:'TEST-1',customer_email:validBooking.customer_email};assert.equal((await post(identity,'/find')).status,200);assert.equal((await post(identity,'/cancel')).status,200);
  assert.equal(f.booking.status,'cancelled');for(const {payload} of f.calls){assert.match(payload.template.variables.vehicle,/requires confirmation/);assert.match(payload.template.variables.vehicle,/two vehicles/);assert.doesNotMatch(payload.template.variables.vehicle,/1–8 passengers/);}
 });
});
test('already confirmed legacy nine does not return ordinary confirmation success',async t=>{
 const f=fixture('confirm',{booking:{status:'confirmed',passengers:8,children:1,vehicle_type:van}});await serve(t,f,async post=>{assert.equal((await post({token:'synthetic-token'})).status,400);noEffects(f);});
});
test('legacy van aliases are normalized only for display; unrelated models retained',async()=>{
 const {displayBookingVehicle}=await import('../utils/bookingCapacity.js');
 for(const vehicle_type of ['Luxury Van 7 seats','Luxury Van 6 seats','Luxury Van (1–6 passengers)','Private Van','Luxury Van 7 seats (3-6 people)'])assert.equal(displayBookingVehicle({passengers:6,children:0,vehicle_type}),'Private van (1–8 passengers, excluding the chauffeur)');
 assert.equal(displayBookingVehicle({passengers:2,children:0,vehicle_type:'Other named model'}),'Other named model');
});
for(const value of [null,-1,1.5,true,[],{},'NaN','1e0'])for(const route of ['booking','manage'])test(route+' rejects manipulated children '+JSON.stringify(value),async t=>{
 const f=fixture(route,{booking:{passengers:1,children:0,vehicle_type:van}});await serve(t,f,async post=>{
  const r=await post({...validBooking,booking_number:'TEST-1',passengers:1,children:value,vehicle_type:van},route==='manage'?'/modify':'/');assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_PASSENGER_COUNTS');noEffects(f);
 });
});
test('eight-person return/night price and free requested equipment remain unchanged',async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{
  const r=await post({...validBooking,passengers:6,children:2,vehicle_type:van,baby_seats:1,child_seats:1,booking_time:'23:00',return_date:'2026-12-02',return_time:'05:00',trip_type:'round_trip'});
  assert.equal(r.status,200);assert.equal(f.booking.price,280);assert.equal(f.booking.original_price,130);assert.equal(f.booking.night_surcharge,20);
 });
});
test('legacy decimal count strings retain API compatibility',async t=>{
 const f=fixture('booking');await serve(t,f,async post=>{
  const r=await post({...validBooking,passengers:' 6 ',children:' 2 ',vehicle_type:van});assert.equal(r.status,200);assert.equal(f.booking.passengers,6);assert.equal(f.booking.children,2);assert.equal(f.booking.price,130);
 });
});
