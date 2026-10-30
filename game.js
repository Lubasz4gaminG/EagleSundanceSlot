"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const DATA = WOLF_DATA;
  const KEY = "siberian-wolf.v1";
  const LEADERBOARD_URL = "https://siberian-wolf-leaderboard.lubaszj.workers.dev";
  const musicTracks = [
    "Sacred Spirit - 01. Intro And Prelude (How The West Was.oga",
    "Sacred Spirit - 02. Tor-Cheney-Nahana (Winter Ceremony).oga",
    "Sacred Spirit - 03. Ly-O-Lay Ale Loya (The Counterclock.oga",
    "Sacred Spirit - 04. Ya-Na-Hana (Celebrate Wild Rice).oga",
    "Sacred Spirit - 05. Dawa (The Cradlesong).oga",
    "Sacred Spirit - 06. Gitchi-Manidoo (Advice For The Youn.oga",
    "Sacred Spirit - 07. Yeha Noha (Wishes Of Happiness And .oga",
    "Sacred Spirit - 08. Ta-Was-Ne (Elevation).oga",
    "Sacred Spirit - 09. Heya-Hee (Intertribal Song To Stop .oga",
    "Sacred Spirit - 10. Shamanic Chant No 5 (Heal The Soul).oga",
    "Sacred Spirit - 11. Yo-Hey-O-Hee (Brandishing The Tomah.oga"
  ];
  const names = ["Diamond", "Howling wolf", "White Cougar", "White wolf", "Paw print", "Crane", "Moon", "Snowflake"];
  const lampY = [358.5,234.5,478.5,145.5,570.5,188.5,524,313,402.5];
  const controls = ["lines-up","lines-down","bet-up","bet-down","max","cash","denomination","new-game"];
  let state = {balance:5000, denomination:5, lines:9, bet:1, lastWin:0, grid:null, bonus:null, sound:true, musicVolume:0.25, slotVolume:1, score:null};
  let spinning = false, timers = [], animation = null, lineTimer = null, wins = [], lineIndex = 0;
  let payout = null, payoutTimer = null;
  let leaderboardBusy=false, leaderboardRevision=0;
  let audioUnlocked = false;
  const sounds = Object.fromEntries(["click","spin","stop","pay","clear","snowflake"].map(name=>{
    const clip = new Audio(`assets/${name}.ogg`);
    clip.preload = "auto";
    clip.volume = name === "spin" ? 0.35 : 0.55;
    return [name,clip];
  }));
  const music=new Audio();
  music.preload="none";
  let musicIndex=0, mixedStreams=false;
  let payContext=null, payBuffer=null, stopBuffer=null, payGain=null, paySource=null, slotGain=null, musicGain=null;
  const stopSources=new Set();
  try {
    const BufferedAudio=window.AudioContext || window.webkitAudioContext;
    if(BufferedAudio){
      payContext=new BufferedAudio();
      slotGain=payContext.createGain();slotGain.connect(payContext.destination);
      payGain=payContext.createGain();payGain.gain.value=sounds.pay.volume;
      payGain.connect(slotGain);
      function pcmBuffer(encoded) {
        const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        const samples=new DataView(bytes.buffer),frames=bytes.length/4;
        const buffer=payContext.createBuffer(2,frames,44100);
        for(let channel=0;channel<2;channel++){
          const output=buffer.getChannelData(channel);
          for(let frame=0;frame<frames;frame++)output[frame]=samples.getInt16(frame*4+channel*2,true)/32768;
        }
        return buffer;
      }
      payBuffer=pcmBuffer(WOLF_PAY_AUDIO);
      stopBuffer=pcmBuffer(WOLF_STOP_AUDIO);
      // Stream through gain controls on the web; local files retain native playback.
      if(location.protocol!=="file:"){
        for(const clip of Object.values(sounds)){
          const level=payContext.createGain();level.gain.value=clip.volume;
          payContext.createMediaElementSource(clip).connect(level);level.connect(slotGain);
          clip.volume=1;
        }
        musicGain=payContext.createGain();musicGain.connect(payContext.destination);
        payContext.createMediaElementSource(music).connect(musicGain);
        mixedStreams=true;
      }
    }
  } catch (_) { /* Keep the original audio player if buffered playback is unavailable. */ }

  function unlockAudio() {
    audioUnlocked=true;
    if(payContext && payContext.state!=="running" && payContext.state!=="closed")payContext.resume().catch(()=>{});
    syncMusic();
  }

  function syncMusic() {
    if(!audioUnlocked || !state.sound || document.hidden || state.musicVolume===0){music.pause();return;}
    if(!music.getAttribute("src"))music.src="bkg_music/"+encodeURIComponent(musicTracks[musicIndex]);
    if(music.paused){
      const playing=music.play();
      if(playing)playing.catch(()=>{}); // A later tap can retry playback restrictions.
    }
  }
  music.addEventListener("ended",()=>{
    musicIndex=(musicIndex+1)%musicTracks.length;
    music.src="bkg_music/"+encodeURIComponent(musicTracks[musicIndex]);
    syncMusic();
  });

  function applyVolumes() {
    if(slotGain)slotGain.gain.value=state.slotVolume;
    if(musicGain)musicGain.gain.value=state.musicVolume;
    for(const [name,clip] of Object.entries(sounds)){
      clip.volume=mixedStreams ? 1 : (name==="spin" ? 0.35 : 0.55)*state.slotVolume;
    }
    music.volume=mixedStreams ? 1 : state.musicVolume;
    for(const [name,value] of [["music",state.musicVolume],["slot",state.slotVolume]]){
      $(name+"-volume").value=String(Math.round(value*100));
      $(name+"-level").textContent=Math.round(value*100)+"%";
    }
    syncMusic();
  }

  function playSound(name, loop=false) {
    if (!audioUnlocked || !state.sound || document.hidden) return;
    const clip = sounds[name];
    const buffer=name==="pay" ? payBuffer : name==="stop" ? stopBuffer : null;
    if(buffer && payContext.state!=="closed"){
      if(name==="pay")stopSound(name);
      const source=payContext.createBufferSource();
      source.buffer=buffer;source.loop=loop;source.connect(payGain);
      source.onended=()=>{source.disconnect();stopSources.delete(source);if(paySource===source)paySource=null;};
      if(name==="pay")paySource=source;
      else stopSources.add(source);
      source.start();
      return;
    }
    clip.pause(); clip.currentTime = 0; clip.loop = loop;
    const playing = clip.play();
    if (playing) playing.catch(()=>{}); // Playback restrictions must not interrupt the game.
  }
  function stopSound(name) {
    if(name==="pay" && paySource){paySource.stop();paySource.disconnect();paySource=null;}
    if(name==="stop"){
      for(const source of stopSources){source.stop();source.disconnect();}
      stopSources.clear();
    }
    const clip = sounds[name];
    clip.pause(); clip.currentTime = 0; clip.loop = false;
  }
  function stopAllSounds() { Object.keys(sounds).forEach(stopSound);music.pause(); }
  document.addEventListener("pointerdown",unlockAudio,{capture:true});
  document.addEventListener("touchend",unlockAudio,{capture:true,passive:true});
  document.addEventListener("click",unlockAudio,{capture:true});
  document.addEventListener("keydown",unlockAudio,{capture:true});
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden)stopAllSounds();
    else {
      if(payout)playSound("pay",true);
      else if(spinning)playSound("spin",true);
      syncMusic();
    }
  });
  document.addEventListener("click",event=>{
    const button=event.target.closest("button");
    if(button && !button.disabled && !["sound","spin","max"].includes(button.id) &&
       !button.closest("#bonus-board"))playSound("click");
  });

  function randomInt(max) {
    const values = new Uint32Array(1), limit = Math.floor(4294967296 / max) * max;
    do { crypto.getRandomValues(values); } while (values[0] >= limit);
    return values[0] % max;
  }
  function makeGrid(stops) {
    return DATA.reels.map((strip, col) => [-1,0,1].map(row => strip[(stops[col] + row + strip.length) % strip.length]));
  }
  function rollGrid() { return makeGrid(DATA.reels.map(strip => randomInt(strip.length))); }
  function money(cents) { return (cents / 100).toLocaleString("en-US", {style:"currency",currency:"USD"}); }
  function denominationLabel(cents) { return cents < 100 ? `${cents}¢` : `$${cents / 100}`; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* Browser storage may be unavailable. */ } }

  async function leaderboardRequest(method="GET", score) {
    if(!LEADERBOARD_URL)throw new Error("Leaderboard unavailable.");
    const response=await fetch(`${LEADERBOARD_URL}/v1/scores`,{
      method, mode:"cors", cache:"no-store", signal:AbortSignal.timeout(5000),
      ...(score ? {headers:{"Content-Type":"application/json"},body:JSON.stringify(score)} : {})
    });
    if(!response.ok)throw new Error("Leaderboard unavailable.");
    const data=await response.json();
    if(!Array.isArray(data.scores) || data.scores.length>3 || data.scores.some(entry=>
      typeof entry.id!=="string" || !/^[A-Z0-9]{3}$/.test(entry.initials) ||
      !Number.isSafeInteger(entry.cents) || entry.cents<=0))throw new Error("Invalid leaderboard.");
    return data;
  }
  function renderLeaderboard(scores) {
    $("leaderboard-scores").replaceChildren();
    for(let i=0;i<3;i++){
      const entry=scores[i],row=document.createElement("li");
      for(const text of [String(i+1),entry ? entry.initials : "— — —",entry ? money(entry.cents) : "—"]){
        const span=document.createElement("span");span.textContent=text;row.append(span);
      }
      $("leaderboard-scores").append(row);
    }
  }
  async function refreshLeaderboard() {
    const revision=++leaderboardRevision;
    $("leaderboard-status").textContent="Loading shared scores…";
    try {
      const data=await leaderboardRequest();
      if(revision!==leaderboardRevision)return;
      renderLeaderboard(data.scores);$("leaderboard-status").textContent="Highest single-spin payouts · Includes bonus wins";
    } catch {
      if(revision===leaderboardRevision)$("leaderboard-status").textContent="Shared scores unavailable. Refresh to try again.";
    }
  }
  async function checkHighScore() {
    if(leaderboardBusy || spinning || payout || state.bonus || !state.score)return;
    if(!state.score.cents){state.score=null;save();return;}
    leaderboardBusy=true;++leaderboardRevision;update();
    $("leaderboard-status").textContent="Checking your payout…";
    try {
      const data=await leaderboardRequest();renderLeaderboard(data.scores);
      if(data.scores.some(entry=>entry.id===state.score.id) ||
         (data.scores.length===3 && state.score.cents<=data.scores[2].cents)){
        state.score=null;save();$("leaderboard-status").textContent="Highest single-spin payouts · Includes bonus wins";
      } else {
        $("score-amount").textContent=money(state.score.cents);
        $("score-initials").value=state.score.initials;
        $("score-error").textContent="";
        $("score-dialog").showModal();$("score-initials").focus();
        $("leaderboard-status").textContent="Top-three payout! Enter your initials.";
      }
    } catch {
      $("leaderboard-status").textContent="Your payout could not be checked. Refresh to retry before your next spin.";
    } finally {leaderboardBusy=false;update();if($("score-dialog").open)$("score-initials").focus();}
  }

  function renderMeters() {
    const balance=payout ? payout.balance : state.balance;
    $("bank").textContent=money(balance);
    $("credits").textContent=Math.floor(balance/state.denomination).toLocaleString("en-US");
    $("win").textContent=(payout ? payout.win : state.lastWin).toLocaleString("en-US");
  }
  function countPayout(credits, complete) {
    if(!credits){update();complete();return;}
    // The full award is already saved; this count only presents that settled award.
    payout={balance:state.balance-credits*state.denomination,
      win:state.lastWin-credits,remaining:credits};
    update();playSound("pay",true);
    payoutTimer=setInterval(()=>{
      if(document.hidden)return;
      payout.balance+=state.denomination;
      payout.win++;
      payout.remaining--;
      renderMeters();
      if(payout.remaining===0){
        clearInterval(payoutTimer);payoutTimer=null;payout=null;
        $("win-overlay").textContent=money(state.lastWin*state.denomination);
        $("win-overlay").hidden=false;
        // Finish the current playback, including short wins that end before its first loop.
        sounds.pay.loop=false;if(paySource)paySource.loop=false;
        update();complete();
      }
    },credits<=10 ? 200 : credits<=20 ? 100 : 50);
  }

  // Saved files are a trust boundary; accept only this game's supported state.
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (!s || !Number.isSafeInteger(s.balance) || s.balance < 0 || s.balance > 1e12 ||
          !DATA.denominations.includes(s.denomination) || !Number.isInteger(s.lines) || s.lines < 1 || s.lines > 9 ||
          !Number.isInteger(s.bet) || s.bet < 1 || s.bet > 5) return;
      const validGrid = Array.isArray(s.grid) && s.grid.length === 5 && s.grid.every(col =>
        Array.isArray(col) && col.length === 3 && col.every(n => Number.isInteger(n) && n >= 0 && n <= 7));
      state = {...state, balance:s.balance, denomination:s.denomination, lines:s.lines, bet:s.bet,
        lastWin:Number.isSafeInteger(s.lastWin) && s.lastWin >= 0 ? s.lastWin : 0, grid:validGrid ? s.grid : null,
        sound:typeof s.sound === "boolean" ? s.sound : true,
        musicVolume:Number.isFinite(s.musicVolume) && s.musicVolume>=0 && s.musicVolume<=1 ? s.musicVolume : 0.25,
        slotVolume:Number.isFinite(s.slotVolume) && s.slotVolume>=0 && s.slotVolume<=1 ? s.slotVolume : 1};
      if(s.score && typeof s.score.id==="string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.score.id) &&
          Number.isSafeInteger(s.score.cents) && s.score.cents>=0 && s.score.cents<=1801350000 &&
          typeof s.score.initials==="string" && /^(?:[A-Z0-9]{3})?$/.test(s.score.initials)) {
        state.score={id:s.score.id,cents:s.score.cents,initials:s.score.initials};
      }
      const b = s.bonus;
      if (b && Array.isArray(b.values) && b.values.length === 14 &&
          [...b.values].sort((a,c)=>a-c).join() === [...DATA.bonusValues].sort((a,c)=>a-c).join() &&
          Array.isArray(b.picks) && new Set(b.picks).size === b.picks.length &&
          b.picks.every(n=>Number.isInteger(n)&&n>=0&&n<14) &&
          Number.isInteger(b.bet) && b.bet>=1 && b.bet<=5 && DATA.denominations.includes(b.denomination) &&
          !b.picks.some(n=>b.values[n]===0)) {
        state.bonus = {values:b.values,picks:b.picks,bet:b.bet,denomination:b.denomination};
      }
    } catch (_) { /* Use a fresh game if the save is invalid. */ }
  }

  // Rows are ordered highest-first in the original executable. -1 accepts any symbol.
  function evaluate(grid, lines, bet) {
    const lineWins = [];
    DATA.lines.slice(0,lines).forEach((pattern,line) => {
      const symbols = pattern.map((row,col)=>grid[col][row]);
      const award = DATA.payouts.find(row=>row.slice(0,5).every((s,col)=>s===-1 || s===symbols[col]));
      if (award) lineWins.push({line, credits:award[5]*bet, count:award.slice(0,5).filter(s=>s!==-1).length});
    });
    // The original trigger counts reels containing a snowflake, once per reel.
    return {wins:lineWins,total:lineWins.reduce((sum,w)=>sum+w.credits,0),bonus:grid.filter(col=>col.includes(7)).length>=3};
  }

  function createReels() {
    for (let col=0;col<5;col++) {
      const reel=document.createElement("div"); reel.className="reel";
      for (let row=0;row<3;row++) {
        const img=document.createElement("img"); img.className="symbol"; img.draggable=false; reel.append(img);
      }
      $("reels").append(reel);
    }
    for (let line=0;line<9;line++) {
      const lamp=document.createElement("button"); lamp.className="marker";
      lamp.style.top=`${(lampY[line]-20)/768*100}%`; lamp.textContent=line+1;
      lamp.setAttribute("aria-label",`Play ${line+1} paylines`);
      lamp.addEventListener("click",()=>change(()=>{state.lines=line+1;}));
      lamp.addEventListener("mouseenter",()=>{if(!spinning&&!payout&&!state.bonus)showLine(line);});
      lamp.addEventListener("mouseleave",()=>{if(!spinning&&!payout&&!state.bonus)showWin();});
      $("markers").append(lamp);
    }
  }
  function drawGrid(grid) {
    [...$("reels").children].forEach((reel,col)=>[...reel.children].forEach((img,row)=>{
      const symbol=grid[col][row]; img.src=`assets/serbia_symbol${symbol}.png`; img.alt=names[symbol];
    }));
  }
  function update() {
    $("sound").textContent=state.sound ? "Sound: on" : "Sound: off";
    $("sound").setAttribute("aria-pressed",String(state.sound));
    renderMeters();
    $("lines").textContent=state.lines; $("bet").textContent=state.bet;
    $("total").textContent=state.lines*state.bet;
    $("denom-art").src=`assets/slots_denom${DATA.denominations.indexOf(state.denomination)}.png`;
    $("denom-art").alt=denominationLabel(state.denomination);
    $("denomination").title=`${denominationLabel(state.denomination)} per credit — click to change`;
    $("cost").textContent=`${money(state.bet*state.denomination)} per line · ${money(state.lines*state.bet*state.denomination)} per spin`;
    const scoreLocked=leaderboardBusy || $("score-dialog").open;
    const locked=spinning || !!payout || !!state.bonus || !$("bonus").hidden || scoreLocked;
    controls.forEach(id=>$(id).disabled=locked);
    $("spin").disabled=!!payout || !!state.bonus || !$("bonus").hidden || scoreLocked;
    $("bonus-done").disabled=!!payout || scoreLocked;
    $("leaderboard-refresh").disabled=scoreLocked;
    $("score-submit").disabled=leaderboardBusy;
    $("score-skip").disabled=leaderboardBusy;
    $("score-initials").disabled=leaderboardBusy;
    $("spin").classList.toggle("stopping",spinning);
    $("spin").setAttribute("aria-label",spinning ? "Stop reels" : "Spin");
    $("lines-up").disabled=locked||state.lines===9; $("lines-down").disabled=locked||state.lines===1;
    $("bet-up").disabled=locked||state.bet===5; $("bet-down").disabled=locked||state.bet===1;
    [...$("markers").children].forEach((lamp,i)=>{
      lamp.classList.toggle("active",i%9<state.lines); lamp.disabled=locked;
      lamp.setAttribute("aria-pressed",String(i%9<state.lines));
    });
  }
  function showLine(line) {
    $("paylines").replaceChildren();
    if(line===undefined)return;
    const img=document.createElement("img"); img.src=`assets/payline_${String(line+1).padStart(2,"0")}.png`; img.alt=""; $("paylines").append(img);
  }
  function clearWins() { clearInterval(lineTimer); lineTimer=null; wins=[]; showLine(); }
  function showWin() {
    if (!wins.length || spinning || state.bonus) { showLine(); return; }
    const w=wins[lineIndex%wins.length]; showLine(w.line);
    $("message").textContent=`Line ${w.line+1} pays ${w.credits.toLocaleString()} · Game pays ${state.lastWin.toLocaleString()} credits`;
  }
  function startWinCycle() {
    clearInterval(lineTimer); lineIndex=0; showWin();
    if(wins.length>1)lineTimer=setInterval(()=>{if(!$("dialog").open&&!document.hidden){lineIndex++;showWin();}},1800);
  }
  function change(fn) {
    if(spinning||payout||state.bonus||!$("bonus").hidden||leaderboardBusy||$("score-dialog").open)return;
    clearWins();fn();save();update();$("message").textContent=`Play ${state.lines*state.bet} credits. Good luck!`;
  }

  function spin() {
    if($("dialog").open||$("score-dialog").open||leaderboardBusy)return;
    if(spinning){finishSpin();return;}
    if(payout||state.bonus||!$("bonus").hidden)return;
    const wager=state.lines*state.bet*state.denomination;
    if(state.balance<wager){$("message").textContent="Not enough credits. Lower your wager or denomination, or start a new game.";return;}
    $("win-overlay").hidden=true;
    clearWins();state.balance-=wager;state.lastWin=0;spinning=true;
    const grid=rollGrid(), result=evaluate(grid,state.lines,state.bet);
    // Commit the outcome before animation so refreshing cannot replay a settled spin.
    state.grid=grid;state.balance+=result.total*state.denomination;
    state.lastWin=result.total;
    if(result.bonus)state.bonus=newBonus();
    state.score=result.total || result.bonus ? {id:crypto.randomUUID(),cents:result.total*state.denomination,initials:""} : null;
    save();
    // Hold the credited result until all reels stop visually.
    $("bank").textContent=money(state.balance-result.total*state.denomination);
    $("credits").textContent=Math.floor((state.balance-result.total*state.denomination)/state.denomination).toLocaleString();
    $("win").textContent="0";
    controls.forEach(id=>$(id).disabled=true);
    [...$("markers").children].forEach(lamp=>lamp.disabled=true);
    $("spin").classList.add("stopping");$("spin").setAttribute("aria-label","Stop reels");
    $("message").textContent="Good Luck!";
    playSound("spin",true);
    const reels=[...$("reels").children];reels.forEach(reel=>reel.classList.add("rolling"));
    animation=setInterval(()=>{const preview=rollGrid();reels.forEach((reel,col)=>{
      if(reel.classList.contains("rolling")) [...reel.children].forEach((img,row)=>{img.src=`assets/serbia_symbol${preview[col][row]}.png`;});
    });},85);
    reels.forEach((reel,col)=>timers.push(setTimeout(()=>{
      reel.classList.remove("rolling");[...reel.children].forEach((img,row)=>{img.src=`assets/serbia_symbol${grid[col][row]}.png`;img.alt=names[grid[col][row]];});
      playSound("stop");
    },700+col*230)));
    timers.push(setTimeout(()=>finishSpin(result),1700));
  }
  function finishSpin(result) {
    if(!spinning)return;
    stopSound("spin");
    if([...$("reels").children].some(reel=>reel.classList.contains("rolling")))playSound("stop");
    timers.forEach(clearTimeout);timers=[];clearInterval(animation);animation=null;
    [...$("reels").children].forEach(reel=>reel.classList.remove("rolling"));
    drawGrid(state.grid);spinning=false;
    const outcome=result||evaluate(state.grid,state.lines,state.bet);wins=outcome.wins;
    if(outcome.total){
      showLine(wins[0].line);
      $("message").textContent=`Game pays ${outcome.total.toLocaleString()} credits`;
    }
    countPayout(outcome.total,()=>{
      if(state.bonus){playSound("clear");showBonus();$("message").textContent="Three snowflake reels — bonus game!";}
      else {
        if(wins.length)startWinCycle();
        else $("message").textContent="Game over · Select your wager and spin again.";
        checkHighScore();
      }
    });
  }
  function newBonus() {
    const values=[...DATA.bonusValues];
    for(let i=values.length-1;i>0;i--){const j=randomInt(i+1);[values[i],values[j]]=[values[j],values[i]];}
    return {values,picks:[],bet:state.bet,denomination:state.denomination};
  }
  function showBonus() {
    clearInterval(lineTimer);showLine();$("bonus").hidden=false;$("bonus-done").hidden=true;
    const b=state.bonus;$("bonus-board").replaceChildren();
    b.values.forEach((value,index)=>{
      const button=document.createElement("button");button.setAttribute("aria-label",`Pick snowflake ${index+1}`);
      const img=document.createElement("img");img.src=`assets/serbia_bonus${index%4}.png`;img.alt="";button.append(img);
      if(b.picks.includes(index)){button.textContent=`+${value*b.bet}`;button.classList.add("revealed");button.disabled=true;}
      button.addEventListener("click",()=>pick(index));$("bonus-board").append(button);
    });
    const earned=b.picks.reduce((sum,index)=>sum+b.values[index]*b.bet,0);
    $("bonus-message").textContent=`Pick until COLLECT · Bonus ${earned} credits`;
  }
  function pick(index) {
    const b=state.bonus;if(!b||b.picks.includes(index))return;
    const button=$("bonus-board").children[index],value=b.values[index];
    b.picks.push(index);button.classList.add("revealed");button.disabled=true;
    if(value===0){
      const multiplier=b.picks.length===1 ? b.values.reduce((s,n)=>s+n,0) : b.picks.reduce((s,i)=>s+b.values[i],0);
      const award=multiplier*b.bet;
      state.balance+=award*b.denomination;state.lastWin+=award;state.bonus=null;
      state.score=state.score || {id:crypto.randomUUID(),cents:(state.lastWin-award)*b.denomination,initials:""};
      state.score.cents+=award*b.denomination;save();
      button.textContent="COLLECT";
      [...$("bonus-board").children].forEach((choice,i)=>{choice.disabled=true;if(!choice.classList.contains("revealed"))choice.textContent=b.values[i] ? `+${b.values[i]*b.bet}` : "COLLECT";});
      $("bonus-message").textContent=`Bonus pays ${award} credits${b.picks.length===1 ? " · First-pick COLLECT awards the whole board!" : ""}`;
      $("bonus-done").hidden=false;
      // Keep wagering locked until the player leaves the result screen.
      countPayout(award,checkHighScore);
    }else{
      playSound("snowflake");
      button.textContent=`+${value*b.bet}`;
      $("bonus-message").textContent=`Bonus ${b.picks.reduce((sum,i)=>sum+b.values[i]*b.bet,0)} credits · Keep picking`;
      save();
    }
  }
  function modal(title,html) {$("dialog-title").textContent=title;$("dialog-body").innerHTML=html;$("dialog").showModal();}
  function paytable() {
    let html='<table><thead><tr><th>Symbol</th><th>2</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>';
    for(let symbol=0;symbol<7;symbol++){
      const awards=[2,3,4,5].map(count=>DATA.payouts.find(row=>row[0]===symbol&&row.slice(0,5).filter(s=>s!==-1).length===count)[5]);
      html+=`<tr><td><img src="assets/serbia_symbol${symbol}.png" alt="">${names[symbol]}</td>${awards.map(a=>`<td>${a.toLocaleString()}</td>`).join("")}</tr>`;
    }
    modal("Canadian Wolf · Pay table",html+'</tbody></table><p>Awards are credits for one coin per line. Multiply by your bet per line. Matching symbols must start on the leftmost reel; only the highest award on each active line pays. There are no wild substitutions.</p><p>Snowflakes on at least three different reels trigger the bonus, anywhere in the three visible rows. Pick snowflakes for credits until COLLECT appears. Finding COLLECT first awards the entire board. Bonus values are multiplied by bet per line.</p>');
  }
  $("sound").addEventListener("click",()=>{
    state.sound=!state.sound;save();
    if(!state.sound)stopAllSounds();
    else if(payout)playSound("pay",true);
    else if(spinning)playSound("spin",true);
    else playSound("click");
    syncMusic();
    $("sound").textContent=state.sound ? "Sound: on" : "Sound: off";
    $("sound").setAttribute("aria-pressed",String(state.sound));
  });
  $("spin").addEventListener("click",spin);
  for(const name of ["music","slot"]){
    $(name+"-volume").addEventListener("input",()=>{
      state[name+"Volume"]=Number($(name+"-volume").value)/100;
      applyVolumes();save();
    });
  }
  $("lines-up").addEventListener("click",()=>change(()=>state.lines++));
  $("lines-down").addEventListener("click",()=>change(()=>state.lines--));
  $("bet-up").addEventListener("click",()=>change(()=>state.bet++));
  $("bet-down").addEventListener("click",()=>change(()=>state.bet--));
  $("max").addEventListener("click",()=>{if(spinning||payout||state.bonus||!$("bonus").hidden)return;change(()=>{state.lines=9;state.bet=5;});spin();});
  $("paytable").addEventListener("click",paytable);
  $("cash").addEventListener("click",()=>modal("Cash out",`<p>You have <strong>${Math.floor(state.balance/state.denomination).toLocaleString()} credits</strong> at ${denominationLabel(state.denomination)} per credit.</p><p>Total simulated balance: <strong>${money(state.balance)}</strong>.</p><p>These are play credits. No money is paid out; your balance stays available for play.</p>`));
  $("help").addEventListener("click",()=>modal("How to play",'<p>Use LINES +/− to choose 1–9 paylines, and BET +/− for 1–5 credits per line. Click the numbered lamps to select that many lines. Hover over a lamp to see its path.</p><p>SPIN or Space starts a spin. STOP reveals the result immediately. BET MAX selects nine lines and five credits per line, then spins.</p><p>Click the coin beside CREDITS to change denomination. Your cash balance is preserved. BANK shows simulated cash; CREDITS shows whole credits at the current denomination. Any remainder stays in your balance.</p><p>PAY TABLE shows the recovered awards. Three reels with snowflakes open the bonus. Pick until COLLECT. New game restores 1,000 play credits (entertainment only) at your current denomination.</p>'));
  $("denomination").addEventListener("click",()=>{
    modal("Choose denomination",'<p>One credit is worth the selected amount. Your simulated cash balance stays the same.</p><div class="choices">'+DATA.denominations.map(n=>`<button data-denom="${n}" aria-pressed="${n===state.denomination}">${denominationLabel(n)}</button>`).join("")+'</div>');
    $("dialog-body").querySelectorAll("[data-denom]").forEach(button=>button.addEventListener("click",()=>{
      change(()=>{state.denomination=Number(button.dataset.denom);});$("dialog").close();
    }));
  });
  $("new-game").addEventListener("click",()=>{
    modal("New game",`<p>Replace your current balance with 1,000 play credits (entertainment only) at the current denomination?</p><button class="primary" id="confirm-new">Start new game</button>`);
    $("confirm-new").addEventListener("click",()=>{change(()=>{state.balance=1000*state.denomination;state.lastWin=0;$("win-overlay").hidden=true;state.score=null;state.grid=rollGrid();});drawGrid(state.grid);$("dialog").close();});
  });
  $("bonus-done").addEventListener("click",()=>{if(payout)return;$("bonus").hidden=true;update();if(wins.length)startWinCycle();else $("message").textContent=`Game pays ${state.lastWin} credits · Ready to spin`;});
  $("close-dialog").addEventListener("click",()=>$("dialog").close());
  $("leaderboard-refresh").addEventListener("click",()=>{
    if(state.score && !spinning && !payout && !state.bonus)checkHighScore();else refreshLeaderboard();
  });
  $("score-initials").addEventListener("input",()=>{
    $("score-initials").value=$("score-initials").value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3);
  });
  $("score-form").addEventListener("submit",async event=>{
    event.preventDefault();
    if(leaderboardBusy || !state.score || !$("score-form").reportValidity())return;
    state.score.initials=$("score-initials").value;save();
    leaderboardBusy=true;++leaderboardRevision;update();$("score-error").textContent="Saving…";
    try {
      const data=await leaderboardRequest("POST",state.score);renderLeaderboard(data.scores);
      const rank=data.scores.findIndex(entry=>entry.id===state.score.id)+1;
      const initials=state.score.initials;state.score=null;save();$("score-dialog").close();
      $("leaderboard-status").textContent=rank ? `${initials} placed #${rank}!` : "Another payout moved ahead. The board has been updated.";
    } catch {$("score-error").textContent="Could not save. Try again; your payout will not be entered twice.";}
    finally {leaderboardBusy=false;update();}
  });
  function skipHighScore() {
    if(leaderboardBusy)return;
    state.score=null;save();$("score-dialog").close();
    $("leaderboard-status").textContent="Score entry skipped.";update();
  }
  $("score-skip").addEventListener("click",skipHighScore);
  $("score-dialog").addEventListener("cancel",event=>{event.preventDefault();skipHighScore();});
  $("score-dialog").addEventListener("close",update);
  document.addEventListener("keydown",event=>{if(event.code==="Space"&&!event.repeat&&!$("dialog").open&&!$("score-dialog").open&&$("bonus").hidden&&!["BUTTON","INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName)){event.preventDefault();spin();}});
  load();applyVolumes();createReels();if(!state.grid)state.grid=rollGrid();drawGrid(state.grid);update();
  if(state.bonus)showBonus();save();
  renderLeaderboard([]);
  if(state.score && !state.bonus)checkHighScore();else refreshLeaderboard();
})();
