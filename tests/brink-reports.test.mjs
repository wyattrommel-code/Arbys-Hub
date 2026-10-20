import test from "node:test";
import assert from "node:assert/strict";
import {salesReports, reportsCsv, discountCategory} from "../lib/brink-sales-reports.js";
import {parseOrders} from "../lib/brink.js";
import {attachEmployeeNames} from "../lib/brink-employee-directory.js";
import {attachDefinitions, parseDefinitions} from "../lib/brink-definitions.js";
const offer = (id, amount, name) => ({id, definition_id:"meal", amount, name, definition_name:name, definition_name_source:"Settings.GetDiscounts", employee_id:"actor",approver_employee_id:"boss"});
const order = (changes={}) => ({id:"100",number:"19",business_date:"2026-10-19",details_version:3,closed:true,refund:false,net_sales:5,total:5.4,employee_id:"cashier",discounts:[],promotions:[],items:[],...changes});
const status = orders => ({environment:"production",label:"Store",business_date:"2026-10-19",day:{orders,synced_at:"2026-10-20T12:00:00Z"}});
test("meal classification requires exact labels verified through this connection's settings",()=>{
  assert.equal(discountCategory(offer("1",12,"$12 Employee Meal")),"employee_meal");
  assert.equal(discountCategory(offer("1",12,"Manager Meal")),"manager_meal");
  for(const name of ["Manager Comp","SHB Employee Family Meal","Off the Clock Employee.","$7 Employee Discount","not Employee Meal"]) assert.equal(discountCategory(offer("1",12,name)),"other_discount");
  assert.equal(discountCategory({name:"Manager Meal",definition_id:"640220904"}),"unresolved");
});
test("summary counts order adjustments once, preserves refund signs and excludes open orders",()=>{
  const a = offer("a",12,"$12 Employee Meal"), b=offer("b",2,"$12 Employee Meal");
  const data = salesReports(status([
    order({discounts:[a,b],items:[{id:"combo",discounts:[{amount:12,order_adjustment_id:"a"}]},{id:"child",discounts:[{amount:12,order_adjustment_id:"a"}]}]}),
    order({id:"101",closed:false,discounts:[offer("c",100,"$12 Employee Meal")]}),
    order({id:"102",refund:true,discounts:[offer("d",-12,"$12 Employee Meal")]}),
  ]));
  assert.deepEqual(data.summary.categories.employee_meal,{adjustments:3,orders:2,amount:2});
  assert.equal(data.summary.discounts.amount,2);
  assert.equal(data.summary.open_adjustments,1);
  assert.equal(data.adjustments[0].items.length,2);
});
test("void, deleted and cleared rows retain independent flags without inventing cancellations or losses",()=>{
  const data=salesReports(status([order({items:[
    {id:"1",description:"Main",price:10,voided:true,deleted:false,cleared:false,removal_flags_captured:true,void:{employee_id:"actor",reason_id:"2"}},
    {id:"2",price:0,voided:true,deleted:true,cleared:false,removal_flags_captured:true},
    {id:"3",price:5,voided:false,deleted:false,cleared:true,removal_flags_captured:true},
  ]}),order({id:"101",total:0})]));
  assert.equal(data.summary.voided_entries,2); assert.equal(data.summary.deleted_entries,1); assert.equal(data.summary.cleared_entries,1);
  assert.equal(data.removals.length,3); assert.equal(data.summary.empty_orders,1);
  assert.equal(data.removals[0].voided_by_id,"actor"); assert.equal(data.removals[0].employee_id,"cashier");
  assert.equal("void_loss" in data.summary,false); assert.equal("cancelled_orders" in data.summary,false);
});
test("unknown coverage remains visible and empty saved data differs from no snapshot",()=>{
  const data=salesReports(status([order({details_version:2,discounts:null,promotions:null})]));
  assert.equal(data.coverage.missing_discounts,1); assert.equal(data.coverage.legacy_void_details,1);
  assert.equal(salesReports(status([])).available,true);
  assert.equal(salesReports({...status([]),day:null}).available,false);
});
test("CSV protects source formulas, quotes and lines, includes open state and exports only chosen category",()=>{
  const data=salesReports(status([order({closed:false,employee_name:' =HYPERLINK("bad")',discounts:[offer("1",2,"$12 Employee Meal"),offer("2",3,"Manager Meal")]})]));
  const csv=reportsCsv(data,"employee_meal");
  assert.match(csv,/' =HYPERLINK\(""bad""\)/); assert.match(csv,/"false"/); assert.ok(!csv.includes("Manager Meal"));
});
test("Sales XML keeps only useful void fields and resolves the void actor separately",()=>{
  const xml=`<Envelope><Body><GetOrdersResponse><GetOrdersResult><ResultCode>0</ResultCode><Orders><Order><Id>1</Id><Number>2</Number><BusinessDate>2026-10-19</BusinessDate><IsClosed>true</IsClosed><EmployeeId>cashier</EmployeeId><Subtotal>0</Subtotal><Tax>0</Tax><Total>0</Total><NetSales>0</NetSales><Entries><OrderEntry><Id>2</Id><ItemId>3</ItemId><Description>Fries</Description><Price>3.29</Price><NetSales>0</NetSales><IsVoided>true</IsVoided><IsDeleted>false</IsDeleted><IsCleared>false</IsCleared><Void><EmployeeId>actor</EmployeeId><ApproverEmployeeId>boss</ApproverEmployeeId><VoidReasonId>7</VoidReasonId><Time><DateTime>2026-10-19T19:00:00Z</DateTime><OffsetMinutes>-360</OffsetMinutes></Time><Note>private-note</Note></Void><Payments>private-card</Payments></OrderEntry></Entries></Order></Orders></GetOrdersResult></GetOrdersResponse></Body></Envelope>`;
  const orders=parseOrders(xml,"2026-10-19");
  attachEmployeeNames(orders,{employees:[{id:"cashier",name:"Order Account"},{id:"actor",name:"Void Account"},{id:"boss",name:"Approver"}],fetched_at:"now"});
  const definitions=parseDefinitions("<Envelope><Body><GetVoidReasonsResponse><GetVoidReasonsResult><VoidReason><Id>7</Id><Name>Wrong item</Name><Note>private-note</Note></VoidReason></GetVoidReasonsResult></GetVoidReasonsResponse></Body></Envelope>","GetVoidReasons");
  attachDefinitions(orders,"GetVoidReasons",{...definitions,fetched_at:"now"});
  assert.equal(orders[0].items[0].void.employee_name,"Void Account"); assert.equal(orders[0].employee_name,"Order Account");
  assert.equal(orders[0].items[0].void.reason_name,"Wrong item");
  assert.equal(orders[0].items[0].void.at,"2026-10-19T19:00:00.000Z");
  assert.ok(!JSON.stringify(orders).includes("private-"));
});
