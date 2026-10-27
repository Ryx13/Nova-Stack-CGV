"""Create disposable tutorial fixture with test hooks in a copy of the module."""
from pathlib import Path
import time
root = Path(__file__).resolve().parent.parent
version = str(time.time_ns())
source = (root / 'IntroTutorial.js').read_text(encoding='utf-8')
hooks = '''active={dispose,test:{
  snapshot:()=>({phase,blocked,thirdPerson,shot,history:narrative.history.length}),
  advance(seconds){cancelAnimationFrame(raf);for(let i=0;i<seconds*20;i++){tick(last+50);cancelAnimationFrame(raf);}},
  move(x,z){playerPosition.set(x,0,z);walkDistance=2;yaw=Math.PI;pitch=0;},
  key:keydown,release:keyup,toggle:toggleView,guide:()=>manual.onclick(),
  aim(){const delta=target.position.clone().sub(playerPosition.clone().setY(1.65));yaw=Math.atan2(delta.x,delta.z);pitch=Math.atan2(delta.y,Math.hypot(delta.x,delta.z));},
  fire(){ray.setFromCamera(new THREE.Vector2(),camera);if(ray.intersectObject(target).length){target.material.color.setHex(0x8fe0ff);phase='reload';return true;}return false;}
}}'''
source = source.replace('active={dispose}', hooks).replace('./Narrative.js', f'./Narrative.js?v={version}').replace('./TutorialAvatar.js', f'./TutorialAvatar.js?v={version}')
(root / 'smoke-tutorial-module.js').write_text(source, encoding='utf-8')
(root / 'smoke-tutorial.html').write_text((root / 'index.html').read_text(encoding='utf-8').replace('src="main.js"',f'src="smoke-tutorial.mjs?v={version}"'),encoding='utf-8')
(root / 'smoke-tutorial.mjs').write_text((root / 'tests/tutorial-smoke.mjs').read_text(encoding='utf-8').replace('./smoke-tutorial-module.js', f'./smoke-tutorial-module.js?v={version}'),encoding='utf-8')
