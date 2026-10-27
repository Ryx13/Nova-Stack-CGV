import * as THREE from 'three';
import {VendingMachine,makeIcon} from './VendingMachine.js';

export function createLevel3Vendor({scene,state,addStaticBox,updateAmmoHUD,updateCoinHUD,feed,sfx}){
  const product={id:'l3-ammo',itemId:'ammo',name:'24 PISTOL ROUNDS',category:'support',price:3,stock:8,icon:makeIcon(96,96,(c)=>{c.fillStyle='#d3b974';for(let i=0;i<3;i++){c.fillRect(20+i*21,28,12,45);c.beginPath();c.moveTo(20+i*21,28);c.lineTo(26+i*21,15);c.lineTo(32+i*21,28);c.fill();}})};
  const machine=new VendingMachine({scene,position:new THREE.Vector3(-9,0,-106),rotationY:Math.PI/2,catalog:{support:[product]},frontLight:false,soldOutShelves:true});
  machine.root.name='Level3_AmmoVendingMachine';machine.setSelection(2,0);
  addStaticBox(VendingMachine.WIDTH/2,VendingMachine.HEIGHT/2,VendingMachine.DEPTH/2,-9,VendingMachine.HEIGHT/2,-106,Math.PI/2);
  function nearby(pos){return pos.distanceTo(machine.root.position)<2.6;}
  function buy(pos){
    if(state.paused||state.isDead||state.narrativeBlocked||!state.readyShown||!nearby(pos))return false;
    if(product.stock<=0){feed('Ammunition machine sold out');return false;}
    if(state.coins<product.price){feed(`Ammunition costs ${product.price} coins`);return false;}
    state.coins-=product.price;state.ammoReserve+=24;product.stock--;updateAmmoHUD();updateCoinHUD();sfx.pickup();
    if(product.stock===0)machine.takeCard('support');else machine.setSelection(2,0);
    feed('Bought 24 pistol rounds');return true;
  }
  return {machine,product,buy,nearby,prompt:`E — buy 24 pistol rounds / 3 coins`,update(dt){machine.update(dt);},dispose(){machine.dispose();}};
}
