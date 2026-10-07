// Intro.js — standalone HTML storyboard. It deliberately imports no game
// systems, so the opening can be changed or removed without touching levels.
//
// Fixes applied:
//   1. Each slide now shows its OWN background image (crossfaded between two
//      stacked layers) instead of one static image for the whole storyboard.
//   2. The storyline copy text is now much larger and easier to read.
const SLIDES = [
  ['SEISMIC EVENT', 'Six days ago, an earthquake tore through the industrial district and shattered containment at the research annex.', 'assets/splash1.jpg'],
  ['CONTAINMENT FAILURE', 'The chemical cloud escaped before the vents could be sealed. Everyone caught outside began changing within the hour.', 'assets/splash2.jpg'],
  ['THE SAFE ROOM', 'You were delivering a package when Dr. James pulled you into the underground safe room. She could not save the others.', 'assets/splash1.jpg'],
  ['ONE LAST CHANCE', 'Dr. James is close to a cure. Recover the culture sample, stabilize the infected, and bring everyone home.', 'assets/splash2.jpg'],
];

let ui;

function build() {
  if (ui) return ui;
  const style = document.createElement('style');
  style.textContent = `
    #opening-story{position:fixed;inset:0;z-index:90;display:grid;place-items:end center;padding:8vh 24px;background:#030405;overflow:hidden}
    #opening-story.hidden{display:none!important}
    #opening-frame{position:absolute;inset:0}
    #opening-frame .layer{position:absolute;inset:0;background-size:cover;background-position:center;filter:saturate(.45) contrast(1.15);opacity:0;transition:opacity .9s ease}
    #opening-frame .layer.show{opacity:1}
    #opening-frame:after{content:'';position:absolute;inset:0;background:linear-gradient(125deg,rgba(15,2,2,.2),rgba(3,7,10,.15) 40%,rgba(0,0,0,.94)),radial-gradient(circle at 30% 20%,rgba(210,45,20,.3),transparent 36%)}
    #opening-card{position:relative;width:min(900px,100%);text-align:center;border-top:1px solid rgba(206,224,230,.35);padding-top:24px;text-shadow:0 2px 8px #000}
    #opening-kicker{color:#bff0ff;letter-spacing:5px;font:700 16px Oswald,sans-serif}
    #opening-copy{min-height:140px;margin:18px 0;color:#f0ece4;font:500 clamp(26px,4vw,40px)/1.5 Rajdhani,sans-serif}
    #opening-progress{display:flex;justify-content:center;gap:7px;margin:16px 0} #opening-progress i{width:28px;height:3px;background:#555;transition:background .2s} #opening-progress i.on{background:#bff0ff}
    #opening-actions{display:flex;justify-content:center;gap:12px} #opening-actions button{padding:11px 22px;color:#f5f2ec;background:rgba(2,6,8,.65);border:1px solid #bff0ff;font:600 13px Oswald,sans-serif;letter-spacing:2px;text-transform:uppercase;cursor:pointer} #opening-actions button:hover{background:#bff0ff;color:#071014}
  `;
  document.head.appendChild(style);
  const root = document.createElement('section');
  root.id = 'opening-story'; root.className = 'hidden';
  root.innerHTML = `<div id="opening-frame"><div class="layer" data-slot="a"></div><div class="layer" data-slot="b"></div></div><div id="opening-card"><div id="opening-kicker"></div><p id="opening-copy"></p><div id="opening-progress"></div><div id="opening-actions"><button id="opening-skip">Skip story</button><button id="opening-next">Continue</button></div></div>`;
  document.body.appendChild(root);
  ui = {
    root,
    kicker: root.querySelector('#opening-kicker'),
    copy: root.querySelector('#opening-copy'),
    progress: root.querySelector('#opening-progress'),
    next: root.querySelector('#opening-next'),
    skip: root.querySelector('#opening-skip'),
    layerA: root.querySelector('.layer[data-slot="a"]'),
    layerB: root.querySelector('.layer[data-slot="b"]'),
    frontIsA: true,
  };
  return ui;
}

// Crossfades the background to `src` by swapping which stacked layer is on top.
function setBackground(el, src) {
  const incoming = el.frontIsA ? el.layerB : el.layerA;
  const outgoing = el.frontIsA ? el.layerA : el.layerB;
  incoming.style.backgroundImage = `url('${src}')`;
  incoming.classList.add('show');
  outgoing.classList.remove('show');
  el.frontIsA = !el.frontIsA;
}

export function playStoryboard() {
  const el = build(); let index = 0;
  return new Promise((resolve) => {
    const render = () => {
      const [kicker, copy, image] = SLIDES[index];
      el.kicker.textContent = kicker; el.copy.textContent = copy;
      setBackground(el, image);
      el.progress.innerHTML = SLIDES.map((_, i) => `<i class="${i <= index ? 'on' : ''}"></i>`).join('');
      el.next.textContent = index === SLIDES.length - 1 ? 'Enter safe room' : 'Continue';
    };
    const finish = () => { el.root.classList.add('hidden'); el.next.onclick = null; el.skip.onclick = null; resolve(); };
    el.next.onclick = () => index === SLIDES.length - 1 ? finish() : (index++, render());
    el.skip.onclick = finish;
    el.root.classList.remove('hidden'); render();
  });
}
