import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReportCsv, csvCell, nightRows, reportTotals, visitRows } from '../apps/portal/src/lib/patrolReport.ts';

const scan = (id, validation = 'valid') => ({ id, device_time:'2026-09-11T01:00:00+04:00', server_time:'2026-09-11T09:00:00+04:00', effective_time:'2026-09-11T01:00:00+04:00', validation, latitude:null, longitude:null, accuracy_m:null, distance_m:null, status:'normal', note:null, flags:[], review_note:null, expected_attachments:0, attachment_count:0 });
const shift = (overrides = {}) => ({ id:'shift-1', patrol_date:'2026-09-10', guard_name:null, guard_ref:null, login_name:'Test login', route_name:'Test route', status:'completed', scheduled_start:'2026-09-10T22:00:00+04:00', scheduled_end:'2026-09-11T06:00:00+04:00', actual_start:null, actual_end:null, auto_closed_at:'2026-09-11T06:05:00+04:00', checkpoints:[], ...overrides });
const report = (shifts) => ({from_date:'2026-09-10',to_date:'2026-09-11',generated_at:'2026-09-11T10:00:00+04:00',shifts});

test('duplicate scans count once; flagged, rejected and missed stay distinct', () => {
  const data = report([shift({checkpoints:[
    {id:'a',name:'A',sequence:1,scans:[scan('1'),scan('2')]},
    {id:'b',name:'B',sequence:2,scans:[scan('3','flagged')]},
    {id:'c',name:'C',sequence:3,scans:[scan('4','rejected')]},
    {id:'d',name:'D',sequence:4,scans:[]},
  ]})]);
  assert.deepEqual(visitRows(data).map((r) => r.status),['Verified','Awaiting review','Rejected','Missed']);
  const totals = reportTotals(data);
  assert.equal(totals.required,4);assert.equal(totals.verified,1);assert.equal(totals.completion,25);
});

test('open shift is not marked missed and cancelled shifts are excluded', () => {
  const checkpoint = {id:'a',name:'A',sequence:1,scans:[]};
  const data = report([shift({status:'active',scheduled_end:'2026-09-12T06:00:00+04:00',checkpoints:[checkpoint]}),shift({id:'2',status:'cancelled',checkpoints:[checkpoint]})]);
  assert.deepEqual(visitRows(data).map((r) => r.status),['Pending','Cancelled']);
  assert.equal(reportTotals(data).required,1);assert.equal(reportTotals(data).missed,0);assert.equal(reportTotals(data).pending,1);
});

test('CSV leaves missing readings blank, quotes cells and blocks spreadsheet formulas', () => {
  const data=report([shift({guard_name:'=HYPERLINK("unsafe")',checkpoints:[{id:'a',name:'Gate, "one"',sequence:1,scans:[scan('1')]}]})]);
  const csv=buildReportCsv(data);
  assert.ok(csv.includes("'="));assert.ok(csv.includes('Gate, ""one""'));
  assert.doesNotMatch(csv, /unknown/i);assert.ok(csv.includes('11/09/2026, 01:00:00'));
  assert.ok(csv.includes('11/09/2026, 09:00:00'));
  assert.ok(csv.includes('"","",""'));
});

test('CSV starts with the shift date and never mentions contractors', () => {
  const csv = buildReportCsv(report([shift({checkpoints:[{id:'a',name:'A',sequence:1,scans:[]}]})]));
  const [head, row] = csv.replace('﻿', '').split('\r\n');
  assert.ok(head.startsWith('"Shift date",'));
  assert.ok(row.startsWith('"2026-09-10",'));
  assert.doesNotMatch(csv, /contractor/i);
});

test('large report and empty routes are retained without pagination loss', () => {
  const data = report([shift({checkpoints:Array.from({length:1201},(_,i)=>({id:String(i),name:`Test ${i}`,sequence:i+1,scans:[]}))}),shift({id:'empty'})]);
  assert.equal(visitRows(data).length,1201);
  assert.equal(buildReportCsv(data).split('\r\n').length,1203);
  assert.ok(buildReportCsv(data).includes('No checkpoints configured'));
  assert.equal(reportTotals(report([])).completion,null);
});

test('every night is listed, including a night with no patrol record at all', () => {
  const cp = (id, scans = []) => ({id,name:id,sequence:1,scans});
  const data = {from_date:'2026-09-06',to_date:'2026-09-12',generated_at:'2026-09-11T23:00:00+04:00',shifts:[
    shift({id:'done',patrol_date:'2026-09-06',guard_name:'Sample guard',checkpoints:[cp('a',[scan('1')])]}),
    shift({id:'part',patrol_date:'2026-09-07',actual_start:'2026-09-07T22:00:00+04:00',checkpoints:[cp('a',[scan('2')]),cp('b')]}),
    shift({id:'missed',patrol_date:'2026-09-08',status:'missed',auto_closed_at:null,checkpoints:[cp('a')]}),
    shift({id:'cancel',patrol_date:'2026-09-10',status:'cancelled',checkpoints:[cp('a')]}),
    shift({id:'live',patrol_date:'2026-09-11',status:'active',checkpoints:[cp('a')]}),
  ]};
  const nights = nightRows(data);
  assert.deepEqual(nights.map((n) => [n.date, n.status]), [
    ['2026-09-06','Completed'],['2026-09-07','Incomplete'],['2026-09-08','Missed'],
    ['2026-09-09','Absent'],['2026-09-10','Cancelled'],['2026-09-11','In progress'],['2026-09-12','Upcoming'],
  ]);
  assert.equal(nights[1].verified,1);assert.equal(nights[1].required,2);
  assert.deepEqual(nights[0].guards,['Sample guard']);
});

test('tonight without a record is not yet started, not missed', () => {
  const data = {from_date:'2026-09-11',to_date:'2026-09-11',generated_at:'2026-09-11T19:00:00+04:00',shifts:[]};
  assert.equal(nightRows(data)[0].status,'Not started');
});

test('scan export cells neutralise spreadsheet formulas', () => {
  assert.equal(csvCell('=1+1'),`"'=1+1"`);
  assert.equal(csvCell('  @SUM(A1)'),`"'  @SUM(A1)"`);
  assert.equal(csvCell(-5),'"-5"');
  assert.equal(csvCell('Gate "A"'),'"Gate ""A"""');
});
