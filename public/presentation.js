import {toTaiwanTranscript} from './traditional.js';

export function sourceForTarget(record,target){
 const code=String(record._inputLanguage||record.language||'').toLowerCase();
 const source=record.text||record.interim||'';
 if(target==='Traditional Chinese (Taiwan)' && /^(zh|cmn)(?:-|$)/.test(code))return toTaiwanTranscript(source,'zh');
 const targets={English:'en',Japanese:'ja',Korean:'ko',Bengali:'bn'};
 if(targets[target] && code.split('-')[0]===targets[target])return source;
 return '';
}
export function indexTranslations(records) {
 const byParent=new Map(),byId=new Map(),byTime=new Map();
 for(const r of records){
  if(!r.secondary)continue;
  if(r.parentId){const key=JSON.stringify([r.parentId,r.target]);if(!byParent.has(key))byParent.set(key,r);}
  else {byId.set(JSON.stringify([r.id,r.target]),r);const key=JSON.stringify([r.sessionId,r.time,r.target]);if(!byTime.has(key))byTime.set(key,r);}
 }
 return (parent,target)=>parent.target===target?parent:byParent.get(JSON.stringify([parent.id,target]))||byId.get(JSON.stringify([parent.secondId,target]))||byTime.get(JSON.stringify([parent.sessionId,parent.time,target]))||null;
}

// Continuous lecture columns retain all translations in source order.
// The default bounded source/translation layout remains for legacy callers.
export function presentationLanes(records, {dual=false,triple=false,labels=[],targets=[],continuous=false,includeSpeaker=null}={}) {
 const findTranslation=indexTranslations(records);
 const primary=records.filter(r=>!r.secondary && r.target!=='連線狀態');
 const children=new Map(),legacyIds=new Map(),legacyTimes=new Map();
 for(const r of records.filter(r=>r.secondary)){
  if(r.parentId)children.set(`${r.parentId}:${r.languageSlot===3?3:2}`,r);
  else if(r.languageSlot!==3){legacyIds.set(r.id,r);const key=JSON.stringify([r.sessionId,r.time]);if(!legacyTimes.has(key))legacyTimes.set(key,r);}
 }
 const laneCount=triple&&dual?4:dual?3:2;
 const lanes=Array.from({length:laneCount},(_,slot)=>{
  const items=[];
  let state='等待字幕…';
  for(const r of primary){
   const item=slot===0?r:targets[slot-1]?findTranslation(r,targets[slot-1]):slot<2?r:children.get(`${r.id}:${slot}`) || (slot===2?(legacyIds.get(r.secondId)||legacyTimes.get(JSON.stringify([r.sessionId,r.time]))):null);
   const sameLanguage=slot>0&&targets[slot-1]?sourceForTarget(r,targets[slot-1]):'';
   const text=slot===0?(r.text||r.interim||''):(sameLanguage || item?.translation || (slot===2&&!targets.length?r.secondTranslation:'') || '');
   if(text)items.push({id:r.id,time:r.time,text,error:slot>0&&item?.state==='error'?item.error||'翻譯中斷':''});
   state=sameLanguage?'原文即時顯示':item?.state==='error'?(item.error||'翻譯中斷，請核對原文'):!text?(item?.state==='streaming'?'正在串流翻譯…':item?.state==='pending'?'正在送出翻譯…':'此段尚無所選語言譯文'):item?.state==='streaming'?'即時更新中':'最新字幕';
  }
  return {label:labels[slot]||['講者原文','第一語言','第二語言','第三語言'][slot],items:continuous?items:items.slice(-3),state};
 });
 const shouldSlice = includeSpeaker === false || (continuous && includeSpeaker !== true);
 return shouldSlice ? lanes.slice(1) : lanes;
}

export function renderPresentation(container,lanes,{triple=false,continuous=false}={}) {
 container.classList.toggle('presentation-triple',triple);
 container.classList.toggle('continuous-languages',continuous);
 if(container.children.length!==lanes.length){
  container.replaceChildren();
  for(const lane of lanes){
   const pane=document.createElement('section');pane.className='presentation-pane';
   const heading=document.createElement('h2');heading.className='presentation-heading';
   const body=document.createElement('div');body.className='presentation-body';body.tabIndex=0;
   const state=document.createElement('div');state.className='presentation-state';
   pane.append(heading,body,state);container.append(pane);
  }
 }
 lanes.forEach((lane,index)=>{
  const [heading,body,state]=container.children[index].children;
  heading.textContent=lane.label;body.setAttribute('aria-label',lane.label+'字幕');state.textContent=lane.state;
  const signature=JSON.stringify([continuous,lane.items]);
  if(body.dataset.content!==signature){
   body.dataset.content=signature;
   const items = lane.items;
   if(continuous){
    while(body.children.length > items.length){
     if(body.removeChild && body.lastChild) body.removeChild(body.lastChild);
     else if(body.children.pop) body.children.pop();
     else break;
    }
    items.forEach((item, i) => {
     let block = body.children[i];
     if(!block){
      block = document.createElement('div'); block.className = 'presentation-sentence';
      const time = document.createElement('time'); time.textContent = item.time || '';
      const text = document.createElement('p'); text.textContent = item.text;
      block.append(time, text);
      if(item.error){ const warning = document.createElement('small'); warning.textContent = item.error; block.append(warning); }
      body.append(block);
     } else {
      const time = block.children?.[0];
      if(time && item.time && time.textContent !== item.time) time.textContent = item.time;
      const text = block.children?.[1];
      if(text && text.textContent !== item.text) text.textContent = item.text;
      if(block.children?.[2]){if(item.error)block.children[2].textContent=item.error;else block.children[2].remove();}
      if(item.error && block.children?.length < 3){
       const warning = document.createElement('small'); warning.textContent = item.error; block.append(warning);
      }
     }
    });
   } else {
    if(body.children.length === items.length && items.length > 0){
     items.forEach((item, i) => {
      const block = body.children[i];
      const time = block.children?.[0];
      if(time && item.time && time.textContent !== item.time) time.textContent = item.time;
      const text = block.children?.[1];
      if(text && text.textContent !== item.text) text.textContent = item.text;
     });
    } else {
     body.replaceChildren();
     for(const item of items){
      const block=document.createElement('div');block.className='presentation-sentence';
      const time=document.createElement('time');time.textContent=item.time||'';
      const text=document.createElement('p');text.textContent=item.text;
      block.append(time,text);
      if(item.error){const warning=document.createElement('small');warning.textContent=item.error;block.append(warning);}
      body.append(block);
     }
    }
   }
  }
  // Pin scroll to bottom cleanly for continuous line pushing
  body.scrollTop=body.scrollHeight;
 });
}
