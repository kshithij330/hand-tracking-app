/**
 * Hand Tracker AR — app.js
 * 2D Mode: Right hand → Size/Rotation | Left hand → Hue/Sat
 * 3D Mode: Right hand open → wrist pos drives 3D rotation | Left hand → colour
 * Any hand pinch → drag (2D) | Quick tap → cycle shape
 */

// ── DOM ──────────────────────────────────────────────────────────────
const videoEl       = document.getElementById('webcam-video');
const canvas        = document.getElementById('main-canvas');
const ctx           = canvas.getContext('2d');
const threeCanvas   = document.getElementById('three-canvas');
const statusDot     = document.getElementById('status-dot');
const noHandOverlay = document.getElementById('no-hand-overlay');
const shapeBadge    = document.getElementById('shape-badge');
const rightHint     = document.getElementById('right-hint');

// ── App mode ──────────────────────────────────────────────────────────
let appMode = '2D';

// ── Shapes ────────────────────────────────────────────────────────────
const SHAPES = ['square', 'triangle', 'circle'];
let shapeTypeIndex = 0;

// ── Visual config (lerped) ────────────────────────────────────────────
const shapeConfig = { rotation: 0, size: 120, hue: 260, saturation: 80 };
const shapePos    = { x: 0, y: 0 };

// ── Three.js state ────────────────────────────────────────────────────
let threeRenderer = null, threeScene = null, threeCamera = null, threeMesh = null;
const TARGET3D      = { rotX: 0, rotY: 0, scale: 1 };
let   idleSpin      = 0;
const prevWrist     = { x: null, y: null }; // for delta-based 3D rotation

// ── Lerp targets ─────────────────────────────────────────────────────
const TARGET = { size: 120, rot: 0, hue: 260, sat: 80 };
const LERP   = 0.15;
function lerp(a, b, t) { return a + (b - a) * t; }

// ── Pinch constants ───────────────────────────────────────────────────
const PINCH_CLOSE = 55, PINCH_OPEN = 75, TAP_MIN = 60, TAP_MAX = 900;

// ── Per-hand state ────────────────────────────────────────────────────
const pinch = {
  Left:  { closed: false, closeTime: 0, fingerMid: { x: 0, y: 0 } },
  Right: { closed: false, closeTime: 0, fingerMid: { x: 0, y: 0 } },
};
const drag = { active: false, startMid: { x:0,y:0 }, startShapePos: { x:0,y:0 } };

// ── Utilities ─────────────────────────────────────────────────────────
const dist     = (x1,y1,x2,y2) => Math.hypot(x2-x1, y2-y1);
const angleDeg = (x1,y1,x2,y2) => (Math.atan2(y2-y1,x2-x1)*180/Math.PI+360)%360;
const mapRange = (v,a,b,c,d)   => c + ((v-a)/(b-a))*(d-c);
const clamp    = (v,mn,mx)     => Math.min(Math.max(v,mn),mx);

// ── Canvas / renderer resize ──────────────────────────────────────────
function resizeAll() {
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  if (shapePos.x === 0) { shapePos.x = W/2; shapePos.y = H/2; }
  if (threeRenderer) {
    threeRenderer.setSize(W, H);
    threeCamera.aspect = W/H;
    threeCamera.updateProjectionMatrix();
  }
}
resizeAll();
window.addEventListener('resize', resizeAll);

// ── 2D drawing helpers ────────────────────────────────────────────────
function rrPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.closePath();
}

function drawShape2D(cx, cy, size, rot, hue, sat, type) {
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(rot);
  ctx.shadowColor = `hsla(${hue},${sat}%,60%,0.5)`;
  ctx.shadowBlur  = size*0.6;
  ctx.fillStyle   = `hsl(${hue},${sat}%,50%)`;
  if (type==='square')   { const h=size/2,r=size*0.1; rrPath(ctx,-h,-h,size,size,r); }
  else if (type==='triangle') {
    const h=size*Math.sqrt(3)/2;
    ctx.beginPath(); ctx.moveTo(0,-h*2/3); ctx.lineTo(size/2,h/3); ctx.lineTo(-size/2,h/3); ctx.closePath();
  } else { ctx.beginPath(); ctx.arc(0,0,size/2,0,Math.PI*2); }
  ctx.fill();
  ctx.shadowBlur=0; ctx.strokeStyle=`hsla(${hue},${sat}%,90%,0.75)`; ctx.lineWidth=2.5; ctx.stroke();
  ctx.restore();
}

function drawDot(x, y, color, r=8) {
  ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.shadowColor=color; ctx.shadowBlur=14; ctx.fill();
  ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.stroke(); ctx.restore();
}

function drawLine(x1,y1,x2,y2,color) {
  ctx.save(); ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineCap='round';
  ctx.shadowColor=color; ctx.shadowBlur=8; ctx.stroke(); ctx.restore();
}

