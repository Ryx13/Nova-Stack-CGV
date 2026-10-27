// Seconds and metres; deliberately independent of rendering for deterministic checks.
export const GUARDIAN_TIMING = Object.freeze({entrance:3.5,rupture:5,chase:5,slam_warning:1.3,slam:.9,vent_warning:1.8,vent:2.4,recovery:3.4,dying:3.2});
export const GUARDIAN_SLAM_RADIUS = 3.1;
export const GUARDIAN_GAS_RADIUS = 3.5;
export const GUARDIAN_RUPTURE_DAMAGE=180;
export const GUARDIAN_SHOCKWAVE_RADIUS=7;
export class GuardianShockwave {
 constructor(){this.active=false;this.radius=0;this.hit=false;this.x=0;this.z=0;}
 start(boss){this.active=true;this.radius=0;this.hit=false;this.x=boss.x;this.z=boss.z;}
 update(dt,target){if(!this.active)return 0;const previous=this.radius;this.radius=Math.min(GUARDIAN_SHOCKWAVE_RADIUS,this.radius+Math.max(0,dt)*3.5);const d=Math.hypot(target.x-this.x,target.z-this.z);const hit=!this.hit&&d<=GUARDIAN_SHOCKWAVE_RADIUS&&d>=previous-.35&&d<=this.radius+.35;if(hit)this.hit=true;if(this.radius>=GUARDIAN_SHOCKWAVE_RADIUS)this.active=false;return hit?18:0;}
 clear(){this.active=false;this.hit=false;this.radius=0;}
}
export class GuardianCombat {
  constructor(){this.phase='entrance';this.stage=1;this.valveCharge=0;this.ruptured=false;this.time=0;this.direction={x:0,z:1};this.ventTarget=null;this.hit=false;this.attacks=0;this.vented=false;}
  setHealth(health,maxHealth){
    if(Number.isFinite(health)&&Number.isFinite(maxHealth)&&maxHealth>0&&health/maxHealth<=.5)this.stage=2;
  }
  // Pressure increases between attacks. Warning and weak-point windows stay fair.
  get duration(){if(this.phase==='slam_warning'&&this.stage===2)return 2;return this.phase==='chase'&&this.stage===2?3.5:GUARDIAN_TIMING[this.phase];}
  get progress(){return Math.min(1,this.time/(this.duration||1));}
  get speed(){return this.stage===2?.85:.65;}
  enter(phase){this.phase=phase;this.time=0;this.hit=false;this.vented=false;}
  update(dt,boss,target){
    if(this.phase==='defeated')return;
    this.time+=Math.max(0,Number.isFinite(dt)?dt:0);
    if(this.time+1e-8<this.duration)return;
    if(this.phase==='entrance'||this.phase==='recovery'||this.phase==='rupture')this.enter('chase');
    else if(this.phase==='chase'){
      const x=target.x-boss.x,z=target.z-boss.z,d=Math.hypot(x,z)||1;
      this.direction={x:x/d,z:z/d};
      // Ranged pressure commits to a visible location before the vent opens.
      const reach=d>=5?Math.min(d,16):0;
      this.ventTarget={x:boss.x+this.direction.x*reach,z:boss.z+this.direction.z*reach};
      // Alternate close slams with vents. Distant targets always get a vent.
      const slam=d<GUARDIAN_SLAM_RADIUS+.1&&this.attacks%2===0;this.attacks++;this.enter(slam?'slam_warning':'vent_warning');
    }else if(this.phase==='slam_warning')this.enter('slam');
    else if(this.phase==='vent_warning')this.enter('vent');
    else if(this.phase==='slam'||this.phase==='vent')this.enter('recovery');
    else if(this.phase==='dying')this.enter('defeated');
  }
  damage(amount,weakPoint){
    if(['entrance','dying','defeated'].includes(this.phase))return 0;
    const raw=Math.max(0,Number.isFinite(amount)?amount:0),exposed=this.phase==='recovery'||this.phase==='rupture';
    if(raw&&weakPoint&&this.phase==='recovery'&&!this.ruptured){
      this.valveCharge=Math.min(this.stage===2?GUARDIAN_RUPTURE_DAMAGE:GUARDIAN_RUPTURE_DAMAGE-1,this.valveCharge+raw);
      if(this.stage===2&&this.valveCharge>=GUARDIAN_RUPTURE_DAMAGE){this.ruptured=true;this.enter('rupture');}
    }
    return raw*(exposed&&weakPoint?2.5:1);
  }
}
// Fixed capacity: vents leave world-space hazards, never homing clouds.
export class GuardianGas {
  constructor(){this.clouds=Array.from({length:3},()=>({x:0,z:0,age:0,active:false}));this.cooldown=0;this.graceAvailable=true;this.exposure=0;this.outsideTime=0;}
  // Refuse a cloud if no straight, clear five-metre escape remains.
  canPlace(x,z,target,isExitClear=()=>true){
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,dx=Math.cos(angle),dz=Math.sin(angle);let escaped=false,valid=true;
      for(let step=1;step<=10;step++){
        const px=target.x+dx*step*.5,pz=target.z+dz*step*.5;
        const inside=Math.hypot(px-x,pz-z)<GUARDIAN_GAS_RADIUS+.25||this.clouds.some(c=>c.active&&Math.hypot(px-c.x,pz-c.z)<GUARDIAN_GAS_RADIUS+.25);
        if(escaped&&inside){valid=false;break;}if(!inside)escaped=true;
      }
      if(valid&&escaped&&isExitClear(target.x+dx*5,target.z+dz*5))return true;
    }return false;
  }
  spawn(x,z){const c=this.clouds.find(c=>!c.active)||this.clouds.reduce((a,b)=>a.age>b.age?a:b);Object.assign(c,{x,z,age:0,active:true});return c;}
  update(dt,target){
    this.cooldown=Math.max(0,this.cooldown-dt);let inside=false;
    for(const c of this.clouds){if(!c.active)continue;c.age+=dt;if(c.age>=8){c.active=false;continue;}if(Math.hypot(target.x-c.x,target.z-c.z)<GUARDIAN_GAS_RADIUS)inside=true;}
    if(!inside){this.outsideTime+=dt;if(this.outsideTime>=1){this.graceAvailable=true;this.exposure=0;}return 0;}
    this.outsideTime=0;
    if(this.graceAvailable){this.exposure+=dt;if(this.exposure<.6-1e-8)return 0;this.graceAvailable=false;}
    if(this.cooldown<=0){this.cooldown=.7;return 7;}return 0;
  }
  clear(){for(const c of this.clouds)c.active=false;this.cooldown=0;this.graceAvailable=true;this.exposure=0;this.outsideTime=0;}
}
