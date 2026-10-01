import { clamp, lerp, rnd } from './util.js';

// =====================================================================
// AUDIO — procedural WebAudio (no samples)
// =====================================================================
export const midiF=m=>440*Math.pow(2,(m-69)/12);
export const AU={
  ctx:null,ready:false,vol:{master:0.8,music:0.6,sfx:0.9},
  init(){
    if(this.ctx){this.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    try{
      const c=this.ctx=new AC();
      this.master=c.createGain();this.master.gain.value=this.vol.master;
      const comp=c.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;
      this.master.connect(comp);comp.connect(c.destination);
      this.sfx=c.createGain();this.sfx.gain.value=this.vol.sfx;this.sfx.connect(this.master);
      this.mus=c.createGain();this.mus.gain.value=this.vol.music*0.55;this.mus.connect(this.master);
      this.rev=c.createConvolver();this.rev.buffer=this.impulse(3.4,2.4);
      const ro=c.createGain();ro.gain.value=0.85;this.rev.connect(ro);ro.connect(this.master);
      const s1=c.createGain();s1.gain.value=0.3;this.sfx.connect(s1);s1.connect(this.rev);
      const s2=c.createGain();s2.gain.value=0.75;this.mus.connect(s2);s2.connect(this.rev);
      this.revIn=c.createGain();this.revIn.gain.value=1;this.revIn.connect(this.rev);
      this.noiseBuf=this.mkNoise(2,false);this.brownBuf=this.mkNoise(4,true);
      this.startLoops();
      this.ready=true;
      Music.start();
    }catch(e){console.warn('audio init failed',e);}
  },
  // hidden tab: stop the graph; resume() restarts it (also after iOS reports 'interrupted')
  suspend(){if(this.ctx&&this.ctx.state==='running')this.ctx.suspend().catch(()=>{});},
  resume(){const c=this.ctx;if(!c||c.state==='running'||c.state==='closed'||document.hidden)return;
    try{const p=c.resume();if(p&&p.catch)p.catch(()=>{});}catch(e){}
    try{const b=c.createBuffer(1,1,22050),s=c.createBufferSource();s.buffer=b;s.connect(c.destination);s.start(0);}catch(e){}}, // a silent blip inside the gesture unlocks WebKit
  setVol(){if(!this.ready)return;const t=this.ctx.currentTime;this.master.gain.setTargetAtTime(this.vol.master,t,0.05);this.sfx.gain.setTargetAtTime(this.vol.sfx,t,0.05);this.mus.gain.setTargetAtTime(this.vol.music*0.55,t,0.05);},
  impulse(sec,decay){const c=this.ctx,len=c.sampleRate*sec|0,b=c.createBuffer(2,len,c.sampleRate);for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);}return b;},
  mkNoise(sec,brown){const c=this.ctx,len=c.sampleRate*sec|0,b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0);let last=0;for(let i=0;i<len;i++){const w=Math.random()*2-1;if(brown){last=(last+0.02*w)/1.02;d[i]=last*3.5;}else d[i]=w;}return b;},
  startLoops(){
    const c=this.ctx;
    const s=c.createBufferSource();s.buffer=this.brownBuf;s.loop=true;
    this.ambF=c.createBiquadFilter();this.ambF.type='lowpass';this.ambF.frequency.value=380;
    this.ambG=c.createGain();this.ambG.gain.value=0;
    s.connect(this.ambF);this.ambF.connect(this.ambG);this.ambG.connect(this.master);s.start();
    const s2=c.createBufferSource();s2.buffer=this.noiseBuf;s2.loop=true;
    this.washF=c.createBiquadFilter();this.washF.type='bandpass';this.washF.frequency.value=650;this.washF.Q.value=0.5;
    this.washG=c.createGain();this.washG.gain.value=0;
    const lfo=c.createOscillator();lfo.frequency.value=0.12;const lg=c.createGain();lg.gain.value=0.02;lfo.connect(lg);lg.connect(this.washG.gain);lfo.start();
    s2.connect(this.washF);this.washF.connect(this.washG);this.washG.connect(this.master);s2.start();
    this.motO=c.createOscillator();this.motO.type='sawtooth';this.motO.frequency.value=42;
    this.motO2=c.createOscillator();this.motO2.type='triangle';this.motO2.frequency.value=84.5;
    this.motF=c.createBiquadFilter();this.motF.type='lowpass';this.motF.frequency.value=260;this.motF.Q.value=2;
    this.motG=c.createGain();this.motG.gain.value=0;
    this.motO.connect(this.motF);this.motO2.connect(this.motF);this.motF.connect(this.motG);this.motG.connect(this.sfx);
    this.motO.start();this.motO2.start();
    this.bO=c.createOscillator();this.bO.type='sawtooth';this.bO.frequency.value=110;
    this.bO2=c.createOscillator();this.bO2.type='sine';this.bO2.frequency.value=221;
    this.bF=c.createBiquadFilter();this.bF.type='bandpass';this.bF.frequency.value=900;this.bF.Q.value=3;
    const bl=c.createOscillator();bl.frequency.value=7;const blg=c.createGain();blg.gain.value=320;bl.connect(blg);blg.connect(this.bF.frequency);bl.start();
    this.bG=c.createGain();this.bG.gain.value=0;
    this.bO.connect(this.bF);this.bO2.connect(this.bF);this.bF.connect(this.bG);this.bG.connect(this.sfx);
    this.bO.start();this.bO2.start();
  },
  update(dm,speed,thrust,beam,playing){
    if(!this.ready)return;const t=this.ctx.currentTime;
    this.ambG.gain.setTargetAtTime(playing?0.24:0.16,t,0.6);
    this.ambF.frequency.setTargetAtTime(lerp(440,120,clamp(dm/900,0,1)),t,0.6);
    this.washG.gain.setTargetAtTime(0.07*clamp(1-dm/70,0,1),t,0.3);
    this.motG.gain.setTargetAtTime(playing?0.012+thrust*0.045:0,t,0.12);
    this.motO.frequency.setTargetAtTime(36+speed*0.1,t,0.25);
    this.motO2.frequency.setTargetAtTime(72.5+speed*0.2,t,0.25);
    this.bG.gain.setTargetAtTime(beam?0.03:0,t,0.05);
  },
  tone(f,dur,type='sine',vol=0.2,att=0.005,dest,when=0,f2){
    if(!this.ready)return;const c=this.ctx,t=c.currentTime+Math.max(0,when);
    const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(f,t);
    if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
    g.gain.setValueAtTime(0.0001,t);g.gain.linearRampToValueAtTime(vol,t+att);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g);g.connect(dest||this.sfx);o.start(t);o.stop(t+dur+0.05);
  },
  noise(dur,vol,type='lowpass',freq=800,q=1,when=0,f2,dest){
    if(!this.ready)return;const c=this.ctx,t=c.currentTime+Math.max(0,when);
    const s=c.createBufferSource();s.buffer=this.noiseBuf;const fl=c.createBiquadFilter();fl.type=type;fl.frequency.setValueAtTime(freq,t);fl.Q.value=q;
    if(f2)fl.frequency.exponentialRampToValueAtTime(f2,t+dur);
    const g=c.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    s.connect(fl);fl.connect(g);g.connect(dest||this.sfx);s.start(t,Math.random()*1.5);s.stop(t+dur+0.05);
  },
  collect(combo,big){const sc=[0,2,4,7,9,12,14,16,19,21,24,26,28];const n=sc[Math.min(combo,sc.length-1)];const f=midiF(72+n);
    this.tone(f,0.32,'triangle',0.14);this.tone(f*2,0.4,'sine',0.05,0.005,this.revIn);
    if(big){this.tone(f/2,0.5,'sine',0.14);this.tone(f*1.5,0.5,'triangle',0.06,0.01,null,0.06);}
    this.noise(0.12,0.05,'highpass',3000,1);},
  sell(){[72,76,79,84,88].forEach((m,i)=>{this.tone(midiF(m),0.4,'triangle',0.12,0.005,null,i*0.07);this.tone(midiF(m+12),0.3,'sine',0.04,0.005,null,i*0.07);});},
  upgrade(){this.tone(300,0.5,'sawtooth',0.05,0.02,null,0,1200);[60,64,67,72].forEach((m,i)=>this.tone(midiF(m+12),0.9,'triangle',0.08,0.01,null,0.15+i*0.05));},
  ping(){this.tone(1480,1.1,'sine',0.22,0.004,null,0,1150);this.tone(1480,1.2,'sine',0.07,0.004,this.revIn,0.42,1150);this.tone(1480,1.2,'sine',0.025,0.004,this.revIn,0.85,1150);},
  hurt(){this.noise(0.35,0.5,'lowpass',500,1,0,120);this.tone(110,0.3,'square',0.08,0.005,null,0,50);},
  zap(){this.noise(0.25,0.25,'bandpass',3200,4);for(let i=0;i<4;i++)this.tone(180+Math.random()*300,0.06,'square',0.05,0.002,null,i*0.05);},
  bite(){this.noise(0.18,0.5,'lowpass',900,2);this.tone(80,0.25,'sawtooth',0.12,0.005,null,0,40);},
  splash(v=0.2){this.noise(0.6,v,'highpass',900,0.7,0,4000);},
  alarm(){this.tone(880,0.12,'square',0.05);this.tone(660,0.12,'square',0.05,0.005,null,0.14);},
  discover(){[79,83,86,91].forEach((m,i)=>this.tone(midiF(m),1.3,'triangle',0.07,0.01,this.revIn,i*0.11));[79,83,86,91].forEach((m,i)=>this.tone(midiF(m),0.9,'sine',0.06,0.005,null,i*0.11));},
  mission(){[67,72,76,79,84].forEach((m,i)=>this.tone(midiF(m),0.7,'triangle',0.1,0.01,null,i*0.09));this.tone(midiF(48),1.4,'sine',0.12,0.02,null,0.4);},
  click(){this.tone(1300,0.05,'sine',0.05);},
  // 푸른이's chirp: two quick rising whistles
  chirp(){if(!this.ready)return;const c=this.ctx,t=c.currentTime;for(let k=0;k<2;k++){const o=c.createOscillator(),g=c.createGain(),t0=t+k*0.13;o.type='sine';o.frequency.setValueAtTime(1700,t0);o.frequency.exponentialRampToValueAtTime(3100,t0+0.08);o.frequency.exponentialRampToValueAtTime(2300,t0+0.11);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(0.045,t0+0.015);g.gain.exponentialRampToValueAtTime(0.001,t0+0.12);o.connect(g);g.connect(this.sfx);o.start(t0);o.stop(t0+0.13);}},
  creak(){this.noise(0.9,0.2,'bandpass',420,6,0,110);},
  cut(){this.noise(0.05,0.08,'bandpass',2400,5);},
  bubble(){const f=rnd(350,700);this.tone(f,0.08,'sine',0.03,0.004,null,0,f*2.2);},
  dock(){this.tone(110,1.4,'sawtooth',0.07,0.08);this.tone(165,1.4,'sawtooth',0.05,0.08);this.tone(55,1.6,'sine',0.14,0.1);},
  fail(){[64,60,57,52].forEach((m,i)=>this.tone(midiF(m),0.6,'triangle',0.1,0.01,null,i*0.18));},
  rescue(){[72,76,79,83,84,88].forEach((m,i)=>this.tone(midiF(m),0.6,'triangle',0.09,0.01,this.revIn,i*0.08));},
  thud(v){this.noise(0.3,clamp(v,0.05,0.4),'lowpass',260,1);this.tone(70,0.25,'sine',clamp(v,0.05,0.3),0.005,null,0,40);},
  whale(vol=0.14){if(!this.ready)return;const c=this.ctx,t=c.currentTime;const o=c.createOscillator(),g=c.createGain(),fl=c.createBiquadFilter();
    o.type='sine';const b=rnd(170,260);o.frequency.setValueAtTime(b,t);o.frequency.exponentialRampToValueAtTime(b*rnd(1.6,2.4),t+1.2);o.frequency.exponentialRampToValueAtTime(b*rnd(0.7,1.1),t+2.6);o.frequency.exponentialRampToValueAtTime(b*rnd(1.2,1.6),t+3.6);
    const v=c.createOscillator(),vg=c.createGain();v.frequency.value=5;vg.gain.value=6;v.connect(vg);vg.connect(o.frequency);
    fl.type='lowpass';fl.frequency.value=900;g.gain.setValueAtTime(0.0001,t);g.gain.linearRampToValueAtTime(vol,t+0.6);g.gain.setValueAtTime(vol,t+2.8);g.gain.exponentialRampToValueAtTime(0.0001,t+4);
    o.connect(fl);fl.connect(g);g.connect(this.revIn);g.connect(this.mus);o.start(t);v.start(t);o.stop(t+4.1);v.stop(t+4.1);},
};
const CHORDS=[
  [[48,55,64,71],[45,52,60,67],[41,48,57,64],[43,50,59,66]],
  [[50,57,60,65],[46,53,62,69],[48,55,64,67],[45,52,60,64]],
  [[45,52,55,60],[41,48,52,57],[43,50,53,58],[40,47,52,55]],
  [[33,40,45,52],[34,41,46,51],[31,38,43,50]],
];
const SPARK=[[72,74,76,79,81,84,86],[74,77,79,81,84,86],[69,72,76,79,81],[70,73,75,78,82]];
export const Music={zone:0,idx:0,next:0,timer:null,
  start(){if(this.timer||!AU.ready)return;this.next=AU.ctx.currentTime+0.3;this.timer=setInterval(()=>this.tick(),350);},
  tick(){const c=AU.ctx;if(!c||c.state!=='running'||AU.vol.music<0.01||document.hidden)return;const now=c.currentTime;
    if(this.next<now)this.next=now+0.1;
    if(now+0.8>=this.next)this.chord(this.next);
    if(Math.random()<[0.16,0.1,0.06,0.035][this.zone])this.spark(Math.random()*0.3);},
  chord(t){const set=CHORDS[this.zone];const ch=set[this.idx++%set.length];const dur=[9,10,12,14][this.zone];
    ch.forEach(m=>this.pad(m,t,dur,0.028));this.pad(ch[0]-12,t,dur,0.05,'sine');this.next=t+dur;},
  pad(m,t,dur,vol,type='triangle'){const c=AU.ctx,f=midiF(m);const o=c.createOscillator(),o2=c.createOscillator(),g=c.createGain(),lp=c.createBiquadFilter();
    o.type=type;o2.type='sine';o.frequency.value=f;o2.frequency.value=f*1.005;lp.type='lowpass';lp.frequency.value=[1500,1100,750,500][this.zone];
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+dur*0.3);g.gain.setValueAtTime(vol,t+dur*0.65);g.gain.linearRampToValueAtTime(0,t+dur+3);
    o.connect(lp);o2.connect(lp);lp.connect(g);g.connect(AU.mus);o.start(t);o2.start(t);o.stop(t+dur+3.1);o2.stop(t+dur+3.1);},
  spark(when){const sc=SPARK[this.zone];AU.tone(midiF(sc[Math.random()*sc.length|0]),2.4,'sine',0.028,0.01,AU.mus,when);},
};
