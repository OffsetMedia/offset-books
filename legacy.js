
var DATA = window.__OB_BOOT__;
var state = { view: null, pfilter: 'Active', psearch: '', month: '', pid: '', allCosts: false, dtab: 'invoice', dfilter: 'All', dsearch: '', dtype: 'invoice', dno: '', ed: null, modal: null,
  etab: 'entries', ef: 'All', emonth: 'All', eproject: 'All', esearch: '', eshow: 150 };
DATA.quotes = DATA.quotes || []; DATA.invoices = DATA.invoices || []; DATA.approvals = DATA.approvals || []; DATA.costmap = DATA.costmap || [];

/* ---------- helpers ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){var n=Number(v);return isFinite(n)?n:0;}
function fmt(v){return num(v).toLocaleString('en-US',{maximumFractionDigits:0});}
function lkr(v){return 'LKR '+fmt(v);}
function sgn(v){return num(v)<0?'neg':'';}
function toast(msg,ok,keep){var t=document.getElementById('toast');t.textContent=msg;t.className=ok?'ok':'';t.style.display='block';clearTimeout(toast.h);toast.h=setTimeout(function(){t.style.display='none';},keep?60000:(ok?2400:7000));}
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MONFULL=['January','February','March','April','May','June','July','August','September','October','November','December'];
function pad(n){return ('0'+n).slice(-2);}
function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
var TODAY = ymd(new Date());
function dayNum(s){var p=String(s).slice(0,10).split('-');return Date.UTC(+p[0],+p[1]-1,+p[2])/86400000;}
function daysFrom(a,b){return Math.round(dayNum(b)-dayNum(a));}
function dshort(s){var p=String(s).slice(0,10).split('-');return pad(+p[2])+' '+MON[+p[1]-1];}
function dfull(s){var p=String(s).slice(0,10).split('-');return (+p[2])+' '+MON[+p[1]-1]+' '+p[0];}
function monthLabel(m){var p=String(m).split('-');return MONFULL[+p[1]-1]+' '+p[0];}
function fmtK(v){return v>=1000000?(v/1000000).toFixed(1).replace(/\.0$/,'')+'m':(v>=1000?Math.round(v/1000)+'k':String(Math.round(v)));}
function shortClient(n){return String(n||'').replace(/\s*\((pvt|private)\)\s*(ltd\.?)?/i,'').replace(/\s+pvt\.?\s*ltd\.?/i,'').trim();}
var COST_TYPES = String(DATA.settings.cost_types||'').split('|');
var BUDGET_KEY = {'Equipment rental':'budget_equipment_rental','Crew / freelancer':'budget_crew','Transport':'budget_transport','Food':'budget_food','Location & venue':'budget_location','Other':'budget_other'};
var ROLE = DATA.user.role;
var WARN = num(DATA.settings.budget_warning)||0.9;

/* document status of a cost: have / missing / not needed */
function docInfo(e){
  var d=String(e.doc_status||'').toLowerCase();
  if(d.indexOf('quote')>=0) return {t:'Quote only',k:'warn',miss:true};
  if(e.doc_url||d.indexOf('invoice')===0||d==='yes'||d==='receipt') return {t:'Invoice',k:'good',miss:false};
  if(d==='none') return {t:'Missing',k:'warn',miss:true};
  if(d==='bank line only') return String(e.payment_method)==='Bank transfer'?{t:'Missing',k:'warn',miss:true}:{t:'Bank line',k:'mute',miss:false};
  return {t:'-',k:'mute',miss:false};
}
function paidOf(e){return e.paid_status==='paid'?num(e.amount):num(e.paid_amount);}
function invNo(e){var m=/(NOINV-[\w-]+|INV-\d+)/.exec(String(e.description||''));return m?m[1]:'';}

/* ---------- derived figures (all client-side) ---------- */
function compute(){
  var byP={}, byM={}, general={costs:0,byType:{}};
  DATA.projects.forEach(function(p){byP[p.id]={p:p,invoiced:0,received:0,costs:0,byType:{},ninv:0,missing:0};});
  function bm(m){return byM[m]||(byM[m]={rev:0,cost:0,over:0,n:0,prod:{rev:0,cost:0},ai:{rev:0,cost:0},hasAi:false});}
  var aiAny=false;
  DATA.entries.forEach(function(e){
    var a=num(e.amount), m=String(e.date).slice(0,7);
    var s = e.project && byP[e.project] ? byP[e.project] : null;
    var ai = String(e.business_line)==='AI data'; if(ai) aiAny=true;
    if(e.kind==='income'){
      if(s){s.invoiced+=a; s.ninv++; s.received+=paidOf(e);}
      var b=bm(m); b.rev+=a; b.n++; (ai?b.ai:b.prod).rev+=a;
    } else if(e.kind==='cost' && String(e.account)!=='1400'){
      var tgt = s || general; tgt.costs+=a; tgt.byType[e.cost_type]=(tgt.byType[e.cost_type]||0)+a;
      if(s && docInfo(e).miss) s.missing++;
      var b2=bm(m); b2.cost+=a; if(!s) b2.over+=a; (ai?b2.ai:b2.prod).cost+=a;
    }
  });
  Object.keys(byP).forEach(function(k){
    var s=byP[k]; s.owed=s.invoiced-s.received; s.profit=s.invoiced-s.costs; s.margin=s.invoiced?s.profit/s.invoiced:0;
    s.budget=0; COST_TYPES.forEach(function(t){var key=BUDGET_KEY[t]; if(key) s.budget+=num(s.p[key]);});
  });
  return {byP:byP,general:general,byM:byM,aiAny:aiAny};
}
var C = compute();
function mo(m){return C.byM[m]||{rev:0,cost:0,over:0,n:0,prod:{rev:0,cost:0},ai:{rev:0,cost:0}};}

function fyMonths(){
  var out=[],p=String(DATA.settings.fy_start||'2026-04-01').split('-'),y=+p[0],m0=+p[1]-1;
  for(var i=0;i<12;i++){var yy=y+Math.floor((m0+i)/12),mm=(m0+i)%12;out.push(yy+'-'+pad(mm+1));}
  return out;
}
function curMonth(){var ms=fyMonths(),t=TODAY.slice(0,7);if(t<ms[0])return ms[0];if(t>ms[11])return ms[11];return t;}
function fyLabel(){var ms=fyMonths();return 'FY '+ms[0].slice(0,4)+'/'+ms[11].slice(2,4);}

function statusPill(s){
  var m={'In production':'info','Delivered':'good','Quoted':'warn','Confirmed':'info','Closed':'mute','Cancelled':'late'};
  return '<span class="pill '+(m[s]||'mute')+'">'+esc(s||'-')+'</span>';
}
function budgetBar(s){
  if(!s.budget) return '<span class="note">no budget</span>';
  var r=s.costs/s.budget, cls=r>1?'over':(r>=WARN?'warn':'');
  return '<div class="bar '+cls+'" title="'+Math.round(r*100)+'% of budget"><i style="width:'+Math.min(100,Math.round(r*100))+'%"></i></div>';
}

/* ---------- navigation ---------- */
var NAV = [
  {id:'dashboard',label:'Dashboard',roles:['admin','viewer','accountant']},
  {id:'inbox',label:'Inbox',roles:['admin']},
  {id:'projects',label:'Projects',roles:['admin','viewer','accountant']},
  {id:'entries',label:'Entries',roles:['admin','viewer','accountant']},
  {sec:1,id:'vendors',label:'Vendors',roles:['admin','accountant']},
  {sec:1,id:'bank',label:'Bank',roles:['admin']},
  {sec:1,id:'pay',label:'Payments',roles:['admin','viewer','accountant']},
  {id:'docs',label:'Invoices',roles:['admin','viewer','accountant']},
  {sec:1,id:'clients',label:'Clients',roles:['admin','viewer','accountant']},
  {sec:1,id:'crew',label:'Crew',roles:['admin','viewer','accountant']},
  {sec:1,id:'settings',label:'Settings',roles:['admin']},
  {phone:1,id:'more',label:'More',roles:['admin','viewer','accountant']}
];
function renderNav(){
  var items=NAV.filter(function(n){return n.roles.indexOf(ROLE)>=0;});
  if(ROLE==='accountant') items.sort(function(a,b){return (a.id==='books'?-1:b.id==='books'?1:0);});
  var cur = state.view==='project' ? 'projects' : (state.view==='doc'||state.view==='edit' ? 'docs' : state.view);
  document.getElementById('nav').innerHTML =
    '<div class="logo"><span class="w">OFFSET</span><span class="m">MEDIA</span></div>'+
    items.map(function(n){
      var nb=n.id==='entries'&&ROLE==='admin'?pendingItems().length+OBX.reviews().length:(n.id==='inbox'?OBX.unread():0);
      var badge=nb?'<span class="navbadge">'+nb+'</span>':'';
      return '<a data-view="'+n.id+'" class="'+(cur===n.id||(n.id==='more'&&OBX.isSecondary(cur))?'on':'')+(n.sec?' nsec':'')+(n.phone?' phoneonly':'')+'" tabindex="0">'+OBX.icon(n.id)+'<span class="lbl">'+esc(n.label)+'</span>'+badge+'</a>';}).join('')+
    '<div class="who"><b>'+esc(DATA.user.name)+'</b>'+esc(ROLE)+' · <a style="display:inline;padding:0;color:var(--cobalt)" id="refresh" tabindex="0">refresh</a></div>';
}
function go(v){
  state.view=v; renderNav();
  var f={inbox:OBX.vInbox,more:OBX.vMore,dashboard:vDashboard,books:vBooks,projects:vProjects,project:vProject,entries:vEntries,bank:vBank,acct:vAcct,pay:vPay,vendors:vVendors,docs:vDocs,doc:vDoc,edit:vEdit,clients:vClients,crew:vCrew,settings:vSettings}[v];
  document.getElementById('main').innerHTML='<div class="phone-logo"><span class="w">OFFSET</span></div>'+f();
  window.scrollTo(0,0);
  if(v==='edit') edPreview(0); else if(v==='doc') loadDocPreview();
}

/* ---------- dashboard ---------- */
function card(l,v,cls,sub){return '<div class="card"><span class="mono">'+esc(l)+'</span><span class="big num '+(cls||'')+'">'+esc(v)+'</span>'+(sub?'<div class="sub">'+esc(sub)+'</div>':'')+'</div>';}

function invoiceInfo(){var m={};(DATA.invoices||[]).forEach(function(i){m[i.number]=i;});return m;}
function sentDate(inv){try{return JSON.parse(inv.status_dates||'{}').sent||'';}catch(e){return '';}}

/* clients owe: unpaid income entries, grouped by client */
function owedList(){
  var inv=invoiceInfo(), groups={}, total=0;
  DATA.entries.forEach(function(e){
    if(e.kind!=='income'||e.paid_status==='paid') return;
    var a=num(e.amount)-paidOf(e); if(a<=0.005) return; total+=a;
    var no=invNo(e), i=inv[no]||{}, due=String(i.due||''), sent=sentDate(i);
    var g=groups[e.payee]||(groups[e.payee]={who:e.payee,amt:0,n:0,no:no,late:0,due:'',sent:''});
    g.amt+=a; g.n++;
    if(due){ var late=daysFrom(due,TODAY); if(late>g.late) g.late=late; if(!g.due||due<g.due) g.due=due; }
    if(sent&&(!g.sent||sent>g.sent)) g.sent=sent;
  });
  var rows=Object.keys(groups).map(function(k){
    var g=groups[k], name=shortClient(g.who)+(g.n>1?' · '+g.n+' invoices':(g.no?' · '+g.no:''));
    var tag,kind;
    if(g.late>0){tag=g.late+(g.late===1?' day late':' days late');kind='late';}
    else if(g.due===TODAY){tag='Due today';kind='warn';}
    else if(g.due){tag='Due '+dshort(g.due);kind='info';}
    else {tag='Unpaid';kind='warn';}
    return {who:name,amt:g.amt,tag:tag,kind:kind,late:g.late};
  });
  rows.sort(function(a,b){return (b.late>0)-(a.late>0)||b.amt-a.amt;});
  return {rows:rows,total:total};
}

/* next tax instalment date: 15 Aug, 15 Nov, 15 Feb, 15 May */
function nextTax(){
  var y=+TODAY.slice(0,4), c=[], i;
  [y,y+1].forEach(function(yy){[[8,15],[11,15],[2,15],[5,15]].forEach(function(md){c.push(yy+'-'+pad(md[0])+'-'+pad(md[1]));});});
  c.sort();
  for(i=0;i<c.length;i++) if(c[i]>=TODAY) return {date:c[i],days:daysFrom(TODAY,c[i])};
  return null;
}
function comingUp(){
  var out=[], horizon=45, y=+TODAY.slice(0,4), mth=+TODAY.slice(5,7), d0=+TODAY.slice(8,10);
  (DATA.recurring||[]).forEach(function(r){
    var day=Math.max(1,Math.min(31,num(r.day))); if(!r.name||!day) return;
    var yy=y, mm=mth, dim=new Date(yy,mm,0).getDate(), dd=Math.min(day,dim);
    if(dd<d0){mm++; if(mm>12){mm=1;yy++;} dd=Math.min(day,new Date(yy,mm,0).getDate());}
    var dt=yy+'-'+pad(mm)+'-'+pad(dd), dl=daysFrom(TODAY,dt);
    if(dl>=0&&dl<=horizon) out.push({date:dt,sort:dt,what:r.name,amt:num(r.amount)?(String(r.name).match(/workspace/i)?'~':'')+fmt(r.amount):'-'});
  });
  var t=nextTax(); if(t&&t.days<=horizon) out.push({date:t.date,sort:t.date,what:'Income tax instalment',amt:'-'});
  DATA.entries.forEach(function(e){
    if(e.kind==='cost'&&e.paid_status==='unpaid'&&num(e.amount)>0)
      out.push({date:'',label:'Unpaid',sort:'0000-00-00',what:(e.payee||'')+(e.description?' · '+e.description:''),amt:fmt(e.amount)});
  });
  out.sort(function(a,b){return a.sort<b.sort?-1:a.sort>b.sort?1:0;});
  return out.slice(0,7);
}

