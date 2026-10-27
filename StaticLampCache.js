import * as THREE from 'three';

// Horizontal receivers cache incident lighting. Other fixed opaque surfaces
// use a cached spatial lamp grid, retaining exact local PBR light evaluation.
// Keep the PBR response live: normal maps and view-dependent specular cannot
// be flattened into a conventional colour lightmap without changing the look.
// Each lamp's direction/falloff is baked once; colour/intensity remain live.
const PAGE = 128, CELL = 2, MAX_LAMPS = 64;
const physicalFalloff = (distance, cutoff, decay) => {
  let falloff = 1 / Math.max(distance ** decay, 0.01);
  if (cutoff > 0) falloff *= Math.max(0, 1 - (distance / cutoff) ** 4) ** 2;
  return falloff;
};
export function sampleStationaryLamp(light, position, x, y, z, result = []) {
  const dx = position.x - x, dy = position.y - y, dz = position.z - z;
  const distance = Math.hypot(dx, dy, dz);
  const cosine = dy / distance;
  const outer = Math.cos(light.angle), inner = Math.cos(light.angle * (1 - light.penumbra));
  const t = inner === outer ? +(cosine >= outer) : THREE.MathUtils.clamp((cosine - outer) / (inner - outer), 0, 1);
  result[0] = dx / distance; result[1] = dy / distance; result[2] = dz / distance;
  result[3] = t * t * (3 - 2 * t) * physicalFalloff(distance, light.distance, light.decay);
  return result;
}

function signature(light) {
  light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
  const p = light.matrixWorld.elements, t = light.target.matrixWorld.elements;
  return [p[12], p[13], p[14], t[12], t[13], t[14], light.angle, light.penumbra, light.distance, light.decay, light.castShadow, !!light.map];
}

function unchanged(record) {
  const light = record.lamp, s = record.signature;
  light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
  const p = light.matrixWorld.elements, t = light.target.matrixWorld.elements;
  return p[12] === s[0] && p[13] === s[1] && p[14] === s[2] && t[12] === s[3] && t[13] === s[4] && t[14] === s[5]
    && light.angle === s[6] && light.penumbra === s[7] && light.distance === s[8] && light.decay === s[9] && light.castShadow === s[10] && !!light.map === s[11];
}

export function bakeLampPlane(lamps, height) {
  const columns = Math.ceil(Math.sqrt(lamps.length)), rows = Math.ceil(lamps.length / columns);
  const width = columns * PAGE, textureHeight = rows * PAGE;
  const data = new Uint16Array(width * textureHeight * 4), bounds = [];
  const positions = lamps.map(light => new THREE.Vector3().setFromMatrixPosition(light.matrixWorld));
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  lamps.forEach((light, index) => {
    const p = positions[index], radius = Math.max(0.01, (p.y - height) * Math.tan(light.angle));
    const b = new THREE.Vector4(p.x - radius, p.z - radius, radius * 2, radius * 2); bounds.push(b);
    minX = Math.min(minX, b.x); minZ = Math.min(minZ, b.y); maxX = Math.max(maxX, b.x + b.z); maxZ = Math.max(maxZ, b.y + b.w);
    const sample = [];
    for (let y = 0; y < PAGE; y++) for (let x = 0; x < PAGE; x++) {
      sampleStationaryLamp(light, p, b.x + x / (PAGE - 1) * b.z, height, b.y + y / (PAGE - 1) * b.w, sample);
      const offset = ((Math.floor(index / columns) * PAGE + y) * width + index % columns * PAGE + x) * 4;
      for (let c = 0; c < 4; c++) data[offset + c] = THREE.DataUtils.toHalfFloat(sample[c]);
    }
  });
  minX = Math.floor(minX / CELL) * CELL; minZ = Math.floor(minZ / CELL) * CELL;
  const gw = Math.max(1, Math.ceil((maxX - minX) / CELL)), gh = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const ids = new Uint8Array(gw * gh * 4); let maxOverlap = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let matches = 0;
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      if (b.x > minX + (x + 1) * CELL || b.x + b.z < minX + x * CELL || b.y > minZ + (y + 1) * CELL || b.y + b.w < minZ + y * CELL) continue;
      if (matches === 4) throw new Error('Overlapping lamps exceed cache capacity; retain original lighting');
      ids[(y * gw + x) * 4 + matches++] = i + 1;
    }
    maxOverlap = Math.max(maxOverlap, matches);
  }
  const atlas = new THREE.DataTexture(data, width, textureHeight, THREE.RGBAFormat, THREE.HalfFloatType);
  atlas.minFilter = atlas.magFilter = THREE.LinearFilter; atlas.generateMipmaps = false; atlas.needsUpdate = true;
  const grid = new THREE.DataTexture(ids, gw, gh, THREE.RGBAFormat, THREE.UnsignedByteType);
  grid.minFilter = grid.magFilter = THREE.NearestFilter; grid.generateMipmaps = false; grid.needsUpdate = true;
  return { atlas, grid, bounds, columns, rows, gridBounds: new THREE.Vector4(minX, minZ, gw * CELL, gh * CELL), bytes: data.byteLength + ids.byteLength, maxOverlap };
}

