// Terminology references, not clinical protocols. See docs/medical-glossary-sources.md.
// Fields: category | Taiwan Traditional Chinese | English | unambiguous abbreviations/aliases.
const DATA = `
現場與交班|到院前救護|prehospital care|
現場與交班|緊急醫療救護系統|emergency medical services|EMS
現場與交班|救護技術員|emergency medical technician|EMT
現場與交班|高級救護技術員|paramedic|
現場與交班|現場安全|scene safety|
現場與交班|大量傷病患事件|mass casualty incident|MCI
現場與交班|檢傷分類|triage|
現場與交班|傷患交接|patient handover|patient handoff
現場與交班|主訴|chief complaint|
現場與交班|病史|medical history|
現場與交班|過敏史|allergy history|
現場與交班|受傷機轉|mechanism of injury|MOI
現場與交班|預估到院時間|estimated time of arrival|ETA
評估與生命徵象|生命徵象|vital signs|
評估與生命徵象|意識狀態|level of consciousness|LOC
評估與生命徵象|格拉斯哥昏迷指數|Glasgow Coma Scale|GCS
評估與生命徵象|瞳孔對光反射|pupillary light reflex|
評估與生命徵象|呼吸速率|respiratory rate|
評估與生命徵象|心跳速率|heart rate|
評估與生命徵象|血壓|blood pressure|
評估與生命徵象|血氧飽和度|oxygen saturation|SpO2
評估與生命徵象|呼氣末二氧化碳|end-tidal carbon dioxide|ETCO2
評估與生命徵象|血糖|blood glucose|
評估與生命徵象|體溫|body temperature|
評估與生命徵象|毛細血管再充填|capillary refill|
呼吸道與通氣|呼吸道阻塞|airway obstruction|
呼吸道與通氣|呼吸衰竭|respiratory failure|
呼吸道與通氣|呼吸停止|respiratory arrest|
呼吸道與通氣|缺氧|hypoxia|
呼吸道與通氣|低血氧症|hypoxemia|
呼吸道與通氣|呼吸困難|shortness of breath|dyspnea
呼吸道與通氣|喘鳴|wheezing|
呼吸道與通氣|喉鳴|stridor|
呼吸道與通氣|抽吸|suctioning|
呼吸道與通氣|口咽呼吸道|oropharyngeal airway|OPA
呼吸道與通氣|鼻咽呼吸道|nasopharyngeal airway|NPA
呼吸道與通氣|聲門上呼吸道|supraglottic airway|
呼吸道與通氣|氣管內插管|endotracheal intubation|
呼吸道與通氣|袋瓣罩甦醒球|bag-valve-mask|BVM
呼吸道與通氣|持續性正壓呼吸|continuous positive airway pressure|CPAP
呼吸道與通氣|氣胸|pneumothorax|
呼吸道與通氣|張力性氣胸|tension pneumothorax|
呼吸道與通氣|血胸|hemothorax|
心血管與復甦|心肺停止|cardiac arrest|
心血管與復甦|到院前心肺功能停止|out-of-hospital cardiac arrest|OHCA
心血管與復甦|心肺復甦術|cardiopulmonary resuscitation|CPR
心血管與復甦|胸外按壓|chest compressions|胸腔按壓
心血管與復甦|自動體外心臟去顫器|automated external defibrillator|AED
心血管與復甦|電擊去顫|defibrillation|
心血管與復甦|自主循環恢復|return of spontaneous circulation|ROSC
心血管與復甦|心室顫動|ventricular fibrillation|
心血管與復甦|無脈搏心室頻脈|pulseless ventricular tachycardia|
心血管與復甦|無脈搏電氣活動|pulseless electrical activity|PEA
心血管與復甦|心室靜止|asystole|
心血管與復甦|急性冠心症|acute coronary syndrome|ACS
心血管與復甦|心肌梗塞|myocardial infarction|
心血管與復甦|心電圖|electrocardiogram|ECG;EKG
心血管與復甦|心因性休克|cardiogenic shock|
心血管與復甦|低血容性休克|hypovolemic shock|
心血管與復甦|過敏性休克|anaphylactic shock|
心血管與復甦|嚴重過敏反應|anaphylaxis|
創傷與止血|外傷性腦損傷|traumatic brain injury|TBI
創傷與止血|脊髓損傷|spinal cord injury|
創傷與止血|脊椎活動限制|spinal motion restriction|SMR
創傷與止血|頸圈|cervical collar|
創傷與止血|止血|hemorrhage control|bleeding control
創傷與止血|直接加壓止血|direct pressure|
創傷與止血|止血帶|tourniquet|
創傷與止血|傷口填塞|wound packing|
創傷與止血|骨盆固定帶|pelvic binder|
創傷與止血|骨折|bone fracture|fracture
創傷與止血|開放性骨折|open fracture|
創傷與止血|脫臼|dislocation|
創傷與止血|夾板固定|splinting|
創傷與止血|燒燙傷|burn injury|burns
創傷與止血|電擊傷|electrical injury|
搬運與救援|長背板|long spine board|
搬運與救援|鏟式擔架|scoop stretcher|
搬運與救援|軟式擔架|soft stretcher|
搬運與救援|真空床墊|vacuum mattress|
搬運與救援|樓梯椅|stair chair|
搬運與救援|擔架|stretcher|
搬運與救援|傷患搬運|patient handling|patient movement
搬運與救援|傷患轉移|patient transfer|
搬運與救援|救出脫困|extrication|
搬運與救援|軸向翻身|log roll|
內科與急診|敗血症|sepsis|
內科與急診|敗血性休克|septic shock|
內科與急診|肺炎|pneumonia|
內科與急診|氣喘|asthma|
內科與急診|慢性阻塞性肺病|chronic obstructive pulmonary disease|COPD
內科與急診|肺栓塞|pulmonary embolism|
內科與急診|低血糖|hypoglycemia|
內科與急診|高血糖|hyperglycemia|
內科與急診|糖尿病酮酸中毒|diabetic ketoacidosis|DKA
內科與急診|中風|stroke|
內科與急診|缺血性中風|ischemic stroke|
內科與急診|出血性中風|hemorrhagic stroke|
內科與急診|暫時性腦缺血發作|transient ischemic attack|TIA
內科與急診|癲癇發作|seizure|
內科與急診|意識改變|altered mental status|
內科與急診|腦膜炎|meningitis|
內科與急診|主動脈剝離|aortic dissection|
內科與急診|急性腎損傷|acute kidney injury|
內科與急診|上消化道出血|upper gastrointestinal bleeding|
內科與急診|腹膜炎|peritonitis|
內科與急診|腸阻塞|bowel obstruction|
內科與急診|急性闌尾炎|acute appendicitis|
內科與急診|急性胰臟炎|acute pancreatitis|
兒科與婦產科|兒科病人|pediatric patient|
兒科與婦產科|新生兒|newborn|neonate
兒科與婦產科|妊娠|pregnancy|
兒科與婦產科|產後出血|postpartum hemorrhage|
兒科與婦產科|子癲前症|preeclampsia|
兒科與婦產科|子癲症|eclampsia|
兒科與婦產科|早產|preterm labor|
感染與用藥|個人防護裝備|personal protective equipment|PPE
感染與用藥|感染管制|infection control|
感染與用藥|接觸隔離|contact precautions|
感染與用藥|飛沫隔離|droplet precautions|
感染與用藥|空氣傳染隔離|airborne precautions|
感染與用藥|靜脈注射|intravenous injection|
感染與用藥|骨髓內輸液|intraosseous infusion|
感染與用藥|腎上腺素|epinephrine|adrenaline
感染與用藥|硝化甘油|nitroglycerin|
感染與用藥|納洛酮|naloxone|
感染與用藥|藥物過敏|drug allergy|
感染與用藥|抗凝血藥|anticoagulant|
感染與用藥|抗血小板藥|antiplatelet|
`;
export const MEDICAL_GLOSSARY = DATA.trim().split('\n').map(line => {
 const [category, zh, en, aliases=''] = line.split('|');
 return {category, zh, en, aliases:aliases ? aliases.split(';') : []};
});
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matchesTerm(text, term) {
 if (!term) return false;
 if (/^[\x00-\x7F]+$/.test(term)) {
  const sensitive=/^[A-Z0-9]{2,6}$/.test(term);
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(term)}(?=$|[^A-Za-z0-9])`, sensitive ? '' : 'i').test(text);
 }
 return text.includes(term);
}
export function findMedicalTerms(text, limit=12) {
 const input=String(text||'');
 return MEDICAL_GLOSSARY.filter(item=>[item.zh,item.en,...item.aliases].some(term=>matchesTerm(input,term))).slice(0,limit);
}
export function medicalContext(text, existing='', limit=3000) {
 const matches=findMedicalTerms(text,30);
 if(!matches.length)return String(existing||'').slice(0,limit);
 const intro='【消防·救護·急診醫療中英日專業術語庫】以下術語僅供參考；依上下文判斷，不可憑空補充診斷、數值或處置。\n';
 const lines=matches.map(({zh,en,aliases})=>`${zh} = ${en}${aliases.length ? ' ('+aliases.join(', ')+')' : ''}`);
 let result=intro;
 for(const line of lines){if(result.length+line.length+1>limit)break;result+=line+'\n';}
 const remainder=String(existing||'').trim();
 if(remainder && result.length+2<limit)result+='\n'+remainder.slice(0,limit-result.length-1);
 return result;
}