function chartSvg(sel){
  var ms=fyMonths(), cm=curMonth(), W=720,H=230,L=44,R=8,T=14,B=28,iw=W-L-R,ih=H-T-B,max=1;
  ms.forEach(function(m){var o=mo(m);max=Math.max(max,o.rev,o.cost);});
  var pw=Math.pow(10,Math.floor(Math.log(max)/Math.LN10)), n=max/pw, top=(n<=1?1:n<=2?2:n<=5?5:10)*pw;
  var cw=iw/12, bw=Math.min(16,cw/2-3), s='';
  [0,0.5,1].forEach(function(f){
    var y=T+ih-ih*f;
    s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="#221C3D" stroke-width="1"/><text x="'+(L-6)+'" y="'+(y+3)+'" text-anchor="end">'+fmtK(top*f)+'</text>';
  });
  ms.forEach(function(m,i){
    var x0=L+i*cw, o=mo(m), rh=ih*o.rev/top, ch=ih*o.cost/top, mid=x0+cw/2, future=m>cm;
    s+='<g data-month="'+m+'" style="cursor:pointer">'+
      '<title>'+monthLabel(m)+': revenue '+fmt(o.rev)+', costs '+fmt(o.cost)+', profit '+fmt(o.rev-o.cost)+'</title>'+
      (m===sel?'<rect x="'+(x0+2)+'" y="'+T+'" width="'+(cw-4)+'" height="'+ih+'" rx="6" fill="#1C1838"/>':'<rect x="'+x0+'" y="'+T+'" width="'+cw+'" height="'+ih+'" fill="transparent"/>')+
      (o.rev>0?'<rect x="'+(mid-bw-1)+'" y="'+(T+ih-rh)+'" width="'+bw+'" height="'+rh+'" rx="3" fill="#2B4BFF"/>':'')+
      (o.cost>0?'<rect x="'+(mid+1)+'" y="'+(T+ih-ch)+'" width="'+bw+'" height="'+ch+'" rx="3" fill="#7838FF"/>':'')+
      '<text x="'+mid+'" y="'+(H-8)+'" text-anchor="middle" class="'+(m===sel?'sel':'')+'" style="'+(future?'opacity:.5':'')+'">'+MON[+m.slice(5,7)-1].toUpperCase()+'</text></g>';
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Revenue and costs by month, '+fyLabel()+'">'+s+'</svg>';
}

function vDashboard(){return OBX.dashBanner()+vDashboard0();}
function vDashboard0(){
  var ms=fyMonths(), cm=curMonth();
  if(!state.month||ms.indexOf(state.month)<0) state.month=cm;
  var m=state.month, o=mo(m), profit=o.rev-o.cost, margin=o.rev?Math.round(profit/o.rev*100):0;
  var prevOk=ms.indexOf(m)>0, nextOk=ms.indexOf(m)<ms.indexOf(cm);
  var ow=owedList(), nLate=ow.rows.filter(function(r){return r.late>0;}).length;

  /* business lines */
  function lineCard(name,tag,tagc,d,empty){
    var p=d.rev-d.cost;
    return '<div class="panel"><div class="ptitle"><strong>'+name+'</strong><span class="mono" style="color:'+tagc+';margin:0">'+tag+'</span></div>'+
      (empty?'<div class="trio"><div><span class="k">Revenue</span><strong>-</strong></div><div><span class="k">Costs</span><strong>-</strong></div><div><span class="k">Profit</span><strong>-</strong></div></div><div class="sub" style="margin:0">No AI data entries yet</div>'
      :'<div class="trio"><div><span class="k">Revenue</span><strong class="num">'+fmt(d.rev)+'</strong></div><div><span class="k">Costs</span><strong class="num">'+fmt(d.cost)+'</strong></div><div><span class="k">Profit</span><strong class="num" style="color:'+(p<0?'var(--over)':'var(--good)')+'">'+fmt(p)+'</strong></div></div>')+'</div>';
  }
  var fyProfit=0; ms.forEach(function(x){if(x<=cm){var q=mo(x);fyProfit+=q.rev-q.cost;}});
  var setAside=Math.max(0,fyProfit)*(num(DATA.settings.tax_rate)||0.3), tx=nextTax();
  var taxCard='<div class="panel"><div class="ptitle"><strong>Tax</strong><span class="mono" style="color:var(--warn);margin:0">'+(tx?'Due '+dshort(tx.date):'')+'</span></div>'+
    '<div class="trio"><div><span class="k">Set aside</span><strong class="num">'+fmt(setAside)+'</strong></div><div><span class="k">Instalment</span><strong>-</strong></div><div><span class="k">Days left</span><strong class="num" style="color:var(--warn)">'+(tx?tx.days:'-')+'</strong></div></div>'+
    '<div class="sub" style="margin:0">Set aside is an estimate: '+Math.round((num(DATA.settings.tax_rate)||0.3)*100)+'% of profit to date. Instalment amount to be agreed with the accountant.</div></div>';

  /* owed + coming up */
  var owedHtml=ow.rows.map(function(r){return '<div class="lrow"><span>'+esc(r.who)+'</span><span class="r"><span class="tag '+r.kind+'">'+esc(r.tag)+'</span><strong class="num">'+fmt(r.amt)+'</strong></span></div>';}).join('')||'<div class="note" style="padding-top:8px">Nothing outstanding.</div>';
  var upHtml=comingUp().map(function(u){return '<div class="lrow"><span class="l"><span class="d">'+(u.date?dshort(u.date):esc(u.label))+'</span><span>'+esc(u.what)+'</span></span><strong class="num">'+esc(u.amt)+'</strong></div>';}).join('')||'<div class="note" style="padding-top:8px">Nothing due in the next 45 days.</div>';

  /* claude spend */
  var usage=DATA.aiusage||null, spend='';
  if(usage!==null){
    var budget=num(DATA.settings.claude_monthly_budget_usd)||4, used=0;
    usage.forEach(function(r){ if(String(r.time).slice(0,7)===m) used+=num(r.cost_usd); });
    var r=used/budget, cls=r>=1?'over':(r>=0.75?'warn':'good');
    spend='<div class="panel"><div class="ptitle"><strong>Claude spend</strong><span class="mono" style="margin:0;color:var(--muted2)">'+esc(monthLabel(m))+'</span></div>'+
      '<span class="big num" style="font-size:36px;line-height:1">USD '+used.toFixed(2)+'</span>'+
      '<div class="bar '+cls+'"><i style="width:'+Math.min(100,Math.round(r*100))+'%"></i></div>'+
      '<div class="sub" style="margin:0">of USD '+budget.toFixed(2)+' monthly budget'+(usage.length?'':' · no usage yet')+'</div></div>';
  }

  /* projects table */
  var order={'In production':0,'Confirmed':1,'Quoted':2,'Delivered':3};
  var plist=DATA.projects.filter(function(p){return ['Closed','Cancelled'].indexOf(p.status)<0;}).sort(function(a,b){
    var x=(order[a.status]==null?9:order[a.status])-(order[b.status]==null?9:order[b.status]);
    return x||C.byP[b.id].invoiced-C.byP[a.id].invoiced;
  }).slice(0,8);
  var prow=plist.map(function(p){
    var s=C.byP[p.id], pct=s.budget?Math.round(s.costs/s.budget*100):null, cls=pct==null?'':(pct>100?'over':(pct>=WARN*100?'warn':'good'));
    return '<tr class="click" data-pid="'+esc(p.id)+'" tabindex="0"><td class="name"><b>'+esc(p.name)+'</b><small>'+esc(shortClient(p.client))+'</small></td><td>'+statusPill(p.status)+'</td>'+
      '<td class="r num">'+(p.agreed_fee?fmt(p.agreed_fee):'-')+'</td><td class="r num">'+fmt(s.costs)+'</td><td class="r num '+sgn(s.profit)+'"><b>'+fmt(s.profit)+'</b></td>'+
      '<td>'+(pct==null?'<span class="note">no budget</span>':'<div style="display:flex;align-items:center;gap:10px"><div class="bar '+cls+'" style="flex:1" title="'+pct+'% of budget"><i style="width:'+Math.min(100,pct)+'%"></i></div><span class="num" style="font-size:12px;width:40px;text-align:right">'+pct+'%</span></div>')+'</td></tr>';
  }).join('');

  var pend=ROLE==='admin'?pendingItems().length:0;
  var pendBanner=pend?'<div class="banner" style="cursor:pointer" data-gotab="queue" tabindex="0"><b>'+pend+(pend===1?' item is':' items are')+' waiting for your approval.</b> Open the queue</div>':'';
  return pendBanner+'<div class="head"><div><span class="mono">Dashboard · '+fyLabel()+' · LKR</span><h1 style="font-size:64px;font-weight:900">'+esc(monthLabel(m))+'</h1></div>'+
    '<div class="mnav"><button class="btn sq" data-mshift="-1" aria-label="Previous month"'+(prevOk?'':' disabled')+'>&lsaquo;</button><button class="btn sq" data-mshift="1" aria-label="Next month"'+(nextOk?'':' disabled')+'>&rsaquo;</button></div></div>'+
    '<div class="grid g4">'+
      '<div class="card profit hero span2"><span class="mono">Profit this month</span><span class="big num '+sgn(profit)+'">'+fmt(profit)+'</span><span class="sub" style="margin:0">'+(o.rev?margin+'% margin · production and AI combined':'No revenue booked this month')+'</span></div>'+
      '<div class="card tile"><span class="mono">Revenue</span><span class="big num">'+fmt(o.rev)+'</span><span class="sub" style="margin:0">'+o.n+(o.n===1?' invoice':' invoices')+'</span></div>'+
      '<div class="card tile"><span class="mono">Costs</span><span class="big num">'+fmt(o.cost)+'</span><span class="sub" style="margin:0">Overheads '+fmt(o.over)+'</span></div>'+
    '</div>'+
    '<div class="grid g3">'+
      lineCard('Production','By project','#8FA2FF',o.prod,false)+
      lineCard('AI data','Monthly total','#B48CFF',o.ai,!C.aiAny)+
      taxCard+
    '</div>'+
    '<div class="grid '+(spend?'g21':'')+'"><div class="panel"><div class="ptitle"><span class="h2big">Month by month</span><div class="legend"><span><i style="background:#2B4BFF"></i>Revenue</span><span><i style="background:#7838FF"></i>Costs</span></div></div>'+chartSvg(m)+'</div>'+spend+'</div>'+
    spendPanel(true)+
    '<div class="grid g2">'+
      '<div class="panel"><div class="ptitle"><strong>Clients owe you</strong><span class="big num">'+fmt(ow.total)+'</span></div>'+owedHtml+'</div>'+
      '<div class="panel"><div class="ptitle"><strong>Coming up</strong></div>'+upHtml+'</div>'+
    '</div>'+
    '<div class="panel" style="padding:6px 0 4px;gap:0"><div style="display:flex;justify-content:space-between;align-items:center;padding:14px 22px"><span class="h2big">Projects</span><a class="link" data-view="projects" tabindex="0">All projects</a></div>'+
      '<div class="tablewrap" style="border:0;border-radius:0"><table><thead><tr><th>Project</th><th>Status</th><th class="r">Fee</th><th class="r">Spent</th><th class="r">Profit</th><th>Budget used</th></tr></thead><tbody>'+
      (prow||'<tr><td colspan="6" class="empty">No active projects.</td></tr>')+'</tbody></table></div></div>'+
    '<p class="note" style="margin-top:12px">Overheads are costs not tied to a project. Revenue counts on invoice date, costs on cost date.</p>';
}

/* ---------- projects ---------- */
function vProjects(){
  var statuses=['Active','All','Quoted','Confirmed','In production','Delivered','Closed','Cancelled'];
  var list=DATA.projects.filter(function(p){
    var f=state.pfilter;
    if(f==='Active'){ if(['Closed','Cancelled'].indexOf(p.status)>=0) return false; }
    else if(f!=='All' && p.status!==f) return false;
    var q=state.psearch.toLowerCase();
    return !q || (p.name+' '+p.client+' '+p.property).toLowerCase().indexOf(q)>=0;
  });
  var rows=list.map(function(p){
    var s=C.byP[p.id];
    return '<tr class="click" data-pid="'+esc(p.id)+'" tabindex="0">'+
     '<td class="name">'+esc(p.name)+'<small>'+esc(p.client)+'</small></td>'+
     '<td>'+statusPill(p.status)+'</td>'+
     '<td class="r num">'+fmt(s.invoiced)+'</td><td class="r num">'+fmt(s.received)+'</td>'+
     '<td class="r num">'+fmt(s.owed)+'</td>'+
     '<td class="r num">'+fmt(s.costs)+'</td>'+
     '<td class="r num '+sgn(s.profit)+'">'+fmt(s.profit)+'</td>'+
     '<td class="r num">'+(s.invoiced?Math.round(s.margin*100)+'%':'-')+'</td>'+
     '<td>'+budgetBar(s)+'</td><td>'+(p.budget_url?'<a class="dl" href="'+esc(p.budget_url)+'" target="_blank" rel="noopener"><span class="tag info">Budget sheet</span></a>':(ROLE==='admin'?'<button class="chip" data-act="pb-create" data-id="'+esc(p.id)+'">+ Budget</button>':''))+'</td></tr>';
  }).join('');
  return '<div class="head"><div><span class="mono">'+list.length+' shown</span><h1>Projects</h1></div>'+(ROLE==='admin'?'<div class="btnrow"><button class="btn primary" data-act="pj-new">New project</button></div>':'')+'</div>'+
   '<div class="filters">'+statuses.map(function(s){return '<button class="chip '+(state.pfilter===s?'on':'')+'" data-pf="'+esc(s)+'">'+esc(s)+'</button>';}).join('')+
   '<input class="search" id="psearch" placeholder="Search project or client" value="'+esc(state.psearch)+'"></div>'+
   '<div class="tablewrap"><table class="sticky1"><thead><tr><th>Project</th><th>Status</th><th class="r">Invoiced</th><th class="r">Received</th><th class="r">Owed</th><th class="r">Costs</th><th class="r">Profit</th><th class="r">Margin</th><th>Budget used</th><th>Internal budget</th></tr></thead><tbody>'+
   (rows||'<tr><td colspan="10" class="empty">No projects match.</td></tr>')+'</tbody></table></div>'+
   '<p class="note" style="margin-top:12px">Company costs not tied to a project: <span class="num">'+lkr(C.general.costs)+'</span> (kept under "General").</p>';
}

function openProject(id){ state.pid=id; state.allCosts=false; go('project'); }

function vProject(){
  var s=C.byP[state.pid];
  if(!s) return '<div class="empty">Project not found. <a class="link" data-view="projects" tabindex="0">All projects</a></div>';
  var p=s.p, inv=invoiceInfo();

  /* budget against spend */
  var brows=COST_TYPES.filter(function(t){return BUDGET_KEY[t];}).map(function(t){
    var b=num(p[BUDGET_KEY[t]]), sp=s.byType[t]||0;
    if(!b&&!sp) return '';
    var color,note,w;
    if(b){ var r=sp/b; w=Math.min(100,Math.round(r*100));
      if(sp>b){color='#FF4D7D';note=fmt(sp-b)+' over budget';}
      else if(r>=WARN){color='#FFC067';note=fmt(b-sp)+' left';}
      else {color='#3DDC97';note=fmt(b-sp)+' left';}
    } else {w=100;color='#FFC067';note='Not budgeted';}
    return '<div class="brow"><div class="t"><strong>'+esc(t)+'</strong><span><strong class="num">'+fmt(sp)+'</strong> <span style="color:var(--muted2)">of '+(b?fmt(b):'no budget')+'</span></span></div>'+
      '<div class="bar"><i style="width:'+w+'%;background:'+color+'"></i></div><span style="font-size:12px;font-weight:600;color:'+color+'">'+note+'</span></div>';
  }).join('');

  /* invoices (from income entries, enriched from the Invoices tab) */
  var irows=DATA.entries.filter(function(e){return e.kind==='income'&&e.project===state.pid;})
    .sort(function(a,b){return String(b.date).localeCompare(String(a.date));}).map(function(e){
      var no=invNo(e), due=String((inv[no]||{}).due||''), tag,kind;
      var pd=paidOf(e);
      if(e.paid_status==='paid'){tag='Paid';kind='good';}
      else if(due&&due<TODAY){var d=daysFrom(due,TODAY);tag=d+(d===1?' day late':' days late');kind='late';}
      else if(pd>0){tag='Part paid';kind='warn';}
      else if(due===TODAY&&due){tag='Due today';kind='warn';}
      else if(due){tag='Due '+dshort(due);kind='info';}
      else {tag='Unpaid';kind='warn';}
      var left=num(e.amount)-pd, has=!!inv[no];
      return '<div class="lrow"'+(has?' data-doc="invoice|'+esc(no)+'" style="cursor:pointer" tabindex="0"':'')+'><span class="l"><span style="font:500 12px \'JetBrains Mono\',monospace;'+(has?'color:var(--link)':'')+'">'+esc(no||'-')+'</span><span style="color:var(--muted)">'+esc(e.cost_type||'')+'</span></span><span class="r"><strong class="num">'+fmt(e.amount)+'</strong>'+(pd>0&&left>0.005?'<span class="note">'+fmt(left)+' left</span>':'')+'<span class="tag '+kind+'">'+esc(tag)+'</span></span></div>';
    }).join('')||'<div class="note">No invoices yet.</div>';

  /* costs */
  var costs=DATA.entries.filter(function(e){return e.kind==='cost'&&e.project===state.pid;})
    .sort(function(a,b){return String(b.date).localeCompare(String(a.date))||String(b.id).localeCompare(String(a.id));});
  var shown=state.allCosts?costs:costs.slice(0,25);
  var crows=shown.map(function(e){
    var di=docInfo(e), paid=e.paid_status==='paid'?(e.paid_date?dshort(e.paid_date):'Paid'):(e.paid_status==='part'?'Part paid':'Unpaid');
    return '<tr'+(ROLE==='admin'?' class="click" data-eid="'+esc(e.id)+'" tabindex="0"':'')+'><td><span class="mono" style="font-size:11px">'+esc(e.shoot||'-')+'</span></td><td class="wrap"><b>'+esc(e.payee)+'</b></td><td class="wrap" style="color:#C8C2DE">'+esc(e.description)+'</td>'+
      '<td class="r num"><b>'+fmt(e.amount)+'</b></td><td style="color:'+(e.paid_status==='paid'?'var(--pill-good)':'var(--warn)')+'">'+esc(paid)+'</td><td>'+docTag(e,di)+'</td></tr>';
  }).join('')||'<tr><td colspan="6" class="empty">No costs yet.</td></tr>';
  var more=costs.length>25?'<div style="padding:12px 22px"><button class="chip" data-allcosts="1">'+(state.allCosts?'Show latest 25':'Show all '+costs.length)+'</button></div>':'';

  var statusCtl = ROLE==='admin'
    ? '<select id="pstatus" data-pid="'+esc(p.id)+'" aria-label="Project status">'+String(DATA.settings.project_statuses).split('|').map(function(x){return '<option'+(x===p.status?' selected':'')+'>'+esc(x)+'</option>';}).join('')+'</select>'
    : statusPill(p.status);

  var meta=[shortClient(p.client)];
  if(p.property&&p.property!=='Standalone project') meta.push(p.property);
  if(p.start) meta.push(dfull(p.start)+(p.end?' - '+dfull(p.end):' onwards'));
  var fee=num(p.agreed_fee), feeNote=fee?(s.invoiced<fee?fmt(fee-s.invoiced)+' not yet invoiced':'Fully invoiced'):'No fee set';
  function kpi(label,val,note,extra){return '<div class="kpi card '+(extra||'')+'"><span class="mono">'+label+'</span><span class="big num '+(label==='Profit'?sgn(s.profit):'')+'">'+val+'</span><span class="sub" style="margin:0">'+note+'</span></div>';}

  return '<a class="back" data-view="projects" tabindex="0">&lsaquo; All projects</a>'+
    '<div class="head"><div><span class="mono">'+esc(meta.join(' · '))+'</span><h1 style="font-size:60px;font-weight:900;line-height:.9">'+esc(p.name)+'</h1></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+statusCtl+(ROLE==='admin'?'<button class="btn" data-act="pj-edit" data-id="'+esc(p.id)+'">Edit project</button><button class="btn" data-act="new-qt" data-project="'+esc(p.id)+'">New quote</button><button class="btn primary" data-act="new-inv" data-project="'+esc(p.id)+'">New invoice</button>':'')+'</div></div>'+
    '<div class="grid g5">'+
      kpi('Agreed fee',fee?fmt(fee):'-',feeNote)+
      kpi('Invoiced',fmt(s.invoiced),s.ninv+(s.ninv===1?' invoice':' invoices'))+
      kpi('Received',fmt(s.received),s.invoiced?(s.owed>0?fmt(s.owed)+' still owed':'All paid'):'Nothing invoiced')+
      kpi('Costs',fmt(s.costs),s.missing?s.missing+(s.missing===1?' document missing':' documents missing'):'All documents in')+
      kpi('Profit',fmt(s.profit),s.invoiced?Math.round(s.margin*100)+'% of invoiced':'Nothing invoiced yet','profit')+
    '</div>'+
    OBX.shootsPanel(p,s)+
    '<div class="grid g2">'+'<div class="panel"><span class="h2big">Budget against spend</span>'+(brows||'<div class="note">No budget set and nothing spent.</div>')+'</div>'+
      '<div class="panel"><span class="h2big">Invoices</span>'+irows+'</div>'+
    '</div>'+
    '<div class="panel" style="padding:6px 0 4px;gap:0"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding:14px 22px"><span class="h2big">Costs</span>'+
      (ROLE==='admin'||ROLE==='viewer'?'<button class="chip" data-act="new-entry" data-project="'+esc(p.id)+'">'+(ROLE==='admin'?'+ Add cost':'+ Submit a cost')+'</button>':'')+
      (s.missing?'<span class="mono" style="color:var(--warn);margin:0">'+s.missing+(s.missing===1?' document missing':' documents missing')+'</span>':'')+'</div>'+
      '<div class="tablewrap" style="border:0;border-radius:0"><table><thead><tr><th>Shoot</th><th>Paid to</th><th>What for</th><th class="r">Amount</th><th>Paid</th><th>Document</th></tr></thead><tbody>'+crows+'</tbody></table></div>'+more+'</div>'+
    (p.notes?'<div class="sec"><h3>Notes</h3><p class="note">'+esc(p.notes)+'</p></div>':'');
}

/* ---------- clients, crew ---------- */
function vClients(){
  var rows=DATA.clients.map(function(c){
    var inv=0,rec=0,n=0;
    DATA.projects.forEach(function(p){ if(p.client===c.name){n++;var s=C.byP[p.id];inv+=s.invoiced;rec+=s.received;} });
    return '<tr><td class="name">'+esc(c.name)+'<small>'+esc(c.notes)+'</small></td><td>'+esc(c.type||'-')+'</td><td class="r num">'+n+'</td><td class="r num">'+fmt(inv)+'</td><td class="r num">'+fmt(rec)+'</td><td class="r num">'+fmt(inv-rec)+'</td></tr>';
  }).join('');
  return '<div class="head"><div><span class="mono">'+DATA.clients.length+' clients</span><h1>Clients</h1></div></div><div class="tablewrap"><table><thead><tr><th>Client</th><th>Type</th><th class="r">Projects</th><th class="r">Invoiced</th><th class="r">Received</th><th class="r">Owed</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function vCrew(){
  var thr=num(DATA.settings.wht_threshold)||100000, alert=num(DATA.settings.wht_alert)||80000;
  var monthly={};
  DATA.entries.forEach(function(e){ if(e.kind==='cost' && (e.cost_type==='Crew / freelancer'||e.cost_type==='Staff & salaries')){
    var k=String(e.payee).toLowerCase().trim(); var m=String(e.date).slice(0,7);
    monthly[k]=monthly[k]||{}; monthly[k][m]=(monthly[k][m]||0)+num(e.amount); }});
  var rows=DATA.crew.map(function(c){
    var names=[c.name].concat(String(c.aliases||'').split(';')).map(function(x){return x.toLowerCase().trim();}).filter(Boolean);
    var months={};
    names.forEach(function(n){ var mm=monthly[n]||{}; Object.keys(mm).forEach(function(m){months[m]=(months[m]||0)+mm[m];}); });
    var total=0,peak=0,pm=''; Object.keys(months).forEach(function(m){total+=months[m]; if(months[m]>peak){peak=months[m];pm=m;}});
    var flag = peak>thr?'<span class="pill late">Over WHT limit '+esc(pm)+'</span>':(peak>=alert?'<span class="pill warn">Near limit '+esc(pm)+'</span>':'');
    return '<tr><td class="name">'+esc(c.name)+'<small>'+esc(c.aliases)+'</small></td><td>'+esc(c.role)+'</td><td class="r num">'+fmt(total)+'</td><td class="r num">'+fmt(peak)+'</td><td>'+flag+'</td></tr>';
  }).join('');
  return '<div class="head"><div><span class="mono">WHT alert at '+lkr(alert)+' a month</span><h1>Crew</h1></div></div><div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th class="r">Total fees</th><th class="r">Peak month</th><th>WHT</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* ---------- books ---------- */
function mirrorLine(){
  var mi=DATA.mirror;
  if(!(ROLE==='admin'||ROLE==='accountant')) return '';
  if(!mi) return ROLE==='admin'?'<p class="note" style="margin-top:12px">Accountant mirror sheet: not set up yet. Run <b>setupMirror</b> once in the script editor.</p>':'';
  return '<p class="note" style="margin-top:12px">Accountant mirror sheet: <a class="link" href="'+esc(mi.url)+'" target="_blank" rel="noopener">open in Google Sheets</a> · last synced '+esc(mi.last||'not yet')+' · <a class="link" id="syncbtn" tabindex="0">sync now</a></p>';
}
function vBooks(){
  var months=fyMonths(), names=['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
  var sums={};
  DATA.entries.forEach(function(e){ if(e.kind==='income'||e.kind==='cost'){ var k=e.account+'|'+String(e.date).slice(0,7); sums[k]=(sums[k]||0)+num(e.amount);} });
  function block(types,title){
    var accs=DATA.accounts.filter(function(a){return types.indexOf(a.type)>=0;}), tot=months.map(function(){return 0;}), h='<tr class="group"><td colspan="14">'+title+'</td></tr>';
    accs.forEach(function(a){
      var row=months.map(function(m,i){var v=sums[a.code+'|'+m]||0;tot[i]+=v;return v;}), t=row.reduce(function(x,y){return x+y;},0);
      if(!t) return;
      h+='<tr><td>'+esc(a.code)+' '+esc(a.name)+'</td>'+row.map(function(v){return '<td class="r num">'+(v?fmt(v):'')+'</td>';}).join('')+'<td class="r num"><b>'+fmt(t)+'</b></td></tr>';
    });
    h+='<tr class="total"><td>Total</td>'+tot.map(function(v){return '<td class="r num">'+fmt(v)+'</td>';}).join('')+'<td class="r num">'+fmt(tot.reduce(function(x,y){return x+y;},0))+'</td></tr>';
    return {html:h,tot:tot};
  }
  var inc=block(['Revenue'],'Income'), exp=block(['Expense'],'Expenses');
  var net='<tr class="total"><td>Net profit</td>'+inc.tot.map(function(v,i){var n=v-exp.tot[i];return '<td class="r num '+sgn(n)+'">'+fmt(n)+'</td>';}).join('')+'<td class="r num">'+fmt(inc.tot.reduce(function(x,y){return x+y;},0)-exp.tot.reduce(function(x,y){return x+y;},0))+'</td></tr>';
  return '<div class="head"><div><span class="mono">Accrual basis · by invoice / cost date</span><h1>Books</h1></div></div>'+
   '<div class="tablewrap"><table class="sticky1"><thead><tr><th>Account</th>'+names.map(function(n){return '<th class="r">'+n+'</th>';}).join('')+'<th class="r">Total</th></tr></thead><tbody>'+inc.html+exp.html+net+'</tbody></table></div>'+
   mirrorLine()+
   '<p class="note" style="margin-top:12px">Review and month lock are on the Accountant page. Assets and depreciation are coming next.</p>';
}

function vSettings(){
  var s=Object.keys(DATA.settings).map(function(k){return '<tr><td>'+esc(k)+'</td><td>'+esc(DATA.settings[k])+'</td></tr>';}).join('');
  var u=(DATA.users||[]).map(function(x){return '<tr><td>'+esc(x.email)+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.role)+'</td></tr>';}).join('');
  return '<div class="head"><div><span class="mono">Admin</span><h1>Settings</h1></div></div>'+
   '<div class="sec"><h3>Accountant mirror</h3>'+(mirrorLine()||'<p class="note">Not available.</p>')+'</div>'+
   '<div class="sec"><h3>Users</h3><div class="tablewrap"><table class="fit"><thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead><tbody>'+u+'</tbody></table></div></div>'+
   '<div class="sec"><h3>Settings</h3><div class="tablewrap"><table class="fit kv"><tbody>'+s+'</tbody></table></div></div>'+
   '<p class="note" style="margin-top:12px">Edit these in the Settings and Users tabs of the database sheet for now. In-app editing comes with later sessions.</p>';
}

/* ---------- quotes and invoices ---------- */
function jparse(s,d){try{var v=JSON.parse(s);return v==null?d:v;}catch(e){return d;}}
function fmt2(v){return num(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function r2(n){return Math.round(n*100)/100;}
function pnum(v){var n=parseFloat(String(v==null?'':v).replace(/,/g,''));return isFinite(n)?n:NaN;}
function addDays(s,n){var d=new Date((dayNum(s)+n)*86400000);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());}
function projName(id){var p=DATA.projects.filter(function(x){return x.id===id;})[0];return p?p.name:'';}
function invDue(i){return r2(num(i.total)-num(i.advance_applied));}
function invPaid(i){return i.status==='paid'?invDue(i):num(i.paid_amount);}
function invBal(i){return i.status==='draft'?invDue(i):Math.max(0,r2(invDue(i)-invPaid(i)));}
function invStatus(i){
  var s=i.status; if(s==='draft'||s==='paid') return s;
  var due=String(i.due||'').slice(0,10);
  if(due&&due<TODAY) return 'overdue';
  return s==='overdue'?'sent':s;
}
function qStatus(q){return (q.status==='sent'&&q.valid_until&&String(q.valid_until).slice(0,10)<TODAY)?'expired':q.status;}
var STATUS_KIND={draft:'mute',sent:'info','part paid':'warn',paid:'good',overdue:'late',approved:'good',declined:'late',invoiced:'info',expired:'warn'};
function dpill(s){return '<span class="pill '+(STATUS_KIND[s]||'mute')+'">'+esc(s)+'</span>';}
function findDoc(type,no){var a=(type==='quote'?DATA.quotes:DATA.invoices)||[];for(var i=0;i<a.length;i++) if(String(a[i].number)===String(no)) return a[i];return null;}
function upsertLocal(arr,row,key){for(var i=0;i<arr.length;i++) if(String(arr[i][key])===String(row[key])){arr[i]=row;return;}arr.push(row);}
function mergeRes(res){
  if(!res) return;
  if(res.invoice) upsertLocal(DATA.invoices,res.invoice,'number');
  if(res.quote) upsertLocal(DATA.quotes,res.quote,'number');
  (res.entries||[]).forEach(function(e){upsertLocal(DATA.entries,e,'id');});
  if(res.client) upsertLocal(DATA.clients,res.client,'name');
  if(res.entry) upsertLocal(DATA.entries,res.entry,'id');
  if(res.approval) upsertLocal(DATA.approvals,res.approval,'id');
  if(res.removedEntry){for(var i=DATA.entries.length-1;i>=0;i--) if(String(DATA.entries[i].id)===String(res.removedEntry)) DATA.entries.splice(i,1);}
  pvCache={};
  C=compute();
}
var busy=false;
function call(fn,args,ok,okMsg){
  if(busy) return;
  busy=true; toast('Working…',true,true);
  var r=google.script.run
    .withSuccessHandler(function(res){busy=false;mergeRes(res);if(ok) ok(res);toast(okMsg||'Done',true);})
    .withFailureHandler(function(err){busy=false;toast((err&&err.message)||String(err));});
  r[fn].apply(r,args);
}
function hasBank(){var S=DATA.settings;return !!(String(S.bank_account_number||'').trim()||String(S.bank_details||'').trim());}
function clientRow(name){return DATA.clients.filter(function(c){return c.name===name;})[0]||null;}
function setupWarnings(){
  if(ROLE!=='admin') return '';
  var w=whtBanner();
  if(DATA.settings.last_quote_number===undefined) w+='<div class="banner">One-time step needed: open the script editor, pick <b>setupSession3</b> in the function list and click Run. It adds the new columns and settings and asks permission for Drive and email.</div>';
  else if(!hasBank()) w+='<div class="banner">Bank details are not set. Invoices will not say how to pay. Add them in the <b>bank_account_name</b>, <b>bank_account_number</b>, <b>bank_name</b> and <b>bank_branch</b> rows of the Settings tab.</div>';
  return w;
}

/* ----- list ----- */
function vDocs(){
  var isQ=state.dtab==='quote', list=(isQ?DATA.quotes:DATA.invoices)||[], admin=ROLE==='admin';
  var filters=isQ?['All','Draft','Sent','Approved','Invoiced','Declined']:['All','Draft','Sent','Part paid','Overdue','Paid'];
  if(filters.indexOf(state.dfilter)<0) state.dfilter='All';
  var q=state.dsearch.toLowerCase(), cards='';
  if(isQ){
    var open=0,nOpen=0,appr=0,nAppr=0,dr=0,nDr=0;
    list.forEach(function(x){var s=qStatus(x),t=num(x.total);if(s==='sent'){open+=t;nOpen++;}else if(s==='approved'){appr+=t;nAppr++;}else if(s==='draft'){dr+=t;nDr++;}});
    cards='<div class="grid g3">'+card('Waiting for an answer',lkr(open),'',nOpen+(nOpen===1?' quote':' quotes'))+card('Approved, not invoiced',lkr(appr),'',nAppr+(nAppr===1?' quote':' quotes'))+card('Drafts',lkr(dr),'',nDr+(nDr===1?' draft':' drafts'))+'</div>';
  } else {
    var out=0,over=0,nOver=0,dr2=0,nDr2=0;
    list.forEach(function(i){var s=invStatus(i);if(s==='draft'){dr2+=invDue(i);nDr2++;}else if(s!=='paid'){var b=invBal(i);out+=b;if(s==='overdue'){over+=b;nOver++;}}});
    cards='<div class="grid g3">'+card('Outstanding',lkr(out),'','Sent and not fully paid')+card('Overdue',lkr(over),over>0?'neg':'',nOver+(nOver===1?' invoice':' invoices'))+card('Drafts',lkr(dr2),'',nDr2+(nDr2===1?' draft':' drafts'))+'</div>';
  }
  var rows=list.slice().sort(function(a,b){return String(b.date).localeCompare(String(a.date))||String(b.number).localeCompare(String(a.number));}).filter(function(d){
    var s=isQ?qStatus(d):invStatus(d);
    if(state.dfilter!=='All'&&s!==state.dfilter.toLowerCase()) return false;
    return !q||(d.number+' '+d.client+' '+projName(d.project)).toLowerCase().indexOf(q)>=0;
  }).map(function(d){
    var s=isQ?qStatus(d):invStatus(d), t=(isQ?'quote':'invoice');
    return '<tr class="click" data-doc="'+t+'|'+esc(d.number)+'" tabindex="0"><td><b>'+esc(d.number)+'</b></td><td class="name">'+esc(shortClient(d.client))+'<small>'+esc(projName(d.project)||'No project')+'</small></td>'+
      '<td>'+dshort(d.date)+'</td><td>'+(isQ?(d.valid_until?dshort(d.valid_until):'-'):(d.due?dshort(d.due):'-'))+'</td>'+
      '<td class="r num">'+fmt(isQ?d.total:invDue(d))+'</td>'+(isQ?'':'<td class="r num">'+(s==='paid'||s==='draft'?'-':fmt(invBal(d)))+'</td>')+'<td>'+dpill(s)+'</td></tr>';
  }).join('');
  var head=isQ?'<th>Number</th><th>Client</th><th>Date</th><th>Valid until</th><th class="r">Total</th><th>Status</th>':'<th>Number</th><th>Client</th><th>Date</th><th>Due</th><th class="r">Amount</th><th class="r">Balance</th><th>Status</th>';
  return '<div class="head"><div><span class="mono">Quotes and invoices · LKR</span><h1>'+(isQ?'Quotes':'Invoices')+'</h1></div>'+
    (admin?'<div class="btnrow"><button class="btn'+(isQ?'':' primary')+'" data-act="new-inv">New invoice</button><button class="btn'+(isQ?' primary':'')+'" data-act="new-qt">New quote</button></div>':'')+'</div>'+
    setupWarnings()+cards+
    '<div class="filters"><button class="chip '+(isQ?'':'on')+'" data-dtab="invoice">Invoices</button><button class="chip '+(isQ?'on':'')+'" data-dtab="quote">Quotes</button><span style="width:10px"></span>'+
    filters.map(function(f){return '<button class="chip '+(state.dfilter===f?'on':'')+'" data-df="'+esc(f)+'">'+esc(f)+'</button>';}).join('')+
    '<input class="search" id="dsearch" placeholder="Search number, client or project" value="'+esc(state.dsearch)+'"></div>'+
    '<div class="tablewrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+(rows||'<tr><td colspan="7" class="empty">Nothing here yet.</td></tr>')+'</tbody></table></div>';
}

/* ----- one document ----- */
function openDoc(type,no){state.dtype=type;state.dno=no;go('doc');}
function totalsBlock(type,d){
  var isInv=type==='invoice', lr=function(l,v,cls){return '<div class="lrow'+(cls?' '+cls:'')+'"><span>'+l+'</span><span class="num">'+v+'</span></div>';};
  var h=lr('Sub total','LKR '+fmt2(d.total));
  if(isInv){
    if(num(d.advance_applied)>0) h+=lr('Less: advance already invoiced','- LKR '+fmt2(d.advance_applied));
    h+=lr('Amount due','LKR '+fmt2(invDue(d)),'strong');
    if(d.status!=='draft'&&invPaid(d)>0) h+=lr('Paid','LKR '+fmt2(invPaid(d)))+lr('Balance','LKR '+fmt2(invBal(d)),'strong');
  } else h+=lr('Total','LKR '+fmt2(d.total),'strong');
  return '<div class="totbox">'+h+'</div>';
}
function vDoc(){
  var type=state.dtype, d=findDoc(type,state.dno);
  if(!d) return '<div class="empty">Not found. <a class="link" data-view="docs" tabindex="0">Back to the list</a></div>';
  var isInv=type==='invoice', s=isInv?invStatus(d):qStatus(d), lines=jparse(d.lines,[]), admin=ROLE==='admin', sd=jparse(d.status_dates,{});
  var acts='';
  function b(label,act,primary){return '<button class="btn'+(primary?' primary':'')+'" data-act="'+act+'">'+label+'</button>';}
  if(admin){
    if(isInv){
      if(d.status==='draft') acts=b('Send…','send',true)+b('Mark as sent','marksent')+b('Edit','edit')+b('Make PDF','pdf')+b('Delete','delete');
      else if(d.status!=='paid') acts=b('Record payment','pay',true)+b('Send again…','send')+b('Edit due date or notes','edit')+b('Refresh PDF','pdf');
      else acts=b('Refresh PDF','pdf');
    } else {
      if(d.status==='draft') acts=b('Send…','send',true)+b('Mark as sent','marksent')+b('Edit','edit')+b('Make PDF','pdf')+b('Delete','delete');
      else if(d.status==='sent') acts=b('Approved','approve',true)+b('Declined','decline')+b('Send again…','send')+b('Refresh PDF','pdf');
      else if(d.status==='approved') acts=b('Create invoice','convert',true)+b('Declined','decline')+b('Send again…','send');
      else if(d.status==='declined') acts=b('Reopen as draft','reopen');
    }
  }
  if(d.pdf_url) acts+='<a class="btn" href="'+esc(d.pdf_url)+'" target="_blank" rel="noopener">Open PDF</a>';
  var lrows=lines.map(function(l){
    var hasQR=l.qty!=null&&l.qty!==''&&l.rate!=null&&l.rate!=='';
    return '<tr><td class="wrap">'+esc(l.desc)+'</td><td class="r num">'+(hasQR?esc(l.qty):'')+'</td><td class="r num">'+(hasQR?fmt2(l.rate):'')+'</td><td class="r num"><b>'+fmt2(l.amount)+'</b></td></tr>';
  }).join('');
  var tl='';
  function t(k,v){if(v) tl+='<div class="tl"><span>'+k+'</span><span>'+esc(v)+'</span></div>';}
  t('Date',dfull(d.date)); if(isInv) t('Due',d.due?dfull(d.due):''); else t('Valid until',d.valid_until?dfull(d.valid_until):'');
  t('Sent',sd.sent?dfull(sd.sent):''); t('Last emailed',sd.emailed?dfull(sd.emailed):''); t('Approved',sd.approved?dfull(sd.approved):''); t('Declined',sd.declined?dfull(sd.declined):''); t('Invoiced',sd.invoiced?dfull(sd.invoiced):''); t('Paid',sd.paid?dfull(sd.paid):'');
  t('Sent to',d.to_email||'');
  var links='';
  if(isInv&&d.quote_no) links+='<div class="tl"><span>From quote</span><a class="link" data-doc="quote|'+esc(d.quote_no)+'" tabindex="0">'+esc(d.quote_no)+'</a></div>';
  if(!isInv&&d.invoice_no) links+='<div class="tl"><span>Invoice</span><a class="link" data-doc="invoice|'+esc(d.invoice_no)+'" tabindex="0">'+esc(d.invoice_no)+'</a></div>';
  var pays='';
  if(isInv){
    var pl=jparse(d.payments,[]);
    if(pl.length) pays='<div class="panel"><span class="h2big">Payments</span>'+pl.map(function(p){return '<div class="lrow"><span class="l"><span class="d">'+dshort(p.date)+'</span><span>'+esc(p.method||'Payment')+'</span></span><strong class="num">'+fmt2(p.amount)+'</strong></div>';}).join('')+(admin&&d.status!=='draft'?'<div><a class="link" data-act="undopay" tabindex="0">Undo the last payment</a></div>':'')+'</div>';
    else if(d.status==='paid') pays='<div class="panel"><span class="h2big">Payments</span><div class="note">Marked paid'+(sd.paid?' on '+dfull(sd.paid):'')+' before payments were tracked here.</div></div>';
  }
  var cl=clientRow(d.client);
  return '<a class="back" data-view="docs" tabindex="0">&lsaquo; '+(isInv?'Invoices':'Quotes')+'</a>'+
    '<div class="head"><div><span class="mono">'+esc(shortClient(d.client))+(d.project?' · '+esc(projName(d.project)):'')+'</span><h1 style="font-size:54px;font-weight:900;line-height:.95">'+esc(d.number)+'</h1></div><div>'+dpill(s)+'</div></div>'+
    '<div class="btnrow" style="margin-bottom:18px">'+acts+'</div>'+
    '<div class="grid g21"><div>'+paperBox()+'</div>'+
    '<div style="display:flex;flex-direction:column;gap:14px"><div class="panel"><span class="h2big">Amount</span>'+(d.subject?'<div class="note">'+esc(d.subject)+'</div>':'')+totalsBlock(type,d)+'</div><div class="panel"><span class="h2big">Dates</span>'+tl+links+'</div>'+pays+'</div></div>';
}
function paperBox(){return '<div class="paperwrap" id="pw"><iframe class="paper" id="pf" sandbox="allow-same-origin" title="Document preview"></iframe></div>';}
var pvCache={}, pvTimer=null, pvSeq=0;
function paperHtml(h){return String(h).replace('<body style="margin:0;padding:0;','<body style="margin:0;padding:36px 40px;box-sizing:border-box;background:#fff;');}
function fitPaper(){
  var f=document.getElementById('pf'), w=document.getElementById('pw'); if(!f||!w) return;
  var sc=Math.min(1,w.clientWidth/760), h=0;
  try{h=f.contentDocument.documentElement.scrollHeight;}catch(e){h=1080;}
  h=Math.max(h,1000);
  f.style.height=h+'px'; f.style.transform='scale('+sc+')'; w.style.height=Math.round(h*sc)+'px';
}
function showPaper(h){var f=document.getElementById('pf'); if(!f) return; f.onload=fitPaper; f.srcdoc=paperHtml(h);}
window.addEventListener('resize',function(){fitPaper();});
function loadDocPreview(){
  var key=state.dtype+'|'+state.dno;
  if(pvCache[key]){showPaper(pvCache[key]);return;}
  var seq=++pvSeq;
  google.script.run.withSuccessHandler(function(r){ if(seq!==pvSeq||state.view!=='doc') return; if(!r) return; pvCache[key]=r.html; showPaper(r.html); })
    .withFailureHandler(function(err){ var w=document.getElementById('pw'); if(w) w.innerHTML='<div class="note" style="padding:16px;color:#333">Preview not available: '+esc((err&&err.message)||err)+'</div>'; })
    .renderDoc(state.dtype,state.dno);
}
function edPayload(){
  var ed=state.ed, client=ed.client==='__new'?String(ed.newClient||'').trim():ed.client, t=edTotals();
  var p={number:ed.number,client:client,project:ed.project,date:ed.date,notes:ed.notes,subject:ed.subject,lines:ed.lines.map(function(l){return {desc:l.desc,detail:l.detail,qty:l.qty,rate:l.rate,amount:lineAmt(l)};}).filter(function(l){return String(l.desc).trim()||l.amount;})};
  if(ed.type==='invoice'){p.due=ed.due;p.advance_applied=t.adv;p.quote_no=ed.quote_no;} else p.valid_until=ed.valid_until;
  return p;
}
function edPreview(delay){
  clearTimeout(pvTimer);
  pvTimer=setTimeout(function(){
    var ed=state.ed; if(state.view!=='edit'||!ed) return;
    var seq=++pvSeq;
    google.script.run.withSuccessHandler(function(r){ if(!r||seq!==pvSeq||state.view!=='edit') return; showPaper(r.html); })
      .withFailureHandler(function(){})
      .renderDoc(ed.type,ed.locked?ed.number:edPayload());
  },delay==null?700:delay);
}
function catalogue(){
  var m={}, order=[];
  (DATA.invoices||[]).concat(DATA.quotes||[]).sort(function(a,b){return String(b.date).localeCompare(String(a.date));}).forEach(function(d){
    jparse(d.lines,[]).forEach(function(l){ var k=String(l.desc||'').trim(); if(!k||m[k]) return; m[k]={rate:l.rate,qty:l.qty,detail:l.detail||'',amount:l.amount}; order.push(k); });
  });
  return {map:m,list:order.slice(0,80)};
}

/* ----- editor ----- */
function newLine(){return {desc:'',detail:'',qty:'',rate:'',amount:''};}
function startNew(type,opts){
  opts=opts||{};
  var terms=num(DATA.settings.payment_terms_days)||14, vd=num(DATA.settings.quote_valid_days)||14;
  var proj=opts.project?DATA.projects.filter(function(p){return p.id===opts.project;})[0]:null;
  state.ed={type:type,number:'',client:proj?proj.client:'',newClient:'',project:proj?proj.id:'',date:TODAY,due:addDays(TODAY,terms),valid_until:addDays(TODAY,vd),dueTouched:false,
    label:'Full payment',subject:'',lines:[newLine()],advance:'',notes:'',to_email:proj&&clientRow(proj.client)?(clientRow(proj.client).email||''):'',quote_no:'',locked:false};
  go('edit');
}
function startEdit(type,no){
  var d=findDoc(type,no); if(!d) return;
  var lines=jparse(d.lines,[]).map(function(l){return {desc:l.desc||'',detail:l.detail||'',qty:l.qty==null?'':String(l.qty),rate:l.rate==null?'':String(l.rate),amount:String(l.amount==null?'':l.amount)};});
  state.ed={type:type,number:d.number,client:d.client,newClient:'',project:d.project||'',date:String(d.date).slice(0,10),due:String(d.due||'').slice(0,10),valid_until:String(d.valid_until||'').slice(0,10),dueTouched:true,
    label:d.label||'Full payment',subject:d.subject||'',lines:lines.length?lines:[newLine()],advance:num(d.advance_applied)?String(d.advance_applied):'',notes:d.notes||'',to_email:d.to_email||'',quote_no:d.quote_no||'',
    locked:type==='invoice'&&d.status!=='draft'};
  go('edit');
}
function lineAmt(l){var q=pnum(l.qty),r=pnum(l.rate);if(isFinite(q)&&isFinite(r)) return r2(q*r);var a=pnum(l.amount);return isFinite(a)?a:0;}
function edTotals(){
  var ed=state.ed, total=0; ed.lines.forEach(function(l){total+=lineAmt(l);}); total=r2(total);
  var adv=ed.type==='invoice'?(isFinite(pnum(ed.advance))?pnum(ed.advance):0):0;
  return {total:total,adv:adv,due:r2(total-adv)};
}
function edTotalsHtml(){
  var t=edTotals(), ed=state.ed, h='<div class="lrow"><span>Sub total</span><span class="num">LKR '+fmt2(t.total)+'</span></div>';
  if(ed.type==='invoice'){ if(t.adv>0) h+='<div class="lrow"><span>Less: advance already invoiced</span><span class="num">- LKR '+fmt2(t.adv)+'</span></div>'; h+='<div class="lrow strong"><span>Amount due</span><span class="num '+(t.due<0?'neg':'')+'">LKR '+fmt2(t.due)+'</span></div>'; }
  else h+='<div class="lrow strong"><span>Total</span><span class="num">LKR '+fmt2(t.total)+'</span></div>';
  return h;
}
function advanceHint(pid,exceptNo){
  if(!pid) return null;
  var adv=0,ded=0,hasBal=false;
  DATA.entries.forEach(function(e){ if(e.kind==='income'&&e.project===pid){ if(e.cost_type==='Advance') adv+=num(e.amount); if(e.cost_type==='Balance') hasBal=true; } });
  DATA.invoices.forEach(function(i){ if(i.project===pid&&i.number!==exceptNo) ded+=num(i.advance_applied); });
  return {adv:adv,ded:ded,hasBal:hasBal,left:hasBal?0:Math.max(0,r2(adv-ded))};
}
function vEdit(){
  var ed=state.ed; if(!ed) return vDocs();
  var isInv=ed.type==='invoice', lock=ed.locked, dis=lock?' disabled':'';
  var cnames=DATA.clients.map(function(c){return c.name;});
  if(ed.client&&ed.client!=='__new'&&cnames.indexOf(ed.client)<0) cnames.push(ed.client);
  var copts='<option value="">Choose a client</option>'+cnames.map(function(n){return '<option value="'+esc(n)+'"'+(n===ed.client?' selected':'')+'>'+esc(n)+'</option>';}).join('')+'<option value="__new"'+(ed.client==='__new'?' selected':'')+'>+ New client…</option>';
  var plist=DATA.projects.filter(function(p){return ed.client&&ed.client!=='__new'&&(p.client===ed.client||p.id===ed.project);});
  var popts='<option value="">No project (one-off)</option>'+plist.map(function(p){return '<option value="'+esc(p.id)+'"'+(p.id===ed.project?' selected':'')+'>'+esc(p.name)+'</option>';}).join('');
  var lrows=ed.lines.map(function(l,i){
    return '<div class="lline"><input class="f ld" list="catl" data-li="'+i+'" data-lf="desc" id="ld'+i+'" placeholder="Item (pick a past one or type)" aria-label="Item" value="'+esc(l.desc)+'"'+dis+'>'+
      '<input class="f" inputmode="decimal" data-li="'+i+'" data-lf="qty" id="lq'+i+'" placeholder="Qty" aria-label="Quantity" value="'+esc(l.qty)+'"'+dis+'>'+
      '<input class="f" inputmode="decimal" data-li="'+i+'" data-lf="rate" id="lr'+i+'" placeholder="Rate" aria-label="Rate" value="'+esc(l.rate)+'"'+dis+'>'+
      '<input class="f" inputmode="decimal" data-li="'+i+'" data-lf="amount" id="la'+i+'" placeholder="Amount" aria-label="Amount" value="'+esc(l.amount)+'"'+dis+'>'+
      (lock||ed.lines.length<2?'<span></span>':'<button class="xbtn" data-act="ed-rm" data-i="'+i+'" aria-label="Remove line">&times;</button>')+
      '<input class="f lx" data-li="'+i+'" data-lf="detail" id="lt'+i+'" placeholder="Details under the item (optional)" aria-label="Details" value="'+esc(l.detail)+'"'+dis+'></div>';
  }).join('');
  var hint='';
  if(isInv&&!lock&&ed.project){
    var h=advanceHint(ed.project,ed.number);
    if(h&&h.adv>0) hint='<div class="note">Advance invoiced on this project: <b class="num">'+fmt(h.adv)+'</b>, already deducted on other invoices: <b class="num">'+fmt(h.ded)+'</b>.'+(h.hasBal?' A balance invoice already exists, so nothing is suggested.':'')+(h.left>0?' <a class="link" data-act="ed-adv" data-v="'+h.left+'" tabindex="0">Deduct '+fmt(h.left)+'</a>':'')+'</div>';
  }
  var cat=catalogue(), dl='<datalist id="catl">'+cat.list.map(function(k){return '<option value="'+esc(k)+'">';}).join('')+'</datalist>';
  return '<a class="back" data-act="ed-cancel" tabindex="0">&lsaquo; Cancel</a>'+
    '<div class="head"><div><span class="mono">'+(ed.number?'Editing':'New')+' '+(isInv?'invoice':'quote')+'</span><h1>'+esc(ed.number||(isInv?'New invoice':'New quote'))+'</h1></div></div>'+
    (lock?'<div class="banner">This invoice has been sent. Only the due date, notes and email address can change.</div>':'')+
    dl+'<div class="split"><div class="panel form">'+
      '<div class="frow"><div class="fld"><label for="f-client">Client</label><select class="f" id="f-client" data-f="client"'+dis+'>'+copts+'</select>'+(ed.client==='__new'?'<input class="f" id="f-newClient" data-f="newClient" placeholder="Client name" value="'+esc(ed.newClient)+'">':'')+'</div>'+
        '<div class="fld"><label for="f-project">Project</label><select class="f" id="f-project" data-f="project"'+dis+'>'+popts+'</select></div></div>'+
      '<div class="frow"><div class="fld"><label for="f-date">Date</label><input class="f" type="date" id="f-date" data-f="date" value="'+esc(ed.date)+'"'+dis+'></div>'+
        (isInv?'<div class="fld"><label for="f-due">Due date</label><input class="f" type="date" id="f-due" data-f="due" value="'+esc(ed.due)+'"></div>':'<div class="fld"><label for="f-valid_until">Valid until</label><input class="f" type="date" id="f-valid_until" data-f="valid_until" value="'+esc(ed.valid_until)+'"></div>')+'</div>'+
      (isInv?'<div class="frow"><div class="fld"><label for="f-label">This invoice is</label><select class="f" id="f-label" data-f="label"'+dis+'>'+['Full payment','Advance','Balance'].map(function(x){return '<option'+(x===ed.label?' selected':'')+'>'+x+'</option>';}).join('')+'</select></div></div>':'')+
      '<div class="fld"><label for="f-subject">Subject</label><input class="f" id="f-subject" data-f="subject" placeholder="e.g. Brand film for Night Shift" value="'+esc(ed.subject)+'"></div>'+
      '<div class="fld"><label>Lines</label><div>'+lrows+'</div>'+(lock?'':'<div><button class="chip" data-act="ed-add">+ Add a line</button></div>')+'<div class="note">Type a quantity and a rate and the amount fills in, or just type the amount.</div></div>'+
      (isInv?'<div class="fld"><label for="f-advance">Advance to deduct (LKR)</label><input class="f" inputmode="decimal" id="f-advance" data-f="advance" placeholder="0" value="'+esc(ed.advance)+'"'+dis+'>'+hint+'</div>':'')+
      '<div id="edtotals" class="totbox">'+edTotalsHtml()+'</div>'+
      '<div class="frow"><div class="fld"><label for="f-notes">Note on the '+(isInv?'invoice':'quote')+' (optional)</label><textarea class="f" id="f-notes" data-f="notes" rows="3">'+esc(ed.notes)+'</textarea></div>'+
        '<div class="fld"><label for="f-to_email">Client email</label><input class="f" type="email" id="f-to_email" data-f="to_email" placeholder="name@company.com" value="'+esc(ed.to_email)+'"></div></div>'+
      '<div class="btnrow"><button class="btn primary" data-act="ed-save">'+(lock?'Save changes':'Save draft')+'</button><button class="btn" data-act="ed-cancel">Cancel</button></div>'+
    '</div><div class="prevcol"><span class="mono" style="display:block;margin-bottom:8px">Live preview</span>'+paperBox()+'</div></div>';
}
function edSave(){
  var ed=state.ed, client=ed.client==='__new'?String(ed.newClient||'').trim():ed.client;
  if(!client){toast('Choose a client first.');return;}
  var lines=ed.lines.map(function(l){return {desc:l.desc,detail:l.detail,qty:l.qty,rate:l.rate,amount:lineAmt(l)};}).filter(function(l){return String(l.desc).trim()||l.amount;});
  if(!ed.locked){
    if(!lines.length){toast('Add at least one line.');return;}
    if(lines.some(function(l){return !String(l.desc).trim();})){toast('Every line needs a description.');return;}
  }
  var t=edTotals();
  if(!ed.locked&&t.total<=0){toast('The total must be more than zero.');return;}
  if(ed.type==='invoice'&&(t.adv<0||t.adv>t.total)){toast('The advance cannot be more than the total.');return;}
  var isInv=ed.type==='invoice', payload={number:ed.number,client:client,project:ed.project,date:ed.date,notes:ed.notes,subject:ed.subject,to_email:ed.to_email,lines:lines};
  if(isInv){payload.due=ed.due;payload.label=ed.label;payload.advance_applied=t.adv;payload.quote_no=ed.quote_no;} else payload.valid_until=ed.valid_until;
  call(isInv?'saveInvoice':'saveQuote',[payload],function(res){
    var d=isInv?res.invoice:res.quote;
    if(ed.client==='__new'&&!clientRow(client)) DATA.clients.push({name:client,type:'One-off'});
    state.dtype=ed.type;state.dno=d.number;state.ed=null;go('doc');
  },'Saved');
}
function edInput(t){
  var ed=state.ed; if(!ed) return; var f=t.getAttribute('data-f'); ed[f]=t.value;
  if(f==='due') ed.dueTouched=true;
  if(f==='date'&&ed.type==='invoice'&&!ed.dueTouched){ed.due=addDays(ed.date,num(DATA.settings.payment_terms_days)||14);var d=document.getElementById('f-due');if(d) d.value=ed.due;}
  if(f==='date'&&ed.type==='quote'){ed.valid_until=addDays(ed.date,num(DATA.settings.quote_valid_days)||14);var v=document.getElementById('f-valid_until');if(v) v.value=ed.valid_until;}
  if(f==='advance'){var el=document.getElementById('edtotals');if(el) el.innerHTML=edTotalsHtml();}
  edPreview();
}
function lineInput(t){
  var ed=state.ed; if(!ed) return; var i=+t.getAttribute('data-li'), f=t.getAttribute('data-lf'), l=ed.lines[i]; if(!l) return;
  l[f]=t.value;
  if(f==='qty'||f==='rate'){ var q=pnum(l.qty),r=pnum(l.rate); if(isFinite(q)&&isFinite(r)){ l.amount=String(r2(q*r)); var a=document.getElementById('la'+i); if(a) a.value=l.amount; } }
  if(f==='amount'){ l.qty='';l.rate=''; var q2=document.getElementById('lq'+i),r3=document.getElementById('lr'+i); if(q2) q2.value=''; if(r3) r3.value=''; }
  var el=document.getElementById('edtotals'); if(el) el.innerHTML=edTotalsHtml();
  edPreview();
}
function edSelect(t){
  var ed=state.ed; if(!ed) return; var f=t.getAttribute('data-f'); ed[f]=t.value;
  if(f==='client'){ ed.project=''; if(t.value&&t.value!=='__new'){var c=clientRow(t.value); ed.to_email=c&&c.email?c.email:'';} go('edit'); }
  else if(f==='project'){ if(ed.project){var p=DATA.projects.filter(function(x){return x.id===ed.project;})[0]; if(p&&!ed.client) ed.client=p.client;} go('edit'); }
}

/* ----- pop-ups ----- */
function renderModal(){
  var el=document.getElementById('modal'), m=state.modal;
  if(!m){el.innerHTML='';el.style.display='none';return;}
  var old=el.querySelector('.mbox'), top=old?old.scrollTop:0;
  el.style.display='flex';
  el.innerHTML='<div class="mback" data-act="m-close"></div><div class="mbox'+(m.kind==='entry'?' wide':'')+'" role="dialog" aria-modal="true">'+modalBody(m)+'</div>';
  var nb=el.querySelector('.mbox'); if(nb&&top) nb.scrollTop=top;
}
function openModal(m){state.modal=m;renderModal();}
function closeModal(){state.modal=null;renderModal();}
function defaultMail(type,d){
  var cl=clientRow(d.client)||{}, isInv=type==='invoice', first=cl.contact?String(cl.contact).split(' ')[0]:'', proj=projName(d.project);
  var sig='Thank you,\nOffset Media\n'+(DATA.settings.company_phone||'')+'\n'+(DATA.settings.company_website||'');
  var body=isInv
    ?'Hello'+(first?' '+first:'')+',\n\nPlease find attached invoice '+d.number+(proj?' for '+proj:'')+'. The amount due is LKR '+fmt2(invDue(d)-(d.status==='draft'?0:invPaid(d)))+', payable by '+dfull(d.due)+'.\n\nIf you have any questions, just reply to this email.\n\n'+sig
    :'Hello'+(first?' '+first:'')+',\n\nPlease find attached quote '+d.number+(proj?' for '+proj:'')+', total LKR '+fmt2(d.total)+(d.valid_until?', valid until '+dfull(d.valid_until):'')+'.\n\nLet us know if you would like to go ahead, or if you want anything changed.\n\n'+sig;
  return {subject:(isInv?'Invoice ':'Quote ')+d.number+' from '+(DATA.settings.company_name||'Offset Media'),body:body};
}
function modalBody(m){
  var x='';
  if(m.kind==='send'){
    var d=findDoc(m.type,m.no), isInv=m.type==='invoice';
    x='<h2>Send '+(isInv?'invoice':'quote')+' '+esc(m.no)+'</h2>'+
      '<div class="note">The PDF is attached and a copy is filed in Drive. It is sent from '+esc(DATA.user.email)+'.</div>'+
      (isInv&&!hasBank()?'<div class="banner" style="margin:0">Bank details are not set in Settings, so the PDF will not say how to pay.</div>':'')+
      '<div class="fld"><label for="m-to">To</label><input class="f" type="email" id="m-to" data-m="to" value="'+esc(m.to)+'" placeholder="name@company.com"></div>'+
      '<div class="fld"><label for="m-cc">Cc (optional)</label><input class="f" type="email" id="m-cc" data-m="cc" value="'+esc(m.cc)+'"></div>'+
      '<div class="fld"><label for="m-subject">Subject</label><input class="f" id="m-subject" data-m="subject" value="'+esc(m.subject)+'"></div>'+
      '<div class="fld"><label for="m-body">Message</label><textarea class="f" id="m-body" data-m="body" rows="8">'+esc(m.body)+'</textarea></div>'+
      '<label class="chk"><input type="checkbox" data-m="save"'+(m.save?' checked':'')+'> Remember this address for '+esc(shortClient(d?d.client:''))+'</label>'+
      '<div class="btnrow"><button class="btn primary" data-act="m-send">Send email</button>'+(d&&d.status==='draft'?'<button class="btn" data-act="m-marksent">Mark as sent only</button>':'')+'<button class="btn" data-act="m-close">Cancel</button></div>';
  } else if(m.kind==='pay'){
    var methods=String(DATA.settings.payment_methods||'Bank transfer|Cash').split('|').filter(function(z){return z&&z!=='Not paid yet'&&z!=='Debit card';});
    x='<h2>Record payment · '+esc(m.no)+'</h2>'+
      '<div class="note">Balance on this invoice: <b class="num">LKR '+fmt2(m.balance)+'</b></div>'+
      '<div class="frow"><div class="fld"><label for="m-date">Date received</label><input class="f" type="date" id="m-date" data-m="date" value="'+esc(m.date)+'"></div>'+
      '<div class="fld"><label for="m-amount">Amount (LKR)</label><input class="f" inputmode="decimal" id="m-amount" data-m="amount" value="'+esc(m.amount)+'"></div></div>'+
      '<div class="fld"><label for="m-method">How it was paid</label><select class="f" id="m-method" data-m="method">'+methods.map(function(z){return '<option'+(z===m.method?' selected':'')+'>'+esc(z)+'</option>';}).join('')+'</select></div>'+
      '<div class="note">Paying less than the balance marks the invoice as part paid.</div>'+
      '<div class="btnrow"><button class="btn primary" data-act="m-pay">Record payment</button><button class="btn" data-act="m-close">Cancel</button></div>';
  } else if(m.kind==='entry'){
    x=entryBody(m);
  } else if(m.kind==='acct'){ x=acctBody(m);
  } else if(m.kind==='adj'){ x=adjBody(m);
  } else if(m.kind==='rec'){ x=recBody(m);
  } else if(m.kind==='proj'){ x=projBody(m);
  } else if(m.kind==='reject'){
    x='<h2>Reject this item?</h2><div class="note">The person who submitted it sees your reason. Nothing is posted to the books.</div>'+
      '<div class="fld"><label for="m-reason">Reason (optional)</label><textarea class="f" id="m-reason" data-m="reason" rows="3">'+esc(m.reason)+'</textarea></div>'+
      '<div class="btnrow"><button class="btn primary" data-act="m-q-reject">Reject</button><button class="btn" data-act="m-close">Cancel</button></div>';
  } else {
    x='<h2>'+esc(m.title)+'</h2><div class="note" style="font-size:14px">'+esc(m.text)+'</div><div class="btnrow"><button class="btn primary" data-act="'+esc(m.okAct)+'">'+esc(m.ok)+'</button><button class="btn" data-act="m-close">Cancel</button></div>';
  }
  return x;
}
function modalInput(t){var m=state.modal; if(!m) return; var f=t.getAttribute('data-m'); m[f]=(t.type==='checkbox')?!!t.checked:t.value;}

/* ----- actions ----- */
function curDoc(){return findDoc(state.dtype,state.dno);}
function doAct(act,el){
  var attr=function(k){return el&&el.getAttribute?el.getAttribute(k):null;};
  var type=state.dtype, no=state.dno, d=curDoc();
  switch(act){
    case 'new-inv': startNew('invoice',{project:attr('data-project')||''}); break;
    case 'new-qt': startNew('quote',{project:attr('data-project')||''}); break;
    case 'edit': startEdit(type,no); break;
    case 'ed-cancel': var e0=state.ed; state.ed=null; if(e0&&e0.number){state.dtype=e0.type;state.dno=e0.number;go('doc');} else go('docs'); break;
    case 'ed-add': state.ed.lines.push(newLine()); go('edit'); break;
    case 'ed-rm': state.ed.lines.splice(+attr('data-i'),1); go('edit'); break;
    case 'ed-adv': state.ed.advance=String(attr('data-v')); if(state.ed.label==='Full payment') state.ed.label='Balance'; go('edit'); break;
    case 'ed-save': edSave(); break;
    case 'pdf': call('previewPdf',[type,no],function(){go('doc');},'PDF filed in Drive. Use Open PDF.'); break;
    case 'send':
      if(!d) return;
      var cl=clientRow(d.client)||{}, dm=defaultMail(type,d), to=d.to_email||cl.email||'';
      openModal({kind:'send',type:type,no:no,to:to,cc:'',subject:dm.subject,body:dm.body,save:!cl.email||cl.email!==to}); break;
    case 'marksent':
      if(!d) return;
      openModal({kind:'confirm',title:'Mark '+no+' as sent?',text:type==='invoice'?'Use this when you sent it another way, for example WhatsApp. The invoice counts as income on '+dfull(d.date)+' and the PDF is filed in Drive. Nothing is emailed.':'Use this when you sent it another way. Nothing is emailed; the PDF is filed in Drive.',ok:'Mark as sent',okAct:'m-marksent'}); break;
    case 'm-marksent': call('sendDoc',[state.modal.type||type,state.modal.no||no,{email:false}],function(){closeModal();go('doc');},'Marked as sent'); break;
    case 'm-send':
      var m=state.modal;
      if(!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(String(m.to||'').trim())){toast('Enter a valid email address.');return;}
      call('sendDoc',[m.type,m.no,{email:true,to:String(m.to).trim(),cc:m.cc,subject:m.subject,body:m.body,saveEmail:!!m.save}],function(){closeModal();go('doc');},'Sent to '+String(m.to).trim()); break;
    case 'pay':
      if(!d) return;
      openModal({kind:'pay',no:no,balance:invBal(d),date:TODAY,amount:String(invBal(d)),method:'Bank transfer'}); break;
    case 'm-pay':
      var p=state.modal, amt=pnum(p.amount);
      if(!(amt>0)){toast('Enter the amount received.');return;}
      if(amt>p.balance+0.005){toast('That is more than the balance of '+fmt2(p.balance)+'.');return;}
      if(!p.date){toast('Choose the date received.');return;}
      call('recordPayment',[p.no,{date:p.date,amount:amt,method:p.method}],function(){closeModal();go('doc');},'Payment recorded'); break;
    case 'undopay': openModal({kind:'confirm',title:'Undo the last payment?',text:'The last recorded payment on '+no+' is removed and the invoice goes back to '+(jparse(d.payments,[]).length>1?'part paid':'sent')+'.',ok:'Undo payment',okAct:'m-undopay'}); break;
    case 'm-undopay': call('undoLastPayment',[no],function(){closeModal();go('doc');},'Payment removed'); break;
    case 'delete': openModal({kind:'confirm',title:'Delete draft '+no+'?',text:'This removes the draft. The number is not reused.',ok:'Delete draft',okAct:'m-delete'}); break;
    case 'm-delete':
      call('deleteDoc',[type,no],function(res){
        var arr=type==='quote'?DATA.quotes:DATA.invoices; for(var i=arr.length-1;i>=0;i--) if(String(arr[i].number)===String(no)) arr.splice(i,1);
        closeModal(); state.dtab=type; go('docs');
      },'Deleted'); break;
    case 'approve': case 'decline': case 'reopen':
      call('quoteAction',[no,act],function(){go('doc');},act==='approve'?'Quote approved':(act==='decline'?'Quote declined':'Reopened')); break;
    case 'convert':
      call('convertQuote',[no],function(res){state.dtype='invoice';state.dno=res.invoice.number;go('doc');},'Invoice draft created. Check it, then send.'); break;
    case 'new-entry': openEntryForm({mode:ROLE==='admin'?'direct':'submit',project:attr('data-project')||'',shoot:attr('data-shoot')||''}); break;
    case 'en-kind': var mk=state.modal; if(mk&&mk.e){mk.e.kind=attr('data-v');mk.e.cost_type=mk.e.kind==='income'?'':mk.e.cost_type;mk.e.account='';mk.dupAsk=null;renderModal();} break;
    case 'en-save': enSave(); break;
    case 'en-rmfile': if(state.modal){state.modal.file=null;renderModal();} break;
    case 'en-delete':
      state.delId=state.modal.id;
      openModal({kind:'confirm',title:'Delete entry '+state.delId+'?',text:'The entry is removed from the books. Its document stays in Drive.',ok:'Delete entry',okAct:'m-en-delete'}); break;
    case 'm-en-delete': call('deleteEntry',[state.delId],function(){closeModal();go(state.view);},'Entry deleted'); break;
    case 'q-review':
      var ai=(DATA.approvals||[]).filter(function(x){return x.id===attr('data-id');})[0];
      if(!ai) break;
      if(ai.kind==='payment'||ai.kind==='adjust'){
        state.qid=ai.id;
        openModal({kind:'confirm',title:ai.kind==='payment'?'Record payment on '+ai.doc_number+'?':'Reduce entry '+ai.adjust_entry+'?',
          text:ai.kind==='payment'?'LKR '+fmt2(ai.amount)+' received on '+dshort(ai.date)+' from '+(ai.payee||'the client')+'. The invoice balance goes down by this amount. Bank says: '+String(ai.suggestion||''):
            'The bank refunded LKR '+fmt2(ai.adjust_amount)+' ('+String(ai.suggestion||'')+'). That amount is taken off the cost in the books; if nothing is left the entry is removed.',
          ok:'Approve',okAct:'m-q-approve'});
      } else openEntryForm({mode:'approve',item:ai});
      break;
    case 'm-q-approve': call('approveItem',[state.qid,{}],function(){closeModal();reloadData(function(){go('entries');});},'Approved'); break;
    case 'q-bulk': approveBulk(); break;
    case 'bk-reload': state.bank=null; go('bank'); break;
    case 'bk-clear': state.stm=null; state.sort=null; go('bank'); break;
    case 'bk-open-queue': state.etab='queue'; state.sort=null; go('entries'); break;
    case 'bk-sort-rest': runSort(''); break;
    case 'bk-import':
      var stx=state.stm&&state.stm.st; if(!stx) break;
      call('importStatement',[stx.meta,stx.rows,stx.file],function(res){
        state.stm=null;
        if(!res.added){toast('That statement was already imported.');state.bank=null;go('bank');return;}
        runSort(res.statement.id);
        OBX.afterStatement();
      },'Statement imported'); break;
    case 'bk-test':
      state.bankTest='Testing…'; go('bank');
      google.script.run.withSuccessHandler(function(r){
        state.bankTest='Claude: connected ('+r.model+', replied "'+r.reply+'").\nCalendars: '+(r.calendars.length?r.calendars.join('; '):'none set')+'.\nSpend this month: USD '+r.spend.used.toFixed(4)+' of '+r.spend.budget.toFixed(2)+'.';
        state.bank=null; if(state.view==='bank') go('bank');
      }).withFailureHandler(function(e){state.bankTest='Not working: '+((e&&e.message)||e);if(state.view==='bank') go('bank');}).testClaude(); break;
    case 'en-guess': if(state.modal&&state.modal.e){state.modal.e.remember_match=rememberGuess(state.modal.bank);renderModal();} break;
    case 'q-reject': openModal({kind:'reject',id:attr('data-id'),reason:''}); break;
    case 'm-q-reject': call('rejectItem',[state.modal.id,state.modal.reason||''],function(){closeModal();go('entries');},'Rejected'); break;
    case 'q-withdraw':
      state.wid=attr('data-id');
      openModal({kind:'confirm',title:'Withdraw this item?',text:'It is taken off the queue and its uploaded document is removed.',ok:'Withdraw',okAct:'m-q-withdraw'}); break;
    case 'm-q-withdraw': call('withdrawItem',[state.wid],function(){closeModal();go('entries');},'Withdrawn'); break;
    case 'm-close': closeModal(); break;
    default: if(!doAct6(act,el)) doAct7(act,el);
  }
}

/* ---------- entries and approval queue ---------- */
function pendingItems(){return (DATA.approvals||[]).filter(function(a){return a.status==='pending'&&a.source!=='bill_upload';});}
function docTag(e,di){
  di=di||docInfo(e);
  var t='<span class="tag '+di.k+'">'+esc(di.t)+'</span>';
  return e.doc_url?'<a class="dl" href="'+esc(e.doc_url)+'" target="_blank" rel="noopener" title="Open document">'+t+'</a>':t;
}
function paidText(e){
  if(e.paid_status==='paid') return {t:'Paid'+(e.paid_date?' '+dshort(e.paid_date):''),c:'var(--pill-good)'};
  if(e.paid_status==='part') return {t:'Part: '+fmt(paidOf(e))+' paid',c:'var(--warn)'};
  return {t:'Unpaid',c:'var(--warn)'};
}
function entryList(){
  var q=state.esearch.toLowerCase();
  return DATA.entries.filter(function(e){
    if(state.ef==='Costs'&&e.kind!=='cost') return false;
    if(state.ef==='Income'&&e.kind!=='income') return false;
    if(state.ef==='Unpaid'&&(e.paid_status==='paid'||num(e.amount)-paidOf(e)<0.005)) return false;
    if(state.ef==='Missing document'&&!(e.kind==='cost'&&docInfo(e).miss)) return false;
    if(state.emonth!=='All'&&String(e.date).slice(0,7)!==state.emonth) return false;
    if(state.eproject==='__none'){ if(e.project) return false; } else if(state.eproject!=='All'&&e.project!==state.eproject) return false;
    return !q||[e.payee,e.description,e.shoot,e.cost_type,e.id,e.doc_number,projName(e.project)].join(' ').toLowerCase().indexOf(q)>=0;
  }).sort(function(a,b){return String(b.date).localeCompare(String(a.date))||String(b.id).localeCompare(String(a.id));});
}
function vEntries(){
  var admin=ROLE==='admin', viewer=ROLE==='viewer', canQ=admin||viewer, npend=pendingItems().length;
  if(!canQ&&state.etab==='queue') state.etab='entries';
  if(!admin&&state.etab==='ai') state.etab='entries';
  var nai=admin?OBX.reviews().length:0;
  var tabs=canQ?'<div class="filters"><button class="chip '+(state.etab==='entries'?'on':'')+'" data-etab="entries">Entries</button>'+(admin?'<button class="chip '+(state.etab==='ai'?'on':'')+'" data-etab="ai">Read by Claude'+(nai?' ('+nai+')':'')+'</button>':'')+'<button class="chip '+(state.etab==='queue'?'on':'')+'" data-etab="queue">'+(admin?'Approvals':'My submissions')+(npend?' ('+npend+')':'')+'</button></div>':'';
  var head='<div class="head"><div><span class="mono">Costs and income · LKR</span><h1>'+(state.etab==='queue'?(admin?'Approvals':'My submissions'):state.etab==='ai'?'Read by Claude':'Entries')+'</h1></div>'+
    (admin?OBX.addMenu():(ROLE==='accountant'?'<div class="btnrow"><button class="btn primary" data-act="new-adj">Add adjustment</button></div>':viewer?'<div class="btnrow"><button class="btn primary" data-act="new-entry">Submit a cost</button></div>':''))+'</div>';
  if(state.etab==='queue') return head+tabs+vQueue();
  if(state.etab==='ai') return head+tabs+OBX.vAi();
  var list=entryList(), costs=0,inc=0,unpaid=0,miss=0,nc=0,ni=0;
  list.forEach(function(e){
    var a=num(e.amount);
    if(e.kind==='income'){inc+=a;ni++;}
    else if(String(e.account)!=='1400'){costs+=a;nc++; unpaid+=Math.max(0,a-paidOf(e)); if(docInfo(e).miss) miss++;}
  });
  var cards='<div class="grid g4">'+card('Costs',lkr(costs),'',nc+(nc===1?' entry':' entries'))+card('Income',lkr(inc),'',ni+(ni===1?' entry':' entries'))+card('Costs unpaid',lkr(unpaid),unpaid>0?'':'','Not yet paid out')+card('Documents missing',String(miss),miss?'neg':'','Costs with no invoice or receipt')+'</div>';
  var ms=['All'].concat(fyMonths()), projs=DATA.projects.slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name));});
  var filters='<div class="filters">'+['All','Costs','Income','Unpaid','Missing document'].map(function(f){return '<button class="chip '+(state.ef===f?'on':'')+'" data-ef="'+esc(f)+'">'+esc(f)+'</button>';}).join('')+
    '<select id="e-month" aria-label="Month">'+ms.map(function(m){return '<option value="'+m+'"'+(m===state.emonth?' selected':'')+'>'+(m==='All'?'All months':esc(monthLabel(m)))+'</option>';}).join('')+'</select>'+
    '<select id="e-project" aria-label="Project"><option value="All">All projects</option><option value="__none"'+(state.eproject==='__none'?' selected':'')+'>Overheads (no project)</option>'+projs.map(function(p){return '<option value="'+esc(p.id)+'"'+(p.id===state.eproject?' selected':'')+'>'+esc(p.name)+'</option>';}).join('')+'</select>'+
    '<input class="search" id="esearch" placeholder="Search paid to, description, document no." value="'+esc(state.esearch)+'"></div>';
  var shown=list.slice(0,state.eshow);
  var rows=shown.map(function(e){
    var pt=paidText(e);
    return '<tr'+((admin||ROLE==='accountant')?' class="click" data-eid="'+esc(e.id)+'" tabindex="0"':'')+'><td>'+dshort(e.date)+'</td>'+
      '<td class="name"><b>'+esc(e.payee)+'</b>'+(e.bill_id&&admin?' <span class="tag info obx-billtag" data-obxbill="'+esc(e.bill_id)+'" title="Part of a split bill: tap to change the split">Split</span>':'')+'<small>'+esc(e.description||'')+'</small></td>'+
      '<td class="wrap">'+(e.project?esc(projName(e.project)):'<span class="note">Overhead</span>')+'</td>'+
      '<td>'+(e.kind==='income'?'<span class="tag good">Income</span>':'<span class="tag mute">'+esc(e.cost_type||'Cost')+'</span>')+(String(e.account)==='1400'?' <span class="tag warn">Loan</span>':'')+'</td>'+
      '<td class="r num amt '+(e.kind==='income'?'pos':'')+'">'+fmt(e.amount)+'</td>'+
      '<td style="color:'+pt.c+'">'+esc(pt.t)+'</td><td>'+docTag(e)+'</td></tr>';
  }).join('');
  var more=list.length>shown.length?'<div style="padding:12px 18px"><button class="chip" data-eshowall="1">Show all '+list.length+'</button></div>':'';
  return head+tabs+cards+filters+
    '<div class="tablewrap"><table class="etbl"><thead><tr><th>Date</th><th>Paid to / from</th><th>Project</th><th>Type</th><th class="r">Amount</th><th>Paid</th><th>Document</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="7" class="empty">No entries match.</td></tr>')+'</tbody></table>'+more+'</div>'+
    '<p class="note" style="margin-top:12px">'+((admin||ROLE==='accountant')?'Click a row to '+(admin?'edit':'reclassify or split')+' it. Entries that come from an invoice open the invoice. ':'')+'Costs count on their cost date; income on the invoice date.</p>';
}
function bulkOk(a){
  return ROLE==='admin'&&a.status==='pending'&&a.confidence==='high'&&!a.doc_url&&(a.source==='rule'||a.source==='ai')&&
    (a.kind==='payment'||a.kind==='adjust'||(String(a.payee||'').trim()&&(a.kind==='income'||!!a.cost_type)));
}
function vQueue(){
  var admin=ROLE==='admin', all=(DATA.approvals||[]).filter(function(a){return a.source!=='bill_upload';}).slice().sort(function(a,b){return String(b.submitted_at).localeCompare(String(a.submitted_at));});
  var pendAll=all.filter(function(a){return a.status==='pending';}), done=all.filter(function(a){return a.status!=='pending';}).slice(0,15);
  var ready=pendAll.filter(bulkOk), look=pendAll.filter(function(a){return !bulkOk(a);});
  var qf=state.qf||'all', RANK={low:0,medium:1,high:2};
  var pend=(qf==='ready'?ready:(qf==='look'?look:pendAll)).slice().sort(function(a,b){
    return (RANK[a.confidence]==null?3:RANK[a.confidence])-(RANK[b.confidence]==null?3:RANK[b.confidence])||String(a.date).localeCompare(String(b.date));});
  var KIND={pending:'warn',approved:'good',rejected:'late',withdrawn:'mute'};
  function row(a){
    var isP=a.status==='pending', di=docInfo({doc_url:a.doc_url,doc_status:a.doc_status,payment_method:a.payment_method}), by=String(a.submitted_by||'').split('@')[0], act='';
    if(isP&&admin) act='<button class="chip" data-act="q-review" data-id="'+esc(a.id)+'">'+(a.kind==='payment'||a.kind==='adjust'?'Check':'Review')+'</button> <button class="chip" data-act="q-reject" data-id="'+esc(a.id)+'">Reject</button>';
    else if(isP) act='<button class="chip" data-act="q-withdraw" data-id="'+esc(a.id)+'">Withdraw</button>';
    else act='<span class="pill '+(KIND[a.status]||'mute')+'">'+esc(a.status)+'</span>'+(a.reason?'<div class="note">'+esc(a.reason)+'</div>':'');
    var src=a.source==='ai'?'<span class="tag info">AI</span> ':(a.source==='rule'?'<span class="tag mute">Rule</span> ':''), conf=a.confidence?'<span class="tag '+(a.confidence==='high'?'good':(a.confidence==='medium'?'warn':'late'))+'">'+esc(a.confidence)+'</span>':'';
    var title=a.kind==='payment'?'Payment on '+esc(a.doc_number):(a.kind==='adjust'?esc(a.payee):(esc(a.payee)||'<span class="note">(who?)</span>'));
    var sub=[a.kind==='income'?'Income':(a.kind==='cost'?(a.cost_type||''):''),a.description,a.note].filter(String).map(esc).join(' · ');
    var bank=a.suggestion?'<small style="color:var(--muted2)">Bank: '+esc(String(a.suggestion).slice(0,70))+'</small>':'';
    return '<tr><td>'+dshort(a.date)+'</td><td class="name"><b>'+title+'</b><small>'+sub+'</small>'+bank+'</td>'+
      '<td class="wrap">'+(a.project?esc(projName(a.project)):'<span class="note">'+(a.kind==='payment'?'':'Overhead')+'</span>')+'</td><td class="r num amt">'+fmt(a.amount)+'</td>'+
      '<td>'+src+conf+'</td><td>'+(a.kind==='payment'||a.kind==='adjust'?'':docTag({doc_url:a.doc_url},di))+'</td>'+
      '<td><span class="note">'+(admin&&a.source==='manual'?esc(by)+' · ':'')+esc(String(a.submitted_at||'').slice(0,10))+'</span></td><td>'+act+'</td></tr>';
  }
  function tbl(list,empty){return '<div class="tablewrap"><table class="etbl"><thead><tr><th>Date</th><th>Paid to</th><th>Project</th><th class="r">Amount</th><th>Source</th><th>Document</th><th>Submitted</th><th></th></tr></thead><tbody>'+(list.map(row).join('')||'<tr><td colspan="8" class="empty">'+empty+'</td></tr>')+'</tbody></table></div>';}
  var bulk=admin&&ready.length?'<div class="banner" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span><b>'+ready.length+(ready.length===1?' item is':' items are')+' ready.</b> High confidence, nothing missing. Approving posts them to the books.</span><button class="btn primary" data-act="q-bulk">Approve '+ready.length+'</button></div>':'';
  var chips=admin&&pendAll.length?'<div class="filters">'+[['all','All ('+pendAll.length+')'],['ready','Ready ('+ready.length+')'],['look','Needs a look ('+look.length+')']].map(function(f){return '<button class="chip '+(qf===f[0]?'on':'')+'" data-qf="'+f[0]+'">'+esc(f[1])+'</button>';}).join('')+'</div>':'';
  return (admin?'':'<p class="note" style="margin-bottom:12px">Costs you submit wait here until Joshua approves them. They are not in the books until then.</p>')+bulk+
    '<div class="sec" style="margin-top:0"><h3>Waiting for approval</h3>'+chips+tbl(pend,'Nothing waiting.')+'</div>'+
    '<div class="sec"><h3>Recently decided</h3>'+tbl(done,'Nothing decided yet.')+'</div>';
}
function openEntry(id){
  var e=DATA.entries.filter(function(x){return String(x.id)===String(id);})[0]; if(!e) return;
  if(ROLE==='accountant'){openAcct(e);return;}
  var no=invNo(e);
  if(e.kind==='income'&&no&&findDoc('invoice',no)){openDoc('invoice',no);return;}
  openEntryForm({mode:'direct',entry:e});
}

