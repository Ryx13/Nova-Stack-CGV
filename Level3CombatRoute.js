// Encounter completion is based on resolved enemies, never an elapsed survival timer.
export const MAX_ROUTE_ENEMIES=8;
export const ROAD_AMBUSHES=Object.freeze([
  {id:'road-crossing',label:'Crossing ambush',z:-28,count:7},
  {id:'road-wrecks',label:'Wreckage ambush',z:-70,count:8},
  {id:'road-service',label:'Service road ambush',z:-112,count:9},
  {id:'road-compound',label:'Compound approach',z:-142,count:8},
]);
export class CombatRoute {
  // countMul: each encounter's size as a fraction of its listed count (the difficulty's, Difficulty.js)
  constructor({countMul=1,activeCap=MAX_ROUTE_ENEMIES,spawnInterval=1.25}={}){this.queue=[];this.active=null;this.scheduled=new Set();this.completed=new Set();this.spawnTimer=0;this.seeded=false;this.countMul=countMul;this.activeCap=activeCap;this.spawnInterval=spawnInterval;}
  get pending(){return !!this.active||this.queue.length>0;}
  adoptOpening(enemies){
    if(this.seeded)return;
    this.seeded=true;
    this.active={id:'opening',label:'Clear the street',remaining:0,targets:new Set(enemies)};
    this.scheduled.add('opening');
    for(const enemy of enemies)enemy.combatRequired=true;
  }
  enqueue({id,label,count,switchKey=null}){
    if(this.scheduled.has(id))return false;
    this.scheduled.add(id);this.queue.push({id,label,remaining:Math.max(1,Math.round(count*this.countMul)),targets:new Set(),switchKey});return true;
  }
  advance(position){for(const ambush of ROAD_AMBUSHES)if(position.z<=ambush.z)this.enqueue(ambush);}
  tick(dt,enemies,spawn,onComplete=()=>{}){
    if(!this.active){this.active=this.queue.shift()||null;this.spawnTimer=0;}
    const encounter=this.active;if(!encounter)return;
    for(const enemy of encounter.targets)if(!enemy.alive||enemy.state==='cured')encounter.targets.delete(enemy);
    this.spawnTimer=Math.max(0,this.spawnTimer-Math.max(0,Math.min(.25,dt)));
    const alive=enemies.filter(e=>e.alive&&!e.isBoss&&e.state!=='cured').length;
    if(encounter.remaining>0&&this.spawnTimer===0&&alive<this.activeCap){
      const enemy=spawn(encounter);
      if(enemy){enemy.combatRequired=true;encounter.targets.add(enemy);encounter.remaining--;this.spawnTimer=this.spawnInterval;}
    }
    if(encounter.remaining===0&&encounter.targets.size===0){
      this.active=null;this.completed.add(encounter.id);onComplete(encounter);
    }
  }
  get outstanding(){return this.active?this.active.remaining+this.active.targets.size:0;}
}
