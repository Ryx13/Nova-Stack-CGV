import * as THREE from 'three';

// Approximate low mist along the eye-to-surface ray. It shares the opaque
// surface's depth test, so there is no horizontal sheet cutting through rigs.
export const mistEnabled = { value: 1 };
let installed = false;
export function installHeightMist(uniforms) {
  if(installed)return;installed=true;
  const previous=THREE.Material.prototype.onBeforeCompile;
  THREE.Material.prototype.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.uniforms.dwMistColor=uniforms.uColor;
    shader.uniforms.dwMistOpacity=uniforms.uOpacity;
    shader.uniforms.dwMistEnabled=mistEnabled;
  };
  THREE.ShaderChunk.fog_pars_vertex += '\n#ifdef USE_FOG\nvarying vec3 vMistPosition;\n#endif\n';
  THREE.ShaderChunk.fog_vertex += `
    #ifdef USE_FOG
      // Reconstruct world position from view space. Works for meshes,
      // skinned rigs, instances, points and billboard sprites alike.
      vMistPosition=cameraPosition+vec3(dot(viewMatrix[0].xyz,mvPosition.xyz),
        dot(viewMatrix[1].xyz,mvPosition.xyz),dot(viewMatrix[2].xyz,mvPosition.xyz));
    #endif
  `;
  THREE.ShaderChunk.fog_pars_fragment += `
    #ifdef USE_FOG
      varying vec3 vMistPosition;
      uniform vec3 dwMistColor;
      uniform float dwMistOpacity;
      uniform float dwMistEnabled;
    #endif
  `;
  THREE.ShaderChunk.fog_fragment += `
    #ifdef USE_FOG
      if(dwMistEnabled>0.5){
        float eyeHeight=max(cameraPosition.y,0.0);
        float surfaceHeight=max(vMistPosition.y,0.0);
        // Cheap smooth approximation to the height-weighted view-ray density.
        // Avoid per-pixel exponentials; disabled daylight mist skips this branch.
        float heightSum=eyeHeight+surfaceHeight;
        float averageDensity=1.0/(1.0+0.35*heightSum*heightSum);
        float mistDistance=length(cameraPosition-vMistPosition);
        float opticalDepth=0.035*mistDistance*averageDensity;
        float mistAmount=opticalDepth/(1.0+opticalDepth)*dwMistOpacity;
        mistAmount*=smoothstep(2.0,9.0,mistDistance);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,dwMistColor,clamp(mistAmount,0.0,0.65));
      }
    #endif
  `;
}
