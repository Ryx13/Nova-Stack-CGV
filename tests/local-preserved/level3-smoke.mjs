import {startLevel,lv3,updateLevel3Mission} from './smoke-level3-module.js';
import {state} from './state.js';
import {playerVis} from './characters.js';
import {levelKeyHooks,damagePlayer} from './Actions.js';
const params=new URLSearchParams(location.search),power=params.get('power')||'safety',rescue=params.get('rescue')!=='no';
document.getElementById('start-screen').classList.add('hidden');
const result=document.createElement('pre');result.id='smoke-result';result.style.cssText='position:fixed;left:10px;top:10px;max-height:90vh;overflow:auto;z-index:999;background:#06191e;color:white;padding:16px;font:13px monospace;pointer-events:none';result.textContent='Waiting for assets';document.body.appendChild(result);
startLevel(params.get('mode')||'day');
const timer=setInterval(()=>{if(!state.readyShown||document.getElementById('hud').classList.contains('hidden'))return;clearInterval(timer);run();},200);
function check(ok,label){if(!ok)throw Error(label);result.textContent+='\nPASS '+label;}
function advance(seconds){for(let i=0;i<seconds*20;i++){if(lv3.bossZombie)lv3.bossZombie.update(.05,playerVis.group.position);updateLevel3Mission(.05);}}
async function closeCard(label='Continue'){
 const button=[...document.querySelectorAll('.dw-modal:not([hidden]) button')].find(b=>b.textContent.includes(label));check(!!button,'story action '+label);button.click();await Promise.resolve();await Promise.resolve();
}
async function run(){
 try{
 result.textContent=`Level 3 narrative checks / ${power} / rescue ${rescue}`;state.runReported=true;state.playerHealth=10000;state.playerMaxHealth=10000;
 advance(.1);check(state.narrativeBlocked,'arrival blocks gameplay');const hp0=state.playerHealth;damagePlayer(50);check(state.playerHealth===hp0,'blocking story prevents damage');await closeCard();check(!state.narrativeBlocked,'continue restores gameplay');
 const crate=lv3.details.crates[0];playerVis.group.position.copy(crate.position);playerVis.group.position.z+=1;state.yaw=0;state.meleeTimer=.2;advance(.05);state.meleeTimer=0;check(crate.open,'melee opens crate');
 const puddle=lv3.details.hazards[0];playerVis.group.position.copy(puddle.mesh.position);state.hurtGrace=0;const hp=state.playerHealth;advance(.05);check(state.playerHealth<hp,'toxic hazard damage');
 const first=lv3.compound.switches[0];playerVis.group.position.copy(first.pos);state.keys.KeyE=true;advance(1);check(!first.activated&&lv3.hold>.9,'partial hold');state.keys.KeyE=false;advance(.1);check(lv3.hold===0,'release resets hold');state.keys.KeyE=true;state.paused=true;advance(4);check(!first.activated,'pause freezes hold');state.paused=false;
 for(const sw of lv3.compound.switches){
  playerVis.group.position.copy(sw.pos);levelKeyHooks.KeyG();check(lv3.story.narrative.history.some(h=>h.speaker.includes('RESEARCH')),'research archived');
  state.keys.KeyE=true;advance(3.1);state.keys.KeyE=false;check(sw.activated,'activate '+sw.key);check(lv3.defenseTime>29,'defense starts');advance(30.1);
  if(sw.key==='generator'){
   check(state.narrativeBlocked,'power choice blocks');await closeCard(power==='safety'?'Restore safety systems':'Open the supply route');check(lv3.story.power===power,'power consequence saved');
   if(power==='supplies'){playerVis.group.position.copy(lv3.story.cachePos);const ammo=state.ammoReserve;state.keys.KeyE=true;advance(.1);check(state.ammoReserve===ammo+36,'supply grants 36 once');advance(.1);check(state.ammoReserve===ammo+36,'cache cannot be farmed');state.keys.KeyE=false;}
   else{advance(.1);check(lv3.details.hazards.filter(h=>h.type==='steam').every(h=>!h.mesh.visible),'safety shuts steam off');}
  }
  if(sw.key==='cooling'){
   check(lv3.story.rescueAvailable,'rescue signal unlocked');
   if(rescue){playerVis.group.position.copy(lv3.story.rescuePos);state.keys.KeyE=true;advance(1);check(lv3.story.rescueStarted&&!lv3.story.rescued,'rescue starts once');state.keys.KeyE=false;advance(.1);check(lv3.story.rescueHold===0,'rescue hold resets');state.keys.KeyE=true;advance(4.1);state.keys.KeyE=false;check(lv3.story.rescued,'technician freed');}
  }
 }
 check(state.narrativeBlocked&&lv3.phase==='boss','guardian reveal');await closeCard('Hold the tower');
 const boss=lv3.bossZombie;while(!boss.guardian.ready)await new Promise(resolve=>setTimeout(resolve,50));advance(3.5);check(boss.guardian.combat.phase==='chase'&&boss.speed===.65,'slow boss pursuit');advance(5);check(boss.guardian.combat.phase==='vent_warning','gas warning');advance(1.8);check(boss.guardian.combat.phase==='vent','braced vent');advance(2.4);check(boss.guardian.combat.phase==='recovery','valve recovery window');for(const z of state.zombies)if(!z.isBoss)z.goDown();
 const before=state.zombies.length;boss.takeDamage(400);check(boss.minionThreshold===.5,'75 percent threshold');advance(7);check(state.zombies.length>=before+4,'minions spawn despite downed bodies');boss.takeDamage(400);check(boss.minionThreshold===.25,'50 percent threshold');boss.takeDamage(300);check(boss.minionThreshold===0,'25 percent threshold');boss.takeDamage(400);advance(5);
 check(lv3.phase==='broadcast-ready'&&!state.isDead,'boss does not auto-complete');advance(10);check(lv3.phase==='broadcast-ready','broadcast waits for player');
 playerVis.group.position.copy(lv3.story.consolePos);state.keys.KeyE=true;advance(.1);state.keys.KeyE=false;check(lv3.phase==='dispersion','manual broadcast');advance(9);check(lv3.phase==='done'&&lv3.curedCount>0,'cure completes');
 check(document.getElementById('lv3-win-stats').textContent.includes(rescue?'Technician evacuated':'Rescue signal unresolved'),'ending reflects rescue choice');check(!state.narrativeBlocked,'no narrative lock left behind');state.paused=true;result.textContent+='\nALL CHECKS PASSED';
 }catch(e){result.textContent+='\nFAIL '+e.message;console.error(e);state.paused=true;}
}
