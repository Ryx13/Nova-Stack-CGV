// Scene-independent, disposable narrative UI. Mission code owns the consequences.
export function createNarrative({onBlock=()=>{},onRelease=()=>{},onShot=()=>{}}={}) {
  const seen=new Set(),history=[],queue=[];
  let active=null,radioTime=0,disposed=false,previousFocus=null;
  const modal=document.createElement('section');modal.className='dw-modal';modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Story transmission');
  const card=document.createElement('div');card.className='dw-card';modal.append(card);
  const radio=document.createElement('aside');radio.className='dw-radio';radio.hidden=true;radio.setAttribute('role','status');
  document.body.append(modal,radio);
  const text=(tag,value,parent,className)=>{const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;parent.append(el);return el;};
  function finish(value){
    if(!active)return;const completed=active;active=null;modal.hidden=true;radio.hidden=true;
    if(completed.mode!=='radio'){onShot(null);onBlock(false);previousFocus?.focus?.();onRelease();}
    completed.resolve(value);pump();
  }
  function pump(){
    if(active||disposed||!queue.length)return;
    active=queue.shift();const e=active;if(e.archive!==false)history.push({speaker:e.speaker||'FIELD GUIDE',title:e.title,text:e.text});
    const host=e.mode==='radio'?radio:card;host.replaceChildren();
    text('div',e.speaker||'DR. JAMES / SECURE CHANNEL',host,'dw-eyebrow');
    if(e.title)text(e.mode==='radio'?'strong':'h2',e.title,host);
    text('p',e.text,host);
    if(e.entries){
      for(const entry of e.entries){
        const details=document.createElement('details');details.className='dw-log-entry';
        text('summary',entry.title||entry.speaker,details);
        text('p',entry.text,details);host.append(details);
      }
    }
    if(e.mode==='radio'){radio.hidden=false;radioTime=e.duration||8;const meter=document.createElement('div');meter.className='dw-radio-meter';host.append(meter);return;}
    previousFocus=document.activeElement;onBlock(true);document.exitPointerLock?.();onShot(e.shot||null);modal.hidden=false;
    const actions=document.createElement('div');actions.className='dw-actions';host.append(actions);
    for(const choice of e.choices||[{id:'continue',label:e.continueLabel||'Continue'}]){
      const button=text('button',choice.label,actions,'dw-button '+(e.choices?'dw-choice':'primary'));button.type='button';
      if(choice.detail)text('small',choice.detail,button);
      button.onclick=()=>finish(choice.id);
    }
    if(e.entries)host.insertBefore(actions,host.children[2]);
    actions.querySelector('button').focus({preventScroll:true});card.scrollTop=0;
  }
  const keydown=e=>{
    if(!active||active.mode==='radio')return;
    if(e.code==='Tab'){e.preventDefault();const controls=[...card.querySelectorAll('button,summary')];let i=controls.indexOf(document.activeElement);controls[(i+(e.shiftKey?-1:1)+controls.length)%controls.length]?.focus();}
    if(e.code==='Escape'&&!active.choices){e.preventDefault();finish('continue');}
  };
  document.addEventListener('keydown',keydown);
  return {
    get blocking(){return !!active&&active.mode!=='radio';},
    get history(){return history.slice();},
    show(event){
      if(disposed||seen.has(event.id))return Promise.resolve(null);seen.add(event.id);
      return new Promise(resolve=>{const entry={...event,resolve};
        // A live status supersedes older queued statuses for the same task.
        if(event.mode==='radio'&&event.channel){
          for(let i=queue.length-1;i>=0;i--)if(queue[i].mode==='radio'&&queue[i].channel===event.channel)queue.splice(i,1)[0].resolve(null);
          if(active?.mode==='radio'&&active.channel===event.channel){queue.unshift(entry);finish();return;}
        }
        // Important story events supersede chatter, which remains in the log.
        if(event.mode!=='radio'){
          queue.unshift(entry);
          if(active?.mode==='radio')finish();else pump();
        }else{queue.push(entry);pump();}
      });
    },
    update(dt){if(active?.mode==='radio'){radioTime-=dt;if(radioTime<=0)finish();}},
    openLog(extra=''){
      if(this.blocking)return;
      const sections=extra?extra.split('\n\n'):[];
      const overview=sections.shift();
      const guide=sections.map(section=>{const split=section.indexOf('\n');return split<0?{title:'Field guide',text:section}:{title:section.slice(0,split),text:section.slice(split+1)};});
      return this.show({id:'log-'+performance.now(),archive:false,mode:'cinematic',speaker:'SURVIVOR FIELD GUIDE',title:'Field log',text:overview||'Select a transmission to read it again.',entries:[...guide,...history.slice().reverse()],continueLabel:'Back to mission'});
    },
    dispose(){disposed=true;if(active){active.resolve(null);if(active.mode!=='radio'){onShot(null);onBlock(false);}active=null;}for(const e of queue)e.resolve(null);queue.length=0;document.removeEventListener('keydown',keydown);modal.remove();radio.remove();}
  };
}