/* ---------- entry form (add, edit, submit, review) ---------- */
var COSTMAP_FB={'Equipment rental':['5010','6050'],'Crew / freelancer':['5020','6020'],'Transport':['5040','6060'],'Food':['5050','6060'],'Location & venue':['5030','6050'],'Other':['5060','6050'],'Staff & salaries':['5020','6010']};
function autoAccount(e){
  if(e.kind==='income') return e.project?'4010':(e.business_line==='AI data'?'4020':'4090');
  var pair=null;
  (DATA.costmap||[]).forEach(function(r){ if(String(r.cost_type)===String(e.cost_type)&&(String(r.project_account)||String(r.overhead_account))) pair=[String(r.project_account),String(r.overhead_account)]; });
  pair=pair||COSTMAP_FB[e.cost_type]||['5060','6050'];
  return (e.project?pair[0]:pair[1])||(e.project?'5060':'6050');
}
function accName(code){var a=DATA.accounts.filter(function(x){return String(x.code)===String(code);})[0];return a?a.code+' '+a.name:String(code);}
function openEntryForm(o){
  o=o||{};
  var src=o.entry||o.item||null, proj=o.project?DATA.projects.filter(function(p){return p.id===o.project;})[0]:null, e;
  if(src){
    e={kind:src.kind||'cost',date:String(src.date||'').slice(0,10),amount:String(src.amount==null?'':src.amount),payee:src.payee||'',description:src.description||'',project:src.project||'',shoot:src.shoot||'',
      cost_type:src.cost_type||'',account:'',business_line:src.business_line||'Production',paid_status:src.paid_status||'unpaid',paid_date:String(src.paid_date||'').slice(0,10),
      paid_amount:src.paid_status==='part'?String(src.paid_amount||''):'',payment_method:src.payment_method||'',doc_status:String(src.doc_status||'').toLowerCase(),doc_number:src.doc_number||'',notes:(o.item?src.note:src.notes)||''};
    var a0=String(src.account||''); if(a0&&a0!==autoAccount(e)) e.account=a0;
    if(e.kind==='cost'&&!e.doc_status) e.doc_status=src.doc_url?'invoice':'none';
  } else {
    e={kind:'cost',date:TODAY,amount:'',payee:'',description:'',project:proj?proj.id:'',shoot:o.shoot||'',cost_type:'',account:'',business_line:proj&&proj.business_line?proj.business_line:'Production',
      paid_status:'paid',paid_date:'',paid_amount:'',payment_method:'Bank transfer',doc_status:'none',doc_number:'',notes:''};
  }
  openModal({kind:'entry',mode:o.mode||'direct',id:o.entry?o.entry.id:(o.item?o.item.id:''),e:e,file:null,existing:src?String(src.doc_url||''):'',dupAsk:null,
    by:o.item?String(o.item.submitted_by||'').split('@')[0]:'',on:o.item?String(o.item.submitted_at||'').slice(0,10):'',
    bank:o.item?String(o.item.suggestion||''):'',src:o.item?String(o.item.source||''):'',why:o.item?String(o.item.note||''):'',conf:o.item?String(o.item.confidence||''):''});
}
function selHtml(list,sel,blank){
  return (blank!=null?'<option value="">'+esc(blank)+'</option>':'')+list.map(function(x){
    var v=Array.isArray(x)?x[0]:x, l=Array.isArray(x)?x[1]:x;
    return '<option value="'+esc(v)+'"'+(String(v)===String(sel)?' selected':'')+'>'+esc(l)+'</option>';}).join('');
}
function payeeNames(kind){
  var seen={}, out=[];
  function add(n){n=String(n||'').trim(); if(n&&!seen[n.toLowerCase()]){seen[n.toLowerCase()]=1;out.push(n);}}
  DATA.entries.forEach(function(x){ if(x.kind===kind) add(x.payee); });
  if(kind==='cost') DATA.crew.forEach(function(c){add(c.name);}); else DATA.clients.forEach(function(c){add(c.name);});
  return out.sort().slice(0,400);
}
function entryBody(m){
  var e=m.e, cost=e.kind==='cost', admin=ROLE==='admin', ro=false;
  var title=m.mode==='approve'?'Review '+m.id:(m.mode==='submit'?'Submit a cost':(m.id?'Edit entry '+m.id:'Add entry'));
  var types=COST_TYPES.filter(String); if(e.cost_type&&types.indexOf(e.cost_type)<0) types.push(e.cost_type);
  var accs=DATA.accounts.filter(function(a){return a.type===(cost?'Expense':'Revenue')&&String(a.active).toLowerCase()!=='no';}).map(function(a){return [a.code,a.code+' '+a.name];});
  if(e.account&&!accs.some(function(a){return String(a[0])===String(e.account);})) accs.push([e.account,accName(e.account)]);
  var projs=DATA.projects.filter(function(p){return ['Closed','Cancelled'].indexOf(p.status)<0||p.id===e.project;}).sort(function(a,b){return String(a.name).localeCompare(String(b.name));}).map(function(p){return [p.id,p.name+' · '+shortClient(p.client)];});
  var methods=String(DATA.settings.payment_methods||'Bank transfer|Cash').split('|').filter(function(z){return z&&z!=='Not paid yet';});
  var h='<h2>'+esc(title)+'</h2>';
  if(m.mode==='approve'&&m.src==='manual') h+='<div class="note">Submitted by <b>'+esc(m.by)+'</b> on '+esc(m.on)+'. Check the details and fix anything, then approve to post it to the books.</div>';
  if(m.mode==='approve'&&m.src!=='manual') h+='<div class="note"><b>'+(m.src==='ai'?'Claude':'Sorting rule')+'</b> suggested this'+(m.conf?' ('+esc(m.conf)+' confidence)':'')+(m.why?': '+esc(m.why):'')+'. Check it and fix anything, then approve to post it to the books.</div>'+
    (m.bank?'<div class="note" style="color:var(--muted2)">Bank line: '+esc(m.bank)+'</div>':'');
  if(m.mode==='submit') h+='<div class="note">This goes to Joshua for approval. It is not in the books until he approves it.</div>';
  if(m.dupAsk){var d=m.dupAsk; h+='<div class="banner" style="margin:0">Possible duplicate: <b>'+esc(d.id)+'</b>, '+esc(dshort(d.date))+', '+esc(d.payee)+', LKR '+fmt(d.amount)+'. Press the button again to save anyway.</div>';}
  if(admin&&m.mode!=='submit') h+='<div class="seg"><button class="chip '+(cost?'on':'')+'" data-act="en-kind" data-v="cost">Cost</button><button class="chip '+(cost?'':'on')+'" data-act="en-kind" data-v="income">Income</button></div>';
  h+='<datalist id="enpay">'+payeeNames(e.kind).map(function(n){return '<option value="'+esc(n)+'">';}).join('')+'</datalist>';
  h+='<div class="frow"><div class="fld"><label for="en-date">'+(cost?'Cost date':'Date')+'</label><input class="f" type="date" id="en-date" data-en="date" value="'+esc(e.date)+'"></div>'+
     '<div class="fld"><label for="en-amount">Amount (LKR)</label><input class="f" inputmode="decimal" id="en-amount" data-en="amount" value="'+esc(e.amount)+'" placeholder="0"></div></div>';
  h+='<div class="frow"><div class="fld"><label for="en-payee">'+(cost?'Paid to':'Received from')+'</label><input class="f" list="enpay" id="en-payee" data-en="payee" value="'+esc(e.payee)+'" placeholder="'+(cost?'Supplier or person':'Client')+'" autocomplete="off"></div>'+
     '<div class="fld"><label for="en-description">What for</label><input class="f" id="en-description" data-en="description" value="'+esc(e.description)+'" placeholder="e.g. Lens hire, 2 days"></div></div>';
  h+='<div class="frow"><div class="fld"><label for="en-project">Project</label><select class="f" id="en-project" data-en="project">'+selHtml(projs,e.project,'No project (company overhead)')+'</select></div>'+
     (e.project?'<div class="fld"><label for="en-shoot">Shoot day (optional)</label><input class="f" id="en-shoot" data-en="shoot" value="'+esc(e.shoot)+'" placeholder="Pick or type a shoot" list="obx-dl-shoots" autocomplete="off">'+OBX.shootDatalist(e.project)+'</div>':'<div class="fld"><label for="en-business_line">Business line</label><select class="f" id="en-business_line" data-en="business_line">'+selHtml(['Production','AI data'],e.business_line)+'</select></div>')+'</div>';
  if(cost) h+='<div class="frow"><div class="fld"><label for="en-cost_type">Cost type</label><select class="f" id="en-cost_type" data-en="cost_type">'+selHtml(types,e.cost_type,'Choose a type')+'</select></div>'+
     '<div class="fld"><label for="en-account">Books account</label><select class="f" id="en-account" data-en="account">'+selHtml(accs,e.account,'Automatic: '+accName(autoAccount(e)))+'</select></div></div>';
  else h+='<div class="frow"><div class="fld"><label for="en-account">Books account</label><select class="f" id="en-account" data-en="account">'+selHtml(accs,e.account,'Automatic: '+accName(autoAccount(e)))+'</select></div>'+
     '<div class="fld"><label for="en-cost_type">Label</label><input class="f" id="en-cost_type" data-en="cost_type" value="'+esc(e.cost_type)+'" placeholder="'+(e.project?'Full payment':'Other income')+'"></div></div>';
  h+='<div class="frow"><div class="fld"><label for="en-paid_status">'+(cost?'Payment':'Received')+'</label><select class="f" id="en-paid_status" data-en="paid_status">'+selHtml([['paid',cost?'Paid':'Received in full'],['part','Part paid'],['unpaid','Not paid yet']],e.paid_status)+'</select></div>'+
     (e.paid_status==='part'?'<div class="fld"><label for="en-paid_amount">Amount paid so far</label><input class="f" inputmode="decimal" id="en-paid_amount" data-en="paid_amount" value="'+esc(e.paid_amount)+'"></div>':
      (e.paid_status==='paid'?'<div class="fld"><label for="en-paid_date">Date paid</label><input class="f" type="date" id="en-paid_date" data-en="paid_date" value="'+esc(e.paid_date)+'"></div>':'<div></div>'))+'</div>';
  if(e.paid_status!=='unpaid') h+='<div class="fld"><label for="en-payment_method">How it was paid</label><select class="f" id="en-payment_method" data-en="payment_method">'+selHtml(methods,e.payment_method,'')+'</select></div>';
  h+='<div class="fld"><label for="en-file">'+(cost?'Invoice or receipt (PDF or photo)':'Receipt or remittance (optional)')+'</label><input class="f" type="file" id="en-file" accept="application/pdf,image/*">'+
     '<div class="docline">'+(m.file?'<span>Selected: <b>'+esc(m.file.name)+'</b> ('+Math.max(1,Math.round(m.file.size/1024))+' KB)</span><a class="link" data-act="en-rmfile" tabindex="0">Remove</a>':
      (m.existing?'<span>Current document: <a class="link" href="'+esc(m.existing)+'" target="_blank" rel="noopener">open</a>. Choosing a new file replaces it.</span>':'<span>Photos are shrunk before upload. It is filed in Drive under the standard name.</span>'))+'</div></div>';
  h+='<div class="frow"><div class="fld"><label for="en-doc_number">'+(cost?'Invoice or receipt number':'Document number')+' (optional)</label><input class="f" id="en-doc_number" data-en="doc_number" value="'+esc(e.doc_number)+'"></div>'+
     (cost?'<div class="fld"><label for="en-doc_status">Proof of cost</label><select class="f" id="en-doc_status" data-en="doc_status">'+selHtml([['invoice','Invoice attached'],['receipt','Receipt attached'],['quote only','Quote only'],['bank line only','Bank line only (rides, small items)'],['none','No document yet']],e.doc_status)+'</select></div>':'<div></div>')+'</div>';
  h+='<div class="fld"><label for="en-notes">Note (optional)</label><textarea class="f" id="en-notes" data-en="notes" rows="2">'+esc(e.notes)+'</textarea></div>';
  if(m.mode==='approve'&&m.src!=='manual'&&m.bank) h+='<div class="fld"><label for="en-remember_match">Remember as a sorting rule (optional)</label><input class="f" id="en-remember_match" data-en="remember_match" value="'+esc(e.remember_match||'')+'" placeholder="Text from the bank line, e.g. PAAN PAAN">'+
    '<div class="docline"><span>Later lines containing this text are sorted like this automatically (you still approve them).</span><a class="link" data-act="en-guess" tabindex="0">Use the start of the bank line</a></div></div>';
  var primary=m.mode==='submit'?'Submit for approval':(m.mode==='approve'?'Approve and post':'Save');
  h+='<div class="btnrow"><button class="btn primary" data-act="en-save">'+(m.dupAsk?'Save anyway':primary)+'</button><button class="btn" data-act="m-close">Cancel</button>'+
     (m.mode==='direct'&&m.id?'<button class="btn" data-act="en-delete" style="margin-left:auto">Delete</button>':'')+'</div>';
  return h;
}
function findDup(m){
  var e=m.e, amt=pnum(e.amount), nm=String(e.payee||'').trim().toLowerCase(), hit=null;
  DATA.entries.forEach(function(x){
    if(hit||x.kind!==e.kind||(m.mode==='direct'&&String(x.id)===String(m.id))) return;
    if(Math.abs(num(x.amount)-amt)<0.005&&String(x.payee||'').trim().toLowerCase()===nm&&Math.abs(daysFrom(String(x.date).slice(0,10),e.date))<=3) hit=x;
  });
  return hit;
}
function enSave(){
  var m=state.modal, e=m.e, cost=e.kind==='cost', amt=pnum(e.amount);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')){toast('Enter the date.');return;}
  if(!(amt>0)){toast('Enter the amount.');return;}
  if(!String(e.payee||'').trim()){toast(cost?'Enter who was paid.':'Enter who paid.');return;}
  if(cost&&!e.cost_type){toast('Choose a cost type.');return;}
  if(e.paid_status==='part'){var pa=pnum(e.paid_amount); if(!(pa>0&&pa<amt)){toast('For a part payment, enter an amount paid that is less than the total.');return;}}
  if(cost&&(e.doc_status==='invoice'||e.doc_status==='receipt')&&!(m.file||m.existing)){toast('Attach the document, or choose another option under Proof of cost.');return;}
  if(!m.dupAsk){var d=findDup(m); if(d){m.dupAsk=d;renderModal();return;}}
  var p={kind:e.kind,date:e.date,amount:amt,payee:e.payee,description:e.description,project:e.project,shoot:e.shoot,cost_type:e.cost_type,account:e.account,business_line:e.business_line,
    paid_status:e.paid_status,paid_date:e.paid_date,paid_amount:e.paid_status==='part'?pnum(e.paid_amount):0,payment_method:e.payment_method,doc_status:e.doc_status,doc_number:e.doc_number,notes:e.notes};
  if(m.mode==='direct'&&m.id) p.id=m.id;
  if(m.mode==='approve'&&String(e.remember_match||'').trim()) p.remember_match=String(e.remember_match).trim();
  var fn=m.mode==='submit'?'submitItem':(m.mode==='approve'?'approveItem':'saveEntry'), args=m.mode==='approve'?[m.id,p,m.file]:[p,m.file];
  call(fn,args,function(){closeModal();go(state.view);},m.mode==='submit'?'Submitted for approval':(m.mode==='approve'?'Approved and posted':'Saved'));
}
function enChange(t){
  var m=state.modal; if(!m||!m.e) return; var f=t.getAttribute('data-en'), e=m.e; e[f]=t.value;
  m.dupAsk=null;
  if(f==='payee'){
    var key=String(t.value).trim().toLowerCase(), last=null;
    if(key&&e.kind==='cost') DATA.entries.forEach(function(x){ if(x.kind==='cost'&&String(x.payee||'').trim().toLowerCase()===key&&(!last||String(x.date)>String(last.date))) last=x; });
    if(last&&!e.cost_type){ e.cost_type=last.cost_type||''; if(last.payment_method) e.payment_method=last.payment_method; renderModal(); }
    return;
  }
  if(f==='project'){ if(e.project){var p=DATA.projects.filter(function(x){return x.id===e.project;})[0]; if(p&&p.business_line) e.business_line=p.business_line;} else e.shoot=''; renderModal(); return; }
  if(['cost_type','paid_status','business_line'].indexOf(f)>=0){ renderModal(); }
}
function readUpload(file,cb){
  var okType=/^image\//.test(file.type)||file.type==='application/pdf';
  if(!okType){toast('Attach a PDF or a photo (JPG or PNG).');return;}
  if(file.size>12*1024*1024){toast('That file is over 12 MB. Use a smaller scan or photo.');return;}
  toast('Reading the file…',true);
  if(file.type==='application/pdf'||file.type==='image/gif'){
    var fr=new FileReader();
    fr.onload=function(){cb({name:file.name,mime:file.type,b64:String(fr.result).split(',')[1],size:file.size});toast('File ready',true);};
    fr.onerror=function(){toast('Could not read that file.');};
    fr.readAsDataURL(file); return;
  }
  var url=URL.createObjectURL(file), img=new Image();
  img.onload=function(){
    var sc=Math.min(1,2000/Math.max(img.width,img.height)), c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(img.width*sc)); c.height=Math.max(1,Math.round(img.height*sc));
    var cx=c.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,c.width,c.height); cx.drawImage(img,0,0,c.width,c.height);
    var d=c.toDataURL('image/jpeg',0.85); URL.revokeObjectURL(url);
    cb({name:file.name.replace(/\.[^.]+$/,'')+'.jpg',mime:'image/jpeg',b64:d.split(',')[1],size:Math.round(d.length*0.75)}); toast('File ready',true);
  };
  img.onerror=function(){URL.revokeObjectURL(url);toast('Could not read that photo. Use a JPG, PNG or PDF.');};
  img.src=url;
}
function enFile(inp){
  var f=inp.files&&inp.files[0], m=state.modal; if(!f||!m||!m.e) return;
  readUpload(f,function(obj){
    m.file=obj;
    if(m.e.kind==='cost'&&['bank line only','none'].indexOf(m.e.doc_status)>=0) m.e.doc_status='invoice';
    renderModal();
  });
}

