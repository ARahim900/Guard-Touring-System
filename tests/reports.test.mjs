import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReportCsv, reportTotals, visitRows } from '../apps/portal/src/lib/patrolReport.ts';

const scan = (id, validation = 'valid') => ({ id, device_time:'2026-09-11T01:00:00+04:00', server_time:'2026-09-11T09:00:00+04:00', effective_time:'2026-09-11T01:00:00+04:00', validation, latitude:null, longitude:null, accuracy_m:null, distance_m:null, status:'normal', note:null, flags:[], review_note:null, expected_attachments:0, attachment_count:0 });
const shift = (overrides = {}) => ({ id:'shift-1', patrol_date:'2026-09-10', guard_name:null, guard_ref:null, login_name:'Test login', route_name:'Test route', status:'completed', scheduled_start:'2026-09-10T22:00:00+04:00', scheduled_end:'2026-09-11T06:00:00+04:00', actual_start:null, actual_end:null, auto_closed_at:'2026-09-11T06:05:00+04:00', checkpoints:[], ...overrides });
const report = (shifts) => ({from_date:'2026-09-10',to_date:'2026-09-11',generated_at:'2026-09-11T10:00:00+04:00',shifts});

test('duplicate scans count once; flagged, rejected and unvisited stay distinct', () => {
  const data = report([shift({checkpoints:[
    {id:'a',name:'A',sequence:1,scans:[scan('1'),scan('2')]},
    {id:'b',name:'B',sequence:2,scans:[scan('3','flagged')]},
    {id:'c',name:'C',sequence:3,scans:[scan('4','rejected')]},
    {id:'d',name:'D',sequence:4,scans:[]},
  ]})]);
  assert.deepEqual(visitRows(data).map((r) => r.status),['Verified','Awaiting review','Rejected','Not visited']);
  const totals = reportTotals(data);
  assert.equal(totals.required,4);assert.equal(totals.verified,1);assert.equal(totals.completion,25);
});

test('open shift is not marked missed and cancelled shifts are excluded', () => {
  const checkpoint = {id:'a',name:'A',sequence:1,scans:[]};
  const data = report([shift({status:'active',scheduled_end:'2026-09-12T06:00:00+04:00',checkpoints:[checkpoint]}),shift({id:'2',status:'cancelled',checkpoints:[checkpoint]})]);
  assert.deepEqual(visitRows(data).map((r) => r.status),['Not yet visited','Cancelled']);
  assert.equal(reportTotals(data).required,1);assert.equal(reportTotals(data).unvisited,0);
});

test('CSV preserves unknown readings, quotes and spreadsheet formula safety', () => {
  const data=report([shift({guard_name:'=HYPERLINK("unsafe")',checkpoints:[{id:'a',name:'Gate, "one"',sequence:1,scans:[scan('1')]}]})]);
  const csv=buildReportCsv(data);
  assert.ok(csv.includes("'="));assert.ok(csv.includes('Gate, ""one""'));
  assert.ok(csv.includes('"Unknown"'));assert.ok(csv.includes('11/09/2026, 01:00:00'));
  assert.ok(csv.includes('11/09/2026, 09:00:00'));
  assert.ok(csv.includes('"","",""'));
});

test('large report and empty routes are retained without pagination loss', () => {
  const data = report([shift({checkpoints:Array.from({length:1201},(_,i)=>({id:String(i),name:`Test ${i}`,sequence:i+1,scans:[]}))}),shift({id:'empty'})]);
  assert.equal(visitRows(data).length,1201);
  assert.equal(buildReportCsv(data).split('\r\n').length,1203);
  assert.ok(buildReportCsv(data).includes('No checkpoints configured'));
  assert.equal(reportTotals(report([])).completion,null);
});
