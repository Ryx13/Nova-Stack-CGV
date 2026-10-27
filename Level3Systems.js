// Gameplay policy kept independent of the renderer for deterministic checks.
export const CURE_RADIUS = 6;
export const CURE_CHARGES = 5;
export const CURE_COOLDOWN = 3;
export const CURE_HALF_ANGLE = 55 * Math.PI / 180;
export function withinCureAim(enemy,origin,direction){
  const dx=enemy.mesh.position.x-origin.x,dz=enemy.mesh.position.z-origin.z,distance=Math.hypot(dx,dz),aimLength=Math.hypot(direction.x,direction.z);
  return distance<.05||aimLength>0&&(dx*direction.x+dz*direction.z)/(distance*aimLength)>=Math.cos(CURE_HALF_ANGLE);
}
export const POWER_ROUTES = Object.freeze({
  floodlights: Object.freeze({label:'Floodlights',summary:'Brighter compound · extra infected waves',ending:'The floodlights mark a clear path through the compound.',extraWave:3,ammo:0}),
  safety: Object.freeze({label:'Safety systems',summary:'Steam hazards disabled',ending:'The safety circuit keeps the steam routes clear.',extraWave:0,ammo:0}),
  supplies: Object.freeze({label:'Supply route',summary:'Emergency ammunition unlocked · +36 rounds',ending:'The emergency supply route is open for the survivors.',extraWave:0,ammo:36}),
});
export function powerRoute(id){return POWER_ROUTES[id] || null;}

export class CureDevice {
  constructor(){this.charges=CURE_CHARGES;this.cooldown=0;}
  update(dt){if(Number.isFinite(dt)&&dt>0)this.cooldown=Math.max(0,this.cooldown-dt);}
  canReach(enemy,origin,visible=()=>true){
    const p=enemy?.mesh?.position;
    return !!(p&&origin&&enemy.alive&&!enemy.isBoss&&enemy.state!=='cured'
      &&Math.abs(p.y-origin.y)<=3&&Math.hypot(p.x-origin.x,p.z-origin.z)<=CURE_RADIUS
      &&visible(enemy,origin));
  }
  activate(enemies,origin,{blocked=false,visible}={}){
    if(blocked)return {ok:false,reason:'blocked'};
    if(this.charges<=0)return {ok:false,reason:'empty'};
    if(this.cooldown>0)return {ok:false,reason:'cooldown'};
    const targets=[...new Set(enemies)].filter(z=>this.canReach(z,origin,visible));
    if(!targets.length)return {ok:false,reason:'no-targets'};
    this.charges--;this.cooldown=CURE_COOLDOWN;
    return {ok:true,targets};
  }
}