/* ---------- bank statements: read the PDF here, sort on the server ---------- */
var HNB_DATE=/^\d{2}\/\d{2}\/\d{4}$/, HNB_NUM=/^-?[\d,]+\.\d{2}$/, PDFJS_V='4.10.38';
var PDFJS_SRC=['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+PDFJS_V+'/pdf.min.mjs','https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_V+'/build/pdf.min.mjs'];
var PDFJS_WORKER=['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+PDFJS_V+'/pdf.worker.min.mjs','https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_V+'/build/pdf.worker.min.mjs'];
state.bank=null; state.bankLoading=false; state.stm=null; state.sort=null; state.bankTest='';

/* HNB statement text is font-shifted: every character code under 100 is 29 too low. */
function hnbDecode(s){var o='';for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);o+=(c===32||c>=100)?s.charAt(i):String.fromCharCode(c+29);}return o;}
function loadPdfJs(){
  if(window.__pdfjs) return Promise.resolve(window.__pdfjs);
  var i=0;
  function next(){
    if(i>=PDFJS_SRC.length) return Promise.reject(new Error('Could not load the PDF reader. Check your internet connection and try again.'));
    var k=i++;
    return import(PDFJS_SRC[k]).then(function(m){m.GlobalWorkerOptions.workerSrc=PDFJS_WORKER[k];window.__pdfjs=m;return m;}).catch(next);
  }
  return next();
}
function pdfItems(pdfjs,buf){
  return pdfjs.getDocument({data:new Uint8Array(buf)}).promise.then(function(doc){
    var items=[],chain=Promise.resolve();
    for(var n=1;n<=doc.numPages;n++){(function(n){chain=chain.then(function(){return doc.getPage(n).then(function(page){
      var vp=page.getViewport({scale:1});
      return page.getTextContent({disableNormalization:true}).then(function(tc){
        tc.items.forEach(function(it){
          if(typeof it.str!=='string'||!it.str.length) return;
          var t=pdfjs.Util.transform(vp.transform,it.transform);
          items.push({p:n,x:t[4],y:t[5],x1:t[4]+(it.width||0),s:hnbDecode(it.str),raw:it.str.slice(0,24)});
        });
      });
    });});})(n);}
    return chain.then(function(){return items;});
  });
}
function parseHnb(items){
  var pages={},rows=[],pend=[],header=null;
  items.forEach(function(i){(pages[i.p]=pages[i.p]||[]).push(i);});
  Object.keys(pages).map(Number).sort(function(a,b){return a-b;}).forEach(function(pn){
    var its=pages[pn].slice().sort(function(a,b){return a.y-b.y||a.x-b.x;}),lines=[],cur=null;
    its.forEach(function(it){if(cur&&Math.abs(it.y-cur.y)<=2) cur.items.push(it); else {cur={y:it.y,items:[it]};lines.push(cur);}});
    lines.forEach(function(ln){
      var ws=[];
      ln.items.sort(function(a,b){return a.x-b.x;}).forEach(function(it){var w=ws[ws.length-1];if(w&&it.x-w.x1<2.5){w.s+=it.s;w.x1=it.x1;}else ws.push({x:it.x,x1:it.x1,s:it.s});});
      ws.forEach(function(w){w.s=w.s.replace(/\s+/g,' ').trim();});
      ws=ws.filter(function(w){return w.s;});
      if(!ws.length) return;
      if(ws[0].s==='CURRENT'&&!header) header=ws.filter(function(w){return HNB_NUM.test(w.s);}).map(function(w){return parseFloat(w.s.replace(/,/g,''));});
      if(ws.length>=4&&HNB_DATE.test(ws[0].s)&&HNB_DATE.test(ws[1].s)){
        var nums=ws.filter(function(w){return HNB_NUM.test(w.s);});
        if(nums.length<2){pend=[];return;}
        var bal=nums[0];nums.forEach(function(w){if(w.x>bal.x) bal=w;});
        var amt=nums.filter(function(w){return w!==bal;})[0];
        var det=ws.filter(function(w){return w.x>440&&w.x<690&&!HNB_NUM.test(w.s)&&!HNB_DATE.test(w.s);}).map(function(w){return w.s;});
        rows.push({date:ws[0].s,ref:ws[2]?ws[2].s:'',amount:parseFloat(amt.s.replace(/,/g,'')),balance:parseFloat(bal.s.replace(/,/g,'')),text:pend.concat(det).join(' ').replace(/\s+/g,' ').trim()});
        pend=[];
      } else if(ws.every(function(w){return w.x>440;})){
        var txt=ws.map(function(w){return w.s;}).join(' ');
        if(!/^Page|Generated/i.test(txt)) pend=pend.concat(ws.filter(function(w){return !HNB_DATE.test(w.s)&&!HNB_NUM.test(w.s);}).map(function(w){return w.s;}));
      }
    });
  });
  return {rows:rows,header:header};
}
function buildStatement(parsed){
  if(!parsed.rows.length) throw new Error('No transaction lines were found in this file. Is it the HNB "Statement and Transaction Report"?');
  if(!parsed.header||parsed.header.length<4) throw new Error('Could not find the opening and closing balances on page 1.');
  var opening=parsed.header[2],closing=parsed.header[3],chrono=parsed.rows.slice().reverse(),prev=opening,bad=[],out=[];
  chrono.forEach(function(r,i){
    var d=Math.round((r.balance-prev)*100)/100;
    if(Math.abs(Math.abs(d)-r.amount)>0.015) bad.push((i+1)+' ('+r.date+', '+r.amount+')');
    out.push({date:r.date,ref:r.ref,amount:d,balance:r.balance,text:r.text});prev=r.balance;
  });
  if(bad.length) throw new Error('The amounts do not match the running balance at line '+bad.slice(0,3).join(', ')+'. Nothing was imported.');
  if(Math.abs(prev-closing)>0.015) throw new Error('The last balance ('+fmt2(prev)+') does not match the closing balance ('+fmt2(closing)+').');
  var cr=0,dr=0;out.forEach(function(r){if(r.amount>0) cr+=r.amount; else dr-=r.amount;});
  return {rows:out,meta:{opening:opening,closing:closing},from:out[0].date,to:out[out.length-1].date,credits:cr,debits:dr};
}
function bytesToB64(bytes){var s='';for(var i=0;i<bytes.length;i+=32768) s+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));return btoa(s);}
function bkFile(inp){
  var f=inp.files&&inp.files[0]; if(!f) return;
  if(!/\.pdf$/i.test(f.name)&&f.type!=='application/pdf'){toast('Choose the HNB statement PDF.');return;}
  if(f.size>12*1024*1024){toast('That file is over 12 MB.');return;}
  state.stm={reading:true,name:f.name};go('bank');
  var fr=new FileReader(),dbg=[];
  fr.onerror=function(){state.stm={error:'Could not read that file.'};go('bank');};
  fr.onload=function(){
    var buf=fr.result,b64=bytesToB64(new Uint8Array(buf));
    loadPdfJs().then(function(pdfjs){return pdfItems(pdfjs,buf.slice(0));}).then(function(items){
      dbg=items.slice(0,6).map(function(i){return 'p'+i.p+' x'+Math.round(i.x)+' y'+Math.round(i.y)+' "'+i.s.slice(0,30)+'" raw codes '+Array.prototype.map.call(i.raw.slice(0,8),function(c){return c.charCodeAt(0);}).join(',');});
      var st=buildStatement(parseHnb(items));
      st.file={name:f.name,mime:'application/pdf',b64:b64};st.fname=f.name;
      state.stm={ok:true,st:st};
    }).catch(function(e){state.stm={error:String(e&&e.message||e),debug:dbg};}).then(function(){if(state.view==='bank') go('bank');});
  };
  fr.readAsArrayBuffer(f);
}
function loadBank(){
  state.bankLoading=true;
  google.script.run.withSuccessHandler(function(r){state.bank=r;state.bankLoading=false;if(state.view==='bank') go('bank');})
    .withFailureHandler(function(e){state.bank={error:(e&&e.message)||String(e)};state.bankLoading=false;if(state.view==='bank') go('bank');}).bankOverview();
}
function reloadData(then){
  google.script.run.withSuccessHandler(function(d){DATA=d;C=compute();state.bank=null;if(then) then();})
    .withFailureHandler(function(e){toast('Could not refresh: '+((e&&e.message)||e));}).getBootData();
}
function runSort(id){
  state.sort={id:id,running:true,queued:0,ai:0,reversed:0,adjusted:0,remaining:null,err:'',done:false};go('bank');
  (function step(){
    google.script.run.withSuccessHandler(function(r){
      var s=state.sort;s.queued+=r.processed;s.ai+=r.ai||0;s.remaining=r.remaining;s.spend=r.spend;
      if(r.paired){s.reversed+=r.paired.reversed;s.adjusted+=r.paired.adjusted;}
      if(r.error){s.running=false;s.err=r.error;}
      else if(r.paused){s.running=false;s.err='Paused: this month\'s Claude budget is used up. Raise claude_monthly_budget_usd in the Settings tab to continue.';}
      else if(r.remaining>0&&r.processed>0){if(state.view==='bank') go('bank');step();return;}
      else if(r.remaining>0){s.running=false;s.err='Some lines could not be sorted. Press Continue to try again.';}
      else {s.running=false;s.done=true;}
      reloadData(function(){if(state.view==='bank') go('bank');});
    }).withFailureHandler(function(e){state.sort.running=false;state.sort.err=(e&&e.message)||String(e);reloadData(function(){if(state.view==='bank') go('bank');});}).sortStep(id);
  })();
}
function vBank(){
  var head='<div class="head"><div><span class="mono">HNB statements · LKR</span><h1>Bank</h1></div></div>';
  if(DATA.settings.claude_model_fast===undefined) return head+'<div class="banner">One-time step needed: open the script editor, pick <b>setupSession5</b> in the function list and click Run. It adds the bank tabs and starting sorting rules, and asks permission for Google Calendar. Then reload this page.</div>';
  if(!state.bank&&!state.bankLoading) loadBank();
  var b=state.bank||{}, s=state.sort, sp=b.spend||(s&&s.spend)||null, np=pendingItems().length, nNew=(b.counts&&b.counts['new'])||0;
  if(b.error) return head+'<div class="banner">Could not load the bank page: '+esc(b.error)+' <a class="link" data-act="bk-reload" tabindex="0">Try again</a></div>';
  var cards='<div class="grid g4">'+
    card('Claude spend this month',sp?'USD '+sp.used.toFixed(2):'…',sp&&sp.used>=sp.budget?'neg':'',sp?'of USD '+sp.budget.toFixed(2)+' budget':'')+
    card('Waiting for approval',String(np),np?'':'','Open the Approvals list')+
    card('Not sorted yet',String(nNew),'','Bank lines still to sort')+
    card('Claude key',b.keySet===undefined?'…':(b.keySet?'Set':'Missing'),b.keySet===false?'neg':'',b.keySet===false?'Add ANTHROPIC_API_KEY in Script properties':(b.rules!=null?b.rules+' sorting rules active':''))+'</div>';
  var up='';
  var stm=state.stm;
  if(s&&s.running){
    up='<div class="panel"><span class="h2big">Sorting…</span><div class="note">'+s.queued+' lines queued so far'+(s.remaining!=null?', '+s.remaining+' still to do':'')+'. Keep this page open. Claude is only asked about lines the rules cannot place.</div><div class="bar"><i style="width:'+(s.remaining!=null&&s.queued+s.remaining>0?Math.round(s.queued/(s.queued+s.remaining)*100):5)+'%"></i></div></div>';
  } else if(s&&(s.done||s.err)){
    up='<div class="panel"><span class="h2big">'+(s.done?'Sorting finished':'Sorting stopped')+'</span><div class="note">'+s.queued+' lines are waiting in Approvals'+(s.reversed?'. '+s.reversed+' reversals were paired with their purchases and cancelled out':'')+(s.adjusted?'. '+s.adjusted+' bank refunds were netted against their rides':'')+'. Nothing is in the books until you approve it.</div>'+
      (s.err?'<div class="banner" style="margin:6px 0 0">'+esc(s.err)+'</div>':'')+
      '<div class="btnrow"><button class="btn primary" data-act="bk-open-queue">Open approvals</button>'+(s.err&&nNew?'<button class="btn" data-act="bk-sort-rest">Continue sorting</button>':'')+'<button class="btn" data-act="bk-clear">Done</button></div></div>';
  } else if(stm&&stm.reading){
    up='<div class="panel"><span class="h2big">Reading the statement…</span><div class="note">'+esc(stm.name)+'. The first time can take a few seconds while the PDF reader loads.</div></div>';
  } else if(stm&&stm.error){
    up='<div class="panel"><span class="h2big">Could not read this statement</span><div class="banner" style="margin:0">'+esc(stm.error)+'</div>'+
      (stm.debug&&stm.debug.length?'<div class="note">For Claude to fix: send a screenshot of this box.</div><pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);margin:0">'+esc(stm.debug.join('\n'))+'</pre>':'')+
      '<div class="btnrow"><button class="btn" data-act="bk-clear">Try another file</button></div></div>';
  } else if(stm&&stm.ok){
    var t=stm.st;
    up='<div class="panel"><span class="h2big">Ready to import</span>'+
      '<div class="note"><b>'+esc(stm.st.fname)+'</b><br>'+t.rows.length+' lines from '+esc(t.from)+' to '+esc(t.to)+'. Opening balance LKR '+fmt2(t.meta.opening)+', closing LKR '+fmt2(t.meta.closing)+'.<br>Money in LKR '+fmt2(t.credits)+', money out LKR '+fmt2(t.debits)+'. Every line adds up to the running balance.</div>'+
      '<div class="btnrow"><button class="btn primary" data-act="bk-import">Import and sort</button><button class="btn" data-act="bk-clear">Choose another file</button></div>'+
      '<div class="note">Lines already imported from an earlier statement are skipped. The PDF is filed in Drive under Bank statements.</div></div>';
  } else {
    up='<div class="panel"><span class="h2big">Add a statement</span><div class="note">Download the HNB "Statement and Transaction Report" as a PDF and choose it here. It is read in your browser, checked against the running balance, then sorted.</div>'+
      '<input class="f" type="file" id="bk-file" accept="application/pdf">'+
      (nNew?'<div class="btnrow"><button class="btn" data-act="bk-sort-rest">Sort the '+nNew+' unsorted lines</button></div>':'')+'</div>';
  }
  var test='<div class="panel"><span class="h2big">Connection</span><div class="note">Checks the Claude key and the Google Calendars used to spot shoot days. Costs a fraction of a cent.</div>'+
    '<div class="btnrow"><button class="btn" data-act="bk-test">Test connection</button></div>'+(state.bankTest?'<div class="note" style="white-space:pre-wrap">'+esc(state.bankTest)+'</div>':'')+'</div>';
  var rows=(b.statements||[]).map(function(x){
    var c=x.counts||{},bits=[];['queued','posted','reversed','adjusted','ignored','new'].forEach(function(k){if(c[k]) bits.push(c[k]+' '+(k==='new'?'unsorted':k));});
    return '<tr><td>'+esc(String(x.from).slice(0,10))+' to '+esc(String(x.to).slice(0,10))+'</td><td class="r num">'+esc(x.lines)+'</td><td class="r num">'+fmt2(x.opening)+'</td><td class="r num">'+fmt2(x.closing)+'</td><td>'+esc(bits.join(' · '))+'</td><td>'+(x.file_url?'<a class="link" href="'+esc(x.file_url)+'" target="_blank" rel="noopener">PDF</a>':'')+'</td></tr>';
  }).join('');
  return head+cards+'<div class="grid g2" style="margin-top:14px">'+up+test+'</div>'+
    '<div class="sec"><h3>Statements</h3><div class="tablewrap"><table><thead><tr><th>Period</th><th class="r">Lines</th><th class="r">Opening</th><th class="r">Closing</th><th>Status of lines</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" class="empty">No statements imported yet.</td></tr>')+'</tbody></table></div></div>'+
    '<p class="note" style="margin-top:12px">Sorting rules live in the Rules tab of the database sheet. Everything Claude or a rule suggests goes to Approvals first.</p>';
}
function approveBulk(){
  var ids=(DATA.approvals||[]).filter(bulkOk).map(function(a){return a.id;});
  if(!ids.length||busy) return;
  busy=true;var done=0,errs=[],i=0;
  (function next(){
    if(i>=ids.length){busy=false;reloadData(function(){state.etab='queue';go('entries');toast('Approved '+done+(errs.length?'. '+errs.length+' need a look: '+errs[0]:''),true);});return;}
    var part=ids.slice(i,i+40);i+=40;toast('Approving '+Math.min(i,ids.length)+' of '+ids.length+'…',true,true);
    google.script.run.withSuccessHandler(function(r){done+=r.done;errs=errs.concat(r.errors||[]);next();})
      .withFailureHandler(function(e){busy=false;toast('Stopped: '+((e&&e.message)||e));reloadData(function(){go('entries');});}).approveMany(part);
  })();
}
function rememberGuess(t){return String(t||'').replace(/\s*(Outward_CEFT|Fund_Transfer)\s*$/i,'').replace(/\/(CEFT|BT)\/.*$/i,'').trim().slice(0,40);}

