const $ = (selector) => document.querySelector(selector);
const views = [$('#startView'), $('#editView'), $('#resultView')];
const sourceCanvas = $('#sourceCanvas');
const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
const resultCanvas = $('#resultCanvas');
const resultCtx = resultCanvas.getContext('2d');
const overlay = $('#cropOverlay');
const polygon = $('#cropPolygon');
const handles = $('#handles');
const cornerLoupe = $('#cornerLoupe');
const loupeCanvas = $('#loupeCanvas');
const loupeCtx = loupeCanvas.getContext('2d');
let sourceImage = null;
let points = [];
let dragging = -1;
let rotation = 0;
let toastTimer;

function showView(view) {
  views.forEach(v => v.classList.toggle('hidden', v !== view));
  document.body.dataset.view = view.id.replace('View', '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
}

$('#cameraButton').addEventListener('click', () => openPicker($('#cameraInput')));
$('#libraryButton').addEventListener('click', () => openPicker($('#libraryInput')));
$('#cameraInput').addEventListener('change', loadSelection);
$('#libraryInput').addEventListener('change', loadSelection);
$('#backButton').addEventListener('click', reset);
$('#againButton').addEventListener('click', reset);
$('#autoButton').addEventListener('click', autoDetect);
$('#straightenButton').addEventListener('click', rectify);
$('#rotateButton').addEventListener('click', () => { rotation = (rotation + 90) % 360; renderSource(); });
$('#saveButton').addEventListener('click', saveResult);
$('#infoButton').addEventListener('click', () => $('#infoDialog').showModal());
$('#closeInfo').addEventListener('click', () => $('#infoDialog').close());
$('#infoDialog').addEventListener('click', e => { if (e.target === $('#infoDialog')) $('#infoDialog').close(); });

function openPicker(input) {
  try {
    if (!document.fullscreenElement) {
      const fullscreenRequest = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      fullscreenRequest?.catch(() => {});
    }
  } catch {}
  input.click();
}

async function loadSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Please choose an image file.');
  try {
    sourceImage = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    sourceImage = await loadImageFallback(file);
  }
  rotation = 0;
  showView($('#editView'));
  renderSource();
  setTimeout(autoDetect, 120);
  event.target.value = '';
}

function loadImageFallback(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(image.src); resolve(image); };
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

function renderSource() {
  if (!sourceImage) return;
  const rotated = rotation % 180 !== 0;
  const nativeWidth = sourceImage.width || sourceImage.naturalWidth;
  const nativeHeight = sourceImage.height || sourceImage.naturalHeight;
  const maxDimension = 2200;
  const targetW = rotated ? nativeHeight : nativeWidth;
  const targetH = rotated ? nativeWidth : nativeHeight;
  const scale = Math.min(1, maxDimension / Math.max(targetW, targetH));
  sourceCanvas.width = Math.round(targetW * scale);
  sourceCanvas.height = Math.round(targetH * scale);
  const stage = $('#editorStage');
  stage.style.aspectRatio = `${sourceCanvas.width} / ${sourceCanvas.height}`;
  sizeEditorStage();
  sourceCtx.save();
  sourceCtx.translate(sourceCanvas.width / 2, sourceCanvas.height / 2);
  sourceCtx.rotate(rotation * Math.PI / 180);
  sourceCtx.drawImage(sourceImage, -nativeWidth * scale / 2, -nativeHeight * scale / 2, nativeWidth * scale, nativeHeight * scale);
  sourceCtx.restore();
  requestAnimationFrame(() => {
    overlay.setAttribute('viewBox', `0 0 ${sourceCanvas.width} ${sourceCanvas.height}`);
    points = defaultPoints();
    drawCrop();
  });
}

function sizeEditorStage() {
  if (!sourceCanvas.width || !sourceCanvas.height) return;
  const viewport = window.visualViewport;
  const vw = viewport?.width || window.innerWidth;
  const vh = viewport?.height || window.innerHeight;
  const ratio = sourceCanvas.width / sourceCanvas.height;
  const width = vw / vh > ratio ? vh * ratio : vw;
  const height = width / ratio;
  const stage = $('#editorStage');
  stage.style.width = `${Math.round(width)}px`;
  stage.style.height = `${Math.round(height)}px`;
}

function defaultPoints() {
  const { width:w, height:h } = sourceCanvas;
  return [{x:w*.08,y:h*.08},{x:w*.92,y:h*.08},{x:w*.92,y:h*.92},{x:w*.08,y:h*.92}];
}

