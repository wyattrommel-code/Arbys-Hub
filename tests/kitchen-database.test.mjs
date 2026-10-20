import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('deployment versions are atomic, immutable, idempotent and reject stale updates; kitchen requires owned claim',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.employees(id uuid primary key);
    create table public.deployment_logs(id uuid primary key default gen_random_uuid(),log_date date,shift text,submitted_by text,submitted_at timestamptz,is_late boolean,minutes_late integer,store_id text,unique(log_date,shift));
    create table public.deployment_assignments(deployment_id uuid,log_date date,shift text,employee_name text,stations text[],notes text,store_id text);
    create table public.brink_sync_state(connection_id text primary key,attempt_id uuid);
    grant all on all tables in schema public to service_role;
    insert into public.employees values ('11111111-1111-4111-8111-111111111111');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261020215516_kitchen_deployment_timing.sql',import.meta.url),'utf8'));
  const id='11111111-1111-4111-8111-111111111111', id2='22222222-2222-4222-8222-222222222222',id3='33333333-3333-4333-8333-333333333333';
  const row=[{employee_id:id,employee_name:'Test Crew',stations:['Fryer'],notes:''}];
  const save=async(key,base=null,assignments=row)=>db.query(`select public.hub_save_deployment($1,(now() at time zone 'America/Denver')::date,'Morning',null,$2,'Test Lead',$3,$4) v`,[key,id,JSON.stringify(assignments),base]);
  await db.exec('set role service_role');
  const first=(await save(id)).rows[0].v;
  assert.equal((await save(id)).rows[0].v.id,id,'lost response replay must not create a version');
  await assert.rejects(save(id,null,[]),/already used/);
  await assert.rejects(save(id2),/Reload/);
  await save(id2,id,[]);
  assert.equal((await db.query('select count(*)::int n from public.deployment_versions')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from public.deployment_assignments')).rows[0].n,0);
  assert.equal((await db.query('select assignments from public.deployment_versions where id=$1',[id])).rows[0].assignments[0].employee_name,'Test Crew');
  await assert.rejects(db.exec("update public.deployment_versions set submitted_by='tampered'"),/permission denied/);
  await assert.rejects(db.exec('delete from public.deployment_versions'),/permission denied/);
  await db.exec(`insert into public.brink_sync_state values ('test','${id}'); insert into public.brink_kitchen_state(connection_id) values ('test');`);
  const finish=attempt=>db.query(`select public.brink_finish_kitchen('test',$1,current_date,'production','[]','[]',0) v`,[attempt]);
  assert.equal((await finish(id2)).rows[0].v,false);
  assert.equal((await finish(id)).rows[0].v,true);
  await db.exec('reset role');
  // A legacy write error rolls back the new version as well.
  await db.exec("alter table public.deployment_assignments add constraint reject_fixture check (employee_name <> 'Reject'); set role service_role");
  await assert.rejects(save(id3,id2,[{...row[0],employee_name:'Reject'}]),/reject_fixture/);
  assert.equal((await db.query('select count(*)::int n from public.deployment_versions')).rows[0].n,2);
  await db.exec('reset role');
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for(const table of ['deployment_versions','brink_kitchen_days','brink_kitchen_state']) await assert.rejects(db.exec(`select * from public.${table}`),/permission denied/);
    await assert.rejects(save(id3,id2),/permission denied/);
    await assert.rejects(finish(id),/permission denied/);
    await db.exec('reset role');
  }
  assert.ok(first.effective_at);
});
