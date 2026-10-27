// Level-owned weapon callbacks; no renderer or state dependencies.
const slots = new Map();
export function registerLevelWeapon(id,weapon){
  if(!id||id==='gun'||id==='knife'||typeof weapon.fire!=='function')throw new Error('Invalid level weapon');
  if(slots.has(id))throw new Error('Weapon already registered: '+id);
  slots.set(id,weapon);return()=>slots.delete(id);
}
export function levelWeapon(id){return slots.get(id);}
export function levelWeaponIds(){return [...slots.keys()];}
export function nextWeapon(current,pistolAvailable=true){
  const order=[...(pistolAvailable?['gun']:[]),'knife',...slots.keys()];
  return order[(order.indexOf(current)+1)%order.length];
}
