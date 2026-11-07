// Presentation follows each language independently; the full transcript stays
// in records and in the normal view. Late translations keep their source order.
export function presentationLanes(records, {dual=false,triple=false,labels=[]}={}) {
 const primary=records.filter(r=>!r.secondary && r.target!=='連線狀態');
 const children=new Map(),legacyIds=new Map(),legacyTimes=new Map();
 for(const r of records.filter(r=>r.secondary)){
  if(r.parentId)children.set(`${r.parentId}:${r.languageSlot===3?3:2}`,r);
  else if(r.languageSlot!==3){legacyIds.set(r.id,r);const key=JSON.stringify([r.sessionId,r.time]);if(!legacyTimes.has(key))legacyTimes.set(key,r);}
 }
 const laneCount=triple&&dual?4:dual?3:2;
 return Array.from({length:laneCount},(_,slot)=>{
  const items=[];
  let state='等待字幕…';
  for(const r of primary){
   const item=slot<2?r:children.get(`${r.id}:${slot}`) || (slot===2?(legacyIds.get(r.secondId)||legacyTimes.get(JSON.stringify([r.sessionId,r.time]))):null);
   const text=slot===0?(r.text||r.interim||''):(item?.translation || (slot===2?r.secondTranslation:'') || '');
   if(text)items.push({id:r.id,time:r.time,text,error:slot>0&&item?.state==='error'?item.error||'翻譯中斷':''});
   state=item?.state==='error'?(item.error||'翻譯中斷，請核對原文'):!text?'等待字幕…':item?.state==='streaming'?'即時更新中':'最新字幕';
  }
  return {label:labels[slot]||['講者原文','第一語言','第二語言','第三語言'][slot],items:items.slice(-3),state};
 });
}

export function renderPresentation(container,lanes,{triple=false}={}) {
 container.classList.toggle('presentation-triple',triple);
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
  const signature=JSON.stringify(lane.items);
  if(body.dataset.content!==signature){
   body.dataset.content=signature;body.replaceChildren();
   for(const item of lane.items){
    const block=document.createElement('div');block.className='presentation-sentence';
    const time=document.createElement('time');time.textContent=item.time||'';
    const text=document.createElement('p');text.textContent=item.text;
    block.append(time,text);
    if(item.error){const warning=document.createElement('small');warning.textContent=item.error;block.append(warning);}
    body.append(block);
   }
  }
  // No smooth animation: repeated streaming updates must not lag behind.
  body.scrollTop=body.scrollHeight;
 });
}
