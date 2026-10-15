import {startSafeRoomTutorial} from './smoke-tutorial-module.js';
document.getElementById('start-screen').classList.add('hidden');
let completed=false;
const app=startSafeRoomTutorial({onComplete:()=>{completed=true;}}),t=app.test;
if(!location.search.includes('run')){ /* Manual visual fixture. */ }
else run();
async function run(){
 const out=document.createElement('pre');out.style.cssText='position:fixed;top:0;left:0;z-index:999;background:#081b20;color:white;padding:20px;max-height:90vh;overflow:auto';document.body.append(out);
 const check=(ok,label)=>{if(!ok)throw Error(label);out.textContent+='PASS '+label+'\n';};
 const key=code=>t.key({code,repeat:false,preventDefault(){}});
 const close=async()=>{document.querySelector('.dw-modal:not([hidden]) button').click();for(let i=0;i<8;i++)await Promise.resolve();};
 try{
 t.advance(.1);const initial=t.snapshot().thirdPerson;t.toggle();check(t.snapshot().thirdPerson!==initial,'perspective toggle');t.toggle();
 t.move(-3.5,-2.5);t.advance(.1);check(t.snapshot().blocked,'scientist conversation freezes tutorial');
 key('KeyE');check(t.snapshot().phase==='briefing','interaction blocked during card');
 await close();check(t.snapshot().shot==='scientist','answer retains cinematic shot');await close();check(t.snapshot().phase==='weapon'&&!t.snapshot().blocked,'briefing unlocks weapon');check(t.snapshot().thirdPerson===initial&&!t.snapshot().shot,'chosen perspective restored');
 t.guide();const count=t.snapshot().history;await close();t.guide();check(t.snapshot().history===count,'guide never archives itself');await close();
 t.move(0,1.5);key('KeyE');check(t.snapshot().phase==='shoot','nearby sidearm pickup');
 if(t.snapshot().thirdPerson)t.toggle();t.aim();t.advance(.1);check(t.fire(),'first person aim intersects plate');
 key('KeyR');t.advance(1.3);check(t.snapshot().phase==='sprint','reload advances training');
 t.move(3,5);key('KeyW');key('ShiftLeft');t.advance(1.1);t.move(3,5);t.advance(1.1);check(t.snapshot().phase==='exit'&&t.snapshot().blocked,'sprint opens exit briefing');await close();
 t.move(0,-6.2);t.advance(.05);check(!document.getElementById('safe-room-ui'),'exit disposes tutorial');document.querySelector('.dw-modal button').click();check(completed,'deployment callback fires');
 out.textContent+='ALL CHECKS PASSED';
 }catch(error){out.textContent+='FAIL '+error.message;console.error(error);}
}