function drawCrop() {
  polygon.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
  const rect = overlay.getBoundingClientRect();
  const unitsPerPixel = rect.width ? sourceCanvas.width / rect.width : 1;
  handles.replaceChildren(...points.map((p, i) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('crop-handle'); group.dataset.index = i;
    group.setAttribute('transform', `translate(${p.x} ${p.y})`);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.setAttribute('r', String(40 * unitsPerPixel)); hit.classList.add('hit');
    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    outer.setAttribute('r', String(16 * unitsPerPixel)); outer.classList.add('outer');
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    inner.setAttribute('r', String(4.5 * unitsPerPixel)); inner.classList.add('inner');
    inner.setAttribute('pointer-events', 'none');
    group.append(hit, outer, inner); return group;
  }));
}

overlay.addEventListener('pointerdown', event => {
  event.preventDefault();
  const touch = eventToImagePoint(event, false);
  dragging = points.reduce((best, point, index) => distance(point, touch) < distance(points[best], touch) ? index : best, 0);
  overlay.setPointerCapture(event.pointerId);
  cornerLoupe.classList.remove('hidden');
  updateDrag(event);
});
overlay.addEventListener('pointermove', event => { if (dragging >= 0) updateDrag(event); });
overlay.addEventListener('pointerup', event => { dragging = -1; cornerLoupe.classList.add('hidden'); overlay.releasePointerCapture(event.pointerId); });
overlay.addEventListener('pointercancel', () => { dragging = -1; cornerLoupe.classList.add('hidden'); });

function updateDrag(event) {
  points[dragging] = eventToImagePoint(event, true);
  drawCrop();
  drawLoupe(points[dragging], event);
}

function eventToImagePoint(event, offsetForFinger) {
  const rect = overlay.getBoundingClientRect();
  const fingerOffset = offsetForFinger && event.pointerType !== 'mouse' ? 72 : 0;
  return {
    x: clamp((event.clientX - rect.left) * sourceCanvas.width / rect.width, 0, sourceCanvas.width),
    y: clamp((event.clientY - fingerOffset - rect.top) * sourceCanvas.height / rect.height, 0, sourceCanvas.height)
  };
}

function drawLoupe(point, event) {
  const rect = overlay.getBoundingClientRect();
  const unitsPerPixel = sourceCanvas.width / rect.width;
  const sample = 48 * unitsPerPixel;
  loupeCtx.fillStyle = '#101817';
  loupeCtx.fillRect(0, 0, loupeCanvas.width, loupeCanvas.height);
  loupeCtx.drawImage(sourceCanvas, point.x - sample, point.y - sample, sample * 2, sample * 2, 0, 0, loupeCanvas.width, loupeCanvas.height);
  loupeCtx.strokeStyle = 'rgba(255,255,255,.92)';
  loupeCtx.lineWidth = 1.5;
  loupeCtx.beginPath();
  loupeCtx.moveTo(70, 46); loupeCtx.lineTo(70, 94);
  loupeCtx.moveTo(46, 70); loupeCtx.lineTo(94, 70);
  loupeCtx.stroke();
  loupeCtx.strokeStyle = '#ef725f'; loupeCtx.lineWidth = 3;
  loupeCtx.strokeRect(67, 67, 6, 6);
  const onLeft = event.clientX < window.innerWidth / 2;
  const nearTop = event.clientY < 190;
  cornerLoupe.style.left = onLeft ? 'auto' : '12px';
  cornerLoupe.style.right = onLeft ? '12px' : 'auto';
  cornerLoupe.style.top = nearTop ? 'auto' : `max(82px, calc(env(safe-area-inset-top) + 72px))`;
  cornerLoupe.style.bottom = nearTop ? `max(82px, calc(env(safe-area-inset-bottom) + 72px))` : 'auto';
}

async function autoDetect() {
  if (!sourceImage) return;
  $('#detecting').classList.remove('hidden');
  await new Promise(resolve => setTimeout(resolve, 35));
  try {
    points = await RectifyDetector.detect(sourceCanvas);
    drawCrop();
    // The outline is the feedback; keep the editor visually quiet.
  } catch (error) {
    points = defaultPoints();
    drawCrop();
    toast('AI edge detection failed — adjust the corners manually.');
  } finally { $('#detecting').classList.add('hidden'); }
}