/* ---------- session 6: accountant workspace and payments calendar ---------- */
function monthState(ym){var m=(DATA.months||[]).filter(function(x){return String(x.month).slice(0,7)===ym;})[0];return m?String(m.status):'';}
function lockedDate(d){return monthState(String(d).slice(0,7))==='locked';}
function stPill(s){return s==='locked'?'<span class="pill good">Locked</span>':(s==='reviewed'?'<span class="pill info">Reviewed</span>':'<span class="pill mute">Open</span>');}
function mergeAcct(res){
  if(res.change){DATA.changes=DATA.changes||[];DATA.changes.unshift(res.change);}
  if(res.month){DATA.months=(DATA.months||[]).filter(function(x){return String(x.month).slice(0,7)!==res.month.month;});if(res.month.status) DATA.months.push(res.month);}
  if(res.project) upsertLocal(DATA.projects,res.project,'id');
  if(res.client) upsertLocal(DATA.clients,res.client,'name');
  if(res.recurring) upsertLocal(DATA.recurring=DATA.recurring||[],res.recurring,'name');
  if(res.removedRecurring){DATA.recurring=(DATA.recurring||[]).filter(function(r){return r.name!==res.removedRecurring;});}
  (res.removedEntries||[]).forEach(function(id){for(var i=DATA.entries.length-1;i>=0;i--) if(String(DATA.entries[i].id)===String(id)) DATA.entries.splice(i,1);});
}
var _mergeRes=mergeRes;
mergeRes=function(res){if(res) mergeAcct(res); _mergeRes(res);};

