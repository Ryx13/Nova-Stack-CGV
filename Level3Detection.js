// Metres and seconds; no renderer dependency.
export class DetectionMemory {
  constructor(){this.suspicion=0;this.alert=false;this.memory=0;}
  update(dt,{distance,facing,visible,crouching=false,sprinting=false,moving=false,loud=false}={}){
    dt=Math.max(0,Math.min(.25,Number.isFinite(dt)?dt:0));
    const sight=visible&&(distance<1.7||distance<(crouching?9:17)&&facing>.5);
    const hearing=distance<(crouching?1.2:sprinting?8:3)&&moving;
    if(loud||visible&&distance<1.7)this.suspicion=1;
    else this.suspicion=Math.max(0,Math.min(1,this.suspicion+dt*(sight?(crouching?.65:1.15):hearing?.8:-.3)));
    if(this.suspicion>=1)this.alert=true;
    if(this.alert&&(sight||hearing||loud))this.memory=6;
    else this.memory=Math.max(0,this.memory-dt);
    if(this.alert&&this.memory===0&&this.suspicion<.2)this.alert=false;
    return {sight,hearing,alert:this.alert,suspicion:this.suspicion};
  }
}