function rectify() {
  if (!isValidQuad(points)) return toast('Corners cross over — please separate them.');
  const [tl,tr,br,bl]=points;
  const width=Math.round(Math.max(distance(tl,tr),distance(bl,br)));
  const height=Math.round(Math.max(distance(tl,bl),distance(tr,br)));
  if(width<30||height<30) return toast('That crop is too small.');
  const maxOutput=3600, scale=Math.min(1,maxOutput/Math.max(width,height));
  resultCanvas.width=Math.max(1,Math.round(width*scale)); resultCanvas.height=Math.max(1,Math.round(height*scale));
  const src=sourceCtx.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
  const out=resultCtx.createImageData(resultCanvas.width,resultCanvas.height);
  // Projective map from output rectangle back into the four source corners.
  const H=homography([
    [0,0],[resultCanvas.width-1,0],[resultCanvas.width-1,resultCanvas.height-1],[0,resultCanvas.height-1]
  ], points.map(p=>[p.x,p.y]));
  for(let y=0;y<resultCanvas.height;y++) for(let x=0;x<resultCanvas.width;x++) {
    const d=H[6]*x+H[7]*y+1, sx=(H[0]*x+H[1]*y+H[2])/d, sy=(H[3]*x+H[4]*y+H[5])/d;
    bilinear(src,out,x,y,sx,sy);
  }
  resultCtx.putImageData(out,0,0);
  showView($('#resultView'));
}

function homography(from,to) {
  const A=[],b=[];
  for(let i=0;i<4;i++) { const [x,y]=from[i],[u,v]=to[i]; A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u); A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v); }
  for(let i=0;i<8;i++) { let pivot=i; for(let j=i+1;j<8;j++) if(Math.abs(A[j][i])>Math.abs(A[pivot][i])) pivot=j; [A[i],A[pivot]]=[A[pivot],A[i]]; [b[i],b[pivot]]=[b[pivot],b[i]]; const div=A[i][i]; for(let k=i;k<8;k++) A[i][k]/=div; b[i]/=div; for(let j=0;j<8;j++) if(j!==i) { const f=A[j][i]; for(let k=i;k<8;k++) A[j][k]-=f*A[i][k]; b[j]-=f*b[i]; } }
  return b;
}

function bilinear(src,out,ox,oy,x,y) {
  const x0=clamp(Math.floor(x),0,src.width-1), y0=clamp(Math.floor(y),0,src.height-1), x1=Math.min(x0+1,src.width-1), y1=Math.min(y0+1,src.height-1), fx=x-x0, fy=y-y0;
  const di=(oy*out.width+ox)*4;
  for(let c=0;c<4;c++) { const a=src.data[(y0*src.width+x0)*4+c]*(1-fx)+src.data[(y0*src.width+x1)*4+c]*fx; const d=src.data[(y1*src.width+x0)*4+c]*(1-fx)+src.data[(y1*src.width+x1)*4+c]*fx; out.data[di+c]=a*(1-fy)+d*fy; }
}

function saveResult() {
  resultCanvas.toBlob(async blob => {
    const file=new File([blob],`rectified-${new Date().toISOString().slice(0,10)}.jpg`,{type:'image/jpeg'});
    if(navigator.canShare?.({files:[file]})) { try { await navigator.share({files:[file],title:'Rectified photo'}); return; } catch(e) { if(e.name==='AbortError') return; } }
    const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Photo saved.');
  },'image/jpeg',.94);
}

function reset() { sourceImage=null; points=[]; showView($('#startView')); }
function distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
function clamp(n,min,max) { return Math.max(min,Math.min(max,n)); }
function isValidQuad(p) { const signs=p.map((a,i)=>{const b=p[(i+1)%4],c=p[(i+2)%4];return Math.sign((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x));}); return signs.every(s=>s===signs[0]&&s!==0); }

const BUILD = window.RECTIFY_BUILD || 'dev';

const warmDetector = () => RectifyDetector?.warmup?.();
if ('requestIdleCallback' in window) requestIdleCallback(warmDetector, { timeout: 1500 });
else setTimeout(warmDetector, 250);

async function checkForBuild() {
  try {
    const response = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const latest = (await response.json()).build;
    if (latest && latest !== BUILD) location.replace(`./?v=${encodeURIComponent(latest)}`);
  } catch {}
}

if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
  const reloadKey = `rectify-controller-${BUILD}`;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem(reloadKey)) return;
    sessionStorage.setItem(reloadKey, '1');
    location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(BUILD)}`, { updateViaCache: 'none' });
    await registration.update();
  } catch {}
  checkForBuild();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForBuild(); });
function resizeEditor() {
  if (sourceImage && !$('#editView').classList.contains('hidden')) {
    sizeEditorStage();
    requestAnimationFrame(drawCrop);
  }
}
window.addEventListener('resize', resizeEditor);
window.visualViewport?.addEventListener('resize', resizeEditor);