/* WHT, same rule as the server: 5% of the full amount once one person is paid more than the limit in a month */
function whtRows(from,to){
  var S=DATA.settings, thr=num(S.wht_threshold)||100000, al=num(S.wht_alert)||80000, rate=num(S.wht_rate)||0.05, map={};
  DATA.entries.forEach(function(e){
    if(e.kind!=='cost') return;
    var acc=String(e.account), ct=String(e.cost_type);
    if(acc==='1400'||acc==='6010') return;
    if(acc!=='5020'&&acc!=='6020'&&ct!=='Crew / freelancer') return;
    var p=paidOf(e); if(p<=0) return;
    var m=String(e.paid_date||e.date).slice(0,7); if(m<from||m>to) return;
    var nm=String(e.payee||'').trim(), k=nm.toLowerCase()+'|'+m;
    var o=map[k]||(map[k]={payee:nm,month:m,paid:0,count:0,company:/\b(pvt|ltd|limited|private)\b/i.test(nm)});
    o.paid+=p;o.count++;
  });
  return Object.keys(map).map(function(k){var o=map[k];
    o.status=o.company?'Company':(o.paid>thr?'WHT due':(o.paid>=al?'Near the limit':'Below'));
    o.wht=o.status==='WHT due'?Math.round(o.paid*rate*100)/100:0;return o;
  }).sort(function(a,b){return a.month<b.month?-1:a.month>b.month?1:b.paid-a.paid;});
}
function whtBanner(){
  var m=TODAY.slice(0,7), hit=whtRows(m,m).filter(function(r){return r.status==='WHT due'||r.status==='Near the limit';});
  if(!hit.length) return '';
  return '<div class="banner"><b>Withholding tax this month.</b> '+hit.map(function(r){return esc(r.payee)+' has been paid LKR '+fmt(r.paid)+(r.status==='WHT due'?' (5% = LKR '+fmt(r.wht)+' due)':' (close to the LKR '+fmt(DATA.settings.wht_threshold||100000)+' limit)');}).join('; ')+'.</div>';
}

/* ----- Accountant page ----- */
function loadLib(){
  state.libLoading=true;
  google.script.run.withSuccessHandler(function(r){state.lib=r;state.libLoading=false;if(state.view==='acct') go('acct');})
    .withFailureHandler(function(e){state.libLoading=false;state.lib={error:(e&&e.message)||String(e)};if(state.view==='acct') go('acct');}).statementLibrary();
}
function vAcct(){
  var tab=state.atab||'months', admin=ROLE==='admin';
  var tabs=[['months','Months'],['statements','Statements'],['changes','Changes'],['exports','Exports'],['wht','WHT']];
  var head='<div class="head"><div><span class="mono">Accountant workspace · LKR</span><h1>Accountant</h1></div></div>'+
    (DATA.months===undefined?'<div class="banner">One-time step needed: open the script editor, pick <b>setupSession6</b> in the function list and click Run, then reload this page.</div>':'')+whtBanner()+
    '<div class="filters">'+tabs.map(function(t){return '<button class="chip '+(tab===t[0]?'on':'')+'" data-atab="'+t[0]+'">'+t[1]+(t[0]==='changes'&&(DATA.changes||[]).filter(function(c){return !c.undone;}).length&&admin?' ('+(DATA.changes||[]).filter(function(c){return !c.undone;}).length+')':'')+'</button>';}).join('')+'</div>';
  if((tab==='months'||tab==='statements')&&!state.lib&&!state.libLoading) loadLib();
  if(tab==='months') return head+aMonths();
  if(tab==='statements') return head+aStatements();
  if(tab==='changes') return head+aChanges();
  if(tab==='exports') return head+aExports();
  return head+aWht();
}
function libMonth(ym){return ((state.lib&&state.lib.months)||[]).filter(function(m){return m.month===ym;})[0]||null;}
function aMonths(){
  var admin=ROLE==='admin', lib=state.lib;
  var rows=fyMonths().filter(function(m){return m<=TODAY.slice(0,7);}).map(function(m){
    var s=monthState(m), l=libMonth(m), by=(DATA.months||[]).filter(function(x){return String(x.month).slice(0,7)===m;})[0]||{};
    var open=l?l.open:'…', diff=l?(l.books_net-l.bank_net):null;
    var btn='';
    if(s==='locked') btn=admin?'<button class="chip" data-act="am-reopen" data-m="'+m+'">Reopen</button>':'<span class="note">Admin reopens</span>';
    else btn=(s==='reviewed'?'':'<button class="chip" data-act="am-review" data-m="'+m+'">Mark reviewed</button> ')+'<button class="chip" data-act="am-lock" data-m="'+m+'">Lock</button>';
    return '<tr><td><b>'+esc(monthLabel(m))+'</b></td><td>'+stPill(s)+(by.by?'<div class="note">'+esc(String(by.by).split('@')[0])+' · '+esc(String(by.at||'').slice(0,10))+'</div>':'')+'</td>'+
      '<td class="r num">'+(l?l.lines:'…')+'</td><td class="r num">'+(open?'<span style="color:var(--warn)">'+open+'</span>':open)+'</td>'+
      '<td class="r num">'+(l?fmt(l.bank_net):'…')+'</td><td class="r num">'+(l?fmt(l.books_net):'…')+'</td>'+
      '<td class="r num" style="color:'+(diff!=null&&Math.abs(diff)>1?'var(--warn)':'inherit')+'">'+(diff==null?'…':fmt(diff))+'</td><td>'+btn+'</td></tr>';
  }).join('');
  return '<p class="note" style="margin-bottom:12px">Reviewed means the accountant has looked. Locked months cannot be edited by anyone until the admin reopens them. Bank movement is money in minus money out on the imported statement lines; books movement is what the entries say was paid in that month. They should be close.</p>'+
    (lib&&lib.error?'<div class="banner">'+esc(lib.error)+'</div>':'')+
    '<div class="tablewrap"><table class="etbl"><thead><tr><th>Month</th><th>Status</th><th class="r">Bank lines</th><th class="r">Not posted</th><th class="r">Bank movement</th><th class="r">Books movement</th><th class="r">Difference</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="8" class="empty">No months yet.</td></tr>')+'</tbody></table></div>';
}
function aStatements(){
  var lib=state.lib;
  if(!lib) return '<p class="note">Loading…</p>';
  if(lib.error) return '<div class="banner">'+esc(lib.error)+'</div>';
  var rows=lib.statements.map(function(s){
    var c=s.counts||{}, n=Object.keys(c).map(function(k){return c[k]+' '+k;}).join(', ');
    var link=s.file_url?'<a class="dl" href="'+esc(s.file_url)+'" target="_blank" rel="noopener"><span class="tag info">Open PDF</span></a>':'';
    return '<tr><td><b>'+esc(s.id)+'</b></td><td>'+dshort(s.from)+' to '+dshort(s.to)+' '+esc(String(s.to).slice(0,4))+'</td><td class="r num">'+fmt2(s.opening)+'</td><td class="r num">'+fmt2(s.closing)+'</td><td>'+esc(n)+(s.gap?'<div class="note" style="color:var(--warn)">'+esc(s.gap)+'</div>':'')+'</td><td>'+link+'</td></tr>';
  }).join('');
  return '<div class="tablewrap"><table class="etbl"><thead><tr><th>Statement</th><th>Period</th><th class="r">Opening</th><th class="r">Closing</th><th>Lines</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" class="empty">No statements imported yet.</td></tr>')+'</tbody></table></div>';
}
function changeText(c){
  var o=jparse(c.old,{}), n=jparse(c.new,{});
  if(c.action==='adjust') return 'Added adjustment '+esc(c.entry_id);
  if(c.action==='split') return 'Split into '+(((n.ids||[]).length)+1)+' parts ('+esc([c.entry_id].concat(n.ids||[]).join(', '))+')';
  return Object.keys(n).map(function(k){return esc(k.replace('_',' '))+': '+esc(o[k]===''||o[k]==null?'(blank)':o[k])+' → '+esc(n[k]===''?'(blank)':n[k]);}).join('<br>');
}
function aChanges(){
  var admin=ROLE==='admin', list=DATA.changes||[];
  var rows=list.map(function(c){
    var act=c.undone?'<span class="pill mute">Undone</span>':(admin?'<button class="chip" data-act="ch-undo" data-id="'+esc(c.id)+'">Undo</button>':'');
    return '<tr><td class="wrap">'+esc(String(c.time).slice(0,16))+'<small>'+esc(String(c.by).split('@')[0])+'</small></td><td><b>'+esc(c.entry_id)+'</b><small>'+esc(c.action)+'</small></td><td class="wrap">'+changeText(c)+'</td><td class="wrap">'+esc(c.reason)+'</td><td>'+act+'</td></tr>';
  }).join('');
  return '<p class="note" style="margin-bottom:12px">Accountant changes apply straight away. Each one is listed here with the reason'+(admin?', and you can undo it with one click':'')+'.</p>'+
    '<div class="tablewrap"><table class="etbl"><thead><tr><th>When</th><th>Entry</th><th>What changed</th><th>Reason</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" class="empty">No accountant changes yet.</td></tr>')+'</tbody></table></div>';
}
var REPORTS=[['pnl','Profit and loss'],['tb','Trial balance'],['bs','Balance sheet (draft)'],['ledger','Ledger'],['wht','WHT schedule']];
function aExports(){
  var x=state.exp||(state.exp={type:'pnl',from:fyMonths()[0],to:curMonth(),account:'',res:null,err:'',busy:false});
  var ms=fyMonths(), opt=function(sel){return ms.map(function(m){return '<option value="'+m+'"'+(m===sel?' selected':'')+'>'+esc(monthLabel(m))+'</option>';}).join('');};
  var pointInTime=x.type==='tb'||x.type==='bs';
  var accs=DATA.accounts.slice().sort(function(a,b){return String(a.code).localeCompare(String(b.code));});
  var res=x.res?'<div class="panel" style="margin-top:14px"><b>'+esc(x.res.title)+'</b><div class="btnrow" style="margin-top:10px"><a class="btn primary" href="'+esc(x.res.sheet)+'" target="_blank" rel="noopener">Open in Google Sheets</a><a class="btn" href="'+esc(x.res.xlsx)+'" target="_blank" rel="noopener">Download Excel</a><a class="btn" href="'+esc(x.res.pdf)+'" target="_blank" rel="noopener">Download PDF</a></div><div class="note" style="margin-top:8px">A copy is saved in Drive under Offset Books / FY / Exports.</div></div>':'';
  return '<p class="note" style="margin-bottom:12px">Each report is built as a new Google Sheet, so the accountant can open it, change it, or download it as Excel or PDF. The balance sheet and trial balance are drafts built from the app\'s records, with a balancing line for whatever the records cannot explain yet.</p>'+
    '<div class="panel"><div class="frow"><div class="fld"><label for="x-type">Report</label><select class="f" id="x-type" data-x="type">'+REPORTS.map(function(r){return '<option value="'+r[0]+'"'+(r[0]===x.type?' selected':'')+'>'+r[1]+'</option>';}).join('')+'</select></div>'+
    (pointInTime?'':'<div class="fld"><label for="x-from">From</label><select class="f" id="x-from" data-x="from">'+opt(x.from)+'</select></div>')+
    '<div class="fld"><label for="x-to">'+(pointInTime?'As at end of':'To')+'</label><select class="f" id="x-to" data-x="to">'+opt(x.to)+'</select></div>'+
    (x.type==='ledger'?'<div class="fld"><label for="x-acc">Account</label><select class="f" id="x-acc" data-x="account"><option value="">All accounts</option>'+accs.map(function(a){return '<option value="'+esc(a.code)+'"'+(String(a.code)===x.account?' selected':'')+'>'+esc(a.code+' '+a.name)+'</option>';}).join('')+'</select></div>':'')+'</div>'+
    (x.err?'<div class="banner">'+esc(x.err)+'</div>':'')+
    '<div class="btnrow"><button class="btn primary" data-act="x-build"'+(x.busy?' disabled':'')+'>'+(x.busy?'Building…':'Build report')+'</button></div></div>'+res;
}
function aWht(){
  var ms=fyMonths(), rows=whtRows(ms[0],ms[11]), tot=0;
  var KIND={'WHT due':'late','Near the limit':'warn','Below':'mute','Company':'mute'};
  var body=rows.map(function(r){tot+=r.wht;return '<tr><td>'+esc(monthLabel(r.month))+'</td><td><b>'+esc(r.payee)+'</b></td><td class="r num">'+r.count+'</td><td class="r num">'+fmt(r.paid)+'</td><td><span class="pill '+KIND[r.status]+'">'+esc(r.status==='Company'?'Company, no WHT':r.status)+'</span></td><td class="r num">'+(r.wht?fmt(r.wht):'')+'</td></tr>';}).join('');
  return '<p class="note" style="margin-bottom:12px">WHT is '+Math.round((num(DATA.settings.wht_rate)||0.05)*100)+'% of the full amount once one person is paid more than LKR '+fmt(DATA.settings.wht_threshold||100000)+' in a month. A warning shows from LKR '+fmt(DATA.settings.wht_alert||80000)+'. Companies (Pvt, Ltd) are left out. Counted on the date each payment was made.</p>'+
    '<div class="tablewrap"><table class="etbl"><thead><tr><th>Month</th><th>Paid to</th><th class="r">Payments</th><th class="r">Paid in the month</th><th>Status</th><th class="r">WHT due</th></tr></thead><tbody>'+(body||'<tr><td colspan="6" class="empty">No payments to individuals yet.</td></tr>')+
    (tot?'<tr><td colspan="5" class="r"><b>Total WHT due</b></td><td class="r num"><b>'+fmt(tot)+'</b></td></tr>':'')+'</tbody></table></div>';
}

