const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const express=require('express');
const {rateLimit}=require('express-rate-limit');
const root=path.resolve(__dirname,'..');
function load(file,bindings,names){
 const source=fs.readFileSync(path.join(root,file),'utf8').replace(/^import\s+[\s\S]*?;\s*$/gm,'').replace(/export default router;/,'').replace(/export /g,'');
 return vm.runInNewContext(source+'\n;({'+names.join(',')+'})',{...bindings});
}
const pricing=load('utils/pricing.js',{},['calculateBookingPrice','calculateAdminFinalPrice','calculatePublicBookingPrice','isSupportedService','normalizeBookingNumbers']);
const validation=load('middleware/validation.js',{},['validateBookingData']);
const emailValidation=load('middleware/emailValidation.js',{},['validateEmailInput']);
const protection=load('middleware/emailProtection.js',{...crypto,rateLimit},['emailRateLimits','preventDuplicateEmails']);
const valid={customer_name:'Test Customer',customer_email:'client@example.com',pickup_location:'CDG',destination:'Paris',booking_date:'2026-12-01',booking_time:'12:00',service_type:'cdg-paris',passengers:2,children:0,luggage:1,baby_seats:0,child_seats:0};
function fixture(options={}){
 const emails=[],inserts=[],logs=[];let calendar=0;
 const env={ADMIN_USER_IDS:options.unconfigured?'':'admin-id',ADMIN_EMAIL:'admin@example.com',CLIENT_URL:'https://example.com',RESEND_TEMPLATE_PENDING:'pending-template'};
 const supabase={auth:{getUser:async token=>{
  if(options.outage)throw Error('synthetic-private-token');
  return token==='invalid'?{error:{message:'invalid'}}:{data:{user:{id:token==='admin-token'?'admin-id':'other-id'}}};
 }},from(table){let record;return {
  insert(data){record={id:1,...data};inserts.push({table,data});return this;},select(){return this;},single:async()=>({data:record}),
  update(){return this;},eq(){return this;},then(resolve){return Promise.resolve({error:null}).then(resolve);}
 };}};
 const console={log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)};
 const {requireAdmin}=load('middleware/requireAdmin.js',{supabase,process:{env},console},['requireAdmin']);
 const bindings={express,supabase,process:{env},console,requireAdmin,...pricing,...validation,...emailValidation,...protection,
  sendEmail:async(...args)=>{emails.push(args);return{id:'mock-email-id'};},FROM_EMAIL:'Company <booking@example.com>',REPLY_TO:'admin@example.com',
  generateReference:async()=>'TEST-ADMIN',generateToken:()=>'mock-confirm-token',sanitizeMarketingAttribution:()=>null,
  syncBookingCalendarEvents:async()=>{calendar++;return{outboundEventId:'mock-event',returnEventId:null};}};
 const {router}=load('routes/booking.js',bindings,['router']);
 const session=load('routes/admin.js',bindings,['router']).router;
 const app=express();app.use(express.json());app.use('/api/bookings',router);app.use('/api/admin',session);
 return{app,emails,inserts,logs,get calendar(){return calendar;}};
}
async function serve(t,f,run){
 const server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 await run(async(url,token,body)=>{
  const r=await fetch('http://127.0.0.1:'+server.address().port+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return{status:r.status,body:await r.json()};
 });
}
for(const [token,status] of [[null,401],['invalid',401],['member-token',403],['admin-token',200]])test('admin authentication '+status+' '+token,async t=>{
 const f=fixture();await serve(t,f,async request=>{
  assert.equal((await request('/api/admin/session',token)).status,status);
  assert.equal((await request('/api/bookings/admin',token,valid)).status,status);
  assert.equal(f.emails.length,status===200?2:0);
  if(status!==200)assert.equal(f.inserts.length,0);
 });
});
for(const options of [{outage:true},{unconfigured:true}])test('admin fails closed during '+JSON.stringify(options),async t=>{
 const f=fixture(options);await serve(t,f,async request=>{assert.equal((await request('/api/bookings/admin','admin-token',valid)).status,503);assert.equal(f.inserts.length,0);assert.equal(f.emails.length,0);assert.ok(!JSON.stringify(f.logs).includes('synthetic-private-token'));});
});
test('public pricing ignores forged overrides and preserves pending workflow',async t=>{
 const f=fixture();await serve(t,f,async request=>{
  assert.equal((await request('/api/bookings',null,{...valid,price:1,priceOverride:1,adminCustomPrice:1,discount:99,admin_override:{custom_price:1},internal_note:'forged',admin_user_id:'forged'})).status,200);
  const booking=f.inserts[0].data;assert.equal(booking.price,80);assert.equal(booking.status,'pending');assert.equal(booking.admin_user_id,undefined);assert.equal(booking.internal_note,undefined);
  assert.equal(f.calendar,1);assert.equal(f.emails.length,2);assert.equal(f.emails[0][1].template.id,'pending-template');
 });
});
for(const [override,price] of [[{},80],[{custom_price:150},150],[{custom_price:150,discount:{type:'fixed',amount:20}},130],[{discount:{type:'percent',amount:25}},60]])test('admin server pricing '+JSON.stringify(override),async t=>{
 const f=fixture();await serve(t,f,async request=>{
  assert.equal((await request('/api/bookings/admin','admin-token',{...valid,price:1,admin_override:override,internal_note:'Office booking',internal_reference:'REF'})).status,200);
  const booking=f.inserts[0].data;assert.equal(booking.price,price);assert.equal(booking.calculated_price,80);assert.equal(booking.admin_user_id,'admin-id');assert.equal(booking.internal_note,'Office booking');assert.equal(booking.status,'pending');assert.equal(booking.payment_status,'unpaid');
  assert.equal(f.inserts[1].table,'booking_admin_audit_logs');assert.equal(f.calendar,1);assert.equal(f.emails.length,2);assert.equal(f.emails[0][1].template.id,'pending-template');assert.equal(f.emails[0][1].to,valid.customer_email);assert.equal(f.emails[0][1].template.variables.confirm_url,'https://example.com/confirm.html?token=mock-confirm-token');
 });
});
for(const field of ['passengers','children','luggage','baby_seats','child_seats'])test(field+' rejects fractional, non-finite, negative, malformed and unbounded counts',()=>{
 for(const value of [1.5,NaN,Infinity,-1,1000,null,true,{},[], 'NaN','Infinity','1.5',''])assert.throws(()=>pricing.calculateBookingPrice({...valid,[field]:value}),/integer between/);
});
test('valid frontend maximum counts and historical service caps stay supported',()=>{
 const data={...valid,passengers:8,children:8,luggage:5,baby_seats:10,child_seats:10};
 assert.equal(pricing.calculateBookingPrice(data).total,260);
 assert.equal(pricing.calculateBookingPrice({...data,service_type:'beauvais-paris'}).total,180);
 assert.equal(pricing.calculateBookingPrice({...valid,passengers:' 2 '}).total,80);
 for(const service_type of ['unknown','__proto__','constructor'])assert.throws(()=>pricing.calculateBookingPrice({...valid,service_type}),/Unsupported/);
});
test('invalid pricing rejected before persistence or external effects on both routes',async t=>{
 const f=fixture();await serve(t,f,async request=>{
  for(const url of ['/api/bookings','/api/bookings/admin'])for(const passengers of [1.5,null,-1])assert.equal((await request(url,'admin-token',{...valid,passengers})).status,400);
  assert.equal((await request('/api/bookings/admin','admin-token',{...valid,admin_override:{custom_price:-1}})).status,400);
  assert.equal(f.emails.length,0);assert.equal(f.inserts.length,0);assert.equal(f.calendar,0);
 });
});
