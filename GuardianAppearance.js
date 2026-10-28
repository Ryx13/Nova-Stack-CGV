// Ground the existing animated model in the city's worn, human palette.
// Geometry positions, skin weights, animations and hit surfaces are untouched.
export function styleGuardian(root){
 const geometries=[],vents=[],counts={skin:0,fabric:0,metal:0};
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;const m=mesh.material,name=m.name.toLowerCase();
  m.emissive.setRGB(0,0,0);m.emissiveIntensity=0;
  if(name.includes('necrotic skin')){
   const geometry=mesh.geometry.clone(),color=geometry.attributes.color;mesh.geometry=geometry;geometries.push(geometry);counts.skin++;
   if(color){for(let i=0;i<color.count;i++){
     const r=color.getX(i),g=color.getY(i),b=color.getZ(i),l=.2126*r+.7152*g+.0722*b;
     // Keep the painted eye sockets, lips and wounds; remove the olive cast.
     if(r>g*1.45&&l>.012)color.setXYZ(i,Math.min(.5,l*1.45),l*.76,l*.83);
     else color.setXYZ(i,Math.min(.65,l*1.38),Math.min(.62,l*1.28),Math.min(.6,l*1.24));
    }color.needsUpdate=true;}
   m.color.setHex(0xffffff);m.roughness=.94;m.metalness=0;
  }else if(name.includes('decontamination suit')){
   counts.fabric++;m.color.setHex(0xffffff);m.roughness=.97;m.metalness=0;
   const previousCompile=m.onBeforeCompile, previousKey=m.customProgramCacheKey();
   m.onBeforeCompile=function(shader,renderer){previousCompile.call(this,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float wornFabricLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(wornFabricLuma),.92)*vec3(.94,.89,.83);`);};
   m.customProgramCacheKey=()=> previousKey+'|guardian-worn-workwear-v1';
  }else if(name.includes('containment metal')){
   counts.metal++;m.color.setHex(0xffffff);m.roughness=.91;m.metalness=.35;
   const previousCompile=m.onBeforeCompile, previousKey=m.customProgramCacheKey();
   m.onBeforeCompile=function(shader,renderer){previousCompile.call(this,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float ironLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
    float oxide=smoothstep(.015,.16,diffuseColor.r-diffuseColor.g);
    diffuseColor.rgb=mix(vec3(ironLuma*.82,ironLuma*.83,ironLuma*.80),vec3(ironLuma*1.18,ironLuma*.68,ironLuma*.40),oxide);`);};
   m.customProgramCacheKey=()=> previousKey+'|guardian-rusted-industrial-iron-v1';
  }else if(name.includes('swollen tissue')){m.color.setHex(0xaaa09a);m.roughness=.95;m.metalness=0;}
  else if(name.includes('necrotic fissures')){m.color.setHex(0x35282c);m.roughness=.96;}
  else if(name.includes('hose rubber')){m.color.setHex(0x252323);m.roughness=.97;}
  else if(name.includes('ivory safety')){m.color.setHex(0xaca396);m.roughness=.96;}
  else if(name.includes('warning ochre')){m.color.setHex(0x887451);m.roughness=.94;m.metalness=.12;}
  else if(name.includes('tank seams')){m.color.setHex(0x51443b);m.roughness=.9;m.metalness=.4;vents.push(m);}
 });
 return {counts,update(phase){for(const m of vents){m.emissive.setHex(0x65734a);m.emissiveIntensity=phase==='vent'?.12:0;}},dispose(){for(const geometry of geometries)geometry.dispose();}};
}