/* ----- accountant entry form: reclassify, split, adjust ----- */
function acctOptions(kind,sel){
  return DATA.accounts.filter(function(a){var t=String(a.type);return kind==='cost'?t!=='Revenue':(t==='Revenue'||t==='Liability');})
    .sort(function(a,b){return String(a.code).localeCompare(String(b.code));})
    .map(function(a){return '<option value="'+esc(a.code)+'"'+(String(a.code)===String(sel)?' selected':'')+'>'+esc(a.code+' '+a.name)+'</option>';}).join('');
}
function projOptions(sel){return '<option value="">Overhead (no project)</option>'+DATA.projects.slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name));}).map(function(p){return '<option value="'+esc(p.id)+'"'+(p.id===sel?' selected':'')+'>'+esc(p.name)+'</option>';}).join('');}
function typeOptions(sel){return String(DATA.settings.cost_types||'').split('|').filter(String).map(function(t){return '<option'+(t===sel?' selected':'')+'>'+esc(t)+'</option>';}).join('');}
function openAcct(e){
  var m={kind:'acct',id:e.id,e:e,mode:'edit',np:2,reason:'',f_account:String(e.account),f_project:e.project||'',f_cost_type:e.cost_type||'',f_payee:e.payee||'',f_description:e.description||'',f_business_line:e.business_line||'',
    p0_amount:'',p0_account:String(e.account),p0_project:e.project||'',p0_cost_type:e.cost_type||'',p0_description:e.description||'',p1_amount:'',p1_account:String(e.account),p1_project:e.project||'',p1_cost_type:e.cost_type||'',p1_description:''};
  openModal(m);
}
function acctBody(m){
  var e=m.e, locked=lockedDate(e.date), inv=e.kind==='income'&&invNo(e)&&findDoc('invoice',invNo(e));
  var top='<h2>'+esc(e.id)+' · '+esc(e.payee)+'</h2><div class="note">'+dshort(e.date)+' · LKR '+fmt2(e.amount)+' · '+esc(e.kind==='income'?'Income':(e.cost_type||'Cost'))+(e.doc_url?' · <a class="link" href="'+esc(e.doc_url)+'" target="_blank" rel="noopener">Open document</a>':'')+'</div>'+
    (locked?'<div class="banner">This month is locked. The admin has to reopen it first.</div>':'')+
    '<div class="filters" style="margin-top:12px"><button class="chip '+(m.mode==='edit'?'on':'')+'" data-act="ac-mode" data-v="edit">Reclassify</button>'+(inv?'':'<button class="chip '+(m.mode==='split'?'on':'')+'" data-act="ac-mode" data-v="split">Split</button>')+'</div>';
  var body='';
  if(m.mode==='edit'){
    body='<div class="frow"><div class="fld"><label for="a-acc">Books account</label><select class="f" id="a-acc" data-m="f_account">'+acctOptions(e.kind,m.f_account)+'</select></div>'+
      '<div class="fld"><label for="a-proj">Project</label><select class="f" id="a-proj" data-m="f_project">'+projOptions(m.f_project)+'</select></div></div>'+
      (e.kind==='cost'?'<div class="frow"><div class="fld"><label for="a-ct">Cost type</label><select class="f" id="a-ct" data-m="f_cost_type">'+typeOptions(m.f_cost_type)+'</select></div>':'<div class="frow">')+
      '<div class="fld"><label for="a-bl">Business line</label><select class="f" id="a-bl" data-m="f_business_line"><option'+(m.f_business_line!=='AI data'?' selected':'')+'>Production</option><option'+(m.f_business_line==='AI data'?' selected':'')+'>AI data</option></select></div></div>'+
      '<div class="frow"><div class="fld"><label for="a-payee">'+(e.kind==='income'?'Paid by':'Paid to')+'</label><input class="f" id="a-payee" data-m="f_payee" value="'+esc(m.f_payee)+'"'+(inv?' disabled':'')+'></div>'+
      '<div class="fld"><label for="a-desc">Description</label><input class="f" id="a-desc" data-m="f_description" value="'+esc(m.f_description)+'"'+(inv?' disabled':'')+'></div></div>';
  } else {
    var sum=0, parts='';
    for(var i=0;i<m.np;i++){
      sum+=(pnum(m['p'+i+'_amount'])||0);
      parts+='<div class="panel" style="margin-bottom:10px;padding:12px"><div class="mono" style="margin-bottom:6px">Part '+(i+1)+(i===0?' (keeps '+esc(e.id)+')':'')+'</div><div class="frow"><div class="fld"><label>Amount</label><input class="f" inputmode="decimal" data-m="p'+i+'_amount" value="'+esc(m['p'+i+'_amount'])+'"></div>'+
        '<div class="fld"><label>Books account</label><select class="f" data-m="p'+i+'_account">'+acctOptions(e.kind,m['p'+i+'_account'])+'</select></div></div>'+
        '<div class="frow"><div class="fld"><label>Project</label><select class="f" data-m="p'+i+'_project">'+projOptions(m['p'+i+'_project'])+'</select></div>'+
        (e.kind==='cost'?'<div class="fld"><label>Cost type</label><select class="f" data-m="p'+i+'_cost_type">'+typeOptions(m['p'+i+'_cost_type'])+'</select></div>':'')+'</div>'+
        '<div class="fld"><label>Description</label><input class="f" data-m="p'+i+'_description" value="'+esc(m['p'+i+'_description'])+'"></div></div>';
    }
    var left=Math.round((num(e.amount)-sum)*100)/100;
    body='<div class="note">Split this entry into parts that add up to LKR '+fmt2(e.amount)+'. Payment status is carried over.</div><div style="margin-top:10px">'+parts+'</div>'+
      '<div class="note">Left to assign: <b class="num" style="color:'+(Math.abs(left)<0.01?'var(--pill-good)':'var(--warn)')+'">LKR '+fmt2(left)+'</b></div>'+
      (m.np<8?'<div class="btnrow"><button class="btn" data-act="ac-addpart">Add a part</button>'+(m.np>2?'<button class="btn" data-act="ac-rmpart">Remove last part</button>':'')+'</div>':'');
  }
  return top+body+'<div class="fld" style="margin-top:12px"><label for="a-reason">Reason (required)</label><input class="f" id="a-reason" data-m="reason" value="'+esc(m.reason)+'" placeholder="Why this change is being made"></div>'+
    '<div class="btnrow"><button class="btn primary" data-act="ac-save"'+(locked?' disabled':'')+'>'+(m.mode==='split'?'Split entry':'Save change')+'</button><button class="btn" data-act="m-close">Cancel</button></div>';
}
function acctSave(){
  var m=state.modal, e=m.e;
  if(String(m.reason||'').trim().length<3){toast('Write a short reason for this change.');return;}
  if(m.mode==='edit'){
    var patch={}; ['account','project','cost_type','payee','description','business_line'].forEach(function(f){var v=m['f_'+f];if(v!==undefined&&String(v)!==String(e[f]==null?'':e[f])) patch[f]=v;});
    if(!Object.keys(patch).length){toast('Nothing was changed.');return;}
    call('reclassifyEntry',[e.id,patch,m.reason],function(){closeModal();go(state.view);},'Change saved');
  } else {
    var parts=[],sum=0;
    for(var i=0;i<m.np;i++){var a=pnum(m['p'+i+'_amount']);if(!(a>0)){toast('Part '+(i+1)+' needs an amount.');return;}sum+=a;
      parts.push({amount:a,account:m['p'+i+'_account'],project:m['p'+i+'_project'],cost_type:m['p'+i+'_cost_type'],description:m['p'+i+'_description']});}
    if(Math.abs(sum-num(e.amount))>0.01){toast('The parts add up to '+fmt2(sum)+' but the entry is '+fmt2(e.amount)+'.');return;}
    call('splitEntry',[e.id,parts,m.reason],function(){closeModal();reloadData(function(){go(state.view);});},'Entry split');
  }
}
function openAdj(){
  openModal({kind:'adj',a_kind:'cost',a_date:TODAY,a_amount:'',a_payee:'',a_account:'',a_project:'',a_cost_type:String(DATA.settings.cost_types||'Other').split('|')[0],a_description:'',a_status:'unpaid',reason:''});
}
function adjBody(m){
  var cost=m.a_kind==='cost';
  return '<h2>Add an adjustment</h2><div class="note">A correcting entry, for example a month-end accrual or a missed cost. It is marked as an adjustment and listed under Changes.</div>'+
    '<div class="filters" style="margin-top:12px"><button class="chip '+(cost?'on':'')+'" data-act="ad-kind" data-v="cost">Cost</button><button class="chip '+(!cost?'on':'')+'" data-act="ad-kind" data-v="income">Income</button></div>'+
    '<div class="frow"><div class="fld"><label for="ad-date">Date</label><input class="f" type="date" id="ad-date" data-m="a_date" value="'+esc(m.a_date)+'"></div><div class="fld"><label for="ad-amt">Amount (LKR)</label><input class="f" inputmode="decimal" id="ad-amt" data-m="a_amount" value="'+esc(m.a_amount)+'"></div></div>'+
    '<div class="frow"><div class="fld"><label for="ad-payee">'+(cost?'Paid to':'Paid by')+'</label><input class="f" id="ad-payee" data-m="a_payee" value="'+esc(m.a_payee)+'"></div><div class="fld"><label for="ad-acc">Books account</label><select class="f" id="ad-acc" data-m="a_account"><option value="">Choose automatically</option>'+acctOptions(m.a_kind,m.a_account)+'</select></div></div>'+
    '<div class="frow"><div class="fld"><label for="ad-proj">Project</label><select class="f" id="ad-proj" data-m="a_project">'+projOptions(m.a_project)+'</select></div>'+(cost?'<div class="fld"><label for="ad-ct">Cost type</label><select class="f" id="ad-ct" data-m="a_cost_type">'+typeOptions(m.a_cost_type)+'</select></div>':'')+'</div>'+
    '<div class="fld"><label for="ad-desc">Description</label><input class="f" id="ad-desc" data-m="a_description" value="'+esc(m.a_description)+'"></div>'+
    '<div class="fld"><label for="ad-reason">Reason (required)</label><input class="f" id="ad-reason" data-m="reason" value="'+esc(m.reason)+'"></div>'+
    '<div class="btnrow"><button class="btn primary" data-act="ad-save">Add adjustment</button><button class="btn" data-act="m-close">Cancel</button></div>';
}
function adjSave(){
  var m=state.modal;
  if(String(m.reason||'').trim().length<3){toast('Write a short reason for this adjustment.');return;}
  var o={kind:m.a_kind,date:m.a_date,amount:m.a_amount,payee:m.a_payee,account:m.a_account,project:m.a_project,cost_type:m.a_kind==='cost'?m.a_cost_type:'',description:m.a_description,paid_status:'unpaid'};
  call('addAdjustment',[o,m.reason],function(){closeModal();go(state.view);},'Adjustment added');
}

/* ----- recurring bills form ----- */
function openRec(name){
  var r=name?(DATA.recurring||[]).filter(function(x){return x.name===name;})[0]:null;
  openModal({kind:'rec',old:r?r.name:'',r_name:r?r.name:'',r_amount:r&&r.amount!==''?String(r.amount):'',r_day:r?String(r.day):'1',r_colour:(r&&r.colour)||'#2B4BFF'});
}
var BILL_COLOURS=['#2B4BFF','#7838FF','#FF2E8A','#19C2C2','#3DDC97','#FFC067','#FF7A59','#8FA2FF'];
function recBody(m){
  return '<h2>'+(m.old?'Edit recurring bill':'Add a recurring bill')+'</h2><div class="note">Shows on the Payments calendar every month on this day.</div>'+
    '<div class="fld"><label for="r-name">Name</label><input class="f" id="r-name" data-m="r_name" value="'+esc(m.r_name)+'"></div>'+
    '<div class="frow"><div class="fld"><label for="r-amt">Usual amount (optional)</label><input class="f" inputmode="decimal" id="r-amt" data-m="r_amount" value="'+esc(m.r_amount)+'"></div><div class="fld"><label for="r-day">Day of the month</label><input class="f" inputmode="numeric" id="r-day" data-m="r_day" value="'+esc(m.r_day)+'"></div>'+
    '</div><div class="fld"><label>Colour</label><div class="swatches">'+BILL_COLOURS.map(function(c){return '<button type="button" class="sw'+(String(m.r_colour).toLowerCase()===c.toLowerCase()?' on':'')+'" style="background:'+c+'" data-act="rec-col" data-v="'+c+'" aria-label="Colour '+c+'"></button>';}).join('')+'</div></div>'+
    '<div class="btnrow"><button class="btn primary" data-act="rec-save">Save</button>'+(m.old?'<button class="btn" data-act="rec-del">Delete</button>':'')+'<button class="btn" data-act="m-close">Cancel</button></div>';
}

/* ----- Payments calendar ----- */
function payEvents(ym){
  var ev={}, y=+ym.slice(0,4), mth=+ym.slice(5,7), dim=new Date(y,mth,0).getDate();
  function add(day,o){(ev[day]=ev[day]||[]).push(o);}
  (DATA.recurring||[]).forEach(function(r){var d=Math.min(dim,Math.max(1,num(r.day)));if(!r.name||!num(r.day)) return;add(d,{t:r.name+(num(r.amount)?' · '+fmt(r.amount):''),c:r.colour||'#2B4BFF'});});
  [[8,15,'Tax instalment'],[11,15,'Tax instalment'],[2,15,'Tax instalment'],[5,15,'Tax instalment'],[9,30,'Final tax payment'],[11,30,'Tax return due']].forEach(function(t){if(t[0]===mth) add(t[1],{t:t[2],c:'#E8A33D'});});
  (DATA.invoices||[]).forEach(function(i){
    if(!i.due||String(i.due).slice(0,7)!==ym||i.status==='paid'||i.status==='draft') return;
    var b=invBal(i); if(b<=0.005) return;
    add(+String(i.due).slice(8,10),{t:shortClient(i.client)+' owes '+fmt(b),c:'#2FBF8F'});
  });
  return ev;
}
function vPay(){
  var ym=state.pmonth||TODAY.slice(0,7), y=+ym.slice(0,4), mth=+ym.slice(5,7), dim=new Date(y,mth,0).getDate(), first=(new Date(y,mth-1,1).getDay()+6)%7, ev=payEvents(ym), admin=ROLE==='admin';
  var cells='', i, d;
  for(i=0;i<first;i++) cells+='<div class="pcell off"></div>';
  for(d=1;d<=dim;d++){
    var iso=ym+'-'+pad(d), list=ev[d]||[];
    cells+='<div class="pcell'+(iso===TODAY?' today':'')+'"><span class="pd">'+d+'</span>'+list.map(function(o){return '<span class="pev" style="border-left-color:'+esc(o.c)+'" title="'+esc(o.t)+'">'+esc(o.t)+'</span>';}).join('')+'</div>';
  }
  var prev=(mth===1?(y-1)+'-12':y+'-'+pad(mth-1)), next=(mth===12?(y+1)+'-01':y+'-'+pad(mth+1));
  var rec=(DATA.recurring||[]).slice().sort(function(a,b){return num(a.day)-num(b.day);}).map(function(r){
    return '<tr><td><span class="dot" style="background:'+esc(r.colour||'#2B4BFF')+'"></span> <b>'+esc(r.name)+'</b></td><td class="r num">'+(num(r.amount)?fmt(r.amount):'-')+'</td><td class="r num">'+esc(r.day)+'</td><td>'+(admin?'<button class="chip" data-act="rec-edit" data-n="'+esc(r.name)+'">Edit</button>':'')+'</td></tr>';
  }).join('');
  var unpaid=DATA.entries.filter(function(e){return e.kind==='cost'&&e.paid_status!=='paid'&&String(e.account)!=='1400'&&num(e.amount)-paidOf(e)>0.005;}).sort(function(a,b){return String(a.date).localeCompare(String(b.date));});
  var uTot=0, urows=unpaid.slice(0,30).map(function(e){var o=num(e.amount)-paidOf(e);return '<tr><td>'+dshort(e.date)+'</td><td class="name"><b>'+esc(e.payee)+'</b><small>'+esc(e.description||'')+'</small></td><td class="r num amt">'+fmt(o)+'</td></tr>';}).join('');
  unpaid.forEach(function(e){uTot+=num(e.amount)-paidOf(e);});
  return '<div class="head"><div><span class="mono">Money going out and coming in</span><h1>Payments</h1></div></div>'+spendPanel(false)+'<div style="height:14px"></div>'+
    '<div class="filters"><button class="chip" data-pm="'+prev+'">‹ '+esc(monthLabel(prev))+'</button><b style="padding:0 8px">'+esc(monthLabel(ym))+'</b><button class="chip" data-pm="'+next+'">'+esc(monthLabel(next))+' ›</button><button class="chip" data-pm="'+TODAY.slice(0,7)+'">Today</button></div>'+
    '<div class="pgrid">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(n){return '<div class="phd">'+n+'</div>';}).join('')+cells+'</div>'+
    '<p class="note" style="margin-top:8px"><span class="dot" style="background:#E8A33D"></span> tax dates &nbsp; <span class="dot" style="background:#2FBF8F"></span> invoices due from clients</p>'+
    '<div class="grid g2" style="margin-top:18px"><div class="sec" style="margin-top:0"><h3>Monthly bills</h3><div class="tablewrap"><table class="etbl"><thead><tr><th>Bill</th><th class="r">Usual amount</th><th class="r">Day</th><th></th></tr></thead><tbody>'+(rec||'<tr><td colspan="4" class="empty">None yet.</td></tr>')+'</tbody></table></div>'+(admin?'<div class="btnrow" style="margin-top:10px"><button class="btn" data-act="rec-new">Add a monthly bill</button></div>':'')+'</div>'+
    '<div class="sec" style="margin-top:0"><h3>Costs not paid yet · LKR '+fmt(uTot)+'</h3><div class="tablewrap"><table class="etbl"><thead><tr><th>Date</th><th>Paid to</th><th class="r">Owed</th></tr></thead><tbody>'+(urows||'<tr><td colspan="3" class="empty">Everything is paid.</td></tr>')+'</tbody></table></div></div></div>';
}

/* ----- actions for session 6 ----- */
function doAct6(act,el){
  var attr=function(k){return el&&el.getAttribute?el.getAttribute(k):null;}, m=state.modal;
  if(!/^(am-|m-lock|m-reopen|ch-|m-ch-|x-build|ac-|new-adj|ad-|rec-|m-reopen)/.test(act)) return false;
  switch(act){
    case 'am-review': call('setMonthStatus',[attr('data-m'),'review',''],function(){state.lib=null;go('acct');},'Marked as reviewed'); break;
    case 'am-lock': lockMonth(attr('data-m'),false); break;
    case 'm-lock-force': lockMonth(m.ym,true); break;
    case 'am-reopen': openModal({kind:'confirm',title:'Reopen '+monthLabel(attr('data-m'))+'?',text:'Entries in this month can be edited again. Lock it again when the changes are done.',ok:'Reopen',okAct:'m-reopen'}); state.modal.ym=attr('data-m'); break;
    case 'm-reopen': var ym=state.modal.ym; call('setMonthStatus',[ym,'reopen',''],function(){closeModal();state.lib=null;go('acct');},'Month reopened'); break;
    case 'ch-undo': state.undoId=attr('data-id'); openModal({kind:'confirm',title:'Undo change '+state.undoId+'?',text:'The entry goes back to how it was before the accountant changed it. A split is joined back together.',ok:'Undo change',okAct:'m-ch-undo'}); break;
    case 'm-ch-undo': call('undoChange',[state.undoId],function(){closeModal();reloadData(function(){go('acct');});},'Change undone'); break;
    case 'x-build':
      var x=state.exp; if(x.busy) return;
      x.busy=true;x.err='';x.res=null;toast('Building the report…',true,true);go('acct');
      google.script.run.withSuccessHandler(function(r){x.busy=false;x.res=r;toast('Report ready',true);if(state.view==='acct') go('acct');})
        .withFailureHandler(function(e){x.busy=false;x.err=(e&&e.message)||String(e);toast(x.err);if(state.view==='acct') go('acct');}).exportReport(x.type,{from:x.from,to:x.to,account:x.account});
      break;
    case 'ac-mode': if(m){m.mode=attr('data-v');renderModal();} break;
    case 'ac-addpart': if(m&&m.np<8){var k=m.np;m['p'+k+'_amount']='';m['p'+k+'_account']=m.f_account;m['p'+k+'_project']=m.f_project;m['p'+k+'_cost_type']=m.f_cost_type;m['p'+k+'_description']='';m.np++;renderModal();} break;
    case 'ac-rmpart': if(m&&m.np>2){m.np--;renderModal();} break;
    case 'ac-save': acctSave(); break;
    case 'new-adj': openAdj(); break;
    case 'ad-kind': if(m){m.a_kind=attr('data-v');m.a_account='';renderModal();} break;
    case 'ad-save': adjSave(); break;
    case 'rec-col': if(m){m.r_colour=attr('data-v');renderModal();} break;
    case 'rec-new': openRec(''); break;
    case 'rec-edit': openRec(attr('data-n')); break;
    case 'rec-save':
      if(!String(m.r_name||'').trim()){toast('Enter a name.');return;}
      call('saveRecurring',[{name:m.r_name,amount:m.r_amount,day:m.r_day,colour:m.r_colour},m.old||''],function(){closeModal();go('pay');},'Saved'); break;
    case 'rec-del': var nm=m.old; call('deleteRecurring',[nm],function(){closeModal();go('pay');},'Removed'); break;
  }
  return true;
}
function lockMonth(ym,force){
  if(busy) return; busy=true; toast('Working…',true,true);
  google.script.run.withSuccessHandler(function(res){busy=false;mergeRes(res);closeModal();state.lib=null;toast('Month locked',true);go('acct');})
    .withFailureHandler(function(err){
      busy=false; var msg=(err&&err.message)||String(err), i=msg.indexOf('OPEN:');
      if(i>=0){toast('Check first',true);openModal({kind:'confirm',title:'Lock '+monthLabel(ym)+' anyway?',text:msg.slice(i+5).trim()+' Locking now means those cannot be posted into this month until it is reopened.',ok:'Lock anyway',okAct:'m-lock-force',ym:ym});}
      else toast(msg);
    }).setMonthStatus(ym,'lock','',!!force);
}


