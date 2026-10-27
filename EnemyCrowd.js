// Numeric crowd coordination; animation, damage and perception stay with AI.
export class EnemyCrowd {
  constructor(){this.members=new WeakMap();this.near=[];this.slots=[];this.clock=0;this.serial=0;}
  prepare(enemies,player,dt,{shieldRadius=0,inVehicle=false}={}){
    this.clock+=Math.max(0,Math.min(.1,dt));this.near.length=0;
    let bossNear=false;
    for(const z of enemies){
      if(!z.alive||z.state==='downed'||z.state==='cured') {if(z.crowd)z.crowd=null;continue;}
      const p=z.mesh.position,d=Math.hypot(p.x-player.x,p.z-player.z);
      let m=this.members.get(z);if(!m){m={id:this.serial++,z,mayAttack:false,targetX:0,targetZ:0};this.members.set(z,m);}
      m.distance=d;m.mayAttack=false;z.crowd=m;
      if(d<20)this.near.push(m);
      if(z.isBoss&&d<10)bossNear=true;
      m.eligible=!z.isBoss&&!inVehicle&&d<12&&(!z.stealth||(z.stealth.sense.alert&&z.stealth.noticeHold<=0&&z.stealth.cue==='chase'));
    }
    const limit=bossNear?2:3;
    this.slots=this.slots.filter(s=>s.member.z.crowd===s.member&&s.member.z.alive&&s.member.eligible&&s.member.distance<8).slice(0,limit);
    // Give a waiting attacker a turn after a short lease; avoid swapping every frame.
    const waiting=this.near.filter(m=>m.eligible&&!this.slots.some(s=>s.member===m)).sort((a,b)=>a.distance-b.distance||a.id-b.id);
    for(const slot of this.slots){if(slot.member.z.state==='attack'&&slot.engagedAt==null)slot.engagedAt=this.clock;const finished=slot.engagedAt!=null?this.clock-slot.engagedAt>3.2:this.clock-slot.since>9;if(finished&&waiting.length){slot.member=waiting.shift();slot.since=this.clock;slot.engagedAt=null;}}
    while(this.slots.length<limit&&waiting.length){const m=waiting.shift();this.slots.push({member:m,since:this.clock,engagedAt:null});}
    for(const m of this.near){
      if(m.z.isBoss)continue;
      const slot=this.slots.findIndex(s=>s.member===m);m.mayAttack=slot>=0&&!shieldRadius;
      const angle=slot>=0?Math.atan2(m.z.mesh.position.x-player.x,m.z.mesh.position.z-player.z):m.id*2.399963229728653;
      const radius=slot>=0?1.3:3.3+(m.id%3)*.35;
      m.targetX=player.x+Math.sin(angle)*Math.max(radius,shieldRadius+.65);
      m.targetZ=player.z+Math.cos(angle)*Math.max(radius,shieldRadius+.65);
    }
  }
  separate(player,dt,canMove,shieldRadius=0){
    const maxStep=Math.min(.09,Math.max(0,dt)*1.8),a=this.near;
    for(const m of a)m.shiftBudget=maxStep;
    const shift=(m,dx,dz)=>{
      if(m.z.isBoss||m.shiftBudget<=0)return;
      const length=Math.hypot(dx,dz),scale=length>m.shiftBudget?m.shiftBudget/length:1;dx*=scale;dz*=scale;
      const p=m.z.mesh.position,x=p.x+dx,z=p.z+dz,min=Math.max(.98,shieldRadius+.4);
      const distance=Math.hypot(x-player.x,z-player.z),oldDistance=Math.hypot(p.x-player.x,p.z-player.z);
      if((distance<min&&distance<=oldDistance)||!canMove(p.x,p.z,x,z))return;
      p.x=x;p.z=z;m.shiftBudget-=Math.hypot(dx,dz);
    };
    for(let pass=0;pass<3;pass++)for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++){
      const x=a[i],y=a[j],p=x.z.mesh.position,q=y.z.mesh.position;
      let dx=p.x-q.x,dz=p.z-q.z,d=Math.hypot(dx,dz);const gap=x.z.isBoss||y.z.isBoss?3.0:1.25;
      if(d>=gap-.005)continue;
      if(d<.0001){const angle=(x.id+1)*2.39996+(y.id+1)*.71;dx=Math.sin(angle);dz=Math.cos(angle);d=1;}
      else {dx/=d;dz/=d;}
      const amount=Math.min(maxStep,(gap-Math.hypot(p.x-q.x,p.z-q.z))*.5);
      shift(x,dx*amount,dz*amount);shift(y,-dx*amount,-dz*amount);
    }
  }
}
