import { createStoryAudio } from './StoryAudio.js';

const OPENING=[
 {scene:'delivery',tag:'01 / THE DELIVERY',title:'One last delivery.',text:'You were carrying a sealed case to Dr. James at the science lab. Inside was a stabilizer for the treatment he was finishing. You were almost at the door when the ground began to move.',note:'MANIFEST 047 / STABILIZER BATCH / SIGNATURE REQUIRED'},
 {scene:'quake',tag:'02 / SEISMIC EVENT',title:'Then the city broke.',text:'The earthquake broke the chemical tanks under the lab. The case flew out of your hands. The power went out, and dangerous gas spread into the streets.',note:'SEISMIC ALERT / CONTAINMENT OFFLINE'},
 {scene:'breach',tag:'03 / CONTAINMENT FAILURE',title:'The air changed them.',text:'The gas turned people outside into zombies. Dr. James pulled you into the safe room. Outside, on CAM 03, a schoolgirl picked up your case and ran.',note:'CAM 03 / SIGNAL DEGRADED / EVACUATION FAILED'},
 {scene:'rescue',tag:'04 / A SECOND CHANCE',title:'They can still come home.',text:'The cure needs two things: a culture sample from the street, and the stabilizer you were carrying. Get both back, then turn on the tower to spread the cure across the city.',note:'SAFE ROOM / SEALED / TWO SURVIVORS'}
];
export function playStoryboard(slides=OPENING,finalLabel='Enter safe room'){
 const audio=createStoryAudio(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const root=document.createElement('section');root.id='opening-story';root.setAttribute('aria-label','Opening story');
 root.innerHTML=`<style>
 #opening-story{position:fixed;inset:0;background:#070b0d;z-index:90;overflow:hidden;color:#eee8dc}#opening-story canvas{position:absolute;inset:0;width:100%;height:100%}#opening-story:after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(0deg,#05080d 0%,#05080dd9 17%,transparent 70%),repeating-linear-gradient(0deg,#ffffff03 0 1px,transparent 1px 4px)}
 .opening-top{position:absolute;top:30px;left:5vw;right:5vw;display:flex;justify-content:space-between;z-index:2;border-top:1px solid #e0a83c77;padding-top:18px}.opening-copy{position:absolute;z-index:2;bottom:6vh;left:7vw;width:min(820px,85vw)}.opening-copy h1{font:600 clamp(36px,6vw,76px)/1.05 'Oswald',sans-serif;letter-spacing:-1px;margin:16px 0}.opening-copy p{font:500 clamp(19px,2.1vw,27px)/1.5 'Rajdhani',sans-serif;max-width:730px;min-height:3em;color:#d5d3c8}.opening-progress{display:flex;gap:7px;margin-top:28px}.opening-progress span{height:3px;width:65px;background:#343d40}.opening-progress span.active{background:#e0a83c}.opening-note{position:absolute;right:6vw;top:23%;font:13px monospace;letter-spacing:2px;color:#e0a83c;writing-mode:vertical-rl;z-index:2}.opening-copy.enter{animation:opening-enter .65s both}@keyframes opening-enter{from{opacity:0;transform:translateY(25px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.opening-copy.enter{animation:none}}@media(max-height:600px){.opening-top{top:12px}.opening-copy{bottom:20px}.opening-copy h1{font-size:36px}.opening-copy p{font-size:18px}.opening-progress{margin-top:10px}}
 </style><canvas aria-hidden="true"></canvas><div class="opening-top"><span class="dw-eyebrow">NOVA STACK / DEADWAY CITY</span><button class="dw-button quiet" data-skip>Skip briefing</button></div><div class="opening-note"></div><article class="opening-copy"><div class="dw-eyebrow" data-tag></div><h1></h1><p></p><div class="dw-actions"><button class="dw-button primary" data-next>Continue</button></div><div class="opening-progress"></div></article>`;
 document.body.append(root);
 const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d');canvas.width=1600;canvas.height=900;
 const next=root.querySelector('[data-next]'),copy=root.querySelector('p');let index=0,time=0,start=performance.now(),raf,finished=false,full='';
 return new Promise(resolve=>{
  function render(){const s=slides[index];full=s.text;start=performance.now();root.dataset.scene=s.scene;root.querySelector('[data-tag]').textContent=s.tag;root.querySelector('h1').textContent=s.title;root.querySelector('.opening-note').textContent=s.note;next.textContent=index===slides.length-1?finalLabel:'Continue';root.querySelector('.opening-progress').innerHTML=slides.map((_,i)=>`<span class="${i<=index?'active':''}"></span>`).join('');const article=root.querySelector('article');article.classList.remove('enter');void article.offsetWidth;article.classList.add('enter');audio.cue(s.scene==='quake'?'rumble':'radio');next.focus();}
  function finish(){if(finished)return;finished=true;cancelAnimationFrame(raf);audio.dispose();root.remove();resolve();}
  next.onclick=()=>{if(copy.textContent!==full){start=performance.now()-full.length*20-100;copy.textContent=full;return;}if(index===slides.length-1)finish();else{index++;render();}};
  root.querySelector('[data-skip]').onclick=finish;
  function frame(now){time=reduced?5:(now-start)/1000;copy.textContent=reduced?full:full.slice(0,Math.floor(time*50));drawScene(ctx,slides[index].scene,time,reduced);raf=requestAnimationFrame(frame);}
  render();raf=requestAnimationFrame(frame);
 });
}
function drawScene(c,kind,t,reduced){
 const w=1600,h=900;c.clearRect(0,0,w,h);const sky=c.createLinearGradient(0,0,0,h);sky.addColorStop(0,kind==='breach'?'#243c30':'#16242c');sky.addColorStop(1,'#080c10');c.fillStyle=sky;c.fillRect(0,0,w,h);
 c.save();if(kind==='quake'&&!reduced&&t<2)c.translate(Math.sin(t*55)*9*(1-t/2),Math.cos(t*43)*6*(1-t/2));
 if(kind==='rescue'){lab(c,t,reduced);c.restore();return;}
 // Layered skyline uses a fixed layout, keeping animation allocation-free.
 for(let layer=0;layer<3;layer++)for(let i=0;i<16;i++){const x=i*125-90+layer*40,y=230+((i*73+layer*47)%220);c.fillStyle=['#253337','#1b252b','#10181d'][layer];c.fillRect(x,y,105,600-y+layer*60);c.fillStyle=kind==='quake'&&Math.sin(t*9+i)>0?'#412825':'#a17c3e';for(let row=0;row<5;row++)for(let col=0;col<3;col++)if((row+col+i)%3)c.fillRect(x+16+col*26,y+20+row*32,9,13);}
 c.fillStyle='#10161a';c.fillRect(460,280,660,270);c.strokeStyle='#e0a83c';c.lineWidth=3;c.strokeRect(460,280,660,270);c.fillStyle='#c4ba9f';c.font='28px monospace';c.fillText('NOVA / RESEARCH ANNEX',505,330);
 if(kind==='delivery'||kind==='quake')street(c);
 if(kind==='delivery'){deliveryCrowd(c,t,reduced);c.save();c.translate(1130,130);c.rotate(.06);c.fillStyle='#c5b79a';c.fillRect(0,0,290,190);c.fillStyle='#26292a';c.font='17px monospace';c.fillText('COURIER / 047',20,40);for(let i=0;i<40;i++)c.fillRect(20+i*6,75,(i%3)+1,55);c.fillText('FRAGILE · BIOLOGICAL',20,165);c.restore();}
 if(kind==='quake'){c.strokeStyle='#e76c43';c.lineWidth=4;for(let i=0;i<6;i++){c.beginPath();c.moveTo(i*300,0);c.lineTo(i*300+70,170);c.lineTo(i*300+30,290);c.lineTo(i*300+160,610);c.stroke();}c.fillStyle='#c81e1e';c.fillRect(480,360,240,8);quakeStreet(c,t,reduced);}
 if(kind==='breach'){for(let i=0;i<7;i++){const x=(i*270+t*12)%1900-150,g=c.createRadialGradient(x,400,0,x,400,240);g.addColorStop(0,'#91ad4270');g.addColorStop(1,'#91ad4200');c.fillStyle=g;c.fillRect(x-240,160,480,480);}c.strokeStyle='#e0a83c66';c.strokeRect(100,85,1400,510);c.fillStyle='#d0553d';c.font='20px monospace';c.fillText('● REC   CAM_03   /   NO UPLINK',135,125);
  cam03(c,t,reduced);if(!reduced&&t%3<.12&&t<5.4){c.fillStyle='#b9cebd33';c.fillRect(100,200,1400,35);}}
 if(kind==='port'||kind==='tower'){c.fillStyle='#081015ed';c.fillRect(160,100,1280,470);c.strokeStyle='#e0a83c33';for(let i=0;i<20;i++){c.beginPath();c.moveTo(160+i*68,100);c.lineTo(160+i*68,570);c.stroke();}const points=kind==='port'?[[300,450],[600,300],[1050,210],[1300,420]]:[[350,430],[700,220],[1050,430],[1250,180]];c.strokeStyle='#e0a83c';c.lineWidth=4;c.setLineDash([12,12]);c.lineDashOffset=-t*18;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();c.setLineDash([]);points.forEach(([x,y],i)=>{c.fillStyle=i===3?'#8fe0ff':'#e0a83c';c.beginPath();c.arc(x,y,10,0,7);c.fill();c.font='17px monospace';c.fillText((kind==='port'?['STREET','SIGNAL','INTERCEPT','PORT']:['GENERATOR','COOLING','UPLINK','BROADCAST'])[i],x-50,y+40);});}
 c.restore();if(!reduced){c.fillStyle='#cab79466';for(let i=0;i<45;i++)c.fillRect((i*137+t*(i%4+1)*7)%1600,(i*97+t*17)%900,2,2);}
}
/* --- The opening's people -------------------------------------------------
   Silhouettes drawn limb by limb: legs and arms swing as they walk, lean in
   to choke, lurch with arms out once turned. Positional arguments, no
   objects per frame (the scenes redraw every frame). */
const CLOTHES=['#5a6b7a','#7a5a4a','#4a5a48','#8a7a5a','#6a4a5a','#3a4a6a','#7a6a3a'],SKIN=['#c9a27e','#8a6448','#e0b896','#6a4a36'],TURNED='#8fa57a',COURIER='#8a5a2a';
// x0, speed (px/s), direction, scale, clothes, skin, feet y, gait
const WALKERS=[[150,60,1,1,0,0,622,'walk'],[520,48,-1,.92,1,1,616,'walk'],[880,70,1,1.05,2,2,628,'walk'],[1240,55,-1,.95,3,3,618,'walk'],[1420,140,-1,1,4,0,626,'jog'],[1050,40,1,.9,5,1,614,'walk'],[320,0,1,.97,6,2,620,'phone']];
function limb(c,x,y,len,a){c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.sin(a)*len,y+Math.cos(a)*len);c.stroke();}
function person(c,x,y,s,dir,ph,pose,clothes,skin,carry,skirt){
 c.save();c.translate(x,y);c.scale(s,s);c.lineCap='round';
 if(pose==='down'){c.rotate(dir*Math.PI/2);c.translate(0,-6);pose='lie';}
 const crouch=pose==='crouch',hip=crouch?-24:-38;
 const sw=pose==='walk'?Math.sin(ph)*.45:pose==='jog'?Math.sin(ph)*.7:pose==='zombie'?Math.sin(ph)*.22:pose==='stumble'?Math.sin(ph)*.3:.08;
 const lean=(pose==='zombie'?.38:pose==='choke'?.65:crouch?.8:pose==='jog'?.18:pose==='stumble'?Math.sin(ph*1.3)*.35:0)*dir;
 c.strokeStyle='#22272b';c.lineWidth=7;
 if(crouch){limb(c,0,hip,26,dir*.9);limb(c,0,hip,26,-dir*.3);}else{limb(c,0,hip,38,sw);limb(c,0,hip,38,-sw);}
 if(skirt){c.fillStyle='#2e3d5c';c.beginPath();c.moveTo(-9,hip-4);c.lineTo(9,hip-4);c.lineTo(13,hip+12);c.lineTo(-13,hip+12);c.fill();}
 const sx=Math.sin(lean)*34,sy=hip-Math.cos(lean)*34;
 c.strokeStyle=clothes;c.lineWidth=13;c.beginPath();c.moveTo(0,hip);c.lineTo(sx,sy);c.stroke();
 const ax=sx*.9,ay=sy+4;c.lineWidth=6;
 if(pose==='zombie'){limb(c,ax,ay,30,dir*1.45+Math.sin(ph)*.1);limb(c,ax,ay,30,dir*1.25-Math.sin(ph)*.1);}
 else if(pose==='choke'){limb(c,ax,ay,18,dir*2.5);limb(c,ax,ay,18,dir*2.2);}
 else if(pose==='phone'){limb(c,ax,ay,26,dir*.1);limb(c,ax,ay,20,dir*2.4);}
 else if(crouch){limb(c,ax,ay,28,dir*.5);limb(c,ax,ay,28,dir*.7);}
 else{limb(c,ax,ay,30,-sw*.9);limb(c,ax,ay,30,sw*.9);}
 const hx=sx+Math.sin(lean)*13,hy=sy-Math.cos(lean)*13;
 c.fillStyle=skin;c.beginPath();c.arc(hx,hy,9.5,0,7);c.fill();
 if(pose==='phone'){c.fillStyle='#8fe0ff';c.fillRect(hx+dir*8-3,hy+4,6,9);}
 if(carry){const cx=ax+Math.sin(-sw*.9)*30,cy=ay+Math.cos(-sw*.9)*30;c.fillStyle='#e0a83c';c.fillRect(cx-11,cy-2,22,15);c.fillStyle='#26292a';c.fillRect(cx-3,cy-5,6,3);}
 c.restore();
}
const wrapX=(x)=>((x%1800)+1800)%1800-100;
// The pavement in front of the annex, and the lab's door
function street(c){
 c.fillStyle='#10161a';c.fillRect(460,550,660,52);c.fillStyle='#0a0f12';c.fillRect(760,500,80,102);c.strokeStyle='#e0a83c';c.lineWidth=3;c.strokeRect(760,500,80,102);c.fillStyle='#e0a83c99';c.fillRect(776,490,48,6);
 c.fillStyle='#1c2428';c.fillRect(0,600,1600,300);c.fillStyle='#2b3438';c.fillRect(0,600,1600,34);c.fillStyle='#3d474b';c.fillRect(0,632,1600,4);
 c.fillStyle='#6b6450';for(let i=0;i<14;i++)c.fillRect(i*130+20,740,60,5);
}
// 01: an ordinary afternoon; you walking the case up to the door
function deliveryCrowd(c,t,reduced){
 const tt=reduced?3:t;
 for(const [x0,speed,dir,sc,ci,si,y,gait] of WALKERS)person(c,wrapX(x0+dir*speed*tt),y,sc,dir,tt*speed*.11+x0,gait,CLOTHES[ci],SKIN[si]);
 const cx=reduced?720:Math.min(720,90+t*110);
 person(c,cx,624,1.05,1,t*7,cx<720?'walk':'stand',COURIER,SKIN[0],true);
}
// 02: everyone thrown about, the case out of your hands, glass coming down, gas venting
function quakeStreet(c,t,reduced){
 const tt=reduced?3:t;
 WALKERS.forEach(([x0,,dir,sc,ci,si,y],i)=>person(c,wrapX(x0),y,sc,dir,tt*10+i,tt>1.6&&i%2===0?'down':'stumble',CLOTHES[ci],SKIN[si]));
 person(c,720,624,1.05,1,tt*10,tt<.35?'stumble':'down',COURIER,SKIN[0],tt<.35);
 const p=reduced?1:Math.min(1,t/1.1),bx=735+275*p,by=595-170*Math.sin(p*Math.PI)+20*p;
 c.save();c.translate(bx,by);c.rotate(p*6);c.fillStyle='#e0a83c';c.fillRect(-11,-7,22,15);c.restore();
 c.fillStyle='#bcd8e4cc';for(let i=0;i<10;i++){const f=Math.max(0,tt-.2-i*.08),y=Math.min(625,300+380*f*f);c.fillRect(500+i*60+(i%3)*9,y,i%2?5:8,i%2?9:5);}
 if(tt>1.2){const a=Math.min(1,(tt-1.2)/2);for(let i=0;i<5;i++){const x=520+i*140,r=60+a*90,g=c.createRadialGradient(x,590,0,x,590,r);g.addColorStop(0,`rgba(145,173,66,${.45*a})`);g.addColorStop(1,'rgba(145,173,66,0)');c.fillStyle=g;c.fillRect(x-r,590-r,r*2,r*2);}}
}
// 03: CAM 03. The people outside choke, drop and get up turned; the girl
// comes for your case, opens it, and the feed tears and dies
const GREYS=['#1a1d1c','#3a3e3c','#5c615e','#8a8f8c','#b5bab6','#d8dcd9'];
const CAM_PEOPLE=[[260,1,0],[430,-1,1],[620,1,2],[1220,-1,3],[1380,1,4]];
function cam03(c,t,reduced){
 const tt=reduced?5:t;
 c.fillStyle='#24302a';c.fillRect(101,560,1398,34);
 CAM_PEOPLE.forEach(([x0,dir,i])=>{const turned=tt>=2.7,x=x0+(turned?dir*(tt-2.7)*16:0);person(c,x,585,.95,dir,tt*(turned?3:9)+i,tt<2?'choke':turned?'zombie':'down',CLOTHES[i],turned?TURNED:SKIN[i%4]);});
 const gx=tt<1.2?1580:Math.max(1040,1580-(tt-1.2)*270),there=gx<=1040;
 if(!there||tt<3.4){c.fillStyle='#e0a83c';c.fillRect(1000,573,22,15);}
 person(c,gx,585,.85,-1,tt*14,there?'crouch':'jog','#d8d8d0','#b9cebd',false,true);
 if(there&&tt>=3.4){const open=tt>=4.4;c.fillStyle='#e0a83c';c.fillRect(gx-36,571,22,15);
  if(open){c.fillStyle='#c9a04a';c.fillRect(gx-36,559,22,4);const g=c.createRadialGradient(gx-25,560,0,gx-25,560,70);g.addColorStop(0,'rgba(143,224,255,.55)');g.addColorStop(1,'rgba(143,224,255,0)');c.fillStyle=g;c.fillRect(gx-95,490,140,140);}}
 if(reduced)return;
 // The signal going: the picture tearing sideways, then nothing but static
 if(tt>5.4&&tt<6.4){c.save();c.setTransform(1,0,0,1,0,0);for(let i=0;i<9;i++){const y=95+Math.random()*480,bh=10+Math.random()*40;c.drawImage(c.canvas,100,y,1400,bh,100+(Math.random()-.5)*160,y,1400,bh);}c.restore();}
 if(tt>=6.4){c.fillStyle='#0c0e0d';c.fillRect(100,85,1400,510);for(let i=0;i<1600;i++){c.fillStyle=GREYS[i%6];c.fillRect(100+Math.random()*1394,85+Math.random()*506,6,3);}
  c.fillStyle='#070908cc';c.fillRect(560,300,480,80);c.fillStyle='#d0553d';c.font='bold 34px monospace';c.fillText('CAM_03 / NO SIGNAL',612,352);}
}
// 04: inside the lab. Dr. James and you at the monitors (CAM 03 still dead),
// a bench of the cure's glassware, the blast doors parting on it
function lab(c,t,reduced){
 const wall=c.createLinearGradient(0,0,0,900);wall.addColorStop(0,'#0f1d22');wall.addColorStop(1,'#081014');c.fillStyle=wall;c.fillRect(0,0,1600,900);
 c.fillStyle='#121c20';c.fillRect(0,640,1600,260);c.strokeStyle='#8fe0ff14';c.lineWidth=2;for(let i=0;i<17;i++){c.beginPath();c.moveTo(i*100,640);c.lineTo(i*100-300+i*35,900);c.stroke();}
 ['CAM_01','CAM_03','VITALS','ROUTE'].forEach((label,i)=>{const x=330+i*230,y=150;c.fillStyle='#0a1418';c.fillRect(x,y,200,130);c.strokeStyle='#8fe0ff55';c.lineWidth=2;c.strokeRect(x,y,200,130);c.fillStyle='#8fe0ff99';c.font='13px monospace';c.fillText(label,x+8,y+18);
  if(i===0){c.fillStyle='#2f4a3c';for(let k=0;k<7;k++)c.fillRect(x+12+k*26,y+60+(k*37)%40,20,70-(k*37)%40);}
  if(i===1){for(let k=0;k<160;k++){c.fillStyle=GREYS[k%6];c.fillRect(x+4+Math.random()*190,y+24+Math.random()*100,4,2);}c.fillStyle='#d0553d';c.font='bold 15px monospace';c.fillText('NO SIGNAL',x+58,y+80);}
  if(i===2){c.strokeStyle='#91ad42';c.lineWidth=2;c.beginPath();for(let k=0;k<=190;k+=5){const beat=((k+t*120)%95)<10?-30:0;c.lineTo(x+5+k,y+80+beat+Math.sin(k*.3)*3);}c.stroke();}
  if(i===3){c.strokeStyle='#e0a83c';c.lineWidth=2;c.setLineDash([6,6]);c.beginPath();c.moveTo(x+20,y+110);c.lineTo(x+80,y+60);c.lineTo(x+150,y+90);c.lineTo(x+185,y+40);c.stroke();c.setLineDash([]);}});
 c.fillStyle='#1a2a30';c.fillRect(300,470,940,50);for(let i=0;i<14;i++){c.fillStyle=(i+Math.floor(t*3))%4?'#2a4048':'#8fe0ff';c.fillRect(330+i*64,488,10,6);}
 person(c,860,640,1.7,-1,t*2,'stand','#e5e9e7','#d6a57e');
 person(c,560,640,1.7,1,t*2,'stand',COURIER,SKIN[0]);
 c.fillStyle='#22343a';c.fillRect(1290,560,280,18);c.fillRect(1300,578,14,62);c.fillRect(1546,578,14,62);
 [[1330,'#91ad42'],[1390,'#8fe0ff'],[1450,'#91ad42'],[1510,'#8fe0ff']].forEach(([x,col],i)=>{const g=c.createRadialGradient(x,535,0,x,535,40);g.addColorStop(0,col+'66');g.addColorStop(1,col+'00');c.fillStyle=g;c.fillRect(x-40,495,80,80);c.fillStyle=col;c.beginPath();c.arc(x,540,13+(i%2)*4,0,7);c.fill();c.fillRect(x-4,512,8,18);});
 // The blast doors parting on the room
 const aperture=reduced?1:Math.min(1,.16+t*.5);if(aperture<1){c.fillStyle='#263237';c.fillRect(0,0,800*(1-aperture),900);c.fillRect(800+800*aperture,0,800,900);c.strokeStyle='#e0a83c';c.lineWidth=3;for(let i=0;i<12;i++){c.beginPath();c.moveTo(40+i*135,0);c.lineTo(i*135,160);c.stroke();}}
}
export function playLevelTransition(from){
 const card=from===1?{scene:'port',tag:'ACT II / INTERCEPT',title:'Your delivery is still out there.',text:'The culture sample is safe. Now the stabilizer. The girl from CAM 03 is half-turned, and she is dosing herself with it to stay human. The infected leave her alone. Catch her before she reaches the boats at the port.',note:'DR. JAMES / SIGNAL ACQUIRED'}:{scene:'tower',tag:'ACT III / THE LAST BROADCAST',title:'Give the city a tomorrow.',text:'Stabilizer recovered, and the cure is ready. Her boat is the only way across the bay to the broadcast tower, so she comes with you. Restore the generator, cooling and uplink. Then we bring them all home, her too.',note:'CURE SYNTHESIS / COMPLETE'};
 return playStoryboard([card],'Deploy');
}
