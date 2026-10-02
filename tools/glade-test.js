/* Yaşam alanı (Kayran) güvenlik kuralı: içeride ASLA yaratık olmaz.
   Kullanıcı isteği: "yaşam alanında canavarlar vardı bu olmasın
   sadece labirent içerisinde filmdeki gibi canavarlar olsun."
   Bu test, en zorlu koşullarda (gece, oyuncu labirentte) 40 gün/gece
   döngüsü boyunca hiçbir yaratığın Kayran yarıçapına girmediğini kanıtlar. */
const path=require('path'), fs=require('fs');
const soft=require(path.join(process.cwd(),'tools/softcanvas'));
const elements={};
function makeDiv(id){return{id:id||'',tagName:'DIV',style:{},children:[],className:'',textContent:'',_html:'',
 classList:{add(){},remove(){},toggle(){},contains(){return false;}},appendChild(c){return c;},removeChild(c){return c;},
 get firstChild(){return null;},querySelector(){return makeDiv();},querySelectorAll(){return[];},addEventListener(){},removeEventListener(){}};}
function byId(id){ if(elements[id])return elements[id]; elements[id]=(id==='view'||id==='compass-c'||id==='map-c')?soft.makeCanvas(480,270):makeDiv(id); return elements[id]; }
global.document={readyState:'complete',createElement:(t)=>t==='canvas'?soft.makeCanvas(300,150):makeDiv(),getElementById:byId,addEventListener(){},removeEventListener(){},pointerLockElement:null,body:makeDiv('body'),documentElement:{setAttribute(){},getAttribute(){return null;},style:{}}};
global.navigator={userAgent:'NodeTest'};
global.window={addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:true}),requestPointerLock(){}};
global.performance={now:()=>Date.now()}; global.requestAnimationFrame=()=>0;
const storage={}; global.localStorage={getItem:(k)=>(k in storage?storage[k]:null),setItem:(k,v)=>{storage[k]=v;},removeItem:(k)=>{delete storage[k];}};
global.MV={};
for (const f of ['00-core.js','05-desktop.js','07-input.js','10-textures.js','20-maze.js','30-render.js','40-audio.js','50-ai.js','60-game.js','70-ui.js'])
  new Function(fs.readFileSync(path.join(process.cwd(),'app','js',f),'utf8'))();
const MV=global.MV, G=MV.Game;
MV.UI.init(G); G.init(byId('view'));
const w=G.world, K=MV.K;
let violations=0, checked=0, minR=1e9;
/* oyuncu dışarıda: yaratıklar avlansın (en zorlu durum) */
const spot=MV.Maze.nearestOpen(w, w.cx+K.R1+8, w.cy, 10, true);
G.player.x=spot.x; G.player.y=spot.y;
const st={ world: G.world, player: G.player, gatesOpen: G.gatesOpen, night: false, grievers: G.grievers, beetles: G.beetles,
  items: G.items, sprites: null, addItem: G.addItem ? G.addItem.bind(G) : function(){}, onBeetleSteal: function(){}, onGrieverAttack: function(){}, sound: function(){}, fx: function(){}, day: 1 };
st.gatesOpen = false;
for (let t=0;t<40;t++){
  G.day=1+t%3; G.phase=(t%4<2)?'day':'night'; G.clock=30; st.night = G.phase==='night';
  for (let i=0;i<120;i++) MV.AI.update(st, 1/60);
  for (const list of [G.grievers,G.beetles]){
    for (const e of list){
      const dx=e.x-w.cx, dy=e.y-w.cy, r=Math.hypot(dx,dy);
      checked++; if (r<minR) minR=r;
      if (r < K.R1) { violations++; if (violations<4) console.log('İHLAL: '+e.kind+' r='+r.toFixed(2)+' ('+e.x.toFixed(1)+','+e.y.toFixed(1)+')'); }
    }
  }
}
console.log('kontrol edilen yaratık-kare: '+checked+', en yakın mesafe: '+minR.toFixed(2)+', Kayran yarıçapı: '+K.R1);
console.log(violations===0 ? 'YAŞAM ALANI TEMİZ: Geçti' : 'GEÇTİ DEĞİL: '+violations+' ihlal');
process.exit(violations===0?0:1);