export function createStaticLampCache(renderer, scene, { bake = true, gridStatic = false } = {}) {
  const records = [], fields = new Map(), shaders = new Set(), colours = [], cached = new Set();
  const lights = [], spots = [], visible = new Set();
  const stats = { lamps: 0, surfaces: 0, bytes: 0, bakeMs: 0, disabledReason: null };
  let prepared = false, enabled = true, valid = true;
  let skip = new Float32Array(0);
  const active = { value: 0 };
  const lampPositions=[],lampParameters=[];
  let lampData=null,lampDataValues=null;
  function prepare() {
    if (prepared) return; prepared = true;
    if (!bake) { stats.skippedReason = 'Static lighting cache disabled for this configuration'; return; }
    const start = performance.now(); scene.updateMatrixWorld(true);
    if (THREE.REVISION !== '160' || !renderer.capabilities.isWebGL2 || renderer._useLegacyLights) { stats.disabledReason = 'Unsupported renderer'; return; }
    const lamps = [];
    scene.traverse(o => {
      if (!o.isSpotLight || !o.userData.stationaryStreetLamp || o.castShadow || o.map) return;
      o.target.updateWorldMatrix(true, false);
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld), t = new THREE.Vector3().setFromMatrixPosition(o.target.matrixWorld);
      if (Math.abs(p.x - t.x) > 1e-6 || Math.abs(p.z - t.z) > 1e-6 || p.y <= t.y) return;
      lamps.push(o);
    });
    if (!lamps.length || lamps.length > MAX_LAMPS) return;
    const materials = new Set();
    scene.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
        if (m?.isMeshStandardMaterial && Number.isFinite(m.userData.staticLampHeight)) materials.add(m);
    });
    if(gridStatic){
      const clones=new Map();
      scene.traverse(o=>{
        if(!o.isMesh||o.isSkinnedMesh)return;
        let fixed=!!o.userData.sceneryBatch, movable=false;
        for(let parent=o;parent&&parent!==scene;parent=parent.parent){
          fixed ||= !!parent.userData.staticScenery;
          movable ||= !!parent.userData.supply;
        }
        if(!fixed||movable)return;
        const convert=m=>{
          if(!m?.isMeshStandardMaterial||m.transparent||Number.isFinite(m.userData.staticLampHeight))return m;
          if(!clones.has(m)){
            const copy=m.clone();copy.onBeforeCompile=m.onBeforeCompile;copy.customProgramCacheKey=m.customProgramCacheKey;
            copy.userData.staticLampGrid=true;clones.set(m,copy);materials.add(copy);
          }
          return clones.get(m);
        };
        o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);
      });
    }
    try {
      for (const m of materials) {
        const h = m.userData.staticLampGrid ? 'static-grid' : m.userData.staticLampHeight;
        if (!fields.has(h)) {
          const field=bakeLampPlane(lamps, h==='static-grid'?-.1:h);
          field.staticGrid=h==='static-grid';fields.set(h,field);
        }
      }
    } catch (error) {
      for (const f of fields.values()) { f.atlas.dispose(); f.grid.dispose(); }
      fields.clear(); stats.disabledReason = error.message; console.warn('[static lamps]', error.message); return;
    }
    for (const lamp of lamps) { records.push({ lamp, signature: signature(lamp) }); cached.add(lamp); colours.push(new THREE.Vector3()); }
    for(const lamp of lamps){
      lampPositions.push(new THREE.Vector3().setFromMatrixPosition(lamp.matrixWorld));
      lampParameters.push(new THREE.Vector4(Math.cos(lamp.angle),Math.cos(lamp.angle*(1-lamp.penumbra)),lamp.distance,lamp.decay));
    }
    if(fields.has('static-grid')){
      lampDataValues=new Float32Array(lamps.length*16);
      const bounds=fields.get('static-grid').bounds;
      lamps.forEach((lamp,i)=>{
        lampPositions[i].toArray(lampDataValues,i*16);
        lampParameters[i].toArray(lampDataValues,i*16+4);
        bounds[i].toArray(lampDataValues,i*16+12);
      });
      lampData=new THREE.DataTexture(lampDataValues,4,lamps.length,THREE.RGBAFormat,THREE.FloatType);
      lampData.minFilter=lampData.magFilter=THREE.NearestFilter;lampData.generateMipmaps=false;lampData.needsUpdate=true;
    }
    stats.lamps = lamps.length;
    for (const f of fields.values()) stats.bytes += f.bytes;
    stats.bytes+=lampDataValues?.byteLength||0;
    for (const material of materials) install(material, fields.get(material.userData.staticLampGrid?'static-grid':material.userData.staticLampHeight));
    stats.gridSurfaces=[...materials].filter(m=>m.userData.staticLampGrid).length;
    stats.surfaces = materials.size; stats.bakeMs = performance.now() - start;
    console.info('[static lamps]', { ...stats });
  }
  function install(material, field) {
    const previous = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => key() + `:static-lamp-v2:${records.length}:${field.staticGrid?'grid':'plane'}`;
    material.onBeforeCompile = function(shader, ...args) {
      previous.call(this, shader, ...args);
      const uniforms = {
        uStaticLampActive: active, uStaticSpotSkip: { value: skip },
        uStaticLampAtlas: { value: field.atlas }, uStaticLampGrid: { value: field.grid },
        uStaticLampBounds: { value: field.bounds }, uStaticLampColours: { value: colours },
        uStaticLampGridBounds: { value: field.gridBounds },
        uStaticLampData:{value:lampData},
      };
      Object.assign(shader.uniforms, uniforms); shaders.add(uniforms);
      shader.vertexShader = 'varying vec3 vStaticLampWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 staticLampWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          staticLampWorld = instanceMatrix * staticLampWorld;
        #endif
        vStaticLampWorld = (modelMatrix * staticLampWorld).xyz;
        #include <project_vertex>`);
      shader.fragmentShader = `
        varying vec3 vStaticLampWorld;
        uniform float uStaticLampActive;
        #if NUM_SPOT_LIGHTS > 0
          uniform float uStaticSpotSkip[NUM_SPOT_LIGHTS];
        #endif
        uniform sampler2D uStaticLampAtlas, uStaticLampGrid;
        uniform vec4 uStaticLampBounds[${records.length}], uStaticLampGridBounds;
        uniform vec3 uStaticLampColours[${records.length}];
        uniform sampler2D uStaticLampData;
      ` + shader.fragmentShader;
      let chunk = THREE.ShaderChunk.lights_fragment_begin;
      const begin = chunk.indexOf('spotLight = spotLights[ i ];');
      const end = chunk.indexOf('\n\t}', begin);
      if (begin < 0 || end < 0) throw new Error('Unsupported Three.js spot lighting chunk');
      chunk = chunk.slice(0, begin) + 'if (uStaticSpotSkip[i] < 0.5) {\n' + chunk.slice(begin, end) + '\n}' + chunk.slice(end);
      let cached = `
        if (uStaticLampActive > 0.5) {
          vec2 staticGridUv = (vStaticLampWorld.xz - uStaticLampGridBounds.xy) / uStaticLampGridBounds.zw;
          if (all(greaterThanEqual(staticGridUv,vec2(0.0))) && all(lessThan(staticGridUv,vec2(1.0)))) {
            vec4 staticIds = floor(texture2D(uStaticLampGrid, staticGridUv) * 255.0 + 0.5);
      `;
      for (const component of ['x','y','z','w']) cached += `
        if (staticIds.${component} > 0.5) {
          int lampId = int(staticIds.${component}) - 1;
          vec4 lampBounds = uStaticLampBounds[lampId];
          vec2 lampUv = (vStaticLampWorld.xz - lampBounds.xy) / lampBounds.zw;
          if (all(greaterThanEqual(lampUv,vec2(0.0))) && all(lessThanEqual(lampUv,vec2(1.0)))) {
            vec2 pageOffset = vec2(mod(float(lampId),${field.columns}.0),floor(float(lampId)/${field.columns}.0));
            vec2 atlasUv = (pageOffset * ${PAGE}.0 + lampUv * ${PAGE-1}.0 + 0.5) / vec2(${field.columns * PAGE}.0,${field.rows * PAGE}.0);
            vec4 incident = texture2D(uStaticLampAtlas, atlasUv);
            directLight.direction = mat3(viewMatrix) * incident.xyz;
            directLight.color = uStaticLampColours[lampId] * incident.w;
            directLight.visible = (directLight.color != vec3(0.0));
            RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          }
        }
      `;
      if(field.staticGrid){
        cached=cached.replace(/vec4 lampBounds = uStaticLampBounds\[lampId\];/g,`vec4 lampBounds=texture2D(uStaticLampData,vec2(.875,(float(lampId)+.5)/${records.length}.0));`);
        // One tiny shared texture avoids uploading lamp arrays for every wall material.
        cached=cached.replace(/            vec2 pageOffset[\s\S]*?directLight.visible = \(directLight.color != vec3\(0.0\)\);/g, `
            float lampRow=(float(lampId)+.5)/${records.length}.0;
            vec3 toLamp=texture2D(uStaticLampData,vec2(.125,lampRow)).xyz-vStaticLampWorld;
            float lampDistance=length(toLamp);
            vec4 params=texture2D(uStaticLampData,vec2(.375,lampRow));
            directLight.direction=mat3(viewMatrix)*(toLamp/max(lampDistance,0.0001));
            float cone=smoothstep(params.x,params.y,toLamp.y/max(lampDistance,0.0001));
            directLight.color=texture2D(uStaticLampData,vec2(.625,lampRow)).rgb*cone*getDistanceAttenuation(lampDistance,params.z,params.w);
            directLight.visible=(directLight.color!=vec3(0.0));`);
      }
      cached += '}}';
      chunk = chunk.replace('#if ( NUM_DIR_LIGHTS > 0 )', cached + '\n#if ( NUM_DIR_LIGHTS > 0 )');
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
    };
    material.needsUpdate = true;
  }
  function update(camera) {
    if (!prepared) prepare();
    if (!records.length) return;
    lights.length = 0; spots.length = 0; visible.clear();
    scene.traverseVisible(o => {
      if (!o.isLight) return;
      // Live-light budgeting must not switch off an authored cached contribution.
      const authoredMask = o.userData.streetLampAuthoredLayerMask ?? o.layers.mask;
      if ((authoredMask & camera.layers.mask) !== 0) visible.add(o);
      if (camera.layers.test(o.layers)) lights.push(o);
    });
    // Same stable ordering as Three r160's WebGLLights; include map/shadow lights.
    lights.sort((a,b) => ((b.castShadow ? 2 : 0) + (b.map ? 1 : 0)) - ((a.castShadow ? 2 : 0) + (a.map ? 1 : 0)));
    for (const light of lights) { if (light.isSpotLight) spots.push(light); }
    if (skip.length !== spots.length) skip = new Float32Array(spots.length);
    for (const r of records) if (!unchanged(r)) valid = false;
    const use = enabled && valid && !renderer._useLegacyLights;
    active.value = +use;
    spots.forEach((lamp, i) => { skip[i] = +(use && cached.has(lamp)); });
    records.forEach(({lamp}, i) => colours[i].set(lamp.color.r, lamp.color.g, lamp.color.b).multiplyScalar(visible.has(lamp) ? lamp.intensity : 0));
    if(lampData){
      let dirty=false;
      colours.forEach((colour,i)=>{for(let c=0;c<3;c++){const value=colour.getComponent(c),offset=i*16+8+c;if(lampDataValues[offset]!==Math.fround(value)){lampDataValues[offset]=value;dirty=true;}}});
      if(dirty)lampData.needsUpdate=true;
    }
    for (const uniforms of shaders) uniforms.uStaticSpotSkip.value = skip;
  }
  const render = renderer.render;
  renderer.render = function(renderScene, camera) {
    if (renderScene === scene) update(camera);
    return render.call(this, renderScene, camera);
  };
  return { stats, prepare, setEnabled(value) { enabled = !!value; }, get enabled() { return enabled && valid && !!records.length && stats.surfaces>0; } };
}

export function installStreetLampBudget(renderer,scene,cache,maxLive=6){
 const sources=[];let next=-Infinity;const render=renderer.render;
 renderer.render=function(world,camera){
  if(world===scene){cache.prepare();if(performance.now()>=next){
   next=performance.now()+100;sources.length=0;
   scene.traverse(o=>{if(o.isSpotLight&&o.userData.stationaryStreetLamp)sources.push(o);});
   sources.sort((a,b)=>a.position.distanceToSquared(camera.position)-b.position.distanceToSquared(camera.position));
   sources.forEach((o,i)=>{o.userData.streetLampAuthoredLayerMask??=o.layers.mask;o.layers.mask=(i<maxLive||!cache.enabled)?o.userData.streetLampAuthoredLayerMask:0;});
  }}
  return render.call(this,world,camera);
 };
}
