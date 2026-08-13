const detector = require('../fast-detector.js');
const W = 480, H = 360;

function random(seed) { return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296); }
function inside(x, y, p) { let v=false; for(let i=0,j=3;i<4;j=i++) if((p[i].y>y)!=(p[j].y>y)&&x<(p[j].x-p[i].x)*(y-p[i].y)/(p[j].y-p[i].y)+p[i].x)v=!v; return v; }
function rgba(render) { const data=new Uint8ClampedArray(W*H*4); for(let y=0;y<H;y++)for(let x=0;x<W;x++){const value=render(x,y);const i=(y*W+x)*4;data[i]=value*.93;data[i+1]=value;data[i+2]=value*.88;data[i+3]=255;} return data; }
function errors(actual, expected) { return actual.map((point,i)=>Math.hypot(point.x-expected[i].x,point.y-expected[i].y)); }

function randomizedScenes() {
  const rnd=random(8122026); let correct=0,accepted=0,acceptedWrong=0,totalMs=0,totalError=0;
  for(let n=0;n<30;n++) {
    const p=[{x:25+rnd()*55,y:20+rnd()*45},{x:W-25-rnd()*55,y:20+rnd()*45},{x:W-25-rnd()*55,y:H-20-rnd()*45},{x:25+rnd()*55,y:H-20-rnd()*45}];
    const bg=45+rnd()*90, contrast=18+rnd()*105;
    const image=rgba((x,y)=>{const photo=inside(x,y,p);let v=bg+(x/W)*14+(rnd()-.5)*18;if(photo){v=bg+contrast+(rnd()-.5)*10;if(x>W*.28&&x<W*.74&&y>H*.28&&y<H*.7)v-=contrast*(.2+rnd()*.3);if(((x+2*y)%73)<4)v-=contrast*.2;}return v;});
    try { const start=performance.now(),result=detector.detectRgba(image,W,H);totalMs+=performance.now()-start;const e=errors(result.points,p),ok=Math.max(...e)<18;if(ok){correct++;totalError+=e.reduce((a,b)=>a+b,0)/4;}if(result.confidence>=.7){accepted++;if(!ok)acceptedWrong++;} } catch {}
  }
  if(correct<26||acceptedWrong)throw new Error(`randomized: correct=${correct}, acceptedWrong=${acceptedWrong}`);
  return {correct,accepted,acceptedWrong,meanError:totalError/correct,meanMs:totalMs/30};
}

function innerFrameDecoys() {
  const rnd=random(99),p=[{x:47,y:39},{x:438,y:61},{x:412,y:329},{x:30,y:304}];let acceptedWrong=0;
  for(let n=0;n<12;n++) {
    const image=rgba((x,y)=>{let v=92+(rnd()-.5)*16;if(inside(x,y,p))v=118+(rnd()-.5)*10;if(x>130&&x<370&&y>105&&y<270)v=35+(rnd()-.5)*8;if(inside(x,y,p)&&((x+3*y+n*11)%91)<5)v=180;return v;});
    try { const result=detector.detectRgba(image,W,H);const ok=Math.max(...errors(result.points,p))<18;if(!ok&&result.confidence>=.7)acceptedWrong++; } catch {}
  }
  if(acceptedWrong)throw new Error(`inner-frame decoys: acceptedWrong=${acceptedWrong}`);
  return {scenes:12,acceptedWrong};
}

console.log({randomized:randomizedScenes(),innerFrames:innerFrameDecoys()});
