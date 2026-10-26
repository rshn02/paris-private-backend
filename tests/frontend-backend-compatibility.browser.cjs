// Run separately with Playwright: all database, auth, email and Calendar operations are simulated.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const crypto=require('node:crypto');
const express=require('express');
const {rateLimit}=require('express-rate-limit');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
const front=process.env.PPAT_FRONTEND_ROOT || path.resolve(root,'../paris-private-airport-transfer');
const phone=require('../utils/phone.cjs');
function load(file,bindings,names){
 const sourcePath=file.startsWith('routes/')&&process.env.PPAT_BACKEND_ROUTES_ROOT
  ?path.join(process.env.PPAT_BACKEND_ROUTES_ROOT,path.basename(file)):path.join(root,file);
 const source=fs.readFileSync(sourcePath,'utf8').replace(/^import\s+[\s\S]*?;\s*$/gm,'').replace(/export default router;/,'').replace(/export /g,'');
 return vm.runInNewContext(source+'\n;({'+names.join(',')+'})',{...bindings});
}
function backend(){
 const emails=[],inserts=[],calendar=[];
 const env={ADMIN_USER_IDS:'compat-admin',ADMIN_EMAIL:'admin@example.test',CLIENT_URL:'https://example.test',RESEND_TEMPLATE_CONTACT:'contact',RESEND_TEMPLATE_PENDING:'pending'};
 const supabase={auth:{getUser:async token=>token==='compat-admin-token'?{data:{user:{id:'compat-admin'}}}:{error:{message:'Invalid token'}}},from(table){let record;return{
  insert(data){record={id:inserts.length+1,...data};inserts.push({table,data:record});return this;},select(){return this;},single:async()=>({data:record}),update(){return this;},eq(){return this;},then(resolve){return Promise.resolve({error:null}).then(resolve);}
 };}};
 const bindings={express,console:{log(){},error(){}},process:{env},supabase,phone,...crypto,rateLimit};
 for(const [file,names]of[
  ['middleware/phoneValidation.js',['validatePhoneInput']],['middleware/emailValidation.js',['validateEmailInput']],
  ['middleware/emailProtection.js',['emailRateLimits','preventDuplicateEmails']],['middleware/validation.js',['validateBookingData']],
  ['middleware/requireAdmin.js',['requireAdmin']],['utils/pricing.js',['calculateBookingPrice','calculatePublicBookingPrice','calculateAdminFinalPrice','isSupportedService']]
 ])Object.assign(bindings,load(file,bindings,names));
 Object.assign(bindings,{FROM_EMAIL:'booking@example.test',REPLY_TO:'admin@example.test',sendEmail:async(...args)=>{emails.push(args);return{id:'fake-email'};},generateReference:async()=>'COMPAT-TEST',generateToken:()=> 'compat-confirm-token',
  syncBookingCalendarEvents:async booking=>{calendar.push(booking);return{outboundEventId:null,returnEventId:null};},sanitizeMarketingAttribution:()=>null,cleanMarketingService:()=>'',formatInternalMarketingAttribution:()=>''});
 const app=express();app.use(express.json());
 app.use('/api/contact',load('routes/contact.js',bindings,['router']).router);
 app.use('/api/bookings',load('routes/booking.js',bindings,['router']).router);
 app.use('/api/admin',load('routes/admin.js',bindings,['router']).router);
 app.use(express.static(front));
 return{app,emails,inserts,calendar};
}
test('phone release preserves SEO metadata, structured data and payment markup',()=>{
 for(const name of ['contact','reservation']){
  const previous=fs.readFileSync(path.join(__dirname,'fixtures',`phone-legacy-${name}.html`),'utf8');
  const current=fs.readFileSync(path.join(front,`${name}.html`),'utf8');
  for(const expression of [/<title\b[^>]*>[\s\S]*?<\/title>/g,/<meta\b[^>]*>/g,/<link\b[^>]*(?:canonical|alternate)[^>]*>/g,/<script\b[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/g]){
   assert.deepEqual(current.match(expression),previous.match(expression),`${name}: ${expression}`);
  }
  if(name==='reservation'){
   const payments=/<div class="payment-options">[\s\S]*?<!-- ── TERMS ACCEPTANCE/;
   assert.equal(current.match(payments)[0],previous.match(payments)[0]);
  }
 }
});
const cases=[
 ['legacy','contact','United States','2025550123','+12025550123'],
 ['mixed','contact','France','0612345678','+33612345678'],
 ['current','contact','France','06 12 34 56 78','+33612345678'],
 ['legacy','public','United Kingdom','07400123456','+447400123456'],
 ['current','public','Canada','(416) 555-0123','+14165550123'],
 ['legacy','admin','France','0612345678','+33612345678'],
 ['current','admin','United States','(202) 555-0123','+12025550123']
];
test('cached/current HTML and scripts submit to real backend routes using simulated services',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 t.after(()=>browser.close());
 for(const [generation,kind,country,number,e164]of cases)await t.test(`${generation} ${kind} -> new backend`,async()=>{
  const fixture=backend();const server=http.createServer(fixture.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(admin=>{window.supabase={createClient:()=>({auth:{
   getSession:async()=>({data:{session:admin?{user:{id:'compat-admin'},access_token:'compat-admin-token',expires_at:Math.floor(Date.now()/1000)+3600}:null}}),
   onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
  }})};},kind==='admin');
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.startsWith('/api/')){
    const response=await fetch(origin+url.pathname,{method:request.method(),headers:{'Content-Type':'application/json',...(request.headers().authorization?{Authorization:request.headers().authorization}:{}),...(request.headers()['idempotency-key']?{'Idempotency-Key':request.headers()['idempotency-key']}:{})},...(request.postData()?{body:request.postData()}:{})});
    if(request.method()==='POST')requests.push({path:url.pathname,body:JSON.parse(request.postData()),status:response.status});
    return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
   }
   if(request.url().startsWith(origin)){
    if(generation==='current'&&process.env.PPAT_CACHED_HTML_ROOT&&url.pathname.endsWith('.html'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(process.env.PPAT_CACHED_HTML_ROOT,kind==='contact'?'contact.html':'reservation.html'),'utf8')});
    if(generation!=='current'&&url.pathname.endsWith('.html'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures',`phone-legacy-${kind==='contact'?'contact':'reservation'}.html`),'utf8')});
    if(generation==='legacy'&&url.pathname==='/js/main.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'fixtures/phone-legacy-main.js'),'utf8')});
    if(/\.(?:html|css|js)$/.test(url.pathname))return route.continue();
   }
   return route.abort();
  });
  try{
   const contact=kind==='contact';await page.goto(origin+(contact?'/contact.html':'/reservation.html'));
   if(await page.getByRole('button',{name:'Reject all',exact:true}).isVisible())await page.getByRole('button',{name:'Reject all',exact:true}).click();
   const input=page.locator(contact?'#contact-phone':'#phone-number');
   if(contact){for(const [id,value]of [['contact-name','Compatibility Test'],['contact-email','client@example.test'],['contact-message','Synthetic compatibility request']])await page.locator('#'+id).fill(value);await page.locator('#contact-subject').selectOption('quote');}
   else{
    if(kind==='admin')await page.locator('#adminPanel').waitFor({state:'visible'});
    for(const [id,value]of [['name','Compatibility Test'],['email','client@example.test'],['pickup','CDG'],['destination','Paris'],['date','2027-12-01'],['time','12:00']])await page.locator('#'+id).fill(value);
    await page.locator('#service').selectOption('cdg-paris');await page.locator('#passengers').selectOption('2');await page.locator('#luggage').selectOption({index:1});await page.locator('#vehicle-type').selectOption({index:1});await page.locator('#cgv').check();
    if(generation==='current')await page.locator('input[name="payment"][value="Card to driver"]').check();
    if(kind==='admin'){await page.locator('#adminCustomPrice').fill('150');await page.evaluate(()=>applyAdminPrice());}
   }
   await page.locator(contact?'#contactCountryFlagDisplay':'#countryFlagDisplay').click();
   await page.locator((contact?'#contactCountryList':'#countryList')+' .country-option').filter({hasText:country}).click();
   await input.fill(number);
   await page.locator(contact?'#contactSubmitBtn':'#submitBtn').click();
   await page.waitForFunction(contact=>contact?document.getElementById('contactSuccess').style.display==='block':document.getElementById('bookingSuccess').classList.contains('show'),contact);
   assert.deepEqual(errors,[]);assert.equal(requests.length,1);assert.equal(requests[0].status,200);
   const field=contact?'phone':'customer_phone';assert.equal(phone.normalize(requests[0].body[field]),e164);
   if(generation==='current'){assert.equal(requests[0].body[field],e164);assert.equal(requests[0].body.phone_country,phone.detectCountry(e164));}
   else assert.equal(requests[0].body.phone_country,undefined);
   assert.equal(requests[0].path,contact?'/api/contact':kind==='admin'?'/api/bookings/admin':'/api/bookings');
   assert.equal(fixture.emails.length,2);
   for(const [,payload]of fixture.emails)assert.equal(payload.template.variables[contact?'phone':'client_phone'],e164);
   if(!contact){
    const booking=fixture.inserts.find(x=>x.table==='bookings').data;
    assert.equal(booking.customer_phone,e164);assert.equal(booking.price,kind==='admin'?150:80);assert.equal(booking.payment_method,generation==='current'?'Card to driver':'Cash to driver');assert.equal(booking.payment_method,requests[0].body.payment_method);assert.equal(booking.payment_status,'unpaid');assert.equal(booking.status,'pending');assert.equal(booking.email_confirmed,false);
    assert.equal(fixture.calendar.length,1);assert.match(fixture.emails[0][1].template.variables.confirm_url,/compat-confirm-token$/);
    if(kind==='admin'){assert.equal(booking.admin_user_id,'compat-admin');assert.ok(fixture.inserts.some(x=>x.table==='booking_admin_audit_logs'));}
   }else assert.equal(fixture.inserts.length,0);
  }finally{await page.close();await new Promise(r=>server.close(r));}
 });
});