function drawLabel(text, x, y, color) {
  ctx.save(); ctx.font='13px "Space Mono",monospace'; ctx.textAlign='center';
  const bw=ctx.measureText(text).width+20, bh=22;
  rrPath(ctx,x-bw/2,y-bh/2,bw,bh,6); ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fill();
  ctx.fillStyle=color; ctx.fillText(text,x,y+5); ctx.restore();
}

function drawDragBridge(p1,p2) {
  ctx.save();
  const g=ctx.createLinearGradient(p1.x,p1.y,p2.x,p2.y);
  g.addColorStop(0,'rgba(251,191,36,0.9)'); g.addColorStop(0.5,'rgba(167,139,250,0.9)'); g.addColorStop(1,'rgba(96,165,250,0.9)');
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
  ctx.strokeStyle=g; ctx.lineWidth=3; ctx.lineCap='round'; ctx.setLineDash([8,6]);
  ctx.shadowColor='rgba(167,139,250,0.7)'; ctx.shadowBlur=12; ctx.stroke(); ctx.restore();
}

// ── Three.js setup ────────────────────────────────────────────────────
function initThreeJS() {
  threeRenderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true });
  threeRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  threeRenderer.setSize(window.innerWidth, window.innerHeight);

  threeScene  = new THREE.Scene();
  threeCamera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 100);
  threeCamera.position.z = 3.5;

  threeScene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dl = new THREE.DirectionalLight(0xffffff, 1.5);
  dl.position.set(3, 4, 5); threeScene.add(dl);
  const fl = new THREE.DirectionalLight(0x8888ff, 0.5);
  fl.position.set(-3,-2,-3); threeScene.add(fl);

  createThreeMesh();
}

function makeGeo(type) {
  if (type==='square')   return new THREE.BoxGeometry(1.6,1.6,1.6);
  if (type==='triangle') return new THREE.TetrahedronGeometry(1.15);
  return new THREE.SphereGeometry(0.95, 48, 48);
}

function createThreeMesh() {
  if (threeMesh) { threeScene.remove(threeMesh); threeMesh=null; }
  const geo = makeGeo(SHAPES[shapeTypeIndex]);
  const mat = new THREE.MeshStandardMaterial({
    color:     new THREE.Color().setHSL(shapeConfig.hue/360, shapeConfig.saturation/100, 0.5),
    emissive:  new THREE.Color().setHSL(shapeConfig.hue/360, shapeConfig.saturation/100, 0.12),
    metalness: 0.4, roughness: 0.3,
  });
  threeMesh = new THREE.Mesh(geo, mat);
  threeMesh.rotation.x = TARGET3D.rotX;
  threeMesh.rotation.y = TARGET3D.rotY;
  threeScene.add(threeMesh);
  // Wireframe edges
  threeMesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:0.22 })
  ));
}

function renderThree() {
  if (!threeRenderer || !threeMesh) return;
  threeMesh.rotation.x = lerp(threeMesh.rotation.x, TARGET3D.rotX, 0.1);
  threeMesh.rotation.y = lerp(threeMesh.rotation.y, TARGET3D.rotY, 0.1);
  threeMesh.scale.setScalar(lerp(threeMesh.scale.x, TARGET3D.scale, 0.1));

  // Map shapePos (pixels) to 3D world space
  const tx = mapRange(shapePos.x, 0, canvas.width, -4, 4);
  const ty = mapRange(shapePos.y, 0, canvas.height, 3, -3);
  threeMesh.position.x = lerp(threeMesh.position.x, tx, 0.1);
  threeMesh.position.y = lerp(threeMesh.position.y, ty, 0.1);

  threeMesh.material.color.setHSL(shapeConfig.hue/360, shapeConfig.saturation/100, 0.5);
  threeMesh.material.emissive.setHSL(shapeConfig.hue/360, shapeConfig.saturation/100, 0.12);
  threeRenderer.render(threeScene, threeCamera);
}

// ── Mode switch ───────────────────────────────────────────────────────
function setMode(m) {
  appMode = m;
  threeCanvas.style.display = m==='3D' ? 'block' : 'none';
  if (m==='3D') {
    if (!threeRenderer) initThreeJS(); else createThreeMesh();
  }
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode===m));
  if (rightHint) rightHint.textContent = m==='3D' ? 'Right Hand — 3D Rotation' : 'Right Hand — Size & Rotation';
}

// ── Shape badge ───────────────────────────────────────────────────────
function updateShapeBadge() {
  const icons = { square:'⬛', triangle:'🔺', circle:'🔵' };
  const name  = SHAPES[shapeTypeIndex];
  if (shapeBadge) shapeBadge.textContent = `${icons[name]} ${name[0].toUpperCase()+name.slice(1)}`;
}
updateShapeBadge();