/* ---------- custom dropdown (replaces the plain browser list) ---------- */
(function(){
  var dd=null, cur=null, items=[], hi=-1;
  function close(){ if(dd){dd.remove();dd=null;} cur=null; document.removeEventListener('mousedown',outside,true); window.removeEventListener('scroll',onScroll,true); window.removeEventListener('resize',close); }
  function outside(e){ if(dd&&!dd.contains(e.target)) close(); }
  function onScroll(e){ if(dd&&!dd.contains(e.target)) close(); }
  function pick(i){
    var sel=cur; if(!sel||!items[i]) return;
    var o=items[i]; if(o.disabled) return;
    var changed=sel.selectedIndex!==o.idx;
    sel.selectedIndex=o.idx; close(); sel.focus();
    if(changed) sel.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function setHi(n,scroll){
    var rows=dd.querySelectorAll('.ddo'); if(!rows.length) return;
    n=Math.max(0,Math.min(rows.length-1,n)); hi=n;
    for(var i=0;i<rows.length;i++) rows[i].classList.toggle('hi',i===n);
    if(scroll!==false){var r=rows[n],l=dd.querySelector('.ddl'); if(r.offsetTop<l.scrollTop) l.scrollTop=r.offsetTop-4; else if(r.offsetTop+r.offsetHeight>l.scrollTop+l.clientHeight) l.scrollTop=r.offsetTop+r.offsetHeight-l.clientHeight+4;}
  }
  function build(filter){
    var l=dd.querySelector('.ddl'), q=String(filter||'').toLowerCase(), h='', k=0, vis=[];
    items.forEach(function(o,i){ if(q&&o.text.toLowerCase().indexOf(q)<0) return; vis.push(i);
      h+='<div class="ddo'+(o.idx===cur.selectedIndex?' sel':'')+(o.ph?' ph':'')+'" data-i="'+i+'">'+esc(o.text)+'</div>'; });
    l.innerHTML=h||'<div class="ddn">No matches</div>';
    var start=0; vis.forEach(function(i,n){ if(items[i].idx===cur.selectedIndex) start=n; });
    setHi(q?0:start);
  }
  function open(sel){
    if(sel.disabled) return; close(); cur=sel;
    items=[].map.call(sel.options,function(o,i){return {idx:i,text:o.text,ph:o.value===''&&i===0,disabled:o.disabled};});
    dd=document.createElement('div'); dd.className='dd';
    dd.innerHTML=(items.length>9?'<input class="dds" placeholder="Search" aria-label="Search">':'')+'<div class="ddl"></div>';
    document.body.appendChild(dd);
    var r=sel.getBoundingClientRect(), vh=window.innerHeight, rows=Math.min(items.length,9), want=rows*38+14+(items.length>9?44:0);
    var below=vh-r.bottom-12, above=r.top-12, up=below<Math.min(want,260)&&above>below, mh=Math.max(140,Math.min(360,up?above:below));
    dd.style.minWidth=Math.max(r.width,180)+'px'; dd.style.maxWidth=Math.min(420,window.innerWidth-24)+'px';
    dd.querySelector('.ddl').style.maxHeight=(mh-(items.length>9?52:12))+'px';
    var left=Math.min(Math.max(12,r.left),window.innerWidth-dd.offsetWidth-12); dd.style.left=left+'px';
    if(up) dd.style.bottom=(vh-r.top+6)+'px'; else dd.style.top=(r.bottom+6)+'px';
    build('');
    var s=dd.querySelector('.dds'); if(s&&window.innerWidth>700) s.focus();
    dd.addEventListener('mousedown',function(e){e.preventDefault();});
    dd.addEventListener('click',function(e){var o=e.target.closest('.ddo'); if(o) pick(+o.getAttribute('data-i'));});
    dd.addEventListener('mousemove',function(e){var o=e.target.closest('.ddo'); if(o){var rows=[].slice.call(dd.querySelectorAll('.ddo')); setHi(rows.indexOf(o),false);}});
    if(s) s.addEventListener('input',function(){build(s.value);});
    document.addEventListener('mousedown',outside,true); window.addEventListener('scroll',onScroll,true); window.addEventListener('resize',close);
  }
  document.addEventListener('mousedown',function(e){
    var sel=e.target.closest&&e.target.closest('select'); if(!sel||sel.multiple) return;
    e.preventDefault(); if(dd&&cur===sel){close();return;} open(sel);
  });
  document.addEventListener('keydown',function(e){
    if(dd){
      if(e.key==='Escape'){e.stopPropagation();e.preventDefault();var s0=cur;close();if(s0)s0.focus();return;}
      var rows=dd.querySelectorAll('.ddo');
      if(e.key==='ArrowDown'){e.preventDefault();setHi(hi+1);return;}
      if(e.key==='ArrowUp'){e.preventDefault();setHi(hi-1);return;}
      if(e.key==='Enter'){e.preventDefault();var r=rows[hi]; if(r) pick(+r.getAttribute('data-i')); return;}
      if(e.key==='Tab'){close();return;}
      return;
    }
    var t=e.target; if(t&&t.tagName==='SELECT'&&(e.key==='ArrowDown'||e.key===' '||e.key==='Enter')){e.preventDefault();e.stopPropagation();open(t);}
  },true);
})();

/* ---------- session 7: vendors, spending room, project budget sheets ---------- */
function vendorList(){
  var map={};
  DATA.entries.forEach(function(e){
    if(e.kind!=='cost'||String(e.account)==='1400') return;
    var nm=String(e.payee||'').trim()||'(no name)', k=nm.toLowerCase();
    var v=map[k]||(map[k]={name:nm,owed:0,paid:0,total:0,n:0,oldest:'',last:'',unpaidN:0});
    var a=num(e.amount), pd=paidOf(e), open=Math.max(0,a-pd);
    v.total+=a; v.paid+=pd; v.n++; v.owed+=open;
    if(open>0.005){v.unpaidN++; var d=String(e.date).slice(0,10); if(!v.oldest||d<v.oldest) v.oldest=d;}
    var ld=String(e.paid_date||e.date).slice(0,10); if(ld>v.last) v.last=ld;
  });
  return Object.keys(map).map(function(k){return map[k];});
}
function vVendors(){
  var sel=state.vsel, q=(state.vq||'').toLowerCase(), vf=state.vf||'all';
  var head='<div class="head"><div><span class="mono">Who we pay · LKR</span><h1>Vendors</h1></div></div>';
  if(sel){
    var v=vendorList().filter(function(x){return x.name.toLowerCase()===sel.toLowerCase();})[0];
    if(!v) {state.vsel='';return vVendors();}
    var recs=DATA.entries.filter(function(e){return e.kind==='cost'&&String(e.account)!=='1400'&&(String(e.payee||'').trim()||'(no name)').toLowerCase()===sel.toLowerCase();})
      .sort(function(a,b){return String(b.date).localeCompare(String(a.date));});
    var rows=recs.map(function(e){var pt=paidText(e),open=Math.max(0,num(e.amount)-paidOf(e));
      return '<tr class="click" data-eid="'+esc(e.id)+'" tabindex="0"><td>'+dshort(e.date)+' '+esc(String(e.date).slice(0,4))+'</td><td class="name"><b>'+esc(e.description||e.cost_type||'')+'</b><small>'+esc(e.cost_type||'')+(e.doc_number?' · '+esc(e.doc_number):'')+'</small></td>'+
        '<td class="wrap">'+(e.project?esc(projName(e.project)):'<span class="note">Overhead</span>')+'</td><td class="r num amt">'+fmt(e.amount)+'</td><td class="r num" style="color:'+(open>0.005?'var(--warn)':'var(--muted)')+'">'+(open>0.005?fmt(open):'-')+'</td><td style="color:'+pt.c+'">'+esc(pt.t)+'</td><td>'+docTag(e)+'</td></tr>';}).join('');
    return head+'<div class="filters"><button class="chip" data-act="v-back">‹ All vendors</button></div><h2 style="margin:4px 0 14px">'+esc(v.name)+'</h2>'+
      '<div class="grid g4">'+card('We owe them',lkr(v.owed),v.owed>0.005?'neg':'',v.unpaidN?v.unpaidN+(v.unpaidN===1?' unpaid bill':' unpaid bills'):'Nothing owed')+card('Paid so far',lkr(v.paid),'','Across '+v.n+(v.n===1?' record':' records'))+card('Total billed',lkr(v.total),'','')+card('Last activity',v.last?dshort(v.last)+' '+v.last.slice(0,4):'-','','')+'</div>'+
      '<div class="tablewrap"><table class="etbl"><thead><tr><th>Date</th><th>For</th><th>Project</th><th class="r">Amount</th><th class="r">Owed</th><th>Paid</th><th>Document</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<p class="note" style="margin-top:12px">Click a record to open it'+(ROLE==='admin'?', for example to mark it paid':'')+'.</p>';
  }
  var all=vendorList(), owedTot=0, owedN=0;
  all.forEach(function(v){if(v.owed>0.005){owedTot+=v.owed;owedN++;}});
  var list=all.filter(function(v){return (!q||v.name.toLowerCase().indexOf(q)>=0)&&(vf!=='owed'||v.owed>0.005);})
    .sort(function(a,b){return (b.owed>0.005)-(a.owed>0.005)||b.owed-a.owed||b.paid-a.paid;});
  var rows2=list.map(function(v){
    var age=v.oldest?daysFrom(v.oldest,TODAY):0;
    return '<tr class="click" data-vendor="'+esc(v.name)+'" tabindex="0"><td class="name"><b>'+esc(v.name)+'</b></td><td class="r num amt" style="color:'+(v.owed>0.005?'var(--warn)':'var(--muted)')+'">'+(v.owed>0.005?fmt(v.owed):'-')+'</td>'+
      '<td>'+(v.owed>0.005?'<span class="pill '+(age>30?'late':(age>14?'warn':'mute'))+'">'+(age<=0?'Today':age+' days')+'</span>':'')+'</td><td class="r num">'+fmt(v.paid)+'</td><td class="r num">'+v.n+'</td><td>'+(v.last?dshort(v.last)+' '+v.last.slice(0,4):'')+'</td></tr>';}).join('');
  return head+'<div class="grid g3">'+card('We owe vendors',lkr(owedTot),owedTot>0.005?'neg':'',owedN+(owedN===1?' vendor waiting':' vendors waiting'))+card('Vendors',String(all.length),'','Everyone we have paid or been billed by')+card('Paid to vendors',lkr(all.reduce(function(s,v){return s+v.paid;},0)),'','All time')+'</div>'+
    '<div class="filters"><button class="chip '+(vf==='all'?'on':'')+'" data-act="v-filter" data-v="all">All</button><button class="chip '+(vf==='owed'?'on':'')+'" data-act="v-filter" data-v="owed">We owe</button><input class="search" id="vsearch" placeholder="Search vendors" value="'+esc(state.vq||'')+'"></div>'+
    '<div class="tablewrap"><table class="etbl"><thead><tr><th>Vendor</th><th class="r">We owe</th><th>Oldest unpaid</th><th class="r">Paid so far</th><th class="r">Records</th><th>Last</th></tr></thead><tbody>'+(rows2||'<tr><td colspan="6" class="empty">No vendors match.</td></tr>')+'</tbody></table></div>';
}

/* ----- spending room ----- */
function spendRoom(){
  var S=DATA.settings, horizon=num(S.spend_horizon_days)||60, bufM=num(S.spend_buffer_months); if(!(bufM>=0)||S.spend_buffer_months===undefined) bufM=2;
  var cash=DATA.cash?num(DATA.cash.balance):null, end=addDays(TODAY,horizon);
  var recv=0, recvSoon=0, pay=0, inv=invoiceInfo(), fixed=0, bills=0, fyProfit=0, fy0=fyMonths()[0], fy1=fyMonths()[11];
  DATA.entries.forEach(function(e){
    var a=num(e.amount), d=String(e.date).slice(0,10);
    if(e.kind==='income'&&e.paid_status!=='paid'){var o=a-paidOf(e); if(o>0.005){recv+=o; var due=String((inv[invNo(e)]||{}).due||''); if(!due||due<=end) recvSoon+=o;}}
    if(e.kind==='cost'&&String(e.account)!=='1400'&&e.paid_status!=='paid'){var o2=a-paidOf(e); if(o2>0.005) pay+=o2;}
    if(d>=fy0+'-01'&&d<=TODAY&&String(e.account)!=='1400'){fyProfit+=(e.kind==='income'?a:-a);}
  });
  (DATA.recurring||[]).forEach(function(r){
    var amt=num(r.amount), day=num(r.day); if(!amt||!day) return; fixed+=amt;
    var y=+TODAY.slice(0,4), m=+TODAY.slice(5,7);
    for(var i=0;i<4;i++){var yy=y+Math.floor((m-1+i)/12), mm=((m-1+i)%12)+1, dd=Math.min(day,new Date(yy,mm,0).getDate()), iso=yy+'-'+pad(mm)+'-'+pad(dd); if(iso>=TODAY&&iso<=end) bills+=amt;}
  });
  var cm=TODAY.slice(0,7), wht=whtRows(cm,cm).reduce(function(s,r){return s+r.wht;},0);
  var tax=Math.max(0,fyProfit)*(num(S.tax_rate)||0.3), buffer=Math.round(fixed*bufM);
  var safe=cash==null?null:cash-pay-bills-wht-tax-buffer, withClients=safe==null?null:safe+recvSoon;
  return {cash:cash,asAt:DATA.cash&&DATA.cash.as_at,pay:pay,bills:bills,wht:wht,tax:tax,buffer:buffer,bufM:bufM,horizon:horizon,recv:recv,recvSoon:recvSoon,safe:safe,withClients:withClients};
}
function spendPanel(compact){
  if(ROLE!=='admin'&&ROLE!=='accountant') return '';
  var r=spendRoom();
  if(r.cash==null) return '<div class="panel" style="margin-bottom:14px"><span class="h2big">Spending room</span><div class="note">Import a bank statement on the Bank page and this will show how much you can safely spend on equipment.</div></div>';
  var big=function(v){return v>0?'LKR '+fmt(v):'None right now';};
  var line=function(l,v,sub,neg){return '<div class="lrow"><div class="l"><span>'+esc(l)+(sub?'<small style="display:block;color:var(--muted2)">'+esc(sub)+'</small>':'')+'</span></div><div class="r num" style="color:'+(neg?'var(--warn)':'inherit')+'">'+(neg?'- ':'')+fmt(v)+'</div></div>';};
  var head='<div class="ptitle"><span class="h2big">Spending room</span><span class="mono" style="color:var(--muted)">Bank as at '+esc(dshort(r.asAt))+'</span></div>'+
    '<div class="grid g2" style="margin:8px 0 4px"><div><span class="mono">Safe to spend now</span><div class="big num '+(r.safe>0?'':'neg')+'">'+esc(big(r.safe))+'</div><div class="note">Cash only, keeps the buffer and everything we owe covered.</div></div>'+
    '<div><span class="mono">If clients pay what is due</span><div class="big num '+(r.withClients>0?'':'neg')+'">'+esc(big(r.withClients))+'</div><div class="note">Adds LKR '+fmt(r.recvSoon)+' of invoices due in the next '+r.horizon+' days or overdue.</div></div></div>';
  if(compact) return '<div class="panel" style="margin-bottom:14px">'+head+'<a class="link" data-view="pay" tabindex="0">See how this is worked out</a></div>';
  return '<div class="panel">'+head+'<div style="margin-top:10px">'+line('Cash in the bank',r.cash,'Latest imported statement',false)+
    line('Owed to vendors',r.pay,'Unpaid costs',true)+line('Monthly bills, next '+r.horizon+' days',r.bills,'From the monthly bills list below',true)+
    line('Withholding tax this month',r.wht,'',true)+line('Income tax set aside',r.tax,'Estimate: '+Math.round((num(DATA.settings.tax_rate)||0.3)*100)+'% of profit this year to date',true)+
    line('Safety buffer',r.buffer,r.bufM+' months of monthly bills (change spend_buffer_months in Settings)',true)+
    '<div class="lrow strong"><div class="l"><b>Safe to spend now</b></div><div class="r num"><b>'+esc(r.safe>0?fmt(r.safe):'0')+'</b></div></div></div>'+
    '<p class="note" style="margin-top:10px">Money coming in is left out of the first figure on purpose. This is an estimate from what is in the app: it does not know about cash payments not yet entered or one-off bills not yet billed.</p></div>';
}

/* ----- project budget sheet ----- */
function budgetPanel(p,s){
  var admin=ROLE==='admin';
  if(!p.budget_url) return admin?'<div class="panel"><span class="h2big">Internal budget</span><div class="note">Optional. Creates a Google Sheet where you plan costs by category, separate from the client invoice. Actual spend fills in from this project\'s costs.</div><div class="btnrow" style="margin-top:10px"><button class="btn" data-act="pb-create" data-id="'+esc(p.id)+'">Add internal budget sheet</button></div></div>':'';
  var planned=num(p.budget_planned), spent=s.costs;
  return '<div class="panel"><span class="h2big">Internal budget</span>'+
    '<div class="trio" style="margin-top:8px"><div><span class="k">Planned</span><strong class="num">'+(planned?fmt(planned):'-')+'</strong></div><div><span class="k">Spent</span><strong class="num">'+fmt(spent)+'</strong></div><div><span class="k">Left</span><strong class="num '+(planned&&spent>planned?'neg':'')+'">'+(planned?fmt(planned-spent):'-')+'</strong></div></div>'+
    '<div class="btnrow" style="margin-top:10px"><a class="btn primary" href="'+esc(p.budget_url)+'" target="_blank" rel="noopener">Open budget sheet</a>'+(admin?'<button class="btn" data-act="pb-refresh" data-id="'+esc(p.id)+'">Refresh actuals</button>':'')+'</div>'+
    '<div class="note" style="margin-top:8px">Refresh copies the latest costs into the sheet and updates the planned total shown here.</div></div>';
}
function doAct7(act,el){
  var attr=function(k){return el&&el.getAttribute?el.getAttribute(k):null;};
  switch(act){
    case 'v-back': state.vsel=''; go('vendors'); break;
    case 'v-filter': state.vf=attr('data-v'); go('vendors'); break;
    case 'pj-new': openProj(''); break;
    case 'pj-edit': openProj(attr('data-id')); break;
    case 'pj-save': projSave(); break;
    case 'pb-create': call('createBudgetSheet',[attr('data-id')],function(){go('project');},'Budget sheet created'); break;
    case 'pb-refresh': call('refreshBudgetActuals',[attr('data-id')],function(r){go('project');toast('Budget refreshed: planned '+fmt(r.planned)+', spent '+fmt(r.actual),true);},'Refreshed'); break;
  }
}


/* ----- new / edit project ----- */
var PROJ_STATUSES=['Quoted','Confirmed','In production','Delivered','Closed','Cancelled'];
function openProj(id){
  var p=id?DATA.projects.filter(function(x){return x.id===id;})[0]:null;
  openModal({kind:'proj',id:id||'',p_name:p?p.name:'',p_client:p?p.client:'',p_newclient:'',p_line:(p&&p.business_line)||'Production',p_status:p?p.status:'Confirmed',p_budget:false});
}
function projBody(m){
  var clients=DATA.clients.map(function(c){return c.name;}).filter(String).sort(), isNew=m.p_client==='__new', ed=!!m.id;
  var copts='<option value="">Choose a client</option>'+clients.map(function(c){return '<option value="'+esc(c)+'"'+(c===m.p_client?' selected':'')+'>'+esc(c)+'</option>';}).join('')+'<option value="__new"'+(isNew?' selected':'')+'>New client…</option>';
  return '<h2>'+(ed?'Edit project':'New project')+'</h2>'+
    '<div class="fld"><label for="pj-name">Project name</label><input class="f" id="pj-name" data-m="p_name" value="'+esc(m.p_name)+'" placeholder="e.g. Mabroc product shoot"></div>'+
    '<div class="fld"><label for="pj-client">Client</label><select class="f" id="pj-client" data-m="p_client">'+copts+'</select>'+(isNew?'<input class="f" style="margin-top:8px" id="pj-nc" data-m="p_newclient" placeholder="Client name" value="'+esc(m.p_newclient)+'">':'')+'</div>'+
    '<div class="frow"><div class="fld"><label for="pj-status">Status</label><select class="f" id="pj-status" data-m="p_status">'+PROJ_STATUSES.map(function(s){return '<option'+(s===m.p_status?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>'+
    '<div class="fld"><label for="pj-line">Business line</label><select class="f" id="pj-line" data-m="p_line"><option'+(m.p_line!=='AI data'?' selected':'')+'>Production</option><option'+(m.p_line==='AI data'?' selected':'')+'>AI data</option></select></div></div>'+
    (ed?'':'<label class="chk"><input type="checkbox" data-m="p_budget"'+(m.p_budget?' checked':'')+'> Also create an internal budget sheet (optional)</label>')+
    '<div class="btnrow"><button class="btn primary" data-act="pj-save">'+(ed?'Save':'Create project')+'</button><button class="btn" data-act="m-close">Cancel</button></div>';
}
function projSave(){
  var m=state.modal, client=m.p_client==='__new'?String(m.p_newclient||'').trim():m.p_client;
  if(!String(m.p_name||'').trim()){toast('Enter a project name.');return;}
  if(!client){toast('Choose a client, or type a new client name.');return;}
  var wantBudget=!m.id&&m.p_budget;
  call('saveProject',[{id:m.id,name:m.p_name,client:client,status:m.p_status,business_line:m.p_line}],function(res){
    closeModal();
    if(res.project) {state.pid=res.project.id;}
    if(wantBudget&&res.project){busy=false;call('createBudgetSheet',[res.project.id],function(){go('project');},'Project and budget sheet created');}
    else go('project');
  },m.id?'Project saved':'Project created');
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var t=e.target;
  if(t.closest('a.dl')) return;
  var ac=t.closest('[data-act]'); if(ac){ if(!ac.disabled) doAct(ac.getAttribute('data-act'),ac); return; }
  var vd=t.closest('[data-vendor]'); if(vd){state.vsel=vd.getAttribute('data-vendor');go('vendors');return;}
  var at=t.closest('[data-atab]'); if(at){state.atab=at.getAttribute('data-atab');go('acct');return;}
  var pm=t.closest('[data-pm]'); if(pm){state.pmonth=pm.getAttribute('data-pm');go('pay');return;}
  var qfc=t.closest('[data-qf]'); if(qfc){state.qf=qfc.getAttribute('data-qf');go('entries');return;}
  var et=t.closest('[data-etab]'); if(et){state.etab=et.getAttribute('data-etab');go('entries');return;}
  var ef=t.closest('[data-ef]'); if(ef){state.ef=ef.getAttribute('data-ef');state.eshow=150;go('entries');return;}
  if(t.closest('[data-eshowall]')){state.eshow=100000;var sy=window.scrollY;go('entries');window.scrollTo(0,sy);return;}
  var gt=t.closest('[data-gotab]'); if(gt){state.etab=gt.getAttribute('data-gotab');go('entries');return;}
  var en=t.closest('[data-eid]'); if(en){ if(ROLE==='admin'||ROLE==='accountant') openEntry(en.getAttribute('data-eid')); return; }
  var dt=t.closest('[data-dtab]'); if(dt){state.dtab=dt.getAttribute('data-dtab');state.dfilter='All';go('docs');return;}
  var df=t.closest('[data-df]'); if(df){state.dfilter=df.getAttribute('data-df');go('docs');return;}
  var dd=t.closest('[data-doc]'); if(dd){var pr=dd.getAttribute('data-doc').split('|');openDoc(pr[0],pr[1]);return;}
  var ms=t.closest('[data-mshift]'); if(ms){ if(ms.disabled) return; var arr=fyMonths(), i=arr.indexOf(state.month)+Number(ms.getAttribute('data-mshift')); if(i>=0&&i<arr.length&&arr[i]<=curMonth()){state.month=arr[i];go('dashboard');} return; }
  var cm=t.closest('[data-month]'); if(cm){state.month=cm.getAttribute('data-month');go('dashboard');return;}
  var nav=t.closest('[data-view]'); if(nav){go(nav.getAttribute('data-view'));return;}
  if(t.id==='refresh'){refresh();return;}
  if(t.id==='syncbtn'){
    toast('Syncing…',true);
    google.script.run.withSuccessHandler(function(r){ if(DATA.mirror) DATA.mirror.last=r&&r.last||DATA.mirror.last; toast('Mirror synced',true); go(state.view); })
      .withFailureHandler(function(err){toast('Sync failed: '+(err&&err.message||err));}).syncMirrorNow();
    return;
  }
  var pf=t.closest('[data-pf]'); if(pf){state.pfilter=pf.getAttribute('data-pf');go('projects');return;}
  if(t.closest('[data-allcosts]')){state.allCosts=!state.allCosts;var y=window.scrollY;go('project');window.scrollTo(0,y);return;}
  var row=t.closest('[data-pid]'); if(row && row.tagName==='TR'){openProject(row.getAttribute('data-pid'));return;}
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&state.modal){closeModal();return;}
  if(e.key==='Enter'){
    var dd=e.target.closest&&e.target.closest('[data-doc]'); if(dd){var pr=dd.getAttribute('data-doc').split('|');openDoc(pr[0],pr[1]);return;}
    var en=e.target.closest&&e.target.closest('[data-eid]'); if(en&&en.tagName==='TR'){if(ROLE==='admin'||ROLE==='accountant') openEntry(en.getAttribute('data-eid'));return;}
    var gt=e.target.closest&&e.target.closest('[data-gotab]'); if(gt){state.etab=gt.getAttribute('data-gotab');go('entries');return;}
    var ac=e.target.closest&&e.target.closest('[data-act]'); if(ac&&ac.tagName!=='BUTTON'&&ac.tagName!=='A'){doAct(ac.getAttribute('data-act'),ac);return;}
    var r=e.target.closest&&e.target.closest('[data-pid]'); if(r&&r.tagName==='TR'){openProject(r.getAttribute('data-pid'));return;}
    var v=e.target.closest&&e.target.closest('[data-view]'); if(v){go(v.getAttribute('data-view'));}
  }
});
document.addEventListener('input',function(e){
  var t=e.target, ga=function(k){return t.getAttribute?t.getAttribute(k):null;};
  if(t.id==='psearch'){state.psearch=t.value;var pos=t.selectionStart;go('projects');var i=document.getElementById('psearch');i.focus();i.setSelectionRange(pos,pos);return;}
  if(t.id==='dsearch'){state.dsearch=t.value;var pos2=t.selectionStart;go('docs');var i2=document.getElementById('dsearch');i2.focus();i2.setSelectionRange(pos2,pos2);return;}
  if(t.id==='vsearch'){state.vq=t.value;var pv=t.selectionStart;go('vendors');var iv=document.getElementById('vsearch');iv.focus();iv.setSelectionRange(pv,pv);return;}
  if(t.id==='esearch'){state.esearch=t.value;state.eshow=150;var pos3=t.selectionStart;go('entries');var i3=document.getElementById('esearch');i3.focus();i3.setSelectionRange(pos3,pos3);return;}
  if(ga('data-en')){ if(t.tagName!=='SELECT'&&t.type!=='file'&&state.modal&&state.modal.e){state.modal.e[ga('data-en')]=t.value;state.modal.dupAsk=null;} return; }
  if(ga('data-li')!==null&&ga('data-li')!==undefined){lineInput(t);return;}
  if(ga('data-f')){ if(t.tagName!=='SELECT') edInput(t); return; }
  if(ga('data-m')){ if(t.tagName!=='SELECT') modalInput(t); return; }
});
document.addEventListener('change',function(e){
  var t=e.target, ga=function(k){return t.getAttribute?t.getAttribute(k):null;};
  if(t.id==='en-file'){enFile(t);return;}
  if(t.id==='bk-file'){bkFile(t);return;}
  if(ga('data-x')){state.exp[ga('data-x')]=t.value;if(ga('data-x')==='type') state.exp.res=null; go('acct');return;}
  if(ga('data-en')){enChange(t);return;}
  if(t.id==='e-month'){state.emonth=t.value;state.eshow=150;go('entries');return;}
  if(t.id==='e-project'){state.eproject=t.value;state.eshow=150;go('entries');return;}
  if(ga('data-lf')==='desc'&&state.ed&&!state.ed.locked){
    var i=+ga('data-li'), l=state.ed.lines[i], hit=catalogue().map[String(t.value).trim()];
    if(l&&hit&&l.qty===''&&l.rate===''&&l.amount===''){
      l.qty=hit.qty==null?'':String(hit.qty); l.rate=hit.rate==null?'':String(hit.rate); l.amount=String(hit.amount==null?'':hit.amount); if(!l.detail) l.detail=hit.detail||'';
      ['lq','lr','la','lt'].forEach(function(p,k){var el=document.getElementById(p+i); if(el) el.value=[l.qty,l.rate,l.amount,l.detail][k];});
      var tt=document.getElementById('edtotals'); if(tt) tt.innerHTML=edTotalsHtml(); edPreview();
    }
    return;
  }
  if(ga('data-f')&&t.tagName==='SELECT'){ if(ga('data-f')==='label'){state.ed.label=t.value;} else edSelect(t); return; }
  if(ga('data-m')){ modalInput(t); if((/^p\d_amount$/.test(ga('data-m'))&&state.modal&&state.modal.kind==='acct')||(ga('data-m')==='p_client'&&state.modal&&state.modal.kind==='proj')) renderModal(); return; }
  if(e.target.id==='pstatus'){
    var id=e.target.getAttribute('data-pid'), val=e.target.value;
    var p=DATA.projects.filter(function(x){return x.id===id;})[0], old=p.status;
    p.status=val;                                   // update the screen immediately
    google.script.run
      .withSuccessHandler(function(){toast('Saved',true);})
      .withFailureHandler(function(err){p.status=old;e.target.value=old;toast('Not saved: '+(err&&err.message||err));})
      .saveRow('Projects',{id:id,status:val},'Status change');
  }
});
function refresh(){
  toast('Refreshing…',true);
  google.script.run.withSuccessHandler(function(d){DATA=d;C=compute();go(state.view);toast('Up to date',true);})
    .withFailureHandler(function(err){toast('Could not refresh: '+(err&&err.message||err));}).getBootData();
}

state.month=curMonth();
go('dashboard');
OBX.start();
