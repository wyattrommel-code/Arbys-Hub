const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createHmac, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.EQUIPMENT_PREVIEW_URL || 'http://localhost:3121';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use an isolated localhost preview for this fixture test.');
const output = require('node:path').resolve('out/resource-library-validation');
const stores = [{ id:'07462', name:'Payson', number:'07462', timezone:'America/Denver' }];
const equipment = [], manuals = [], schedules = [], tasks = [];
const people = [{employee_id:'preview-crew', name:'Preview Crew', home_store:'Payson', role:null, is_active:false}];
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let uploadCount = 0;
function cookie(role, store) {
  const body=JSON.stringify({employee_id:role==='gm'?'preview-gm':'preview-crew',first_name:'Preview',last_name:role==='gm'?'Manager':'Crew',purpose:'hub',role,store_id:store,exp:Math.floor(Date.now()/1000)+3600});
  return Buffer.from(body).toString('base64url')+'.'+createHmac('sha256','local-resource-preview-only').update(body).digest('base64url');
}
async function session(browser, role='gm', store='07462', viewport={width:1440,height:1000}) {
  const context=await browser.newContext({viewport,colorScheme:'light'});
  let selected=store;
  const current=()=>({...stores.find(s=>s.id===selected),role,can_create_store:role==='gm'});
  await context.addCookies([{name:'hub_session',value:cookie(role,selected),url:base,httpOnly:true,sameSite:'Lax'}]);
  const {RESOURCE_CATEGORIES}=await import('../lib/resources.js');
  await context.route('**/api/**',async route=>{
    const request=route.request(), url=new URL(request.url()), path=url.pathname, method=request.method();
    const send=(json,status=200,headers={})=>route.fulfill({json,status,headers});
    if(path==='/api/auth/me') return send({employee:{employee_id:'preview-'+role,first_name:'Preview',last_name:'User',role,store_id:selected},store:current()});
    if(path==='/api/timeclock/corrections') return send({pending_count:0});
    if(path==='/api/stores/select') {
      selected=request.postDataJSON().store_id;
      return send({ok:true},200,{'Set-Cookie':`hub_session=${cookie(role,selected)}; Path=/; HttpOnly; SameSite=Lax`});
    }
    if(path==='/api/stores/members') {
      if(method==='POST') Object.assign(people[0],request.postDataJSON());
      return send({people});
    }
    if(path==='/api/stores') {
      if(method==='POST') {const s={...request.postDataJSON(),id:'store_'+randomUUID()};stores.push(s);return send({store:s},201);}
      return send({store:current(),stores:stores.map(s=>({...s,role,can_create_store:role==='gm'}))});
    }
    if(path==='/api/resources') return send({resources:[],categories:RESOURCE_CATEGORIES,categories_version:1,can_manage:role==='gm',store:current()});
    if(path==='/api/checklist/tasks') return send({date:today,shift:'PM',sections:[],completeCount:0,totalCount:0});
    if(path==='/api/equipment/due') return send({date:today,store:current(),tasks:tasks.filter(t=>t.store_id===selected&&t.status!=='cancelled').map(t=>({...t,overdue:false,can_complete:t.status==='pending'&&(role==='gm'||t.responsible_role==='crew')}))});
    if(path.startsWith('/api/equipment/tasks/')) {
      const task=tasks.find(t=>t.id===path.split('/').at(-1)&&t.store_id===selected);
      Object.assign(task,{status:'completed',notes:request.postDataJSON().notes,completed_at:new Date().toISOString(),completed_by_name:'Preview Manager'});
      return send({task});
    }
    if(path==='/api/equipment') {
      if(method==='POST') {const row={...request.postDataJSON(),id:randomUUID(),store_id:selected,version:1};equipment.push(row);return send({equipment:row},201);}
      return send({store:current(),can_manage:role==='gm',equipment:equipment.filter(e=>e.store_id===selected).map(e=>({...e,due_count:tasks.filter(t=>t.equipment_id===e.id&&t.status==='pending').length}))});
    }
    if(path.startsWith('/api/equipment/')) {
      const parts=path.split('/').slice(3), id=parts[0], row=equipment.find(e=>e.id===id&&e.store_id===selected);
      if(!row) return send({error:'Equipment not found in this store.'},404);
      if(parts[1]==='manuals') {
        if(parts.length===2) {const manual={...request.postDataJSON(),id:randomUUID(),equipment_id:id,status:'uploading'};manuals.push(manual);return send({...manual,path:`${selected}/${id}/${manual.id}.pdf`,token:'preview-token',bucket:'equipment-documents'},201);}
        const manual=manuals.find(m=>m.id===parts[2]);
        manual.status=method==='DELETE'?'archived':'ready';return send({manual});
      }
      if(parts[1]==='schedules') {
        let schedule=schedules.find(s=>s.id===parts[2]);
        if(schedule) Object.assign(schedule,request.postDataJSON(),{version:schedule.version+1});
        else {schedule={...request.postDataJSON(),id:randomUUID(),equipment_id:id,version:1};schedules.push(schedule);}
        for(const t of tasks.filter(t=>t.schedule_id===schedule.id&&t.status==='pending')) t.status='cancelled';
        if(schedule.is_active&&row.status==='active'&&!tasks.some(t=>t.schedule_id===schedule.id&&t.status==='completed')) tasks.push({...schedule,id:randomUUID(),schedule_id:schedule.id,equipment_id:id,equipment_name:row.name,store_id:selected,due_date:today,status:'pending'});
        return send({schedule});
      }
      if(method==='PUT') {Object.assign(row,request.postDataJSON(),{version:row.version+1});if(row.status!=='active') tasks.filter(t=>t.equipment_id===id&&t.status==='pending').forEach(t=>t.status='cancelled');return send({equipment:row});}
      return send({equipment:row,store:current(),can_manage:role==='gm',manuals:manuals.filter(m=>m.equipment_id===id&&m.status==='ready'),schedules:schedules.filter(s=>s.equipment_id===id).map(s=>({...s,next_due_date:s.is_active?today:null})),history:tasks.filter(t=>t.equipment_id===id),has_more:false});
    }
    return send({error:'Unexpected fixture endpoint '+path},500);
  });
  await context.route('**/storage/v1/object/upload/sign/**',async route=>{if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'PUT,POST,OPTIONS','Access-Control-Allow-Headers':'*'}});uploadCount++;return route.fulfill({json:{Key:'equipment-documents/preview.pdf'},headers:{'Access-Control-Allow-Origin':'*'}});});
  return context;
}
async function run(){
  await require('node:fs/promises').mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  let debugPage;
  try{
    const context=await session(browser),page=await context.newPage();
    debugPage=page;
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/database',{waitUntil:'networkidle',timeout:120000});
    await page.getByRole('button',{name:'Add store',exact:true}).click();
    let dialog=page.getByRole('dialog');
    await dialog.getByLabel('Store name',{exact:true}).fill('Nephi');
    await dialog.getByLabel('Store number').fill('01234');
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),dialog.getByRole('button',{name:'Create store',exact:true}).click()]);
    await page.getByRole('button',{name:/Equipment Manuals/}).click();
    await page.getByRole('heading',{name:"Add this store's equipment",exact:true}).waitFor();
    assert.equal(equipment.length,0);
    await page.getByRole('button',{name:'Store access',exact:true}).click();
    dialog=page.getByRole('dialog');
    await dialog.getByLabel('Team member').selectOption('preview-crew');
    await dialog.getByRole('button',{name:'Save access',exact:true}).click();
    await dialog.getByText('Store access saved.',{exact:true}).waitFor();
    assert.equal(people[0].is_active,true);
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Add equipment',exact:true}).click();
    dialog=page.getByRole('dialog');
    await dialog.getByLabel('Equipment name').fill('Slicer #1');
    await dialog.getByLabel('Manufacturer',{exact:true}).fill('Example Equipment');
    await dialog.getByLabel('Model',{exact:true}).fill('X-100');
    await dialog.getByLabel('Location',{exact:true}).fill('Prep area');
    await dialog.getByRole('button',{name:'Add equipment',exact:true}).click();
    await page.getByRole('heading',{name:'Slicer #1',exact:true}).waitFor();
    await page.screenshot({path:output+'/equipment-register.png',fullPage:true});
    await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Slicer #1',exact:true})}).click();
    await page.getByRole('button',{name:'Edit equipment',exact:true}).waitFor();
    const equipmentUrl=page.url();
    await page.getByRole('button',{name:/^Manuals/}).click();
    for(const title of ['Operating manual','Service manual']) {
      await page.getByRole('button',{name:'Upload PDF',exact:true}).click();dialog=page.getByRole('dialog');
      await dialog.getByLabel('Document title').fill(title);
      await dialog.locator('input[type=file]').setInputFiles({name:title+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nPreview manual\n%%EOF')});
      await dialog.getByRole('button',{name:'Upload manual',exact:true}).click();
      await page.getByRole('link',{name:'Download '+title,exact:true}).waitFor();
    }
    assert.equal(uploadCount,2);
    await page.getByRole('button',{name:'Upload PDF',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('Document title').fill('Invalid file');
    await dialog.locator('input[type=file]').setInputFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a pdf')});
    await dialog.getByRole('button',{name:'Upload manual',exact:true}).click();
    await dialog.getByText('This file does not appear to be a PDF.',{exact:false}).waitFor();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    for(const [panel,title,unit,responsible] of [['Cleaning','Daily cleaning','days','crew'],['Maintenance','Service inspection','months','assistant_manager']]) {
      await page.getByRole('button',{name:panel,exact:true}).click();
      await page.getByRole('button',{name:'Add schedule',exact:true}).click();dialog=page.getByRole('dialog');
      await dialog.getByLabel('Task name').fill(title);
      await dialog.getByLabel('Instructions',{exact:true}).fill('Approved '+title.toLowerCase()+' instructions.');
      await dialog.getByLabel('Interval').selectOption(unit);
      await dialog.getByLabel('First due date').fill(today);
      await dialog.getByLabel('Responsible role').selectOption(responsible);
      await dialog.getByRole('button',{name:'Save schedule',exact:true}).click();
      await page.getByRole('heading',{name:title,exact:true}).waitFor();
    }
    await page.screenshot({path:output+'/equipment-detail.png',fullPage:true});
    await page.getByRole('link',{name:'Open due work in Checklists',exact:false}).click();
    await page.getByRole('button',{name:'Complete Daily cleaning for Slicer #1',exact:true}).waitFor();
    await page.getByRole('button',{name:'+ Completion note',exact:true}).first().click();
    await page.getByRole('textbox',{name:'Completion note for Daily cleaning'}).fill('Completed and checked.');
    await page.getByRole('button',{name:'Complete Daily cleaning for Slicer #1',exact:true}).click();
    await page.getByLabel('Daily cleaning completed',{exact:true}).waitFor();
    await page.screenshot({path:output+'/equipment-checklists.png',fullPage:true});
    await page.goto(equipmentUrl,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Cleaning',exact:true}).click();
    await page.getByRole('button',{name:'Edit schedule',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByRole('textbox',{name:/^Instructions/}).fill('Revised cleaning instructions.');
    await dialog.getByRole('button',{name:'Save schedule',exact:true}).click();
    await page.getByText('Revised cleaning instructions.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'History',exact:true}).click();
    await page.getByText('Completed and checked.',{exact:true}).waitFor();
    await page.getByText('Instructions at the time',{exact:true}).first().click();
    await page.getByText('Approved daily cleaning instructions.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Maintenance',exact:true}).click();
    await page.getByRole('button',{name:'Edit schedule',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('Schedule active').uncheck();
    await dialog.getByRole('button',{name:'Save schedule',exact:true}).click();
    await page.getByText('Paused',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Edit schedule',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('Schedule active').check();
    await dialog.getByRole('button',{name:'Save schedule',exact:true}).click();
    await page.getByText('Active',{exact:true}).waitFor();
    const nephi=stores.find(s=>s.name==='Nephi').id;
    const blocked=await context.request.get(base+'/api/timecards');
    assert.equal(blocked.status(),403,'real middleware blocks legacy API for selected new store');
    await page.goto(base+'/people',{waitUntil:'networkidle'});assert.ok(page.url().endsWith('/database'));
    await page.getByRole('button',{name:'Add store',exact:true}).waitFor();
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.getByRole('combobox',{name:'Current store'}).selectOption('07462')]);
    const paysonPage=await context.newPage();
    await paysonPage.goto(base+'/database/equipment',{waitUntil:'networkidle'});
    await paysonPage.getByRole('heading',{name:"Add this store's equipment",exact:true}).waitFor();
    assert.equal(await paysonPage.getByRole('heading',{name:'Slicer #1',exact:true}).count(),0);
    const mobileContext=await session(browser,'crew',nephi,{width:390,height:844}),mobile=await mobileContext.newPage();
    mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.goto(equipmentUrl,{waitUntil:'networkidle'});
    await mobile.getByRole('heading',{name:'Slicer #1',exact:true}).waitFor();
    assert.equal(await mobile.getByRole('button',{name:'Edit equipment',exact:true}).count(),0);
    assert.equal(await mobile.getByRole('button',{name:'Add store',exact:true}).count(),0);
    await mobile.getByRole('button',{name:/^Manuals/}).click();
    await mobile.getByRole('link',{name:'Download Operating manual',exact:true}).waitFor();
    assert.equal(await mobile.getByRole('button',{name:'Upload PDF',exact:true}).count(),0);
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile detail has no horizontal overflow');
    await mobile.screenshot({path:output+'/equipment-mobile.png',fullPage:true});
    await mobile.goto(base+'/checklist',{waitUntil:'networkidle'});
    assert.equal(await mobile.getByRole('button',{name:'Complete Service inspection for Slicer #1'}).isDisabled(),true);
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile checklist has no horizontal overflow');
    await mobileContext.route('**/api/checklist/tasks?*',route=>route.fulfill({status:503,json:{error:'The daily checks are temporarily unavailable.'}}));
    await mobile.reload({waitUntil:'networkidle'});
    await mobile.getByRole('button',{name:'Complete Service inspection for Slicer #1'}).waitFor();
    await mobile.getByText('The daily checks are temporarily unavailable.',{exact:true}).waitFor();
    await mobileContext.close();
    assert.deepEqual(errors,[]);
    console.log('Equipment browser checks passed: empty new store, store access, equipment create, two signed PDF uploads, invalid PDF rejection, cleaning/maintenance schedules, checklist completion and notes, preserved history, pause/resume, store isolation, real middleware guard, crew controls, and mobile layout. API fixtures were isolated; no production data accessed.');
    await context.close();
  } catch(error) {console.error('Page errors:',errors);if(debugPage&&!debugPage.isClosed()){await debugPage.screenshot({path:output+'/equipment-failure.png',fullPage:true});console.error((await debugPage.locator('body').innerText()).slice(-6000));}throw error;} finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