// ── onResults ─────────────────────────────────────────────────────────
let handsVisible = false;

function onResults(results) {
  const W = canvas.width, H = canvas.height;
  const videoW = results.image.width;
  const videoH = results.image.height;

  // Calculate 'cover' scale for the mirrored video
  const scale = Math.max(W / videoW, H / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const offsetX = (W - drawW) / 2;
  const offsetY = (H - drawH) / 2;

  // Mirrored video (object-fit: cover implementation on canvas)
  ctx.save();
  ctx.scale(-1, 1);
  // Draw the video centered and scaled to cover the canvas
  ctx.drawImage(results.image, -W - offsetX, offsetY, drawW, drawH);
  ctx.restore();

  // Vignette
  const vgr = ctx.createRadialGradient(W/2,H/2,H*0.2,W/2,H/2,H*0.8);
  vgr.addColorStop(0,'rgba(0,0,0,0)'); vgr.addColorStop(1,'rgba(0,0,0,0.3)');
  ctx.fillStyle=vgr; ctx.fillRect(0,0,W,H);

  handsVisible = false;
  const frameHands = {};

  if (results.multiHandLandmarks?.length > 0) {
    handsVisible = true;
    for (let i=0; i<results.multiHandLandmarks.length; i++) {
      const lm   = results.multiHandLandmarks[i];
      const hand = results.multiHandedness[i].label==='Right' ? 'Left' : 'Right';

      // Map landmarks to the 'cover' video area
      const tx = (1 - lm[4].x) * drawW + offsetX;
      const ty = lm[4].y * drawH + offsetY;
      const ix = (1 - lm[8].x) * drawW + offsetX;
      const iy = lm[8].y * drawH + offsetY;
      const wx = (1 - lm[0].x) * drawW + offsetX;
      const wy = lm[0].y * drawH + offsetY;

      // Normalised position for 3D control (relative to canvas centroide/dimensions)
      const wnx = (wx - offsetX) / drawW;
      const wny = (wy - offsetY) / drawH;

      frameHands[hand] = {
        tx,ty,ix,iy,wx,wy,wnx,wny,
        d: dist(tx,ty,ix,iy),
        angle: angleDeg(tx,ty,ix,iy),
        mx:(tx+ix)/2, my:(ty+iy)/2,
      };
    }
  }

  // ── Pinch state machine ───────────────────────────────────────────
  const now = Date.now();
  const tapFired = { Left:false, Right:false };

  for (const hand of ['Left','Right']) {
    const s=pinch[hand], d=frameHands[hand];
    if (!d) {
      s.closed=false; s.fingerMid={x:0,y:0};
      if (hand==='Right') { prevWrist.x=null; prevWrist.y=null; } // reset delta tracker
      continue;
    }
    s.fingerMid = { x:d.mx, y:d.my };
    if (!s.closed && d.d < PINCH_CLOSE) { s.closed=true; s.closeTime=now; }
    else if (s.closed && d.d > PINCH_OPEN) {
      const held=now-s.closeTime; s.closed=false;
      if (held>=TAP_MIN && held<=TAP_MAX) tapFired[hand]=true;
    }
  }

  // ── Drag (2D only) ────────────────────────────────────────────────
  // Handle dragging (single-hand pinch)
  const lc=pinch.Left.closed&&frameHands.Left, rc=pinch.Right.closed&&frameHands.Right;
  const any=lc||rc;

  if (any) {
    let cx,cy;
    // Single-hand drag only
    if (lc) { cx=pinch.Left.fingerMid.x;  cy=pinch.Left.fingerMid.y; }
    else    { cx=pinch.Right.fingerMid.x; cy=pinch.Right.fingerMid.y; }

    if (!drag.active) { drag.active=true; drag.startMid={x:cx,y:cy}; drag.startShapePos={x:shapePos.x,y:shapePos.y}; }
    shapePos.x = clamp(drag.startShapePos.x+(cx-drag.startMid.x), 0, W);
    shapePos.y = clamp(drag.startShapePos.y+(cy-drag.startMid.y), 0, H);
  } else {
    drag.active = false;
  }

  // ── Shape cycle on quick tap ──────────────────────────────────────
  for (const hand of ['Left','Right']) {
    if (tapFired[hand] && !drag.active) {
      shapeTypeIndex = (shapeTypeIndex+1) % SHAPES.length;
      updateShapeBadge();
      if (appMode==='3D' && threeRenderer) createThreeMesh();
      if (shapeBadge) { shapeBadge.classList.add('flash'); setTimeout(()=>shapeBadge.classList.remove('flash'),350); }
      break;
    }
  }

  // ── Hand overlays & control updates ──────────────────────────────
  for (const [hand, data] of Object.entries(frameHands)) {
    const {tx,ty,ix,iy,wx,wy,wnx,wny,d,angle,mx,my} = data;
    const isClosed=pinch[hand].closed, isRight=hand==='Right';
    const lineCol = isRight ? 'rgba(251,191,36,0.9)' : `hsla(${angle},90%,65%,0.9)`;
    const dotCol  = isRight ? '#f59e0b'              : `hsl(${angle},90%,65%)`;

    drawLine(tx,ty,ix,iy,lineCol);
    drawDot(tx,ty,dotCol); drawDot(ix,iy,dotCol);

    if (isClosed) {
      ctx.save(); ctx.beginPath(); ctx.arc(mx,my,18,0,Math.PI*2);
      ctx.strokeStyle=isRight?'#fde68a':'#e9d5ff'; ctx.lineWidth=2; ctx.setLineDash([4,4]);
      ctx.shadowColor=dotCol; ctx.shadowBlur=12; ctx.stroke(); ctx.restore();
      drawLabel('GRAB', mx, my-28, isRight?'#fde68a':'#e9d5ff');
    } else {
      if (appMode==='3D' && isRight) {
        // Show wrist control point
        drawDot(wx, wy, 'rgba(167,139,250,0.85)', 10);
        drawLabel('3D CTRL', wx, wy-26, '#e9d5ff');
      } else if (isRight) {
        drawLabel(`📏 ${Math.round(d)}px`, mx, my-22, '#fde68a');
      } else {
        drawLabel(`🎨 H:${Math.round(angle)}°`, mx, my-22, '#e9d5ff');
      }
    }

    // ── Update targets ──────────────────────────────────────────────
    if (!isClosed) {
      if (appMode==='2D') {
        if (isRight) { TARGET.size=mapRange(d,30,300,60,350); TARGET.rot=(angle*Math.PI)/180; }
        else         { TARGET.hue=angle; TARGET.sat=mapRange(d,30,300,20,100); }
      } else {
        // 3D mode
        if (isRight) {
          // Delta-based rotation: how much the wrist moved this frame
          if (prevWrist.x !== null) {
            const dx = (wx - prevWrist.x) / canvas.width;
            const dy = (wy - prevWrist.y) / canvas.height;
            TARGET3D.rotY += dx * 5.0;
            TARGET3D.rotX  = clamp(TARGET3D.rotX + dy * 5.0, -Math.PI*0.5, Math.PI*0.5);
          }
          prevWrist.x = wx; prevWrist.y = wy;

          // Thumb–index distance → mesh scale (re-added for 3D)
          TARGET3D.scale = mapRange(d, 30, 300, 0.4, 2.5);
        } else {
          TARGET.hue=angle; TARGET.sat=mapRange(d,30,300,20,100);
        }
      }
    }
  }

  // (drag bridge removed — single-hand drag only)

  // ── Lerp colour (both modes) ──────────────────────────────────────
  shapeConfig.hue = lerp(shapeConfig.hue, TARGET.hue, LERP);
  shapeConfig.saturation = lerp(shapeConfig.saturation, TARGET.sat, LERP);

  // ── Render shape ──────────────────────────────────────────────────
  if (appMode==='2D') {
    shapeConfig.size     = lerp(shapeConfig.size,     TARGET.size, LERP);
    shapeConfig.rotation = lerp(shapeConfig.rotation, TARGET.rot,  LERP);
    drawShape2D(shapePos.x, shapePos.y, shapeConfig.size, shapeConfig.rotation,
                shapeConfig.hue, shapeConfig.saturation, SHAPES[shapeTypeIndex]);
  }
  if (appMode==='3D') {
    if (!handsVisible) { idleSpin+=0.008; TARGET3D.rotY=idleSpin; }
    else { idleSpin = TARGET3D.rotY; } // sync so it resumes from current angle
    renderThree();
  }

  // ── Status ────────────────────────────────────────────────────────
  statusDot.className = handsVisible ? 'dot-active' : 'dot-inactive';
  noHandOverlay.classList.toggle('hidden', handsVisible);
}

// ── Bootstrap ─────────────────────────────────────────────────────────
async function init() {
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );

  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`
  });
  hands.setOptions({ maxNumHands:2, modelComplexity:1, minDetectionConfidence:0.7, minTrackingConfidence:0.5 });
  hands.onResults(onResults);

  const camera = new Camera(videoEl, {
    onFrame: async () => { await hands.send({ image: videoEl }); },
    width: 1280, height: 720,
  });
  camera.start()
    .then(() => console.log('📷 Camera started'))
    .catch(err => {
      console.error(err);
      noHandOverlay.classList.remove('hidden');
      document.querySelector('.no-hand-content p').textContent    = '⚠️ Camera Access Denied';
      document.querySelector('.no-hand-content .sub').textContent = 'Please allow webcam access and reload';
    });
}

document.addEventListener('DOMContentLoaded', () => { init(); });
