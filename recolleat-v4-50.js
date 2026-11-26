(() => {
"use strict";
const DB_NAME="palate-local-v1", DB_VERSION=7, RESTAURANTS="restaurants", LISTS="lists", VISITS="visits", LOCATIONS="locations", MEDIA="photoMedia", SNAPSHOTS="recoverySnapshots", PREF_KEY="recolleat-android-prefs-v1";
const PROFILE_KEY="recolleat-profile-v1";
const DEFAULT_PREFS={view:"home",sortProperty:"grandRank",sortDirection:"asc",filters:{location:"",cuisine:"",vibe:"",region:"",service:"",minScore:"",minValue:"",maxSpend:""},graph:{fitMode:"off",filters:{location:"",cuisine:"",region:"",minFood:"",minOverall:""}},activeListId:null,sidebarCollapsed:false,dishCategories:[],hiddenDishCategories:[],labWeights:{food:60,value:20,service:20},dnaTopCount:8,appearance:{palette:"mint",mode:"dark"}};
const SERVICE_ORDER={Horror:1,Sloppy:2,Average:3,Respectable:4,Lovely:5};
let db=null, entries=[], lists=[], visits=[], locationMedia=[], editingId=null, editingListId=null, editingVisitId=null, selectedPassportId=null, graphSelection=null, currentDishCategoryEdit=null, dishPhotoContext=null, dishBookCategory="", dishBookIndex=0, editorPasteTarget="restaurant", graphZoom=1, graphPan={x:0,y:0}, graphDrag=null, workingPhotos=[], workingLocationImage="", locationImageEdited=false, pendingImport=null, visitMonthCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1), mapLocationFocus=null;
let prefs=loadPrefs();
// Discard invalid legacy experimental weights rather than corrupting global ranking.
if(!['food','value','service'].every(k=>Number.isInteger(prefs.labWeights?.[k])&&prefs.labWeights[k]>=0&&prefs.labWeights[k]<=100)||Object.values(prefs.labWeights).reduce((a,b)=>a+b,0)!==100)prefs.labWeights={food:60,value:20,service:20};
// Build 3: old graph and laboratory destinations are now Collection and Settings.
if(prefs.view==='graph')prefs.view='table';
if(prefs.view==='lab')prefs.view='settings';
// A former experimental weight preset must NEVER silently become an app-wide ranking rule.
try{
 if(!localStorage.getItem('recolleat-b3-global-weights-confirmed')){
  prefs.labWeights={food:60,value:20,service:20};
  localStorage.setItem(PREF_KEY,JSON.stringify(prefs));
  localStorage.setItem('recolleat-b3-global-weights-confirmed','1');
 }
}catch(error){console.warn('Global ranking default could not be stored',error)}
// Build 52 repairs the first-screen regression without changing user records.
try{
  if(!localStorage.getItem('recolleat-b52-boot-check')){
    if(prefs.view==='table'){
      prefs.view='home';
      localStorage.setItem(PREF_KEY,JSON.stringify(prefs));
    }
    localStorage.setItem('recolleat-b52-boot-check','1');
  }
}catch(error){console.warn('First-open navigation setting unavailable',error)}
// One-time navigation upgrade: previous default Grand List becomes Collection; Home is separate.
try{if(!localStorage.getItem('recolleat-b46-home-default')){if(prefs.view==='table'){prefs.view='home';localStorage.setItem(PREF_KEY,JSON.stringify(prefs))}localStorage.setItem('recolleat-b46-home-default','1')}}catch(e){}
let signatureGalleryIndex=0, galleryWheelTimestamp=0, galleryTouchX=null;
let workingVisits=[], selectedPlace=null, placeSearchCandidates=[], placeSearchNonce=0, googlePlacesConnected=false, googlePlacesLoading=false;
 let profile=loadProfile();
const $=id=>document.getElementById(id);

function clone(o){return JSON.parse(JSON.stringify(o))}
function loadPrefs(){try{const raw=JSON.parse(localStorage.getItem(PREF_KEY)||"{}");return {...clone(DEFAULT_PREFS),...raw,sidebarCollapsed:!!raw.sidebarCollapsed,dishCategories:Array.isArray(raw.dishCategories)?raw.dishCategories:[],hiddenDishCategories:Array.isArray(raw.hiddenDishCategories)?raw.hiddenDishCategories:[],filters:{...clone(DEFAULT_PREFS.filters),...(raw.filters||{})},graph:{...clone(DEFAULT_PREFS.graph),...(raw.graph||{}),filters:{...clone(DEFAULT_PREFS.graph.filters),...((raw.graph||{}).filters||{})}},appearance:{...clone(DEFAULT_PREFS.appearance),...(raw.appearance||{})},labWeights:{...clone(DEFAULT_PREFS.labWeights),...(raw.labWeights||{})}}}catch{return clone(DEFAULT_PREFS)}}
function loadProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_KEY)||"{}");return {username:typeof p.username==="string"?p.username.slice(0,30):"",photo:typeof p.photo==="string"&&p.photo.startsWith("data:image/")?p.photo:"",banner:cleanBanner(p.banner),wishlist:cleanWishlist(p.wishlist)}}catch{return {username:"",photo:"",banner:"classic",wishlist:[]}}}
function saveProfile(){try{localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));return true}catch(e){console.warn("Profile storage unavailable",e);return false}}
function profileAvatarMarkup(photo,label){return photo?`<img src="${esc(photo)}" alt="Profile picture">`:esc((label.trim().charAt(0)||"R").toUpperCase())}
function renderSharingDrafts(){
 const root=$('recoSharingDraftBody');if(!root)return;
 const selected=root.querySelector('select')?.value;root.replaceChildren();
 if(!entries.length){root.textContent='Add a restaurant to plan its future sharing permissions.';return;}
 const select=document.createElement('select');select.setAttribute('aria-label','Restaurant for local sharing preferences');
 for(const e of entries){const o=document.createElement('option');o.value=String(e.id);o.textContent=e.restaurant||'Restaurant';select.append(o)}
 if([...select.options].some(o=>o.value===selected))select.value=selected;
 root.append(select);const choices=document.createElement('div');root.append(choices);
 const fields=[['overall','Overall rating'],['dishes','Dish ratings'],['review','Written review'],['photos','Selected food photographs']];
 function records(){return Array.isArray(prefs.shareDrafts)?prefs.shareDrafts.filter(r=>r&&typeof r.id==='string'&&Array.isArray(r.fields)):[]}
 function draw(){choices.replaceChildren();const current=records().find(r=>r.id===select.value)?.fields||[];
 for(const [key,title] of fields){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=current.includes(key);input.dataset.shareField=key;label.append(input,document.createTextNode(' '+title));choices.append(label)}
 const save=document.createElement('button');save.type='button';save.textContent='Save local preferences';save.onclick=()=>{const values=[...choices.querySelectorAll('input:checked')].map(x=>x.dataset.shareField);prefs.shareDrafts=records().filter(r=>r.id!==select.value);if(values.length)prefs.shareDrafts.push({id:select.value,fields:values});savePrefs();notify('Local preferences saved. Nothing has been shared.');};
 const clear=document.createElement('button');clear.type='button';clear.textContent='Set everything private';clear.onclick=()=>{prefs.shareDrafts=records().filter(r=>r.id!==select.value);savePrefs();draw();notify('Sharing preferences cleared. All journal data remains private.');};choices.append(save,clear);}
 select.onchange=draw;draw();
}
window.recoLocalProfileName=()=>profile.username.trim()||"Recolleat collector";
function renderProfile(){
 reco50RenderBanner();renderSharingDrafts();
 const display=profile.username.trim()||"Recolleat collector", avatar=profileAvatarMarkup(profile.photo,display);
 $("profileDisplayName").textContent=window.recoOnlineName||display;$("profileUsername").value=profile.username;
 for(const id of ["profileBigAvatar","profileEditAvatar","headerProfileAvatar","moreProfileAvatar"]){const node=$(id);if(node)node.innerHTML=avatar;}
 $("headerProfileName").textContent=profile.username.trim()||"My profile";
 const rated=entries.filter(e=>Number.isFinite(Number(e.foodScore)));const cuisines=new Set(entries.map(e=>(e.cuisine||"").trim().toLowerCase()).filter(Boolean));
 const dishes=dishRecords().length;
 const totalVisits=visits.length;
 const intl=entries.filter(e=>e.international).length;
 const stats=[{n:entries.length,t:"Restaurants",s:"Memories in your collection"},{n:cuisines.size,t:"Cuisines",s:"Unique cuisines explored"},{n:dishes,t:"Dishes",s:"Items recorded"},{n:totalVisits,t:"Logged visits",s:"Dated and explicitly logged undated visits"},{n:intl,t:"International",s:"Restaurants outside the UK"},{n:rated.length?(rated.reduce((sum,e)=>sum+Number(e.foodScore),0)/rated.length).toFixed(1):"—",t:"Average food score",s:"Out of 100"}];
 $("profileStats").innerHTML=stats.map((x,i)=>`<article class="profile-stat"><strong>${esc(x.n)}</strong><h4>${esc(x.t)}</h4><p>${esc(x.s)}</p></article>`).join("");
}
async function updateProfilePicture(file){if(!file)return;if(!file.type.startsWith("image/"))throw new Error("Choose an image file.");if(file.size>12*1024*1024)throw new Error("Choose an image smaller than 12 megabytes.");const encoded=await imageToData(file,440,.76);const previous=profile.photo;profile.photo=encoded;if(!saveProfile()){profile.photo=previous;throw new Error("This browser could not save the image. Try a smaller picture.")}renderProfile()}
function savePrefs(){try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs))}catch(err){console.warn("Appearance preferences may not persist in this browser",err)}}
const REWARDS_KEY='recolleat-permanent-rewards-v45';
let earnedRewardLevels=(()=>{try{const values=JSON.parse(localStorage.getItem(REWARDS_KEY)||'[]');return Array.isArray(values)?values.filter(x=>[10,20,30,40].includes(x)):[]}catch{return []}})();
function updateEarnedRewards(){
 const levels=[10,20,30,40].filter(n=>collectedRestaurants()>=n);
 const next=[...new Set([...earnedRewardLevels,...levels])].sort((a,b)=>a-b);
 if(next.length!==earnedRewardLevels.length){earnedRewardLevels=next;try{localStorage.setItem(REWARDS_KEY,JSON.stringify(next))}catch(e){console.warn('Milestone reward persistence unavailable',e)}}
}
const THEME_MILESTONES=Object.freeze({mint:0,original:0,royal:10,citrus:20,crimson:30,golden:40});
const THEME_LABELS=Object.freeze({mint:"Recolleat Classic",original:"Black & White",royal:"Plum & Champagne",citrus:"Electric Citrus",crimson:"Crimson Red",golden:"Golden Hour"});
let previousThemeMilestone=null;
function collectedRestaurants(){return new Set(entries.map(e=>e.id)).size}
function themeRequired(palette){return Object.prototype.hasOwnProperty.call(THEME_MILESTONES,palette)?THEME_MILESTONES[palette]:0}
function themeUnlocked(palette){return Object.prototype.hasOwnProperty.call(THEME_MILESTONES,palette)&&(themeRequired(palette)===0||earnedRewardLevels.includes(themeRequired(palette))||collectedRestaurants()>=themeRequired(palette))}
function nextThemeGoal(){const count=collectedRestaurants();const next=[10,20,30,40].find(n=>!earnedRewardLevels.includes(n)&&count<n);return {count,next,nextTheme:next?Object.keys(THEME_MILESTONES).find(p=>THEME_MILESTONES[p]===next):null}}
function renderThemeJourney(){
 updateEarnedRewards();const {count,next,nextTheme}=nextThemeGoal();
 const available=Object.keys(THEME_MILESTONES).filter(themeUnlocked).length;
 const selected=document.documentElement.dataset.theme;
 document.querySelectorAll('.palette-option[data-palette]').forEach(b=>{
  const palette=b.dataset.palette,required=themeRequired(palette),unlocked=themeUnlocked(palette);
  b.classList.toggle('reco-theme-locked',!unlocked);
  b.setAttribute('aria-disabled',unlocked?'false':'true');
  b.setAttribute('aria-pressed',palette===selected?'true':'false');
  b.setAttribute('aria-label',`${THEME_LABELS[palette]}. ${unlocked?'Available':`Locked: save ${required} restaurants; ${Math.max(0,required-count)} more needed`}.`);
  let status=b.querySelector('.reco-palette-state');if(!status){status=document.createElement('span');status.className='reco-palette-state';b.appendChild(status)}
  status.textContent=unlocked?(palette===selected?'✓ In use':required?'Earned forever':'Available'):`🔒 ${required} restaurants · ${required-count} to go`;
 });
 const byId=id=>$(id);const currentGoal=next||40;
 if(byId('themeUnlockCount'))byId('themeUnlockCount').textContent=next?`${count} / ${next}`:`${count} saved · all earned`;
 if(byId('themeUnlockMessage'))byId('themeUnlockMessage').textContent=next?`${Math.max(0,next-count)} more ${next-count===1?'restaurant':'restaurants'} to unlock ${THEME_LABELS[nextTheme]}.`:'All four milestone palettes earned permanently. Enjoy your collection!';
 if(byId('themeUnlockedTotal'))byId('themeUnlockedTotal').textContent=`${available} of 6 available`;
 if(byId('themeUnlockFill'))byId('themeUnlockFill').style.width=`${Math.min(100,count/currentGoal*100)}%`;
 const meter=byId('themeUnlockMeter');if(meter){meter.setAttribute('aria-valuemax',String(currentGoal));meter.setAttribute('aria-valuenow',String(Math.min(currentGoal,count)));meter.setAttribute('aria-valuetext',next?`${count} of ${next} restaurants saved`:`All four milestone themes earned permanently; ${count} restaurants currently saved`)}
 if(byId('recoThemeHomeTitle'))byId('recoThemeHomeTitle').textContent=next?THEME_LABELS[nextTheme]:'All colours unlocked';
 if(byId('recoThemeHomeDescription'))byId('recoThemeHomeDescription').textContent=next?`${next-count} more ${next-count===1?'restaurant':'restaurants'} to unlock · ${count} saved now`:`You reached 40 restaurants. Keep documenting the meals you love.`;
 if(byId('recoThemeHomeFill'))byId('recoThemeHomeFill').style.width=`${Math.min(100,count/currentGoal*100)}%`;
 const newMilestone=[10,20,30,40].filter(n=>count>=n).at(-1)||0;
 if(previousThemeMilestone!==null&&newMilestone>previousThemeMilestone){
  const unlocked=Object.keys(THEME_MILESTONES).find(p=>THEME_MILESTONES[p]===newMilestone);
  notify(`New colour unlocked: ${THEME_LABELS[unlocked]}! Find it under Colour themes.`,'success');
 }
 previousThemeMilestone=newMilestone;
}
function applyAppearance(){
  const a=prefs.appearance||DEFAULT_PREFS.appearance;
  const requested=a.palette==='mono'?'original':a.palette;
  const palette=themeUnlocked(requested)?requested:'mint',mode=a.mode==='light'?'light':'dark';
  if(palette!==a.palette){prefs.appearance={...a,palette};savePrefs()}
  document.documentElement.dataset.theme=palette;
  document.documentElement.dataset.mode=mode;
  const toggle=$('modeToggle');if(toggle)toggle.textContent=mode==='dark'?'☾ Dark mode':'☀ Light mode';
  renderThemeJourney();
}
function setPalette(palette){
 if(!themeUnlocked(palette)){const remaining=Math.max(0,themeRequired(palette)-collectedRestaurants());notify(`${THEME_LABELS[palette]||'This colour'} unlocks after ${themeRequired(palette)} saved restaurants. ${remaining} to go.`,'error');return}
 prefs.appearance={...prefs.appearance,palette};savePrefs();applyAppearance();
}
function toggleMode(){prefs.appearance={...prefs.appearance,mode:(prefs.appearance.mode==='dark'?'light':'dark')};savePrefs();applyAppearance()}

function uid(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`}
function esc(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function scoreColor(n){const s=Math.max(0,Math.min(100,Number(n)||0));return `hsl(${s*1.25} 63% 28%)`}
function ppText(n){return n===null||n===undefined?'Price not rated':Number(n)>=75?"£75+":`£${Number(n)||0}`}
function mapQuery(e){return [e.restaurant,e.location].filter(Boolean).join(", ")}

window.recoShareCandidates=()=>entries.map(e=>({id:String(e.id),restaurant:String(e.restaurant||'').slice(0,160),location:String(e.location||'').slice(0,160),place_id:String(e.googlePlaceId||'').slice(0,512),rating:overallScore(e)===null?null:Math.max(0,Math.min(100,Number(overallScore(e)))),food_rating:Math.max(0,Math.min(100,Number(e.foodScore)||0)),dishes:restaurantDishRecordsForSharing(e),review:String(e.notes||'').slice(0,1500)}));
function restaurantDishRecordsForSharing(e){const raw=[...(e.items||[]),...visits.filter(v=>String(v.restaurantId)===String(e.id)).flatMap(v=>v.dishes||[])];return raw.filter(i=>i&&String(i.name||'').trim()&&i.rating!==null&&i.rating!==undefined&&i.rating!==''&&Number.isFinite(Number(i.rating))&&Number(i.rating)>=0&&Number(i.rating)<=10).slice(0,30).map(i=>({name:String(i.name).trim().slice(0,100),rating:Number(i.rating)}));}
function normalise(e){
  return {id:e.id||uid(),restaurant:e.restaurant||"",cuisine:e.cuisine||"",foodScore:Number(e.foodScore??75),manualFoodScore:Number(e.manualFoodScore??e.foodScore??75),ratingMode:e.ratingMode==='visits'?'visits':'manual',group:String(e.group||'').trim().slice(0,100),
    valueScore:(e.valueScore===null||e.valueScore===undefined||e.valueScore==="")?null:(e.valueScale===100?Number(e.valueScore):(Number(e.valueScore)<=10?Number(e.valueScore)*10:Number(e.valueScore))),valueScale:100,items:Array.isArray(e.items)?e.items.filter(i=>i&&typeof i.name==='string'&&i.name.trim()):[],battleHistory:Array.isArray(e.battleHistory)?e.battleHistory:[],service:e.service||"Average",
    vibes:Array.isArray(e.vibes)?e.vibes:[],pp:e.pp===null?null:Number(e.pp??25),dateVisited:e.dateVisited||"",
    manualVisitCount:Math.max(0,Math.floor(Number(e.manualVisitCount??e.visitCount??0))),international:!!e.international,
    location:e.location||"",notes:e.notes||"",photos:Array.isArray(e.photos)?e.photos:[],
    placeSource:e.placeSource||"",osmType:e.osmType||"",osmId:e.osmId||"",placeAddress:e.placeAddress||"",googlePlaceId:e.googlePlaceId||"",googleMapsUrl:e.googleMapsUrl||"",
    latitude:Number.isFinite(Number(e.latitude))&&e.latitude!==null&&e.latitude!==""?Number(e.latitude):null,
    longitude:Number.isFinite(Number(e.longitude))&&e.longitude!==null&&e.longitude!==""?Number(e.longitude):null,
    createdAt:e.createdAt||new Date().toISOString(),updatedAt:e.updatedAt||new Date().toISOString()};
}
function normaliseList(l){
  return {id:l.id||uid(),name:l.name||"Untitled list",description:l.description||"",ranked:l.ranked!==false,restaurantIds:Array.isArray(l.restaurantIds)?l.restaurantIds:[],
    createdAt:l.createdAt||new Date().toISOString(),updatedAt:l.updatedAt||new Date().toISOString()};
}
function validVisitMoney(raw){
  if(raw===null||raw===undefined||raw==="")return null;
  const n=Number(raw);
  return Number.isFinite(n)&&n>=0&&n<=10000000?Math.round(n*100)/100:null;
}
function normaliseVisit(v){
  const paidFor=v.paidFor===true;
  return {id:v.id||uid(),restaurantId:v.restaurantId||"",date:v.date||"",
    foodValue:validVisitMoney(v.foodValue),spend:paidFor?0:validVisitMoney(v.spend),paidFor,
    foodRating:v.foodRating===null||v.foodRating===undefined||v.foodRating===''?null:(Number.isFinite(Number(v.foodRating))?Math.max(0,Math.min(100,Number(v.foodRating))):null),
    dishes:Array.isArray(v.dishes)?v.dishes.filter(i=>i&&typeof i.name==='string'&&i.name.trim()).map(i=>({id:i.id||uid(),name:String(i.name).slice(0,140),rating:recordedDishScore(i.rating),price:validVisitMoney(i.price),category:String(i.category||''),categories:Array.isArray(i.categories)?i.categories:[],photo:typeof i.photo==='string'?i.photo:''})):[],
    photos:Array.isArray(v.photos)?v.photos.filter(x=>typeof x==='string'&&x.startsWith('data:image/')||typeof x==='string'&&x.startsWith('media:')):[],
    note:v.note||"",createdAt:v.createdAt||new Date().toISOString(),updatedAt:v.updatedAt||new Date().toISOString()};
}
function visitMoney(v,key){return validVisitMoney(v?.[key]);}
function moneyLabel(value){return value===null?'Not recorded':`£${value.toFixed(2)}`;}
function visitCostDetails(v){const food=visitMoney(v,'foodValue'),paid=visitMoney(v,'spend');return `<span class="cost-breakdown"><b>Paid ${paid===null?'—':`£${paid.toFixed(2)}`}</b><small>Food ${food===null?'—':`£${food.toFixed(2)}`}${v.paidFor?' · Treated':''}</small></span>`;}
function sumRecordedMoney(records,key){const values=records.map(v=>visitMoney(v,key)).filter(v=>v!==null);return {total:values.reduce((sum,n)=>sum+n,0),count:values.length};}
function openDB(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){reject(new Error("IndexedDB unavailable"));return}
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains(RESTAURANTS))d.createObjectStore(RESTAURANTS,{keyPath:"id"});
      if(!d.objectStoreNames.contains(LISTS))d.createObjectStore(LISTS,{keyPath:"id"});
      if(!d.objectStoreNames.contains(VISITS))d.createObjectStore(VISITS,{keyPath:"id"});
      if(!d.objectStoreNames.contains(LOCATIONS))d.createObjectStore(LOCATIONS,{keyPath:"id"});
      if(!d.objectStoreNames.contains(MEDIA))d.createObjectStore(MEDIA,{keyPath:'id'});
      if(!d.objectStoreNames.contains(SNAPSHOTS))d.createObjectStore(SNAPSHOTS,{keyPath:'id'});
    };
    req.onsuccess=()=>{db=req.result;db.onversionchange=()=>{db.close();notify('Journal storage changed in another tab. Reload this tab before saving.','error')};resolve()};req.onerror=()=>reject(req.error);
  });
}
function allStore(store){return new Promise((resolve,reject)=>{
  if(!db)return reject(new Error('Journal storage is unavailable'));
  let tx;try{tx=db.transaction(store,'readonly');const request=tx.objectStore(store).getAll();let value=[];
    request.onsuccess=()=>{value=request.result||[]};
    tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||new Error('Reading journal storage failed'));
  }catch(err){reject(err)}
})}
// Build 45: photographs have their own IndexedDB records. Journal records store
// compact media references, while the in-memory model and exported JSON retain
// ordinary data URLs for full backwards compatibility.
const mediaById=new Map(), mediaBySource=new Map();
function hydrateMediaRecord(row){
 if(!row)return row;
 const value={...row},hydrate=x=>typeof x==='string'&&x.startsWith('media:')?(mediaById.get(x.slice(6))||''):x;
 if(Array.isArray(value.photos))value.photos=value.photos.map(hydrate);
 if(Array.isArray(value.items))value.items=value.items.map(item=>({...item,photo:hydrate(item.photo)}));
 if(Array.isArray(value.dishes))value.dishes=value.dishes.map(item=>({...item,photo:hydrate(item.photo)}));
 if(typeof value.image==='string')value.image=hydrate(value.image);
 if(typeof value.photo==='string')value.photo=hydrate(value.photo);
 return value;
}
function stageMediaRecord(store,original,pending,forceNew=false){
 if(![RESTAURANTS,VISITS,LOCATIONS].includes(store)||!original||typeof original!=='object')return original;
 const put=x=>{
   if(typeof x!=='string'||!x.startsWith('data:image/'))return x;
   let id=(!forceNew&&mediaBySource.get(x))||pending.bySource.get(x);
   if(!id){id=uid();pending.bySource.set(x,id);pending.records.push({id,src:x})}
   return 'media:'+id;
 };
 const value={...original};
 if(Array.isArray(value.photos))value.photos=value.photos.map(put);
 if(Array.isArray(value.items))value.items=value.items.map(item=>({...item,photo:put(item.photo)}));
 if(Array.isArray(value.dishes))value.dishes=value.dishes.map(item=>({...item,photo:put(item.photo)}));
 if(typeof value.photo==='string')value.photo=put(value.photo);
 if(typeof value.image==='string')value.image=put(value.image);
 return value;
}
async function migrateExistingMedia(){
 const raw=[...[...(await allStore(RESTAURANTS))].map(e=>[RESTAURANTS,e]),
 ...[...(await allStore(VISITS))].map(e=>[VISITS,e]),
 ...[...(await allStore(LOCATIONS))].map(e=>[LOCATIONS,e])];
 const needs=raw.filter(([,r])=>[...(r.photos||[]),...(r.items||[]).map(i=>i.photo),...(r.dishes||[]).map(i=>i.photo),r.photo,r.image].some(x=>typeof x==='string'&&x.startsWith('data:image/')));
 for(let i=0;i<needs.length;i+=8){await mutateStores(needs.slice(i,i+8).map(([store,row])=>[store,'put',row]))}
 return needs.length;
}
async function pruneUnusedMedia(){
 const data=await Promise.all([allStore(RESTAURANTS),allStore(VISITS),allStore(LOCATIONS),allStore(MEDIA)]);
 const used=new Set();
 for(const rows of data.slice(0,3))for(const row of rows){
   for(const v of [...(row.photos||[]),...(row.items||[]).map(i=>i.photo),...(row.dishes||[]).map(i=>i.photo),row.image,row.photo]){
     if(typeof v==='string'&&v.startsWith('media:'))used.add(v.slice(6));
   }
 }
 const unused=data[3].filter(p=>!used.has(p.id));
 for(let i=0;i<unused.length;i+=100)await mutateStores(unused.slice(i,i+100).map(p=>[MEDIA,'delete',p.id]));
 for(const item of unused){mediaById.delete(item.id);mediaBySource.delete(item.src)}
 return unused.length;
}
// All queued mutations commit together, or IndexedDB aborts the whole transaction.
// Resolve only on transaction.oncomplete, never on individual request.onsuccess.
function mutateStores(operations){return new Promise((resolve,reject)=>{
  if(!db)return reject(new Error('Journal storage is unavailable'));
  if(!operations.length)return resolve();
  const resetMedia=operations.some(([name,op])=>name===MEDIA&&op==='clear');
  const pending={bySource:new Map(),records:[]};
  const prepared=operations.map(([name,op,value])=>[name,op,op==='put'?stageMediaRecord(name,value,pending,resetMedia):value]);
  if(pending.records.length)prepared.push(...pending.records.map(rec=>[MEDIA,'put',rec]));
  const stores=[...new Set(prepared.map(operation=>operation[0]))];let tx;
  try{tx=db.transaction(stores,'readwrite');
    tx.oncomplete=()=>{
      if(resetMedia){mediaById.clear();mediaBySource.clear()}
      for(const image of pending.records){mediaById.set(image.id,image.src);mediaBySource.set(image.src,image.id)}
      resolve();
    };
    tx.onabort=()=>reject(tx.error||new Error('Storage transaction was cancelled; nothing was saved'));
    for(const [name,operation,value] of prepared){
      const store=tx.objectStore(name);
      if(operation==='put')store.put(value);
      else if(operation==='delete')store.delete(value);
      else if(operation==='clear')store.clear();
      else throw new Error('Invalid storage operation');
    }
  }catch(err){if(tx){try{tx.abort()}catch{}}reject(err)}
})}
function putStore(store,e){return mutateStores([[store,'put',e]])}
function delStore(store,id){return mutateStores([[store,'delete',id]])}
function clearStore(store){return mutateStores([[store,'clear']])}
function locationKey(label){return String(label||"").trim().replace(/\s+/g," ").toLocaleLowerCase("en-GB")}
function normaliseLocationRecord(r){return {id:locationKey(r.id),image:r.image||"",updatedAt:r.updatedAt||new Date().toISOString()}}
function getLocationImage(location){return locationMedia.find(x=>x.id===locationKey(location))?.image||""}
function setLocationImagePreview(src="",edited=false){
  // Legacy restaurant-editor drafts can carry a location image; keep their value
  // without rendering controls in the restaurant form.
  workingLocationImage=src||"";
  if(edited)locationImageEdited=true;
}
function refreshLocationImagePreview(){locationImageEdited=false;setLocationImagePreview(getLocationImage($("location").value))}

// Build 3.3: location photography has exactly one editing surface, below the
// location bubbles, and writes to the existing LOCATIONS store (DB version 7).
function syncLocationImageManager(){
  const select=$("locationImageLocation"),preview=$("locationImagePreview"),status=$("locationMediaStatus");
  const previous=select.value;
  const names=[...new Map(entries.filter(e=>e.location?.trim()).map(e=>[locationKey(e.location),e.location.trim()])).entries()]
    .sort((a,b)=>a[1].localeCompare(b[1]));
  select.replaceChildren(...names.map(([key,label])=>new Option(label,key)));
  const focusKey=locationKey(mapLocationFocus);
  if(names.some(([key])=>key===previous))select.value=previous;
  else if(names.some(([key])=>key===focusKey))select.value=focusKey;
  const available=names.length>0;
  for(const id of ["locationImage","locationSearchImages","locationClipboardRead","clearLocationImage"])$(id).disabled=!available;
  select.disabled=!available;
  if(!available){
    preview.replaceChildren();preview.textContent="Add a restaurant with a location to personalise its card.";
    status.textContent="No locations yet.";return;
  }
  status.textContent="";
  showSelectedLocationImage();
}
function showSelectedLocationImage(){
  const key=$("locationImageLocation").value,preview=$("locationImagePreview");
  const src=getLocationImage(key);
  preview.replaceChildren();
  if(src){
    const img=document.createElement("img");img.src=src;img.alt="Picture for the selected location";preview.append(img);
    const note=document.createElement("small");note.textContent="Shared by all restaurants at this location";preview.append(note);
  }else preview.textContent="No location picture selected yet.";
  $("locationMediaStatus").textContent="";
}
async function storeSharedLocationImage(file){
  const key=$("locationImageLocation").value;
  if(!key||!file)return;
  if(!file.type?.startsWith("image/"))throw new Error("Choose an image file.");
  const src=await imageToData(file,1200,.78);
  const rec=normaliseLocationRecord({id:key,image:src});
  await putStore(LOCATIONS,rec);
  locationMedia=locationMedia.filter(x=>x.id!==rec.id).concat(rec);
  renderMap(entries);
  $("locationMediaStatus").textContent="Location picture saved locally.";
}
async function removeSharedLocationImage(){
  const key=$("locationImageLocation").value;
  if(!key||!getLocationImage(key))return;
  if(!confirm("Remove the shared picture from this location and any cards using its cover?"))return;
  const rec=normaliseLocationRecord({id:key,image:""});
  await putStore(LOCATIONS,rec);
  locationMedia=locationMedia.filter(x=>x.id!==rec.id).concat(rec);
  renderMap(entries);
  $("locationMediaStatus").textContent="Shared location picture removed.";
}


function grandList(){
  return [...entries].sort((a,b)=>{
    const ao=overallScoreRaw(a),bo=overallScoreRaw(b);
    if(ao===null&&bo===null)return b.foodScore-a.foodScore || a.restaurant.localeCompare(b.restaurant);
    if(ao===null)return 1;
    if(bo===null)return -1;
    return bo-ao || b.foodScore-a.foodScore || b.valueScore-a.valueScore || a.restaurant.localeCompare(b.restaurant);
  });
}
function grandRankMap(){
  const map=new Map();grandList().forEach((e,i)=>map.set(e.id,i+1));return map;
}
function starredDishIndexes(items){
  if(!Array.isArray(items)||items.length<2)return new Set();
  const max=Math.max(...items.map(i=>Number(i.rating)||0));
  return new Set(items.map((i,idx)=>(Number(i.rating)||0)===max?idx:null).filter(i=>i!==null));
}
function serviceClass(service){
  const key=String(service||"Average").toLowerCase();
  return `service-pill service-${key}`;
}
function serviceNumericScore(service){
  return ({Horror:20,Sloppy:40,Average:60,Respectable:80,Lovely:100})[service] ?? 60;
}
function overallScoreRaw(e){
  
  const w=prefs.labWeights||DEFAULT_PREFS.labWeights;
  if(w.food>0&&(!Number.isFinite(Number(e.foodScore))))return null;
  if(w.value>0&&(e.valueScore===null||e.valueScore===undefined||!Number.isFinite(Number(e.valueScore))))return null;
  if(w.service>0&&!SERVICE_ORDER[e.service])return null;
  return (w.food*Number(e.foodScore||0)+w.value*Number(e.valueScore||0)+w.service*serviceNumericScore(e.service))/100;
}
function roundToTwoSigFigs(value){
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return null;
  const n=Number(value);
  if(n===0)return 0;
  return Number(n.toPrecision(2));
}
function overallScore(e){return roundToTwoSigFigs(overallScoreRaw(e))}
function factorValue(e,key){
  if(key==="overallScore")return overallScore(e);
  if(key==="foodScore")return Number(e.foodScore);
  if(key==="service")return serviceNumericScore(e.service);
  if(key==="valueScore")return e.valueScore===null?null:Number(e.valueScore);
  if(key==="pp")return Number(e.pp);
  if(key==="location")return entries.find(x=>locationKey(x.location)===locationKey(e.location))?.location||e.location||"No location";
  if(key==="cuisine")return e.cuisine||"Uncategorised";
  return null;
}
function factorLabel(key){return ({overallScore:"Overall score",foodScore:"Food score",service:"Service",valueScore:"Value",pp:"£ pp",location:"Location",cuisine:"Cuisine"})[key]||key}

function restaurantVisits(id){return visits.filter(v=>v.restaurantId===id).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")))}
function effectiveVisitCount(e){return Math.max(Number(e.manualVisitCount||0),restaurantVisits(e.id).length)}
function visitDisplayCount(e){const n=effectiveVisitCount(e);return n>10?"10+":String(n)}
function datedRestaurantVisits(id){return restaurantVisits(id).filter(v=>!!v.date)}
function minAllowedVisitCount(e){return restaurantVisits(e.id).length}
function firstVisitDate(e){
  const arr=datedRestaurantVisits(e.id);
  return arr.length?arr[0].date:(e.dateVisited||"");
}
function latestVisitDate(e){
  const arr=datedRestaurantVisits(e.id);
  return arr.length?arr[arr.length-1].date:(e.dateVisited||"");
}
function shortDate(s){
  if(!s)return "—";
  const d=new Date(s+"T12:00:00");
  return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"});
}
function visitDisplayValue(e){return `${e.restaurant}${e.location?` — ${e.location}`:""}`}
function resolveVisitRestaurantId(text){
  const exact=entries.find(e=>visitDisplayValue(e)===text);
  if(exact)return exact.id;
  const byName=entries.filter(e=>e.restaurant.toLowerCase()===String(text||"").trim().toLowerCase());
  return byName.length===1?byName[0].id:"";
}
function median(values){
  const a=[...values].sort((x,y)=>x-y),n=a.length;
  return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;
}
function cuisineRankingMode(){return 'mean'}
function cuisinePosition(c){return cuisineRankingMode()==='mean'?c.avgPos:c.medianPos}
function cuisineStats(){
  const ranks=grandRankMap(), grouped={};
  for(const e of entries){
    const c=e.cuisine?.trim()||"Uncategorised";
    if(!grouped[c])grouped[c]=[];
    grouped[c].push(e);
  }
  const all=Object.entries(grouped).map(([cuisine,items])=>{
    const positions=items.map(e=>ranks.get(e.id));
    const avgPos=positions.reduce((a,b)=>a+b,0)/positions.length;
    const medianPos=median(positions);
    const avgScore=items.reduce((a,b)=>a+b.foodScore,0)/items.length;
    const sorted=[...items].sort((a,b)=>{
      const ao=overallScoreRaw(a),bo=overallScoreRaw(b);
      if(ao===null&&bo===null)return b.foodScore-a.foodScore;
      if(ao===null)return 1;if(bo===null)return -1;
      return bo-ao || b.foodScore-a.foodScore;
    });
    const best=sorted[0],worst=sorted[sorted.length-1];
    return {cuisine,count:items.length,avgPos,medianPos,avgScore,best,worst,eligible:items.length>=3};
  });
  const eligible=all.filter(x=>x.eligible)
    .sort((a,b)=>cuisinePosition(a)-cuisinePosition(b) || b.avgScore-a.avgScore || a.cuisine.localeCompare(b.cuisine))
    .map((x,i)=>({...x,cuisineRank:i+1}));
  const provisional=all.filter(x=>!x.eligible)
    .sort((a,b)=>b.count-a.count || cuisinePosition(a)-cuisinePosition(b) || b.avgScore-a.avgScore || a.cuisine.localeCompare(b.cuisine));
  return {eligible,provisional};
}
function filtered(){
  const q=$("search").value.trim().toLocaleLowerCase("en-GB"),terms=q.split(/\s+/).filter(Boolean),f=prefs.filters||DEFAULT_PREFS.filters,ranks=grandRankMap();
  const visitText=new Map();
  if(terms.length)for(const v of visits){
    const parts=[v.note||'',...(v.dishes||[]).map(d=>d.name||''),v.date||''];
    visitText.set(v.restaurantId,(visitText.get(v.restaurantId)||'')+' '+parts.join(' '));
  }
  let data=entries.filter(e=>{
    const hay=[e.restaurant,e.cuisine,e.location,e.notes,...(e.items||[]).map(i=>i.name),...(e.vibes||[]),visitText.get(e.id)||''].join(" ").toLocaleLowerCase("en-GB");
    if(terms.length&&!terms.every(term=>hay.includes(term)))return false;if(f.location&&locationKey(e.location)!==locationKey(f.location))return false;if(f.cuisine&&e.cuisine!==f.cuisine)return false;
    if(f.vibe&&!e.vibes.includes(f.vibe))return false;
    if(f.region==="international"&&!e.international)return false;
    if(f.region==="uk"&&e.international)return false;
    if(f.service&&e.service!==f.service)return false;
    if(f.minScore!==""&&e.foodScore<Number(f.minScore))return false;
    if(f.minValue!==""&&(e.valueScore===null||e.valueScore<Number(f.minValue)))return false;
    if(f.maxSpend!==""&&e.pp>Number(f.maxSpend))return false;return true;
  });
  const p=prefs.sortProperty||"grandRank",d=prefs.sortDirection==="asc"?1:-1;
  // A large collection should not scan the full visit database inside every sort comparison.
  const latestById=new Map(),visitsById=new Map();
  if(p==='lastVisited'||p==='visitCount')for(const v of visits){
    visitsById.set(v.restaurantId,(visitsById.get(v.restaurantId)||0)+1);
    if(v.date&&(!latestById.has(v.restaurantId)||v.date>latestById.get(v.restaurantId)))latestById.set(v.restaurantId,v.date);
  }
  if(p==='lastVisited')data=data.filter(e=>latestById.has(e.id)||e.dateVisited);
  data.sort((a,b)=>{
    let av=p==="grandRank"?ranks.get(a.id):(p==="overallScore"?overallScoreRaw(a):a[p]),bv=p==="grandRank"?ranks.get(b.id):(p==="overallScore"?overallScoreRaw(b):b[p]);
    if(p==="lastVisited"){
      av=latestById.get(a.id)||a.dateVisited||null;bv=latestById.get(b.id)||b.dateVisited||null;
      if(!av||!bv)return !av&&!bv?a.restaurant.localeCompare(b.restaurant):(!av?1:-1);
    }
    if(p==="visitCount"){av=Math.max(Number(a.manualVisitCount||0),visitsById.get(a.id)||0);bv=Math.max(Number(b.manualVisitCount||0),visitsById.get(b.id)||0)}
    if(p==="service"){av=SERVICE_ORDER[av]||0;bv=SERVICE_ORDER[bv]||0}
    if(p==="updatedAt"){av=new Date(av).getTime();bv=new Date(bv).getTime()}
    if(p==="valueScore"||p==="overallScore"){
      if(av===null&&bv===null)return 0;if(av===null)return 1;if(bv===null)return -1;
    }
    if(typeof av==="string"||typeof bv==="string")return String(av||"").localeCompare(String(bv||""))*d;
    return ((Number(av)||0)-(Number(bv)||0))*d
  });
  return data;
}
function refreshLists(){
  const locationMap=new Map();entries.forEach(e=>{if(e.location&&!locationMap.has(locationKey(e.location)))locationMap.set(locationKey(e.location),e.location.trim())});
  const loc=[...locationMap.values()].sort(),cui=[...new Set(entries.map(e=>e.cuisine).filter(Boolean))].sort();
  $("locationList").innerHTML=loc.map(x=>`<option value="${esc(x)}"></option>`).join("");$("cuisineList").innerHTML=cui.map(x=>`<option value="${esc(x)}"></option>`).join("");
  $("filterLocation").innerHTML='<option value="">All locations</option>'+loc.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("filterCuisine").innerHTML='<option value="">All cuisines</option>'+cui.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("graphFilterLocation").innerHTML='<option value="">All locations</option>'+loc.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("graphFilterCuisine").innerHTML='<option value="">All cuisines</option>'+cui.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("filterLocation").value=prefs.filters.location||"";$("filterCuisine").value=prefs.filters.cuisine||"";
  $("graphFilterLocation").value=prefs.graph.filters.location||"";$("graphFilterCuisine").value=prefs.graph.filters.cuisine||"";
}
function renderStats(data){
  $("statCount").textContent=String(data.length);
  const rated=data.filter(e=>e.foodScore!==null&&e.foodScore!==undefined&&Number.isFinite(Number(e.foodScore)));
  $("statAvg").textContent=rated.length?(rated.reduce((sum,e)=>sum+Number(e.foodScore),0)/rated.length).toFixed(1)+"/100":"—";
  const allowed=new Set(data.map(e=>e.id));
  const recorded=visits.filter(v=>allowed.has(v.restaurantId)).map(v=>visitMoney(v,'foodValue')).filter(v=>v!==null);
  const estimates=data.map(e=>e.pp).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
  const amounts=recorded.length?recorded:estimates;
  $("statSpend").textContent=amounts.length?"£"+(amounts.reduce((a,b)=>a+Number(b),0)/amounts.length).toFixed(2):"—";
  $("statCuisineLabel").textContent="Top cuisine";
  const cs=cuisineStats().eligible.find(c=>c.cuisine!=='Uncategorised'&&data.some(e=>e.cuisine===c.cuisine));
  $("statCuisine").textContent=cs?cs.cuisine:"—";
  $("statCuisineSub").textContent="";
}

function renderChips(){
  const f=prefs.filters,ch=[];if(f.location)ch.push(["location",`Location: ${f.location}`]);if(f.cuisine)ch.push(["cuisine",`Cuisine: ${f.cuisine}`]);if(f.vibe)ch.push(["vibe",`Vibe: ${f.vibe}`]);if(f.region)ch.push(["region",f.region==="international"?"International":"United Kingdom"]);if(f.service)ch.push(["service",`Service: ${f.service}`]);
  if(f.minScore!=="")ch.push(["minScore",`Rating ≥ ${f.minScore}`]);if(f.minValue!=="")ch.push(["minValue",`Value ≥ ${f.minValue}`]);if(f.maxSpend!=="")ch.push(["maxSpend",`£ / person ≤ ${f.maxSpend}`]);
  $("chips").innerHTML=ch.map(([k,t])=>`<span class="chip">${esc(t)}<button data-clear-filter="${k}">×</button></span>`).join("");$("filterCount").textContent=ch.length?`(${ch.length})`:"";
}
function renderSortMarks(){document.querySelectorAll("th[data-sort]").forEach(th=>th.querySelector("i").textContent=th.dataset.sort===prefs.sortProperty?(prefs.sortDirection==="asc"?"↑":"↓"):"")}
// Build 3.4: location cards replace size-based bubbles at every viewport.
function renderLocationConstellation(location,items){
 const sorted=[...items].sort((a,b)=>(overallScoreRaw(b)??-1)-(overallScoreRaw(a)??-1));
 const cover=getLocationImage(location);
 return `<section class="reco34-location-banner">${cover?`<img src="${esc(cover)}" alt="">`:''}<div><small>YOUR LOCATION</small><h3>${esc(location)}</h3><span>${sorted.length} ${sorted.length===1?'restaurant':'restaurants'}</span></div></section><div class="reco34-place-restaurants">${sorted.map(e=>{const photo=e.photos?.[0]||'',score=overallScore(e);return `<button type="button" class="reco34-restaurant-card" data-open-passport="${esc(e.id)}" aria-label="Open ${esc(e.restaurant)}"><span class="reco34-restaurant-photo">${photo?`<img loading="lazy" src="${esc(photo)}" alt="">`:'<span aria-hidden="true">♧</span>'}</span><span class="reco34-restaurant-copy"><b>${esc(e.restaurant)}</b><small>${esc(e.cuisine||'Restaurant')}</small></span><strong>${score===null?'—':esc(score)}</strong></button>`}).join('')}</div>`;
}
function renderMap(data){
  const groups={};
  data.forEach(e=>{
    const label=e.location?.trim()||"No location",key=locationKey(label);
    if(!groups[key])groups[key]={location:label,items:[]};
    groups[key].items.push(e);
  });
  const locations=Object.values(groups).map(({location,items})=>({
    location,items,count:items.length,avgOverall:(()=>{const xs=items.map(overallScoreRaw).filter(x=>x!==null);return xs.length?roundToTwoSigFigs(xs.reduce((s,x)=>s+x,0)/xs.length):null})(),
    image:getLocationImage(location)
  })).sort((a,b)=>b.count-a.count || (b.avgOverall||0)-(a.avgOverall||0) || a.location.localeCompare(b.location)).map(g=>({...g,size:Math.min(210,Math.max(88,70*Math.sqrt(g.count)))}));

  const stage=$("bubbleStage");
  syncLocationImageManager();
  stage.classList.remove('mobile-locations-stage');stage.style.height='auto';
  stage.innerHTML=locations.length?locations.map(g=>{
    const hasPhoto=!!g.image,editable=!!g.items.some(e=>e.location?.trim());
    return `<article class="reco34-location-card"><button type="button" class="reco34-location-open" data-location-bubble="${esc(g.location)}" aria-label="Open ${esc(g.location)}, ${g.count} restaurants"><span class="reco34-location-cover">${hasPhoto?`<img src="${esc(g.image)}" alt="" loading="lazy">`:'<svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M24 42S9 28 9 18a15 15 0 1 1 30 0c0 10-15 24-15 24Z"/><circle cx="24" cy="18" r="5"/></svg>'}</span><span class="reco34-location-copy"><b>${esc(g.location)}</b><small>${g.count} ${g.count===1?'restaurant':'restaurants'}</small><span>Average ${g.avgOverall??'—'}</span></span></button>${editable?`<button type="button" class="reco34-location-edit" data-reco34-location-photo="${esc(g.location)}" aria-label="${hasPhoto?'Edit':'Add'} photo for ${esc(g.location)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>${hasPhoto?'Edit photo':'Add photo'}</button>`:''}</article>`;
  }).join(''):'<p class="reco34-empty">Add a restaurant with a location to start your collection of places.</p>';
  if(mapLocationFocus && !groups[locationKey(mapLocationFocus)])mapLocationFocus=null;
  if(mapLocationFocus){
    const group=groups[locationKey(mapLocationFocus)];
    const items=group?.items||[];
    const xs=items.map(overallScoreRaw).filter(x=>x!==null);
    $("bubbleOverview").style.display="none";
    $("locationDetail").classList.add("show");
    $("locationDetailTitle").textContent=mapLocationFocus;
    $("locationDetailSub").textContent=`${items.length} ${items.length===1?"restaurant":"restaurants"} · average overall ${xs.length?roundToTwoSigFigs(xs.reduce((s,x)=>s+x,0)/xs.length):"—"}`;
    $("locationDetailGrid").innerHTML=renderLocationConstellation(group.location,items);
    $("locationDetailGrid").scrollLeft=0;
  }else{
    $("bubbleOverview").style.display="block";
    $("locationDetail").classList.remove("show");
  }
}
function openLocationBubble(location,button){
  mapLocationFocus=location;renderMap(entries);
  $("backToBubbles").focus({preventScroll:true});
}
function backToBubbleGraph(){mapLocationFocus=null;renderMap(entries)}
function renderCuisineCard(c,provisional=false){
  const ranks=grandRankMap();
  return `<article class="cuisine-card ${provisional?"provisional":""}">
    <div class="c-rank">${provisional?`${c.count}/3 restaurants · provisional`:`Cuisine rank #${c.cuisineRank}`}</div>
    <h3>${esc(c.cuisine)}</h3>
    <div class="cuisine-metrics">
      <div><span>${cuisineRankingMode()==='mean'?'Mean':'Median'} position</span><b>${cuisinePosition(c).toFixed(1)}</b></div>
      <div><span>Average score</span><b>${c.avgScore.toFixed(1)}</b></div>
      <div><span>Restaurants</span><b>${c.count}</b></div>
      <div><span>Best entry</span><b>#${ranks.get(c.best.id)} · ${esc(c.best.restaurant)} (${overallScore(c.best)??"—"})</b></div>
      <div><span>Worst entry</span><b>#${ranks.get(c.worst.id)} · ${esc(c.worst.restaurant)} (${overallScore(c.worst)??"—"})</b></div>
    </div>
  </article>`;
}
function leaderboardAvatar(img,label){
  return `<div class="leader-avatar">${img?`<img src="${esc(img)}" alt="">`:`<span>${esc((label||'?').trim()[0]||'?')}</span>`}</div>`;
}
function leaderboardStage(rows,kind,showRows=true,skipPodiumRows=false){
  if(!rows.length)return '<p class="feature-muted">No qualified results yet.</p>';
  const byRank=[rows[1],rows[0],rows[2]];
  const visibleRows=skipPodiumRows?rows.slice(3):rows;
  const renderSpot=(r,position)=>r?`<div class="leader-spot pos-${position}">
    <div class="leader-person">${leaderboardAvatar(r.image,r.name)}<div><strong>${esc(r.name)}</strong><small>${esc(r.sub)}</small></div></div>
    <div class="leader-block"><span>${position}</span><small>${esc(r.metric)}</small></div>
  </div>`:`<div class="leader-spot empty pos-${position}"></div>`;
  return `<div class="leaderboard-shell"><div class="leaderboard-overline">RECOLLEAT · ${esc(kind)} CHAMPIONS</div><div class="leader-podium">${renderSpot(byRank[0],2)}${renderSpot(byRank[1],1)}${renderSpot(byRank[2],3)}</div>
    ${showRows&&visibleRows.length?`<div class="leader-rows">${visibleRows.map((r,i)=>`<div class="leader-row"><span class="leader-row-number">${i+1+(skipPodiumRows?3:0)}</span>${leaderboardAvatar(r.image,r.name)}<div class="leader-row-name">${r.id?`<button type="button" data-open-passport="${esc(r.id)}">${esc(r.name)}</button>`:`<strong>${esc(r.name)}</strong>`}<small>${esc(r.sub)}</small></div><strong>${esc(r.metric)}</strong></div>`).join('')}</div>`:''}
  </div>`;
}
function renderCuisineView(){
 const {eligible,provisional}=cuisineStats(),mode=cuisineRankingMode();
 document.querySelectorAll('[data-cuisine-mode]').forEach(button=>{const active=button.dataset.cuisineMode===mode;button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active)});
 const row=(c,rank)=>`<button type="button" class="reco33-cuisine-row" data-cuisine-passport="${esc(c.cuisine)}"><span class="reco33-rank">${rank??'—'}</span>${leaderboardAvatar(c.best?.photos?.[0]||getLocationImage(c.best?.location),c.cuisine)}<strong>${esc(c.cuisine)}</strong><span class="reco33-cuisine-number">${rank?cuisinePosition(c).toFixed(1):'—'}</span><span aria-hidden="true">›</span></button>`;
 $('cuisinePodium').innerHTML=eligible.length?`<div class="reco33-cuisine-list"><div class="reco33-cuisine-list-head"><span>Cuisine</span><span>${mode==='mean'?'Mean':'Median'} rank</span></div>${eligible.map(c=>row(c,c.cuisineRank)).join('')}</div>`:'<div class="reco-empty-state"><b>No qualified cuisine yet</b><p>Log three restaurants in a cuisine to rank it.</p></div>';
 $('cuisineGrid').innerHTML='';const heading=$('cuisineGrid').previousElementSibling;if(heading)heading.style.display='none';
 $('provisionalCuisineGrid').innerHTML=provisional.length?`<div class="reco33-cuisine-list">${provisional.map(c=>row(c,null)).join('')}</div>`:'<p class="muted">No provisional cuisines.</p>';
}
let cuisinePassportName='',cuisinePassportPage=0,cuisineTouch=null;
function openCuisinePassport(name){cuisinePassportName=name;cuisinePassportPage=0;renderCuisinePassport(0);$('cuisinePassportDialog').showModal()}
function renderCuisinePassport(direction=0){
 const stats=cuisineStats(),c=[...stats.eligible,...stats.provisional].find(x=>x.cuisine===cuisinePassportName);if(!c)return;
 const members=entries.filter(e=>(e.cuisine?.trim()||'Uncategorised')===c.cuisine),ranks=grandRankMap(),mode=cuisineRankingMode();
 const ranked=members.slice().sort((a,b)=>ranks.get(a.id)-ranks.get(b.id));
 const dishes=allDishes().filter(d=>members.some(e=>e.id===d.e.id)).sort((a,b)=>b.score-a.score);
 const image=c.best?.photos?.[0]||getLocationImage(c.best?.location);
 const restaurantRow=e=>`<button class="reco33-passport-list-row" type="button" data-open-passport="${esc(e.id)}"><span>#${ranks.get(e.id)}</span><b>${esc(e.restaurant)}</b><strong>${overallScore(e)??'—'}</strong></button>`;
 const pages=[`<div class="reco33-cuisine-cover">${image?`<img src="${esc(image)}" alt="">`:''}<div><small>CUISINE PASSPORT</small><h3>${esc(c.cuisine)}</h3><span>${c.eligible?'Cuisine rank #'+c.cuisineRank:'Provisional cuisine'}</span></div></div><div class="reco33-cuisine-metrics"><div><b>${c.count}</b><span>Restaurants</span></div><div><b>${c.avgScore.toFixed(1)}</b><span>Mean food /100</span></div><div><b>${cuisinePosition(c).toFixed(1)}</b><span>${mode==='mean'?'Mean':'Median'} rank</span></div></div><small class="reco33-caption">Rank is position in your overall restaurant collection. Lower is better.</small>`,
 `<h3>Your restaurants</h3><div class="reco33-passport-list">${ranked.map(restaurantRow).join('')}</div>`,
 `<h3>Standout dishes</h3><div class="reco33-passport-list">${dishes.length?dishes.slice(0,20).map(d=>`<button type="button" class="reco33-passport-list-row" data-open-passport="${esc(d.e.id)}"><span>✦</span><b>${esc(d.item.name)}<small>${esc(d.e.restaurant)}</small></b><strong>${d.score.toFixed(1)}</strong></button>`).join(''):'<p class="muted">No rated dishes in this cuisine yet.</p>'}</div>`];
 cuisinePassportPage=Math.max(0,Math.min(2,cuisinePassportPage));$('cuisinePassportTitle').textContent=c.cuisine;$('cuisinePassportPage').innerHTML=pages[cuisinePassportPage];
 $('cuisinePassportCounter').textContent=`${['Overview','Restaurants','Dishes'][cuisinePassportPage]} · ${cuisinePassportPage+1}/3`;$('cuisinePassportPrev').disabled=cuisinePassportPage===0;$('cuisinePassportNext').disabled=cuisinePassportPage===2;
 if(direction&&!matchMedia('(prefers-reduced-motion: reduce)').matches)$('cuisinePassportPage').animate([{opacity:.3,transform:`translateX(${direction*36}px)`},{opacity:1,transform:'translateX(0)'}],{duration:210,easing:'cubic-bezier(.2,.8,.2,1)'});
 $('cuisinePassportPage').scrollTop=0;
}
function changeCuisinePassportPage(delta){const next=Math.max(0,Math.min(2,cuisinePassportPage+delta));if(next===cuisinePassportPage)return;cuisinePassportPage=next;renderCuisinePassport(delta)}
function setupBuild33(){
 const dialog=$('cuisinePassportDialog'),page=$('cuisinePassportPage');$('cuisinePassportPrev').onclick=()=>changeCuisinePassportPage(-1);$('cuisinePassportNext').onclick=()=>changeCuisinePassportPage(1);
 dialog.addEventListener('keydown',ev=>{if(ev.key==='ArrowLeft'||ev.key==='ArrowRight'){ev.preventDefault();changeCuisinePassportPage(ev.key==='ArrowRight'?1:-1)}});
 page.addEventListener('touchstart',ev=>{const t=ev.changedTouches[0];cuisineTouch={x:t.clientX,y:t.clientY}},{passive:true});
 page.addEventListener('touchend',ev=>{if(!cuisineTouch)return;const t=ev.changedTouches[0],dx=t.clientX-cuisineTouch.x,dy=t.clientY-cuisineTouch.y;cuisineTouch=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.4)changeCuisinePassportPage(dx<0?1:-1)},{passive:true});
 document.addEventListener('click',ev=>{const c=ev.target.closest('[data-cuisine-passport]'),v=ev.target.closest('[data-reco33-edit-visit]'),r=ev.target.closest('[data-reco33-edit-review]');if(c){openCuisinePassport(c.dataset.cuisinePassport);return}if(v||r){if($('passportDialog').open)$('passportDialog').close();if(v)openEditVisit(v.dataset.reco33EditVisit);else {edit(r.dataset.reco33EditReview);setEditorStep(3)}}});
 $('recoQuickUseValue').onclick=()=>{if($('recoQuickTreated').checked)return;$('recoQuickPaid').value=$('recoQuickValue').value;v45SaveQuickDraft()};
 $('recoVisitUseValue').onclick=()=>{if($('visitPaidFor').checked)return;$('visitSpend').value=$('visitFoodValue').value};
 let localDay=v45DateToday();const refreshDay=()=>{const d=v45DateToday();if(d!==localDay){localDay=d;renderV45Home()}};document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDay()});window.addEventListener('focus',refreshDay);setInterval(refreshDay,60000);
}
function monthKeyFromDate(dateStr){return String(dateStr||"").slice(0,7)}
function selectedMonthKey(){return `${visitMonthCursor.getFullYear()}-${String(visitMonthCursor.getMonth()+1).padStart(2,"0")}`}
function formatMonth(d){return d.toLocaleDateString("en-GB",{month:"long",year:"numeric"})}
function formatVisitDate(s){if(!s)return "Date unknown";const d=new Date(s+"T12:00:00");return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
function monthlySpendSeries(){
  const result=[],base=new Date(visitMonthCursor.getFullYear(),visitMonthCursor.getMonth(),1);
  for(let i=11;i>=0;i--){
    const d=new Date(base.getFullYear(),base.getMonth()-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const total=visits.filter(v=>monthKeyFromDate(v.date)===key).reduce((s,v)=>s+Number(v.spend||0),0);
    result.push({key,label:d.toLocaleDateString("en-GB",{month:"short"}),total});
  }
  return result;
}
let selectedCalendarDate='',calendarShowingWholeMonth=false,calendarDisplayMode='calendar';
function changeCalendarMode(mode){
  calendarDisplayMode=mode==='wrapped'?'wrapped':'calendar';
  const root=$("visitView");root.dataset.visitMode=calendarDisplayMode;
  for(const [which,id] of [['calendar','visitCalendarTab'],['wrapped','visitWrappedTab']]){
    const b=$(id),active=which===calendarDisplayMode;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;
  }
}
function renderVisitHistory(){
  const key=selectedMonthKey(), restaurantMap=new Map(entries.map(e=>[e.id,e]));
  $("calendarMonthLabel").textContent=formatMonth(visitMonthCursor);if($("calendarMonthJump"))$("calendarMonthJump").value=key;
  const monthVisits=visits.filter(v=>monthKeyFromDate(v.date)===key).sort((a,b)=>a.date.localeCompare(b.date));
  const uniqueRestaurantIds=[...new Set(monthVisits.map(v=>v.restaurantId).filter(id=>restaurantMap.has(id)))];
  $("monthVisitCount").textContent=monthVisits.length;
  $("monthRestaurantCount").textContent=uniqueRestaurantIds.length;
  const paidSummary=sumRecordedMoney(monthVisits,'spend'),foodSummary=sumRecordedMoney(monthVisits,'foodValue');
  $("monthSpendTotal").textContent=paidSummary.count?`£${paidSummary.total.toFixed(2)}`:'—';
  $("monthFoodValue").textContent=foodSummary.count?`£${foodSummary.total.toFixed(2)}`:'—';
  $("monthPersonalCoverage").textContent=`${paidSummary.count} of ${monthVisits.length} visits recorded`;
  $("monthFoodValueCoverage").textContent=`${foodSummary.count} of ${monthVisits.length} visits recorded`;
  $("monthTreatedCount").textContent=monthVisits.filter(v=>v.paidFor).length;

  const grouped={};monthVisits.forEach(v=>{if(!grouped[v.restaurantId])grouped[v.restaurantId]=[];grouped[v.restaurantId].push(v)});
  $("monthRestaurants").innerHTML=uniqueRestaurantIds.length?uniqueRestaurantIds.map(id=>{
    const e=restaurantMap.get(id),arr=grouped[id]||[],paid=sumRecordedMoney(arr,'spend'),food=sumRecordedMoney(arr,'foodValue');
    return `<div class="month-rest-row"><div><b>${esc(e.restaurant)}</b><span>${arr.length} ${arr.length===1?"visit":"visits"} · Food ${food.count?moneyLabel(food.total):'—'}</span></div><b>${paid.count?moneyLabel(paid.total):'—'} <small>paid</small></b></div>`;
  }).join(""):'<div class="visit-empty reco-calendar-empty"><strong>Nothing logged this month yet</strong><p>Save a visit to remember where you ate and what you personally paid.</p><button type="button" data-v44-new-visit>Add a visit</button></div>';

  const year=visitMonthCursor.getFullYear(),month=visitMonthCursor.getMonth(),firstDay=new Date(year,month,1),daysInMonth=new Date(year,month+1,0).getDate();
  const mondayIndex=(firstDay.getDay()+6)%7;
  const heads=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="cal-head">${d}</div>`).join("");
  const today=new Date(), todayISO=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  if(!selectedCalendarDate.startsWith(key))selectedCalendarDate=monthVisits.length?monthVisits[monthVisits.length-1].date:(todayISO.startsWith(key)?todayISO:`${key}-01`);
  let cells="";for(let i=0;i<mondayIndex;i++)cells+='<span class="cal-day empty-day" aria-hidden="true"></span>';
  for(let day=1;day<=daysInMonth;day++){
    const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const count=monthVisits.filter(v=>v.date===ds).length;
    const selected=selectedCalendarDate===ds;
    cells+=`<button type="button" class="cal-day${selected?' is-selected':''}${count?' has-visits':''}${ds===todayISO?' is-today':''}" data-calendar-date="${ds}" aria-pressed="${selected}" aria-label="${day} ${formatMonth(visitMonthCursor)}, ${count} ${count===1?'visit':'visits'}"><span class="cal-num">${day}</span>${count?`<span class="cal-dot" aria-hidden="true"></span>`:''}</button>`;
  }
  $("calendarGrid").innerHTML=heads+cells;

  const undated=visits.filter(v=>!v.date).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  const pendingLegacy=entries.reduce((n,e)=>n+Math.max(0,Number(e.manualVisitCount||0)-restaurantVisits(e.id).length),0);
  $("undatedVisitCount").textContent=undated.length+pendingLegacy;
  $("undatedVisitLog").innerHTML=(undated.length?undated.map(v=>{
    const e=restaurantMap.get(v.restaurantId);
    return `<div class="visit-log-row"><div class="date">Date unknown</div><div><b>${esc(e?.restaurant||"Deleted restaurant")}</b><div class="muted">${esc(v.note||"Visit remembered, date not recorded")}${(v.dishes||[]).length?` · ${v.dishes.length} dishes`:''}${v.foodRating!==null?` · Food ${v.foodRating}/100`:''}</div></div><div class="spend">${visitCostDetails(v)}</div><button data-edit-visit="${esc(v.id)}">Edit</button></div>`;
  }).join(""):"")+(pendingLegacy?`<div class="visit-empty">${pendingLegacy} older visit${pendingLegacy===1?"":"s"} stored as totals only. Open each restaurant's editor to assign optional dates.</div>`:"")||'<div class="visit-empty">No undated visits recorded.</div>';

  const focusedVisits=calendarShowingWholeMonth?monthVisits:monthVisits.filter(v=>v.date===selectedCalendarDate);
  const label=$("calendarSelectionLabel");if(label)label.textContent=calendarShowingWholeMonth?`Visits in ${formatMonth(visitMonthCursor)}`:`Visits on ${formatVisitDate(selectedCalendarDate)}`;
  const showMonth=$("calendarShowMonth");if(showMonth){showMonth.textContent=calendarShowingWholeMonth?'Selected day':'All month';showMonth.setAttribute('aria-pressed',String(calendarShowingWholeMonth));}
  const unknownCount=$("undatedVisitSummaryCount");if(unknownCount)unknownCount.textContent=String(undated.length+pendingLegacy);
  $("visitLog").innerHTML=focusedVisits.length?[...focusedVisits].sort((a,b)=>b.date.localeCompare(a.date)).map(v=>{
    const e=restaurantMap.get(v.restaurantId);
    return `<div class="visit-log-row"><div class="date">${formatVisitDate(v.date)}</div><div><b>${esc(e?.restaurant||"Deleted restaurant")}</b><div class="muted">${esc(v.note||"")}${(v.dishes||[]).length?` · ${v.dishes.length} dishes`:''}${v.foodRating!==null?` · Food ${v.foodRating}/100`:''}</div></div><div class="spend">${visitCostDetails(v)}</div><button data-edit-visit="${v.id}">Edit</button></div>`;
  }).join(""):'<div class="visit-empty reco-calendar-empty">No visits on this day.</div>';

  const series=monthlySpendSeries(),max=Math.max(1,...series.map(x=>x.total));
  $("spendChart").innerHTML=series.map(x=>`<div class="spend-bar-wrap"><div class="spend-bar-value">${x.total?`£${x.total.toFixed(0)}`:""}</div><div class="spend-bar" style="height:${Math.max(2,(x.total/max)*150)}px"></div><div class="spend-bar-label">${x.label}</div></div>`).join("");

  if(!monthVisits.length){$("wrappedReport").innerHTML=`<div class="monthly-wrapped-head"><div><span class="feature-kicker">RECOLLEAT WRAPPED</span><h3>${formatMonth(visitMonthCursor)}</h3></div></div><div class="wrapped-empty">Log visits in this month to unlock a private monthly food report with a headline story, standout restaurant, monthly spend snapshot and personal highlights.</div>`;return}
  const monthRestaurants=uniqueRestaurantIds.map(id=>restaurantMap.get(id)).filter(Boolean);
  const cuisineCounts={}, locationCounts={};
  monthRestaurants.forEach(e=>{if(e.cuisine)cuisineCounts[e.cuisine]=(cuisineCounts[e.cuisine]||0)+1;if(e.location)locationCounts[e.location]=(locationCounts[e.location]||0)+1});
  const topRestaurant=[...uniqueRestaurantIds].map(id=>({id,count:(grouped[id]||[]).length,total:(grouped[id]||[]).reduce((s,v)=>s+Number(v.spend||0),0),e:restaurantMap.get(id)})).sort((a,b)=>b.count-a.count||b.total-a.total)[0]||null;
  const bestOverall=monthRestaurants.filter(Boolean).sort((a,b)=>(overallScore(b)??-1)-(overallScore(a)??-1))[0]||null;
  const avgSpend=paidSummary.count?paidSummary.total/paidSummary.count:null;
  const topCuisine=Object.entries(cuisineCounts).sort((a,b)=>b[1]-a[1])[0]||null;
  const topLocation=Object.entries(locationCounts).sort((a,b)=>b[1]-a[1])[0]||null;
  const mostExpensive=monthVisits.slice().sort((a,b)=>Number(b.spend||0)-Number(a.spend||0))[0]||null;
  const priceyRestaurant=mostExpensive?restaurantMap.get(mostExpensive.restaurantId):null;
  const storyLead=topRestaurant?.e?.restaurant?`${topRestaurant.e.restaurant} led your month with ${topRestaurant.count} ${topRestaurant.count===1?'visit':'visits'}, while ${bestOverall?.restaurant||'your highest-scored spot'} set the benchmark for quality.`:'Your month is ready to be wrapped.';
  $("wrappedReport").innerHTML=`<div class="monthly-wrapped-head"><div><span class="feature-kicker">RECOLLEAT WRAPPED</span><h3>${formatMonth(visitMonthCursor)} · monthly food report</h3></div><div class="feature-mark">✦</div></div><div class="wrapped-hero"><span>Monthly headline</span><b>${esc(topRestaurant?.e?.restaurant||'Your month in food')}</b><p>${esc(storyLead)} You personally paid ${paidSummary.count?`£${paidSummary.total.toFixed(2)}`:'an unrecorded amount'}, while food value was ${foodSummary.count?`£${foodSummary.total.toFixed(2)}`:'not recorded'} across ${monthVisits.length} ${monthVisits.length===1?'visit':'visits'}. ${monthVisits.filter(v=>v.paidFor).length} ${monthVisits.filter(v=>v.paidFor).length===1?'meal was':'meals were'} treated.</p></div><div class="monthly-wrapped-grid"><article class="wrapped-card"><span>Restaurant of the month</span><b>${esc(topRestaurant?.e?.restaurant||'—')}</b><small>${topRestaurant?`${topRestaurant.count} visits · £${topRestaurant.total.toFixed(2)} spent`:'No visits logged'}</small></article><article class="wrapped-card"><span>Best scored visit set</span><b>${esc(bestOverall?.restaurant||'—')}</b><small>${bestOverall&&overallScore(bestOverall)!==null?`Overall score ${overallScore(bestOverall)}`:'Needs an overall score'}</small></article><article class="wrapped-card"><span>Cuisine of the month</span><b>${esc(topCuisine?.[0]||'—')}</b><small>${topCuisine?`${topCuisine[1]} restaurant${topCuisine[1]===1?'':'s'} visited`:'No cuisine data yet'}</small></article><article class="wrapped-card"><span>Location of the month</span><b>${esc(topLocation?.[0]||'—')}</b><small>${topLocation?`${topLocation[1]} restaurant${topLocation[1]===1?'':'s'} from this location`:'No locations logged'}</small></article><article class="wrapped-card"><span>Average personally paid</span><b>${avgSpend===null?'—':`£${avgSpend.toFixed(2)}`}</b><small>${paidSummary.count} visit${paidSummary.count===1?'':'s'} with payment amounts</small></article><article class="wrapped-card"><span>Food value &amp; treats</span><b>${foodSummary.count?`£${foodSummary.total.toFixed(2)}`:'—'}</b><small>${monthVisits.filter(v=>v.paidFor).length} treated · ${foodSummary.count} logged values</small></article></div>`;
}
function populateVisitRestaurantSelect(selectedId=""){
  $("visitRestaurantList").innerHTML=[...entries].sort((a,b)=>a.restaurant.localeCompare(b.restaurant)).map(e=>`<option value="${esc(visitDisplayValue(e))}"></option>`).join("");
  const selected=entries.find(e=>e.id===selectedId);
  $("visitRestaurantSearch").value=selected?visitDisplayValue(selected):"";
}
function readMoneyInput(input){const raw=input.value.trim();if(raw==='')return null;const value=Number(raw);return Number.isFinite(value)&&value>=0&&value<=10000000?Math.round(value*100)/100:undefined;}
function updateVisitTreat(){
 const treated=$("visitPaidFor").checked,spend=$("visitSpend");
 if(treated){if(!spend.disabled)spend.dataset.previousAmount=spend.value;spend.value='0.00';spend.disabled=true}
 else{if(spend.disabled)spend.value=spend.dataset.previousAmount||'';spend.disabled=false}
 $("visitCostHint").textContent=treated?'Your personal payment is £0. The food value still counts towards your meal history.':'Enter what you personally paid. Leave either amount blank if unknown.';
}
function openNewVisit(){
  editingVisitId=null;$("visitDialogTitle").textContent="Log visit";populateVisitRestaurantSelect();
  const today=new Date();$("visitDate").value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;$("visitFoodValue").value="";$("visitSpend").disabled=false;$("visitSpend").dataset.previousAmount="";$("visitSpend").value="";$("visitPaidFor").checked=false;$("visitNote").value="";$("deleteVisitBtn").style.visibility="hidden";updateVisitTreat();prepareV45VisitForm(null);$("visitDialog").showModal();
}
function openVisitForRestaurant(id){
  const entry=entries.find(x=>x.id===id);if(!entry)return;
  openNewVisit();populateVisitRestaurantSelect(id);
  const now=new Date();$("visitDate").value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  $("visitNote").focus();
}
function openEditVisit(id){
  const v=visits.find(x=>x.id===id);if(!v)return;editingVisitId=id;$("visitDialogTitle").textContent="Edit visit";populateVisitRestaurantSelect(v.restaurantId);
  $("visitDate").value=v.date;$("visitFoodValue").value=v.foodValue===null?"":v.foodValue;$("visitSpend").disabled=false;$("visitSpend").dataset.previousAmount="";$("visitSpend").value=v.spend===null?"":v.spend;$("visitPaidFor").checked=!!v.paidFor;$("visitNote").value=v.note;$("deleteVisitBtn").style.visibility="visible";updateVisitTreat();prepareV45VisitForm(v);$("visitDialog").showModal();
}
async function saveVisit(){
  const restaurantId=resolveVisitRestaurantId($("visitRestaurantSearch").value),date=$("visitDate").value;
  if(!restaurantId){alert("Choose a restaurant.");return}
  const old=editingVisitId?visits.find(v=>v.id===editingVisitId):null;
  const paidFor=$("visitPaidFor").checked,foodValue=readMoneyInput($("visitFoodValue"));
  // A legacy part-paid entry must not be silently rewritten when editing only its note/date.
  const spend=paidFor?0:readMoneyInput($("visitSpend"));
  if(foodValue===undefined||spend===undefined){notify('Enter valid non-negative amounts, or leave them blank.','error');return}
  const details=collectV45VisitDetails();if(!details){return}
  if(!confirmDishOverlap(overlappingDishNames(restaurantId,details.dishes.filter(d=>restaurantId!==old?.restaurantId||!(old?.dishes||[]).some(x=>x.id===d.id&&reviewDishName(x.name)===reviewDishName(d.name))),'visit')))return;
  const v=normaliseVisit({id:editingVisitId||uid(),restaurantId,date,foodValue,spend,paidFor,note:$("visitNote").value.trim(),...details,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
  const revised=visits.filter(x=>x.id!==v.id).concat(v),e=entries.find(x=>x.id===restaurantId);
  const nextEntry=e?reco50RateEntry({...e,manualVisitCount:Math.max(e.manualVisitCount||0,revised.filter(x=>x.restaurantId===e.id).length),updatedAt:new Date().toISOString()},revised):null;
  try{const recovery=editingVisitId?buildRecoverySnapshot('Before editing a visit'):null;await mutateStores([...(recovery?[[SNAPSHOTS,'put',recovery]]:[]),[VISITS,'put',v],...(nextEntry?[[RESTAURANTS,'put',nextEntry]]:[])]);
    visits=revised;if(nextEntry)entries=entries.map(x=>x.id===nextEntry.id?nextEntry:x);
    if(date)visitMonthCursor=new Date(Number(date.slice(0,4)),Number(date.slice(5,7))-1,1);
    $('visitDialog').close();render();notify('Visit logged.');
  }catch(error){notify('Visit was not saved. Check device storage.','error');console.error(error)}
}
async function deleteVisit(){
  if(!editingVisitId||!confirm("Delete this visit?"))return;
  const old=visits.find(v=>v.id===editingVisitId), e=entries.find(x=>x.id===old?.restaurantId);
  const before=e?effectiveVisitCount(e):0;
  const revised=visits.filter(v=>v.id!==editingVisitId);
  const nextEntry=e?reco50RateEntry({...e,manualVisitCount:Math.max(revised.filter(v=>v.restaurantId===e.id).length,before-1),updatedAt:new Date().toISOString()},revised):null;
  try{const snap=buildRecoverySnapshot('Before deleting a visit');await mutateStores([...(snap?[[SNAPSHOTS,'put',snap]]:[]),[VISITS,'delete',editingVisitId],...(nextEntry?[[RESTAURANTS,'put',nextEntry]]:[])]);
    visits=revised;if(nextEntry)entries=entries.map(x=>x.id===nextEntry.id?nextEntry:x);
    $('visitDialog').close();render();notify('Visit removed.');
  }catch(error){notify('Visit could not be removed.','error');console.error(error)}
}

function renderLists(){
  if(prefs.activeListId&&!lists.some(l=>l.id===prefs.activeListId))prefs.activeListId=null;
  if(!prefs.activeListId&&lists.length)prefs.activeListId=lists[0].id;
  $("savedLists").innerHTML=lists.length?lists.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).map(l=>`<div class="saved-list ${l.id===prefs.activeListId?"active":""}" data-list-select="${l.id}"><b>${esc(l.name)}</b><span>${l.restaurantIds.length} ${l.restaurantIds.length===1?"restaurant":"restaurants"}</span></div>`).join(""):'<div class="muted">No lists yet.</div>';
  const active=lists.find(l=>l.id===prefs.activeListId);
  if(!active){$("listMain").innerHTML='<div class="list-empty"><div><b>No custom list selected.</b><br>Create one such as “Underrated places”, “Best dates” or “Worth the travel”.</div></div>';return}
  const restaurantMap=new Map(entries.map(e=>[e.id,e]));
  active.restaurantIds=active.restaurantIds.filter(id=>restaurantMap.has(id));
  const available=entries.filter(e=>!active.restaurantIds.includes(e.id)).sort((a,b)=>a.restaurant.localeCompare(b.restaurant));
  $("listMain").innerHTML=`
    <div class="list-top"><div><h2>${esc(active.name)}</h2><p>${esc(active.description||(active.ranked===false?"Unranked list":"Ranked list"))}</p></div>
      <div class="list-actions"><button data-edit-list="${active.id}">Edit list</button></div></div>
    <div class="add-to-list"><button id="addRestaurantToList" class="primary" type="button">Select restaurants</button></div>
    <div class="ranked-list">${active.restaurantIds.length?active.restaurantIds.map((id,i)=>{const e=restaurantMap.get(id);return `<div class="ranked-row" draggable="${active.ranked!==false}" data-reco50-order="${i}">
      <div class="ranked-pos">${active.ranked===false?'•':'#'+(i+1)}</div><div class="ranked-info"><b>${esc(e.restaurant)}</b><span>${esc(e.cuisine||"Uncategorised")} · ${e.foodScore}/100 · grand-list #${grandRankMap().get(e.id)}</span></div>
      <div class="ranked-actions"><button ${active.ranked===false?'hidden':''} data-move-list="${active.id}" data-index="${i}" data-dir="-1" ${i===0?"disabled":""}>↑</button><button ${active.ranked===false?'hidden':''} data-move-list="${active.id}" data-index="${i}" data-dir="1" ${i===active.restaurantIds.length-1?"disabled":""}>↓</button><button data-remove-from-list="${active.id}" data-rid="${e.id}">Remove</button></div>
    </div>`}).join(""):'<div class="muted">Add restaurants above, then reorder them into your ranking.</div>'}</div>`;
  const add=$("addRestaurantToList"); if(add)add.onclick=()=>reco50PickList(active);reco50BindDrag(active);
}
let visibleTableRows=150,visibleCardRows=72;
function fitCollectionMetrics(){
  const nodes=['statCount','statAvg','statCuisine','statSpend'].map(id=>$(id)).filter(Boolean);
  if(!nodes.length||!nodes[0].getBoundingClientRect().width)return;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)return;
  const maxPx=32,minPx=11;
  let size=maxPx;
  for(const el of nodes){
    const parent=el.parentElement,rect=parent.getBoundingClientRect();
    const cs=getComputedStyle(parent);const available=rect.width-parseFloat(cs.paddingLeft||0)-parseFloat(cs.paddingRight||0)-4;
    if(available<=0)continue;
    const font=getComputedStyle(el);
    ctx.font=`${font.fontWeight} ${maxPx}px ${font.fontFamily}`;
    const measured=ctx.measureText(el.textContent||'—').width;
    if(measured>0)size=Math.min(size,Math.floor(maxPx*available/measured));
  }
  const finalSize=Math.max(minPx,Math.min(maxPx,size));
  nodes.forEach(el=>{el.style.setProperty('font-size',finalSize+'px','important');el.style.whiteSpace='nowrap';el.style.overflow='hidden';el.style.textOverflow='clip'});
}
function render(){
  reco50ApplyMeans();updateEarnedRewards();refreshLists();const data=filtered(),ranks=grandRankMap(),dishByRestaurant=new Map();for(const d of dishRecords()){if(!dishByRestaurant.has(d.e.id))dishByRestaurant.set(d.e.id,[]);dishByRestaurant.get(d.e.id).push(d)}renderStats(data);renderChips();renderSortMarks();
  $("tbody").innerHTML=data.slice(0,visibleTableRows).map(e=>{const rv=restaurantVisits(e.id),latest=latestVisitDate(e),restaurantDishes=dishByRestaurant.get(e.id)||[];return `<tr>
  <td><span class="rank">#${ranks.get(e.id)}</span></td>
  <td><button class="name-btn" data-open-passport="${e.id}"><span class="name">${esc(e.restaurant)}</span></button></td>
  <td>${overallScore(e)===null?'<span class="muted">—</span>':`<span class="overall-score" style="background:${scoreColor(overallScore(e))}">${overallScore(e)}</span>`}</td>
  <td>${e.cuisine?`<span class="pill">${esc(e.cuisine)}</span>`:'<span class="muted">—</span>'}</td>
  <td><span class="score" style="background:${scoreColor(e.foodScore)}">${e.foodScore}</span></td>
  <td><div class="photo-row">${e.photos.length?e.photos.slice(0,5).map((p,i)=>`<img loading="lazy" src="${esc(p)}" alt="Photo of ${esc(e.restaurant)}" role="button" tabindex="0" aria-label="Enlarge photo ${i+1} of ${esc(e.restaurant)}" data-photo="${e.id}" data-index="${i}">`).join(""):'<span class="muted">—</span>'}</div></td>
  <td>${e.valueScore===null?'<span class="muted">—</span>':`<span class="score" style="background:${scoreColor(e.valueScore)}">${Math.round(e.valueScore)}</span>`}</td>
  <td><div class="dishes">${restaurantDishes.length?restaurantDishes.slice(0,3).map(d=>`<div class="dish"><span>${esc(d.item.name)}</span><b>${d.score===null?'Unrated':`${d.score.toFixed(1)}/10`}</b></div>`).join('')+(restaurantDishes.length>3?`<div class="dish"><span class="muted">+${restaurantDishes.length-3} more</span><b></b></div>`:''):'<span class="muted">—</span>'}</div></td>
  <td><span class="${serviceClass(e.service)}">${esc(e.service)}</span></td>
  <td><div class="vibes">${e.vibes.length?e.vibes.map(v=>`<span class="vibe">${esc(v)}</span>`).join(""):'<span class="muted">—</span>'}</div></td>
  <td><b>${ppText(e.pp)}</b></td>
  <td>${esc(e.location)||'<span class="muted">—</span>'}${e.international?'<span class="tag-international">International</span>':""}</td>
  <td>${esc(e.notes)||'<span class="muted">—</span>'}</td>
  <td class="visit-cell"><b>${shortDate(latest)}</b></td>
  <td class="visit-cell"><b>${visitDisplayCount(e)}</b><span>${effectiveVisitCount(e)===1?"visit":"visits"}${rv.some(v=>!v.date)?` · ${rv.filter(v=>!v.date).length} date unknown`:""}</span></td>
  <td><button data-edit="${e.id}">Edit</button></td>
</tr>`}).join("");
  $("emptyTable").style.display=data.length?"none":"block";renderMobileHome(data,ranks);
  const searchStatus=$("recoSearchResultStatus");
  if(searchStatus){const query=$("search").value.trim(),active=Object.values(prefs.filters||{}).some(value=>value!==''&&value!==null&&value!==undefined);
    searchStatus.hidden=!(query||active);
    searchStatus.textContent=(query||active)?`${data.length} of ${entries.length} restaurants match${query?` · ${query}`:''}`:'';
  }
  $("cardView").innerHTML=data.slice(0,visibleCardRows).map(e=>`<article class="card"><div class="cover">${e.photos.length?`<img loading="lazy" src="${esc(e.photos[0])}" data-photo="${e.id}" data-index="0">`:"No photo"}</div>
  <div class="card-body"><div class="card-head"><div><h3>#${ranks.get(e.id)} · <button class="name-btn" data-open-passport="${e.id}">${esc(e.restaurant)}</button></h3><div class="meta">${esc(e.cuisine||"Uncategorised")} · ${esc(e.location||"No location")}</div></div>${overallScore(e)===null?'<span class="muted">—</span>':`<span class="overall-score" style="background:${scoreColor(overallScore(e))}">${overallScore(e)}</span>`}</div>
  <div class="mini-grid"><div class="mini"><span>Food</span><b>${e.foodScore}</b></div><div class="mini"><span>Value</span><b>${e.valueScore===null?"—":Math.round(e.valueScore)}</b></div><div class="mini"><span>Service</span><b><span class="${serviceClass(e.service)}">${esc(e.service)}</span></b></div><div class="mini"><span>Visits</span><b>${visitDisplayCount(e)}</b></div></div>
  <div class="card-actions"><button type="button" data-open-passport="${esc(e.id)}">View passport</button><button data-edit="${e.id}">Edit</button></div></div></article>`).join("");
  $('recoTableMore').hidden=data.length<=visibleTableRows;
  $('recoTableMore').textContent=`Show more restaurants · ${Math.min(data.length,visibleTableRows)} of ${data.length}`;
  $('recoCardMore').hidden=data.length<=visibleCardRows;
  $('recoCardMore').textContent=`Load ${Math.min(24,Math.max(0,data.length-visibleCardRows))} more restaurants`;
  requestAnimationFrame(fitCollectionMetrics);
  renderMap(entries);freshRenderPlaces();renderCuisineView();renderGraph(data);renderLists();renderVisitHistory();renderV45AnnualFinance();renderWrappedStories();renderLab();renderDishes();renderDNA();renderProfile();renderV44Pulse();renderV45Home();renderV51YearWrap();reco50RenderExtras();renderBackupStatus();applyAppearance();updateDreamHub();applyView();$("storageStatus").textContent=`Saved locally · ${entries.length} restaurants · ${lists.length} custom lists`;
}
function applySidebarState(){
  const app=document.querySelector(".app");app.classList.toggle("sidebar-collapsed",!!prefs.sidebarCollapsed);
  const collapsed=!!prefs.sidebarCollapsed;
  $("sidebarToggle").textContent=collapsed?"›":"‹";
  $("sidebarToggle").setAttribute("aria-label",collapsed?"Expand sidebar":"Collapse sidebar");
  $("sidebarToggle").title=collapsed?"Expand sidebar":"Collapse sidebar";
}
function toggleSidebar(){
  if(window.matchMedia("(max-width:850px)").matches){setMobileSidebarOpen(false);return}
  prefs.sidebarCollapsed=!prefs.sidebarCollapsed;savePrefs();applySidebarState();
  if(prefs.sidebarCollapsed)document.querySelectorAll(".app-sidebar .popover").forEach(m=>m.classList.remove("show"));
}
function ensureSidebarExpanded(){
  if(prefs.sidebarCollapsed){prefs.sidebarCollapsed=false;savePrefs();applySidebarState()}
}
function setMobileSidebarOpen(open){
  document.querySelector(".app").classList.toggle("sidebar-mobile-open",!!open);
  $("mobileSidebarBtn").setAttribute("aria-expanded",open?"true":"false");
}
function applyView(){
  if(prefs.view==='dna')prefs.view='dishes';
  const v=prefs.view==="battles"?"table":(prefs.view||"table");if(prefs.view==="battles"){prefs.view="table";savePrefs()}$("tableView").style.display=v==="table"?"block":"none";$("cardView").style.display=v==="cards"?"grid":"none";$("mapView").style.display=v==="map"?"grid":"none";$("cuisineView").style.display=v==="cuisines"?"block":"none";$("graphView").style.display=v==="graph"?"grid":"none";$("listView").style.display=v==="lists"?"grid":"none";$("visitView").style.display=v==="visits"?"block":"none";$("labView").style.display=v==="settings"?"flex":"none";$("dishesView").style.display=v==="dishes"?"flex":"none";$("dnaView").style.display="none";$("profileView").style.display=v==="profile"?"block":"none";$("accountView").style.display=v==="account"?"block":"none";$("privacyView").style.display=v==="privacy"?"block":"none";$("termsView").style.display=v==="terms"?"block":"none";$("helpView").style.display=v==="help"?"block":"none";$("grandListTools").style.display=(v==="table"||v==="graph")?"flex":"none";$("grandListTools").classList.toggle("is-graph",v==="graph");document.querySelector(".app").classList.toggle("is-profile",v==="profile");document.querySelector(".app").classList.toggle("is-journal-home",v==="home");if(v==="map")renderMap(entries);if(v==="graph")renderGraph(filtered());
  document.querySelector(".stats").style.display=(v==="table"||v==="cards"||v==="graph")?"grid":"none";
  document.querySelectorAll("[data-view]").forEach(b=>{const isSidebarGrandList=b.closest(".sidebar-nav")&&b.dataset.view==="table"&&v==="graph";const active=b.dataset.view===v||isSidebarGrandList;b.classList.toggle("active",active);if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
mobileApplyNavigation(v);
  document.dispatchEvent(new CustomEvent("reco-view-change",{detail:v}));
  // Pagination belongs only to the view it controls, never to Calendar, Places or Profile.
  const collectionLength=filtered().length;
  if($('recoCardMore'))$('recoCardMore').hidden=v!=='cards'||collectionLength<=visibleCardRows;
  if($('recoTableMore'))$('recoTableMore').hidden=v!=='table'||window.matchMedia('(max-width:1100px)').matches||collectionLength<=visibleTableRows;
  if($('recoPulse'))$('recoPulse').hidden=(v!=='home');
  document.querySelectorAll('#mobileBottomNav [data-mobile-view]').forEach(b=>{const active=b.classList.contains('active');if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  const more=$('mobileMoreBtn');if(more){if(more.classList.contains('active'))more.setAttribute('aria-current','page');else more.removeAttribute('aria-current')}
}
function passportStamp(label,value,sub,rot){return `<div class="passport-stamp" style="--rot:${rot}deg"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`}
function openPhotoLightbox(src){
  const dialog=$("lightbox");$("lightboxImg").src=src;
  if(!dialog.open)dialog.showModal();
  $("lightboxClose").focus({preventScroll:true});
}
function renderPassport(id){
  const e=entries.find(x=>x.id===id);if(!e)return;
  rememberRestaurant(id);
  const history=restaurantVisits(id),locImg=getLocationImage(e.location),topDishIdx=starredDishIndexes(e.items),restaurantDishRecords=dishRecords().filter(d=>d.e.id===id);
  const cover=e.photos?.[0]||locImg,overall=overallScore(e);
  $("passportTitle").textContent=e.restaurant;
  $("passportEditBtn").onclick=()=>{$("passportDialog").close();edit(id)};
  $("passportLogVisitBtn").onclick=()=>{$("passportDialog").close();openVisitForRestaurant(id)};
  $("passportContent").innerHTML=`<article class="compact-passport">
    <div class="passport-hero">${cover?`<img src="${esc(cover)}" role="button" tabindex="0" data-passport-cover="${esc(e.id)}" aria-label="Enlarge restaurant cover photograph" alt="Restaurant cover photograph">`:''}
      <div class="passport-hero-tint"></div><div class="passport-hero-inner"><span class="passport-kicker">RECOLLEAT · YOUR COLLECTION <b>#${grandRankMap().get(e.id)||'—'}</b></span><div class="passport-hero-score"><strong>${overall??'—'}</strong><span>OVERALL</span></div><h2>${esc(e.restaurant)}</h2><p>${esc(e.cuisine||'Uncategorised')} · ${esc(e.location||'No location')}${e.international?' · International':''}</p></div></div>
    <div class="reco-passport-tabs" role="tablist" aria-label="Passport pages"><button type="button" class="active" role="tab" data-passport-page="ratings" aria-selected="true" id="passportTabRatings" aria-controls="passportRatingsPage">Ratings</button><button type="button" role="tab" data-passport-page="journal" aria-selected="false" id="passportTabJournal" aria-controls="passportJournalPage">Journal &amp; memories</button></div>
    <section class="reco-passport-page" id="passportRatingsPage" role="tabpanel" aria-labelledby="passportTabRatings">
    <div class="passport-score-strip"><div><span>FOOD</span><b>${e.foodScore}<small>/100</small></b></div><div><span>VALUE</span><b>${e.valueScore===null?'—':Math.round(e.valueScore)}<small>/100</small></b></div><div><span>SERVICE</span><b>${esc(e.service||'—')}</b></div></div>
    </section><section class="reco-passport-page" id="passportJournalPage" role="tabpanel" aria-labelledby="passportTabJournal" hidden><div class="passport-meta"><span><b>${ppText(e.pp)}</b> per person</span><span><b>${visitDisplayCount(e)}</b> visits</span><span>Last: <b>${esc(shortDate(latestVisitDate(e)))}</b></span></div>
    <div class="passport-accordion">
      <details ${restaurantDishRecords.length?'open':''}><summary>Dishes <span>${restaurantDishRecords.length} recorded</span></summary><div class="passport-items reco33-passport-dishes">${restaurantDishRecords.length?restaurantDishRecords.map(d=>`<div class="passport-item"><div><b>${esc(d.item.name)}</b><small>${d.source==='visit'?esc(formatVisitDate(d.date)):'Restaurant review · undated'}</small></div><span>${d.score===null?'Unrated':`${d.score.toFixed(1)}/10`}</span>${d.visitId?`<button type="button" data-reco33-edit-visit="${esc(d.visitId)}">Edit</button>`:`<button type="button" data-reco33-edit-review="${esc(e.id)}">Edit</button>`}</div>`).join(''):'<p class="muted">No dishes yet.</p>'}</div></details>
      <details><summary>Visits <span>${history.length} logged</span></summary><div class="passport-items">${history.length?history.slice().reverse().map(v=>`<div class="reco-passport-visit"><div class="passport-item"><span><b>${formatVisitDate(v.date)}</b>${v.foodRating!==null?` · Food ${v.foodRating}/100`:''}</span>${visitCostDetails(v)}</div>${v.note?`<p>${esc(v.note)}</p>`:''}${(v.dishes||[]).length?`<div class="reco-visit-dish-tags">${v.dishes.map(i=>`<span>${esc(i.name)}${i.rating!==null?` · ${i.rating}/10`:''}${i.price!==null?` · £${Number(i.price).toFixed(2)}`:''}</span>`).join('')}</div>`:''}${(v.photos||[]).length?`<div class="reco-visit-gallery">${v.photos.map((src,i)=>`<img loading="lazy" data-visit-photo="${esc(v.id)}" data-index="${i}" src="${esc(src)}" alt="Photo of meal on ${esc(formatVisitDate(v.date))}" tabindex="0" role="button" />`).join('')}</div>`:''}</div>`).join(''):'<p class="muted">No logged visits yet.</p>'}</div></details>
      <details><summary>Notes &amp; occasion <span>${esc(e.vibes.join(', ')||'Personal')}</span></summary><div class="passport-note">${esc(e.notes)||'<span class="muted">No notes yet.</span>'}</div></details>
      <details><summary>Photographs <span>${e.photos.length} images</span></summary><div class="passport-photos">${e.photos.length?e.photos.slice(0,12).map((src,i)=>`<img src="${esc(src)}" data-photo="${esc(e.id)}" data-index="${i}" tabindex="0" role="button" aria-label="Enlarge restaurant photograph ${i+1}" alt="Restaurant photograph ${i+1}">`).join(''):'<p class="muted">No restaurant photos uploaded.</p>'}</div></details>
      <details><summary>Location <span>${esc(e.location||'Unspecified')}</span></summary><div class="passport-note">${locImg?`<img class="passport-loc-image" src="${esc(locImg)}" data-location-photo="${esc(e.location)}" role="button" tabindex="0" aria-label="Enlarge location photograph" alt="Location photograph">`:''}<p>${esc(e.location||'No location set')}</p><button data-open-map="${esc(e.location)}">Explore location bubbles</button></div></details>
    </div></section>
  </article>`;
  $("passportDialog").showModal();
}
function graphFiltersActive(){const g=prefs.graph.filters;return !!(g.location||g.cuisine||g.region||g.minFood!==""||g.minOverall!=="")}
function graphFiltered(data){
  const g=prefs.graph.filters||DEFAULT_PREFS.graph.filters;
  return data.filter(e=>{
    if(g.location&&locationKey(e.location)!==locationKey(g.location))return false;
    if(g.cuisine&&e.cuisine!==g.cuisine)return false;
    if(g.region==="international"&&!e.international)return false;
    if(g.region==="uk"&&e.international)return false;
    if(g.minFood!==""&&e.foodScore<Number(g.minFood))return false;
    const ov=overallScoreRaw(e);
    if(g.minOverall!==""&&(ov===null||ov<Number(g.minOverall)))return false;
    return true;
  });
}
function renderGraphFilterChips(){
  const g=prefs.graph.filters,ch=[];
  if(g.location)ch.push(["location",`Location: ${g.location}`]);
  if(g.cuisine)ch.push(["cuisine",`Cuisine: ${g.cuisine}`]);
  if(g.region)ch.push(["region",g.region==="international"?"International":"United Kingdom"]);
  if(g.minFood!=="")ch.push(["minFood",`Food ≥ ${g.minFood}`]);
  if(g.minOverall!=="")ch.push(["minOverall",`Overall ≥ ${g.minOverall}`]);
  $("graphFilterChips").innerHTML=ch.map(([k,t])=>`<span class="graph-filter-chip">${esc(t)}<button type="button" data-clear-graph-filter="${k}">×</button></span>`).join("");
}
function graphRegression(points){
  if(!points||points.length<3)return {ok:false,message:"Need at least 3 matching restaurants for a line of best fit."};
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y); const meanX=xs.reduce((a,b)=>a+b,0)/xs.length, meanY=ys.reduce((a,b)=>a+b,0)/ys.length;
  const sxx=xs.reduce((s,x)=>s+Math.pow(x-meanX,2),0); if(Math.abs(sxx)<1e-9)return {ok:false,message:"A fitted line is unavailable because all x-values are identical."};
  const syy=ys.reduce((s,y)=>s+Math.pow(y-meanY,2),0); const sxy=points.reduce((s,p)=>s+(p.x-meanX)*(p.y-meanY),0);
  const slope=sxy/sxx, intercept=meanY-slope*meanX, r=syy<=1e-12?0:(sxy/Math.sqrt(sxx*syy)), r2=r*r;
  return {ok:true,slope,intercept,r,r2,n:points.length,minX:Math.min(...xs),maxX:Math.max(...xs)};
}
function regressionSummary(reg){
  if(!reg.ok)return reg.message;
  const sign=reg.intercept>=0?"+":"−";
  return `y = ${roundToTwoSigFigs(reg.slope)}x ${sign} ${roundToTwoSigFigs(Math.abs(reg.intercept))} · r = ${roundToTwoSigFigs(reg.r)} · R² = ${roundToTwoSigFigs(reg.r2)} · n = ${reg.n}`;
}
function renderGraphDetailRestaurant(e){
  const cover=e.photos?.[0]||getLocationImage(e.location);
  $("graphDetail").innerHTML=`<div class="passport-mini">${cover?`<img src="${esc(cover)}" style="width:100%;height:155px;object-fit:cover;border-radius:13px;margin-bottom:12px">`:""}<div class="profile-eyebrow">Restaurant card</div><h3>${esc(e.restaurant)}</h3><div class="meta">${esc(e.cuisine||"Uncategorised")} · ${esc(e.location||"No location")}</div><div class="profile-detail-grid"><div>Overall<b>${overallScore(e)??"—"}</b></div><div>Food<b>${e.foodScore}</b></div><div>Value<b>${e.valueScore===null?"—":Math.round(e.valueScore)}</b></div><div>Service<b>${esc(e.service)}</b></div></div><button class="primary" style="width:100%;margin-top:13px" data-open-passport="${e.id}">Open restaurant card</button></div>`;
}
function renderGraphDetailGroup(category,list,metric){$("graphDetail").innerHTML=`<div class="passport-mini"><div class="muted">Category selected</div><h3>${esc(category)}</h3><div>${list.length} ${list.length===1?"restaurant":"restaurants"} · average ${factorLabel(metric).toLowerCase()} <b>${roundToTwoSigFigs(list.map(e=>Number(factorValue(e,metric)||0)).reduce((s,x)=>s+x,0)/Math.max(1,list.length))}</b></div><div style="margin-top:10px">${list.slice(0,8).map(e=>`<div class="passport-item"><span><button class="name-btn" data-open-passport="${e.id}">${esc(e.restaurant)}</button></span><b>${overallScore(e)??"—"}</b></div>`).join("")}</div></div>`}
function applyGraphZoom(){
  const svg=$('graphSvg');const w=1000/graphZoom,h=560/graphZoom;
  graphPan.x=Math.max(0,Math.min(1000-w,graphPan.x));graphPan.y=Math.max(0,Math.min(560-h,graphPan.y));
  svg.setAttribute('viewBox',`${graphPan.x} ${graphPan.y} ${w} ${h}`);$('graphZoomLabel').textContent=`${Math.round(graphZoom*100)}%`;
}
function changeGraphZoom(multiplier,point=null){
  const old=graphZoom,next=Math.max(1,Math.min(5,Math.round(graphZoom*multiplier*100)/100));if(next===old)return;
  const newW=1000/next,newH=560/next,oldW=1000/old,oldH=560/old;
  const fx=point?.x??.5,fy=point?.y??.5;
  graphPan.x+=fx*(oldW-newW);graphPan.y+=fy*(oldH-newH);graphZoom=next;applyGraphZoom();
}
function resetGraphZoom(){graphZoom=1;graphPan={x:0,y:0};applyGraphZoom()}
function bindGraphZoom(){
  $('graphZoomIn').onclick=()=>changeGraphZoom(1.3);$('graphZoomOut').onclick=()=>changeGraphZoom(1/1.3);$('graphZoomReset').onclick=resetGraphZoom;
  const svg=$('graphSvg');svg.addEventListener('wheel',ev=>{ev.preventDefault();const rect=svg.getBoundingClientRect();changeGraphZoom(ev.deltaY<0?1.17:1/1.17,{x:(ev.clientX-rect.left)/rect.width,y:(ev.clientY-rect.top)/rect.height})},{passive:false});
  svg.addEventListener('pointerdown',ev=>{if(ev.target.closest('[data-graph-point],[data-graph-bar]')||graphZoom===1)return;graphDrag={x:ev.clientX,y:ev.clientY,panX:graphPan.x,panY:graphPan.y};svg.setPointerCapture(ev.pointerId);svg.style.cursor='grabbing'});
  svg.addEventListener('pointermove',ev=>{if(!graphDrag)return;const rect=svg.getBoundingClientRect();graphPan.x=graphDrag.panX-(ev.clientX-graphDrag.x)*(1000/graphZoom)/rect.width;graphPan.y=graphDrag.panY-(ev.clientY-graphDrag.y)*(560/graphZoom)/rect.height;applyGraphZoom()});
  const end=()=>{graphDrag=null;svg.style.cursor=''};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
}
function renderGraph(data){
  const svg=$("graphSvg"), note=$("graphNote"), xKey=$("graphX").value, yKey=$("graphY").value, fitMode=$("graphFitMode").value;
  const numeric=["overallScore","foodScore","service","valueScore","pp"], categorical=["location","cuisine"];
  const xNum=numeric.includes(xKey), yNum=numeric.includes(yKey), xCat=categorical.includes(xKey), yCat=categorical.includes(yKey);
  const W=1000,H=560,m={l:70,r:30,t:30,b:70};
  renderGraphFilterChips();applyGraphZoom();
  if(xCat && yCat){svg.innerHTML=''; note.textContent='Choose at least one numeric factor to draw the graph.'; $("graphDetail").innerHTML='<div class="muted">Pick a numeric axis to build a scatter plot or bar chart.</div>'; return;}
  const focused=graphFiltered(data);
  if(xNum && yNum){
    const allPts=data.map(e=>({e,x:Number(factorValue(e,xKey)),y:Number(factorValue(e,yKey))})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    const focusedIds=new Set(focused.map(e=>e.id));
    const focusPts=allPts.filter(p=>focusedIds.has(p.e.id));
    if(!allPts.length){svg.innerHTML=''; note.textContent='No matching data for this scatter plot.'; $("graphDetail").innerHTML='<div class="muted">No restaurants have values for both selected axes.</div>';return}
    const minX=Math.min(...allPts.map(p=>p.x)), maxX=Math.max(...allPts.map(p=>p.x)), minY=Math.min(...allPts.map(p=>p.y)), maxY=Math.max(...allPts.map(p=>p.y));
    const sx=v=>m.l+((v-minX)/(maxX-minX||1))*(W-m.l-m.r), sy=v=>H-m.b-((v-minY)/(maxY-minY||1))*(H-m.t-m.b);
    let out=`<rect x="0" y="0" width="${W}" height="${H}" fill="#fcfcf9"/><line x1="${m.l}" y1="${H-m.b}" x2="${W-m.r}" y2="${H-m.b}" stroke="#999"/><line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H-m.b}" stroke="#999"/>`;
    for(let i=0;i<=5;i++){const v=minX+(maxX-minX)*(i/5), x=sx(v); out+=`<line x1="${x}" y1="${H-m.b}" x2="${x}" y2="${m.t}" stroke="#ece7de"/><text x="${x}" y="${H-m.b+22}" text-anchor="middle" font-size="12" fill="#666">${roundToTwoSigFigs(v)}</text>`}
    for(let i=0;i<=5;i++){const v=minY+(maxY-minY)*(i/5), y=sy(v); out+=`<line x1="${m.l}" y1="${y}" x2="${W-m.r}" y2="${y}" stroke="#ece7de"/><text x="${m.l-10}" y="${y+4}" text-anchor="end" font-size="12" fill="#666">${roundToTwoSigFigs(v)}</text>`}

    const fitSource = fitMode==="filtered" ? focusPts : allPts;
    const reg = fitMode==="off" ? {ok:false,message:"Line of best fit disabled."} : graphRegression(fitSource);
    if(fitMode!=="off" && reg.ok){
      const x1=reg.minX, y1=reg.slope*x1+reg.intercept, x2=reg.maxX, y2=reg.slope*x2+reg.intercept;
      out += `<line x1="${sx(x1)}" y1="${sy(y1)}" x2="${sx(x2)}" y2="${sy(y2)}" stroke="#0f8bd6" stroke-width="3" stroke-dasharray="${fitMode==='filtered'?'10 8':'0'}" opacity="0.9"/>`;
    }

    allPts.forEach(p=>{
      const inFocus=focusedIds.has(p.e.id);
      const selected=graphSelection===p.e.id;
      const fill=selected?'#d63d2e':(inFocus?scoreColor(overallScore(p.e)||p.e.foodScore):'#b8bec8');
      const opacity=inFocus?0.92:0.48;
      out+=`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${selected?8:(inFocus?6:5)}" fill="${fill}" opacity="${opacity}" data-graph-point="${p.e.id}"/>`;
    });
    out+=`<text x="${W/2}" y="${H-10}" text-anchor="middle" font-size="16" fill="#333">${factorLabel(xKey)}</text><text x="18" y="${H/2}" text-anchor="middle" font-size="16" fill="#333" transform="rotate(-90 18 ${H/2})">${factorLabel(yKey)}</text>`;
    svg.innerHTML=out;
    const subsetText = graphFiltersActive()?` Graph filters matched ${focusPts.length} of ${allPts.length} visible restaurants.`:'';
    const fitText = fitMode==='off' ? 'Line of best fit disabled.' : regressionSummary(reg);
    note.textContent=`Scatter plot · click any dot to inspect a restaurant.${subsetText} ${fitMode==='filtered'?'Filtered fit uses only the highlighted subset. ':'Normal fit uses all visible points. '}${fitText}`;
    const selected=data.find(e=>e.id===graphSelection)||focusPts[0]?.e||allPts[0]?.e; if(selected){graphSelection=selected.id; renderGraphDetailRestaurant(selected)}
    return;
  }
  const catKey=xCat?xKey:yKey, metricKey=xCat?yKey:xKey;
  const groups={}; focused.forEach(e=>{const cat=factorValue(e,catKey)||'Unknown'; const val=Number(factorValue(e,metricKey)); if(!Number.isFinite(val))return; (groups[cat]??=[]).push(e)});
  const bars=Object.entries(groups).map(([category,list])=>({category,list,count:list.length,avg:roundToTwoSigFigs(list.map(e=>Number(factorValue(e,metricKey)||0)).reduce((s,x)=>s+x,0)/list.length)})).sort((a,b)=>b.avg-a.avg).slice(0,12);
  if(!bars.length){svg.innerHTML=''; note.textContent='No matching data for this bar chart.'; $("graphDetail").innerHTML='<div class="muted">No restaurants match the current Patterns filters for this bar chart.</div>'; return}
  const bw=(W-m.l-m.r)/bars.length, maxV=Math.max(...bars.map(b=>b.avg));
  let out=`<rect x="0" y="0" width="${W}" height="${H}" fill="#fcfcf9"/><line x1="${m.l}" y1="${H-m.b}" x2="${W-m.r}" y2="${H-m.b}" stroke="#999"/><line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H-m.b}" stroke="#999"/>`;
  for(let i=0;i<=5;i++){const v=maxV*(i/5), y=H-m.b-(v/(maxV||1))*(H-m.t-m.b); out+=`<line x1="${m.l}" y1="${y}" x2="${W-m.r}" y2="${y}" stroke="#ece7de"/><text x="${m.l-10}" y="${y+4}" text-anchor="end" font-size="12" fill="#666">${roundToTwoSigFigs(v)}</text>`}
  bars.forEach((b,i)=>{const x=m.l+i*bw+10, w=Math.max(28,bw-20), h=(b.avg/(maxV||1))*(H-m.t-m.b), y=H-m.b-h, selected=graphSelection===b.category; out+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${selected?'#d63d2e':'#3c4a60'}" opacity="0.88" data-graph-bar="${esc(b.category)}"></rect><text x="${x+w/2}" y="${y-8}" text-anchor="middle" font-size="11" fill="#444">${b.avg}</text><text x="${x+w/2}" y="${H-m.b+18}" text-anchor="middle" font-size="11" fill="#555">${esc(b.category).slice(0,12)}</text><text x="${x+w/2}" y="${H-m.b+33}" text-anchor="middle" font-size="10" fill="#777">n=${b.count}</text>`});
  out+=`<text x="${W/2}" y="${H-10}" text-anchor="middle" font-size="16" fill="#333">${factorLabel(catKey)}</text><text x="18" y="${H/2}" text-anchor="middle" font-size="16" fill="#333" transform="rotate(-90 18 ${H/2})">Average ${factorLabel(metricKey)}</text>`;
  svg.innerHTML=out; note.textContent=`Bar chart · current Patterns filters matched ${focused.length} restaurant${focused.length===1?'':'s'}. Sample size for each category appears below the label.`;
  const selected=bars.find(b=>b.category===graphSelection)||bars[0]; if(selected){graphSelection=selected.category; renderGraphDetailGroup(selected.category,selected.list,metricKey)}
}
function openGraphRestaurant(id){graphSelection=id; renderGraph(filtered())}
function openGraphGroup(category){graphSelection=category; renderGraph(filtered())}

const CATEGORY_CANONICAL=Object.freeze({
 kebab:'Kebab',kebabs:'Kebab',burger:'Burger',burgers:'Burger',pizza:'Pizza',pizzas:'Pizza',
 curry:'Curry',curries:'Curry',taco:'Taco',tacos:'Taco',steak:'Steak',steaks:'Steak',
 sandwich:'Sandwich',sandwiches:'Sandwich',salad:'Salad',salads:'Salad',
 dessert:'Dessert',desserts:'Dessert',pasta:'Pasta',sushi:'Sushi',seafood:'Seafood',
 noodle:'Noodles',noodles:'Noodles',fries:'Fries',chips:'Chips',breakfast:'Breakfast',
 ramen:'Ramen',rice:'Rice',wings:'Wings',dumpling:'Dumpling',dumplings:'Dumpling', 'other dishes':'Other dishes', pies:'Pie',pie:'Pie'
});
function canonicalCategoryName(raw){
 const name=String(raw||'').normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,60);
 if(!name)return '';
 const key=name.toLocaleLowerCase('en-GB');
 if(CATEGORY_CANONICAL[key])return CATEGORY_CANONICAL[key];
 if(/[^a-z -]/i.test(name))return name;
 // Conservative English plural rules; never collapse words ending in -ss/-us/-is.
 let singular=key;
 if(/[^aeiou]ies$/.test(key)&&key.length>5)singular=key.slice(0,-3)+'y';
 else if(/(?:ches|shes|xes|zzes)$/.test(key))singular=key.slice(0,-2);
 else if(key.endsWith('s')&&!/(?:ss|us|is|ous)$/.test(key)&&key.length>4)singular=key.slice(0,-1);
 return CATEGORY_CANONICAL[singular]||singular.replace(/\b\w/g,x=>x.toUpperCase());
}
function normalizeDishCategoryNames(values){
 const result=[],seen=new Set(),source=Array.isArray(values)?values:String(values||'').split(/[,;\n]+/);
 for(const raw of source){const name=canonicalCategoryName(raw),key=name.toLocaleLowerCase('en-GB');
   if(name&&!seen.has(key)){seen.add(key);result.push(name)}
 }
 return result;
}
// Normalise existing preferences only after the category aliases are initialized.
prefs.dishCategories=normalizeDishCategoryNames(prefs.dishCategories);
prefs.hiddenDishCategories=normalizeDishCategoryNames(prefs.hiddenDishCategories);
function explicitDishCategories(item){
  if(Array.isArray(item?.categories)&&item.categories.length)return normalizeDishCategoryNames(item.categories);
  return normalizeDishCategoryNames(item?.category||"");
}
function dishCategoriesForItem(item){
  const explicit=explicitDishCategories(item);
  const inferred=canonicalCategoryName(dishCategory(item));
  return explicit.length?explicit.filter(c=>!(prefs.hiddenDishCategories||[]).some(h=>h.toLowerCase()===c.toLowerCase())):((prefs.hiddenDishCategories||[]).some(h=>h.toLowerCase()===inferred.toLowerCase())?["Uncategorised"]:[inferred]);
}
function dishCategoryCatalog(){
  return normalizeDishCategoryNames([...(prefs.dishCategories||[]),...allDishes().flatMap(d=>d.categories),"Burger","Pizza","Kebab","Steak","Sushi","Curry","Pasta","Dessert","Seafood","Breakfast","Sandwich","Noodles","Salad","Other dishes","Uncategorised"]).filter(c=>!(prefs.hiddenDishCategories||[]).some(h=>h.toLowerCase()===c.toLowerCase())).sort((a,b)=>a.localeCompare(b));
}
function addCustomDishCategory(raw){
  const names=normalizeDishCategoryNames(raw);
  if(!names.length)return null;
  const name=names[0],existing=dishCategoryCatalog().find(x=>x.toLowerCase()===name.toLowerCase());
  const finalName=existing||name;
  prefs.hiddenDishCategories=(prefs.hiddenDishCategories||[]).filter(h=>h.toLowerCase()!==finalName.toLowerCase());prefs.dishCategories=normalizeDishCategoryNames([...(prefs.dishCategories||[]),finalName]);
  savePrefs();renderDishCategoryManager();return finalName;
}
function renderDishCategoryManager(){
  const catalogue=dishCategoryCatalog();
  const counts=new Map();
  for(const d of allDishes())for(const c of d.categories)counts.set(c.toLowerCase(),(counts.get(c.toLowerCase())||0)+1);
  $("dishCategoryCatalog").innerHTML=catalogue.map(c=>`<span class="category-catalog-chip"><button type="button" class="category-open" data-open-dish-book="${esc(c)}">${esc(c)} <small>${counts.get(c.toLowerCase())||0}</small></button><button type="button" class="category-delete" title="Delete category" aria-label="Delete ${esc(c)} category" data-delete-dish-category="${esc(c)}">×</button></span>`).join("");
  const suggestions=$("dishCategorySuggestions");
  if(suggestions)suggestions.innerHTML=catalogue.map(c=>`<option value="${esc(c)}"></option>`).join("");
}
function showDishCategoryChoices(selected=[]){
  const selection=new Set(selected.map(x=>x.toLowerCase()));
  $("dishCategoryChoices").innerHTML=dishCategoryCatalog().map(c=>`<label class="category-choice"><input type="checkbox" value="${esc(c)}" ${selection.has(c.toLowerCase())?'checked':''}><span>${esc(c)}</span></label>`).join("");
}
function openDishCategoryDialog(restaurantId,index){
  const e=entries.find(x=>x.id===restaurantId),item=e?.items?.[index];if(!e||!item)return;
  currentDishCategoryEdit={restaurantId,index};
  $("dishCategoryDialogSubtitle").textContent=`${item.name} · ${e.restaurant}`;
  $("dishCategoryNewInDialog").value="";
  showDishCategoryChoices(dishCategoriesForItem(item));
  $("dishCategoryDialog").showModal();
}
function addCategoryInDialog(){
  const selected=[...$("dishCategoryChoices").querySelectorAll('input:checked')].map(x=>x.value);
  const cat=addCustomDishCategory($("dishCategoryNewInDialog").value);
  if(!cat){$("dishCategoryNewInDialog").focus();return}
  $("dishCategoryNewInDialog").value="";
  showDishCategoryChoices([...selected,cat]);
}
async function saveDishCategoryChanges(){
  const context=currentDishCategoryEdit;if(!context)return;
  const e=entries.find(x=>x.id===context.restaurantId);if(!e||!e.items[context.index])return;
  const names=normalizeDishCategoryNames([...$("dishCategoryChoices").querySelectorAll('input:checked')].map(x=>x.value));
  if(!names.length)names.push("Uncategorised");
  e.items[context.index]={...e.items[context.index],categories:names,category:names[0]};
  e.updatedAt=new Date().toISOString();
  prefs.dishCategories=normalizeDishCategoryNames([...(prefs.dishCategories||[]),...names]);
  savePrefs();await putStore(RESTAURANTS,e);
  $("dishCategoryDialog").close();currentDishCategoryEdit=null;
  render();
}
function addItemRow(item={name:"",rating:null,category:""}){
  const cats=explicitDishCategories(item);
  const r=document.createElement("div");r.className="item-edit";r.dataset.photo=item.photo||"";
  r.innerHTML=`<input class="dish-name" placeholder="Dish / item" aria-label="Dish name" value="${esc(item.name||"")}"><input type="hidden" class="dish-categories-input" value="${esc(cats.join(', '))}"><input class="dish-rating" type="number" min="0" max="10" step="0.1" value="${item.rating===null||item.rating===undefined?'':esc(item.rating)}" placeholder="Rating /10" aria-label="Dish rating"><label class="reco-build3-photo-label">Choose dish photo<input type="file" class="reco-item-photo-file" accept="image/*"></label><span class="reco-build3-photo-state">${r.dataset.photo?'Photo selected ✓':'Optional'}</span><button type="button" class="remove-item" aria-label="Remove dish">−</button>`;
  r.querySelector('.reco-item-photo-file').onchange=async ev=>{await v45UploadPhoto(ev.target.files?.[0],src=>{r.dataset.photo=src;r.querySelector('.reco-build3-photo-state').textContent='Photo selected ✓'});ev.target.value=''};
  r.querySelector(".remove-item").onclick=()=>r.remove();$("itemsEditor").appendChild(r);
}

function setFoodScore(v){v=Math.max(0,Math.min(100,Number(v)||0));$("foodScore").value=v;$("foodScoreNumber").value=v;$("foodScoreNumber").style.background=scoreColor(v);$("foodScoreNumber").style.color="#fff"}
function setValueScore(v){v=Math.max(0,Math.min(100,Number(v)||0));$("valueScore").value=v;$("valueScoreNumber").value=v;$("valueScoreNumber").style.background=scoreColor(v);$("valueScoreNumber").style.color="#fff"}
function setPP(v){v=Math.max(0,Math.min(75,Number(v)||0));$("pp").value=v;$("ppNumber").value=v}
function photoPreview(){$("photoPreview").innerHTML="";workingPhotos.forEach((p,i)=>{const d=document.createElement("div");d.className="photo-chip";d.innerHTML=`<img src="${esc(p)}"><button type="button">×</button>`;d.querySelector("button").onclick=()=>{workingPhotos.splice(i,1);photoPreview()};$("photoPreview").appendChild(d)})}
function renderEditorVisits(){
  const root=$("editorVisitRows");
  const recorded=workingVisits.flatMap(v=>(v.dishes||[]).map(item=>({item,date:v.date})));
  $('reco33ExistingVisitDishes').hidden=!recorded.length;$('reco33VisitDishCount').textContent=`(${recorded.length})`;
  $('reco33VisitDishList').innerHTML=recorded.map(({item,date})=>`<div class="reco33-existing-dish"><div><b>${esc(item.name)}</b><small>${esc(formatVisitDate(date))}</small></div><span>${recordedDishScore(item.rating)===null?'Unrated':`${Number(item.rating).toFixed(1)}/10`}</span></div>`).join('');
  $("editorVisitTotal").textContent=workingVisits.length>10?"10+":String(workingVisits.length);
  root.innerHTML=workingVisits.length?workingVisits.map((v,i)=>`<div class="visit-editor-row" data-visit-id="${esc(v.id)}">
    <div class="visit-row-index"><b>${String(i+1).padStart(2,"0")}</b><div><b>Visit ${i+1}</b><small>${v.date?"Dated memory":"Date unknown"}</small></div></div>
    <label>Date · optional<input type="date" class="visit-date-field" value="${esc(v.date||"")}" aria-label="Date of visit ${i+1} (optional)"></label>
    <label>Meal value (£)<input class="visit-food-field" inputmode="decimal" type="number" min="0" step="0.01" value="${v.foodValue===null?'':v.foodValue}" aria-label="Food value for visit ${i+1}"></label>
    <label>You paid (£)<input class="visit-spend-field" inputmode="decimal" type="number" min="0" step="0.01" value="${v.spend===null?'':v.spend}" ${v.paidFor?'disabled':''} aria-label="Personally paid for visit ${i+1}"></label>
    <label class="editor-visit-treated"><input class="visit-treated-field" type="checkbox" ${v.paidFor?'checked':''} aria-label="Someone paid for visit ${i+1}"> Someone paid for my meal</label>
    <button type="button" data-remove-editor-visit="${esc(v.id)}" aria-label="Remove visit ${i+1}">Remove</button>
  </div>`).join(""):'<div class="visit-empty-message">No visits added. Click “Add another visit” if you remember going.</div>';
}
function prepareWorkingVisits(e){
  workingVisits=e?restaurantVisits(e.id).map(v=>({...v})):[];
  if(e){
    const remembered=e.dateVisited||"";
    if(remembered&&!workingVisits.some(v=>v.date))workingVisits.push(normaliseVisit({id:uid(),restaurantId:e.id,date:remembered,spend:null,note:""}));
    const count=Math.max(Number(e.manualVisitCount||0),workingVisits.length);
    for(let i=workingVisits.length;i<count;i++)workingVisits.push(normaliseVisit({id:uid(),restaurantId:e.id,date:"",spend:null,note:""}));
  }else workingVisits=[normaliseVisit({id:uid(),date:"",spend:null,note:""})];
  renderEditorVisits();
}
function resetPlaceSelection(){
  selectedPlace=null;$("placeSelectedNote").style.display="none";
}
// Manual restaurant entry: no external place-search requests.
function similarName(a,b){
  const normalize=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const x=normalize(a),y=normalize(b);if(!x||!y)return false;if(x===y)return true;
  if(x.length<6||y.length<6)return false;
  const rows=[...Array(y.length+1).keys()];
  for(let i=1;i<=x.length;i++){let prev=rows[0];rows[0]=i;for(let j=1;j<=y.length;j++){const keep=rows[j];rows[j]=Math.min(rows[j]+1,rows[j-1]+1,prev+(x[i-1]===y[j-1]?0:1));prev=keep}}
  return rows[y.length]<=Math.max(1,Math.floor(Math.max(x.length,y.length)*.16));
}
let editorValueRated=true,editorPriceRated=true;
function updateEditorRatingHints(){
 if($("editorValueStatus"))$("editorValueStatus").textContent=editorValueRated?"Value included when service is rated.":"Not rated yet — adjust the value slider to include a rating.";
 if($("editorPriceStatus"))$("editorPriceStatus").textContent=editorPriceRated?"Listed price estimate recorded.":"Price not recorded — adjust this slider only if known.";
}
function resetEditor(){
  editorPasteTarget="restaurant";editingId=null;editingDraftId=null;editorValueRated=true;editorPriceRated=true;$("editorTitle").textContent="Add restaurant";$("editorForm").reset();if($("reco50RatingMode"))$("reco50RatingMode").value="visits";
  setFoodScore(75);setValueScore(70);$("service").value="Average";setPP(25);
  $("international").checked=false;$("itemsEditor").innerHTML="";addItemRow();
  workingPhotos=[];workingLocationImage="";locationImageEdited=false;setLocationImagePreview("");
  $("placeSearchResults").innerHTML="";$("googleMapsUrl").value="";resetPlaceSelection();prepareWorkingVisits(null);
  document.querySelectorAll(".vibe-check input").forEach(x=>x.checked=false);
  $("deleteBtn").style.visibility="hidden";$("pasteZone").textContent="Click here, then press Ctrl+V / Cmd+V to paste a copied image";updateEditorRatingHints();photoPreview();
}
function edit(id){
  editorPasteTarget="restaurant";const e=entries.find(x=>x.id===id);if(!e)return;
  editingId=id;editingDraftId=null;$("editorTitle").textContent="Edit restaurant";if($("reco50Group"))$("reco50Group").value=e.group||'';if($("reco50RatingMode"))$("reco50RatingMode").value=e.ratingMode||'manual';
  $("restaurant").value=e.restaurant;$("cuisine").value=e.cuisine;setFoodScore(e.manualFoodScore??e.foodScore);
  setValueScore(e.valueScore===null?70:e.valueScore);$("service").value=e.service;setPP(e.pp);
  editorValueRated=e.valueScore!==null;editorPriceRated=e.pp!==null;updateEditorRatingHints();
  $("international").checked=!!e.international;$("location").value=e.location;$("notes").value=e.notes;
  $("itemsEditor").innerHTML="";e.items.forEach(addItemRow);if(!e.items.length)addItemRow();
  workingPhotos=[...e.photos];locationImageEdited=false;workingLocationImage=getLocationImage(e.location);setLocationImagePreview(workingLocationImage);
  $("placeSearchResults").innerHTML="";resetPlaceSelection();prepareWorkingVisits(e);
  document.querySelectorAll(".vibe-check input").forEach(x=>x.checked=e.vibes.includes(x.value));
  $("deleteBtn").style.visibility="visible";$("pasteZone").textContent="Click here, then press Ctrl+V / Cmd+V to paste another image";
  photoPreview();setEditorStep(1);$("editor").showModal();
}
function imageToData(file,max=1000,q=.76){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>{const img=new Image();img.onload=()=>{let w=img.width,h=img.height,s=Math.min(1,max/Math.max(w,h));w=Math.round(w*s);h=Math.round(h*s);const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(img,0,0,w,h);resolve(c.toDataURL("image/jpeg",q))};img.onerror=reject;img.src=fr.result};fr.onerror=reject;fr.readAsDataURL(file)})}
async function addImageFiles(files){
  let added=0;
  for(const f of [...files]){
    if(f && f.type && f.type.startsWith("image/")){
      workingPhotos.push(await imageToData(f));
      added++;
    }
  }
  if(added){
    photoPreview();
    const zone=$("pasteZone");
    zone.textContent=added===1?"Image pasted — paste another or upload more":`${added} images added — paste or upload more`;
    zone.classList.add("paste-ok");
    setTimeout(()=>zone.classList.remove("paste-ok"),900);
  }
  return added;
}
async function addLocationImageFile(file){
  if(!file)return; const src=await imageToData(file,1200,.78); setLocationImagePreview(src,true);
}

async function handleImagePaste(ev){
  if(!$('editor').open)return;
  const imageItems=[...(ev.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/'));
  if(!imageItems.length)return;
  const target=ev.target?.closest?.('#locationPasteZone,#pasteZone');
  const destination=target?.id==='locationPasteZone'?'location':target?.id==='pasteZone'?'restaurant':editorPasteTarget;
  ev.preventDefault();ev.stopPropagation();
  try{
    if(destination==='location'){
      await addLocationImageFile(imageItems[0].getAsFile());$('locationPasteZone').textContent='Location image pasted ✓';
    }else{
      await addImageFiles(imageItems.map(i=>i.getAsFile()).filter(Boolean));
    }
  }catch(err){alert('Could not paste image: '+err.message)}
}
async function saveEntry(ev){
  ev.preventDefault();const old=editingId?entries.find(e=>e.id===editingId):null;
  const name=$("restaurant").value.trim(),location=$("location").value.trim();
  const pid=window.recoGoogleSelection?.(name,old?.googlePlaceId)||'';const possibleDuplicate=entries.find(x=>x.id!==editingId&&((pid&&x.googlePlaceId===pid)||(similarName(x.restaurant,name)&&location&&x.location&&locationKey(x.location)===locationKey(location))));
  if(possibleDuplicate&&!confirm(`“${possibleDuplicate.restaurant}” at this location looks like the same restaurant already in your collection. Save a separate entry anyway?`))return;
  const items=[...document.querySelectorAll(".item-edit")].map(r=>({name:r.querySelector(".dish-name").value.trim(),rating:recordedDishScore(r.querySelector(".dish-rating").value),categories:normalizeDishCategoryNames(r.querySelector(".dish-categories-input")?.value||""),category:normalizeDishCategoryNames(r.querySelector(".dish-categories-input")?.value||"")[0]||"",photo:r.dataset.photo||""})).filter(i=>i.name);
  if(old&&!confirmDishOverlap(overlappingDishNames(old.id,items.filter(i=>!(old.items||[]).some(x=>reviewDishName(x.name)===reviewDishName(i.name))),'review')))return;
  prefs.dishCategories=normalizeDishCategoryNames([...(prefs.dishCategories||[]),...items.flatMap(i=>i.categories)]);savePrefs();
  const vibes=[...document.querySelectorAll(".vibe-check input:checked")].map(x=>x.value);
  if(workingVisits.some(v=>v.foodValue===undefined||v.spend===undefined)){notify('Check visit amounts: only non-negative numbers are allowed.','error');return}
  const rememberedDates=workingVisits.map(v=>v.date).filter(Boolean).sort();
  let e=normalise({id:editingId||uid(),restaurant:name,cuisine:$("cuisine").value.trim(),foodScore:Number($("foodScore").value),manualFoodScore:Number($("foodScore").value),ratingMode:$("reco50RatingMode")?.value||'manual',group:$("reco50Group")?.value||'',valueScore:editorValueRated?Number($("valueScore").value):null,valueScale:100,items,battleHistory:old?.battleHistory||[],service:$("service").value,vibes,pp:editorPriceRated?Number($("pp").value):null,dateVisited:rememberedDates[0]||"",manualVisitCount:workingVisits.length,international:$("international").checked,location,notes:$("notes").value.trim(),photos:workingPhotos,
    placeSource:old?.placeSource||"",osmType:old?.osmType||"",osmId:old?.osmId||"",placeAddress:old?.placeAddress||"",googlePlaceId:window.recoGoogleSelection?.(name,old?.googlePlaceId)||"",googleMapsUrl:"",latitude:old?.latitude??null,longitude:old?.longitude??null,
    createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
  try{
    const prev=restaurantVisits(e.id),nextIds=new Set(workingVisits.map(v=>v.id));
    const next=workingVisits.map(v=>normaliseVisit({...v,restaurantId:e.id,updatedAt:new Date().toISOString()}));e=reco50RateEntry(e,next);
    const recovery=editingId?buildRecoverySnapshot('Before editing a restaurant'):null;
    const ops=[...(recovery?[[SNAPSHOTS,'put',recovery]]:[]),[RESTAURANTS,'put',e],...prev.filter(v=>!nextIds.has(v.id)).map(v=>[VISITS,'delete',v.id]),...next.map(v=>[VISITS,'put',v])];
    let rec=null;
    if(e.location&&locationImageEdited){rec=normaliseLocationRecord({id:e.location,image:workingLocationImage,updatedAt:new Date().toISOString()});ops.push([LOCATIONS,'put',rec])}
    await mutateStores(ops);
    entries=entries.filter(x=>x.id!==e.id).concat(e);
    visits=visits.filter(v=>v.restaurantId!==e.id).concat(next);
    if(rec)locationMedia=locationMedia.filter(x=>x.id!==rec.id).concat(rec);
    if(editingDraftId){if(writeDrafts(readDrafts().filter(d=>d.id!==editingDraftId)))editingDraftId=null}
    render();$("editor").close();notify('Restaurant saved to your collection.');
  }catch(err){console.error(err);alert("Couldn't save the restaurant or visits: "+err.message)}
}
async function deleteEntry(){
 if(!editingId||!confirm('Delete this restaurant memory?'))return;
 const id=editingId,undoRecord={entry:clone(entries.find(e=>e.id===editingId)),visits:clone(visits.filter(v=>v.restaurantId===editingId)),memberships:lists.filter(l=>l.restaurantIds.includes(editingId)).map(l=>({id:l.id,index:l.restaurantIds.indexOf(editingId)}))},updatedLists=lists.map(l=>l.restaurantIds.includes(id)?{...l,restaurantIds:l.restaurantIds.filter(rid=>rid!==id),updatedAt:new Date().toISOString()}:l);
 const snap=buildRecoverySnapshot('Before deleting a restaurant');const ops=[...(snap?[[SNAPSHOTS,'put',snap]]:[]),[RESTAURANTS,'delete',id],...visits.filter(v=>v.restaurantId===id).map(v=>[VISITS,'delete',v.id]),...updatedLists.filter(l=>lists.find(x=>x.id===l.id)!==l).map(l=>[LISTS,'put',l])];
 try{await mutateStores(ops);entries=entries.filter(e=>e.id!==id);if(Array.isArray(prefs.shareDrafts)){prefs.shareDrafts=prefs.shareDrafts.filter(r=>r&&r.id!==String(id));savePrefs()}visits=visits.filter(v=>v.restaurantId!==id);lists=updatedLists;reco50Undo=undoRecord;$('editor').close();render();notify('Restaurant deleted. Undo is available on Home until this session ends.')}catch(error){notify('Delete failed; collection was not changed.','error');console.error(error)}
}
function syncControls(){const f=prefs.filters,g=prefs.graph.filters;$("filterLocation").value=f.location||"";$("filterCuisine").value=f.cuisine||"";$("filterVibe").value=f.vibe||"";$("filterRegion").value=f.region||"";$("filterService").value=f.service||"";$("filterMinScore").value=f.minScore??"";$("filterMinValue").value=f.minValue??"";$("filterMaxSpend").value=f.maxSpend??"";$("sortProperty").value=prefs.sortProperty||"grandRank";$("sortDirection").value=prefs.sortDirection||"asc";$("graphFitMode").value=prefs.graph.fitMode||"off";$("graphFilterLocation").value=g.location||"";$("graphFilterCuisine").value=g.cuisine||"";$("graphFilterRegion").value=g.region||"";$("graphFilterMinFood").value=g.minFood??"";$("graphFilterMinOverall").value=g.minOverall??""}

function openNewList(){editingListId=null;$("listDialogTitle").textContent="Create list";$("listName").value="";$("listDescription").value="";$("reco50ListType").value="ranked";$("deleteListBtn").style.visibility="hidden";$("listDialog").showModal()}
function openEditList(id){const l=lists.find(x=>x.id===id);if(!l)return;editingListId=id;$("listDialogTitle").textContent="Edit list";$("listName").value=l.name;$("listDescription").value=l.description;$("reco50ListType").value=l.ranked===false?"unranked":"ranked";$("deleteListBtn").style.visibility="visible";$("listDialog").showModal()}
async function saveList(){
  const name=$("listName").value.trim();if(!name){alert("Give the list a name.");return}
  const old=editingListId?lists.find(l=>l.id===editingListId):null;
  const l=normaliseList({id:editingListId||uid(),name,description:$("listDescription").value.trim(),ranked:$("reco50ListType").value==="ranked",restaurantIds:old?.restaurantIds||[],createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
  await putStore(LISTS,l);lists=lists.filter(x=>x.id!==l.id).concat(l);prefs.activeListId=l.id;savePrefs();$("listDialog").close();render()
}
async function deleteList(){if(!editingListId||!confirm("Delete this custom list?"))return;await delStore(LISTS,editingListId);lists=lists.filter(l=>l.id!==editingListId);if(prefs.activeListId===editingListId)prefs.activeListId=lists[0]?.id||null;savePrefs();$("listDialog").close();render()}
async function addSelectedRestaurantToList(listId){const sel=$("addRestaurantSelect");if(!sel?.value)return;const l=lists.find(x=>x.id===listId);if(!l||l.restaurantIds.includes(sel.value))return;l.restaurantIds.push(sel.value);l.updatedAt=new Date().toISOString();await putStore(LISTS,l);render()}
async function moveListItem(listId,index,dir){const l=lists.find(x=>x.id===listId);if(!l)return;const ni=index+dir;if(ni<0||ni>=l.restaurantIds.length)return;[l.restaurantIds[index],l.restaurantIds[ni]]=[l.restaurantIds[ni],l.restaurantIds[index]];l.updatedAt=new Date().toISOString();await putStore(LISTS,l);render()}
async function removeFromList(listId,rid){const l=lists.find(x=>x.id===listId);if(!l)return;l.restaurantIds=l.restaurantIds.filter(id=>id!==rid);l.updatedAt=new Date().toISOString();await putStore(LISTS,l);render()}

const BACKUP_MARK_KEY="recolleat-last-export-prepared-v42";
const BACKUP_FINGERPRINT_KEY="recolleat-backup-fingerprint-v47";
function journalFingerprint(){
  // A non-cryptographic change detector, not a proof of backup integrity.
  const rows=[...entries.map(e=>['r',e.id,e.updatedAt,e.foodScore,e.manualFoodScore,e.ratingMode,e.group,e.valueScore,e.service,e.items?.length,e.photos?.length,e.notes]),
    ...visits.map(v=>['v',v.id,v.updatedAt,v.spend,v.foodValue,v.paidFor,v.foodRating,v.dishes?.length,v.photos?.length,v.note]),
    ...lists.map(l=>['l',l.id,l.updatedAt,l.ranked,l.restaurantIds]),
    ...locationMedia.map(r=>['location',r.id,r.updatedAt,r.image?.length]),
    ...readDrafts().map(d=>['d',d.id,d.updatedAt])].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  const text=JSON.stringify({rows,profile,earnedRewardLevels,categories:prefs.dishCategories||[],hiddenCategories:prefs.hiddenDishCategories||[]});let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return String(hash>>>0)+':'+rows.length;
}
function renderBackupStatus(){
  const el=$('v42BackupStatus');if(!el)return;const home=$('reco50BackupStatus');if(home)queueMicrotask(()=>{home.textContent=el.textContent});
  let last=null;try{last=localStorage.getItem(BACKUP_MARK_KEY)}catch{}
  const stamp=last?new Date(last):null;
  if(!stamp||Number.isNaN(stamp.getTime())){el.textContent='No backup prepared on this device. Export and keep a copy elsewhere.';return}
  let previous='';try{previous=localStorage.getItem(BACKUP_FINGERPRINT_KEY)||''}catch{}
  const changed=previous&&previous!==journalFingerprint();
  const age=Math.floor((Date.now()-stamp.getTime())/86400000);
  const when=stamp.toLocaleDateString('en-GB');
  el.textContent=changed?`Your journal changed since the backup prepared on ${when}. Export a fresh copy.`:
    age>=30?`Your last backup was prepared ${age} days ago. Export a fresh copy.`:
    `Last backup prepared: ${when}. ${previous?'No record changes detected.':'Export again to enable change checking.'} Keep a copy outside this device.`;
}
function assertMediaAvailableForBackup(records){
  const check=source=>{
    if(typeof source==='string'&&source.startsWith('media:')&&!mediaById.has(source.slice(6)))
      throw new Error('A stored photograph could not be found. Backup cancelled to avoid losing an image.');
  };
  for(const record of records){
    for(const source of record.photos||[])check(source);
    for(const dish of record.items||[])check(dish?.photo);
    for(const dish of record.dishes||[])check(dish?.photo);
    check(record.image);check(record.photo);
  }
}
async function exportBackup(){
  try{
    if(!db)throw new Error('Local database is unavailable. Export cancelled to prevent an empty or incomplete backup.');
    const [savedEntries,savedLists,savedVisits,savedLocations]=await Promise.all([allStore(RESTAURANTS),allStore(LISTS),allStore(VISITS),allStore(LOCATIONS)]);
    assertMediaAvailableForBackup([...savedEntries,...savedVisits,...savedLocations]);
    const payload={app:'Recolleat Local',version:16,exportedAt:new Date().toISOString(),entries:savedEntries.map(hydrateMediaRecord),lists:savedLists,visits:savedVisits.map(hydrateMediaRecord),locations:savedLocations.map(hydrateMediaRecord),dishCategories:prefs.dishCategories,hiddenDishCategories:prefs.hiddenDishCategories,profile,drafts:readDrafts(),earnedThemes:earnedRewardLevels,rankingWeights:{...prefs.labWeights}};
    // Check that the actual serialised file can be parsed and has matching record counts.
    const data=JSON.stringify(payload,null,2),verified=validateBackup(JSON.parse(data));
    if(verified.entries.length!==savedEntries.length||verified.visits.length!==savedVisits.length||verified.drafts.length!==payload.drafts.length)throw new Error('Backup verification failed. Nothing was downloaded.');
    const blob=new Blob([data],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`recolleat-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
    try{localStorage.setItem(BACKUP_MARK_KEY,new Date().toISOString());localStorage.setItem(BACKUP_FINGERPRINT_KEY,journalFingerprint())}catch{}
    renderBackupStatus();renderV44Pulse();notify('Backup prepared from saved records. Verify the file in Downloads and keep a separate copy.');
  }catch(error){notify('Backup was not prepared: '+error.message,'error');console.error(error)}
}
// Validate a backup *before* presenting destructive actions or touching any stored records.
// Legacy array-only Palate backups continue to work.
function validateBackup(raw){
  if(!raw||typeof raw!=='object')throw new Error('Expected a JSON object or legacy restaurant array.');
  const legacy=Array.isArray(raw),source=legacy?{entries:raw}:raw;
  if(!legacy&&source.app&&typeof source.app==='string'&&!/recolleat|palate/i.test(source.app))throw new Error('This file identifies another application.');
  const collections=['entries','lists','visits','locations','drafts','dishCategories','hiddenDishCategories','earnedThemes'];
  for(const name of collections){if(source[name]!==undefined&&!Array.isArray(source[name]))throw new Error('Invalid '+name+' collection in backup.');}
  if(!Array.isArray(source.entries))throw new Error('The backup has no restaurant collection.');
  const limits={entries:15000,lists:5000,visits:120000,locations:15000,drafts:250,dishCategories:2000,hiddenDishCategories:2000,earnedThemes:4};
  for(const name of collections){if((source[name]?.length||0)>limits[name])throw new Error('Unusually large '+name+' collection. Import cancelled.');}
  for(const [name,field] of [['entries','restaurant'],['lists','name'],['drafts','name']]){
    const seen=new Set();for(const record of source[name]||[]){
      if(!record||typeof record!=='object'||Array.isArray(record)||typeof record[field]!=='string'||!record[field].trim())throw new Error('Invalid '+name+' record: missing '+field+'.');
      if(record.id!==undefined&&(typeof record.id!=='string'||!record.id.trim()))throw new Error('Invalid record identifier in '+name+'.');
      if(record.id){if(seen.has(record.id))throw new Error('Duplicate record identifier in '+name+'.');seen.add(record.id)}
    }
  }
  for(const name of ['visits','locations'])for(const record of source[name]||[]){if(!record||typeof record!=='object'||Array.isArray(record))throw new Error('Invalid '+name+' record.');}
  // V42 backups have only personal spend; V43 adds optional foodValue and paidFor.
  // Reject corrupt monetary values before starting the all-or-nothing database transaction.
  for(const record of source.visits||[]){
    for(const field of ['spend','foodValue']){
      const value=record[field];
      if(value!==undefined&&value!==null&&value!==''&&(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>10000000))throw new Error('Invalid '+field+' in a visit record.');
    }
    if(record.paidFor!==undefined&&typeof record.paidFor!=='boolean')throw new Error('Invalid paidFor flag in a visit record.');
    if(record.foodRating!==undefined&&record.foodRating!==null&&(!Number.isFinite(Number(record.foodRating))||Number(record.foodRating)<0||Number(record.foodRating)>100))throw new Error('Invalid food rating in a visit.');
    if(record.dishes!==undefined&&(!Array.isArray(record.dishes)||record.dishes.some(i=>!i||typeof i.name!=='string'||!i.name.trim()||i.photo?.startsWith?.('media:'))))throw new Error('Invalid visit dishes.');
    if(record.photos!==undefined&&(!Array.isArray(record.photos)||record.photos.some(x=>typeof x==='string'&&x.startsWith('media:'))))throw new Error('Invalid visit photographs.');
  }
  for(const e of source.entries){
    for(const field of ['foodScore','manualFoodScore','valueScore','pp']){
      if(e[field]!==null&&e[field]!==undefined&&e[field]!==''&&!Number.isFinite(Number(e[field])))throw new Error('Invalid '+field+' in a restaurant record.');
    }
    if(e.items!==undefined&&(!Array.isArray(e.items)||e.items.some(i=>i?.photo?.startsWith?.('media:'))))throw new Error('Invalid dishes collection in restaurant '+e.restaurant);
    if(e.photos!==undefined&&!Array.isArray(e.photos))throw new Error('Invalid photographs collection in restaurant '+e.restaurant);
    if((e.photos||[]).some(x=>typeof x==='string'&&x.startsWith('media:')))throw new Error('Backup contains unresolved photograph references. Export from the app again.');
  }
  if(source.profile!==undefined&&source.profile!==null&&(typeof source.profile!=='object'||Array.isArray(source.profile)))throw new Error('Invalid profile in backup.');
  if(source.earnedThemes&&source.earnedThemes.some(n=>![10,20,30,40].includes(n)))throw new Error('Invalid earned theme levels in backup.');
  let rankingWeights=null, weightsWarning=source.weightsWarning===true;
  if(source.rankingWeights!=null){
    const w=source.rankingWeights;
    if(w&&typeof w==='object'&&!Array.isArray(w)&&['food','value','service'].every(k=>typeof w[k]==='number'||(typeof w[k]==='string'&&w[k].trim()!==''))){
      const candidate=Object.fromEntries(['food','value','service'].map(k=>[k,Number(w[k])]));
      if(Object.values(candidate).every(v=>Number.isInteger(v)&&v>=0&&v<=100)&&candidate.food+candidate.value+candidate.service===100)rankingWeights=candidate;
    }
    if(!rankingWeights)weightsWarning=true;
  }
  return {entries:source.entries,lists:source.lists||[],visits:source.visits||[],locations:source.locations||[],drafts:source.drafts||[],dishCategories:source.dishCategories||[],hiddenDishCategories:source.hiddenDishCategories||[],profile:source.profile||null,earnedThemes:source.earnedThemes||[],rankingWeights,weightsWarning,legacy:legacy||source.legacy===true||source.version===undefined};
}
function normalizeImportedDraft(d){
  const id=d.id||uid();return {id,name:d.name.trim().slice(0,120),cuisine:String(d.cuisine||'').slice(0,80),location:String(d.location||'').slice(0,120),foodScore:d.foodScore===null||d.foodScore===undefined?null:Number(d.foodScore),valueScore:d.valueScore===undefined||d.valueScore===null?null:Number(d.valueScore),service:String(d.service||'Average'),pp:d.pp===undefined||d.pp===null?null:Number(d.pp),international:!!d.international,vibes:Array.isArray(d.vibes)?d.vibes:[],items:Array.isArray(d.items)?d.items:[],visits:Array.isArray(d.visits)?d.visits:[],photos:Array.isArray(d.photos)?d.photos:[],locationPhoto:String(d.locationPhoto||''),notes:String(d.notes||'').slice(0,10000),updatedAt:d.updatedAt||new Date().toISOString()};
}
function newerOrSame(incoming,previous){
 const a=Date.parse(incoming.updatedAt||''),b=Date.parse(previous.updatedAt||'');
 return !Number.isFinite(a)||!Number.isFinite(b)||a>=b;
}
function mergeRecords(existing,incoming,replace){
 const map=new Map((replace?[]:existing).map(x=>[x.id,x]));
 for(const record of incoming){const old=map.get(record.id);if(!old||newerOrSame(record,old))map.set(record.id,record)}
 return [...map.values()];
}
async function importData(mode){
 if(!pendingImport||!['merge','replace'].includes(mode))return;
 if(mode==='replace'&&(entries.length||visits.length||readDrafts().length)&&!$('recoReplaceConsent').checked){notify('Download your current backup and confirm before replacing.','error');return}
 if(mode==='replace'&&!confirm('Replace all local Recolleat data with this backup? This cannot be undone without a saved backup.'))return;
 const btns=[$('mergeImport'),$('replaceImport')];btns.forEach(b=>b.disabled=true);
 try{
  if(!db)throw new Error('Journal storage is not available; no import was attempted.');
  // All validation and normalisation complete before any destructive write.
  const data=validateBackup(pendingImport);
  const staged={
    entries:mergeRecords(entries,data.entries.map(normalise),mode==='replace'),
    lists:mergeRecords(lists,data.lists.map(normaliseList),mode==='replace'),
    visits:mergeRecords(visits,data.visits.map(normaliseVisit),mode==='replace'),
    locations:mergeRecords(locationMedia,data.locations.map(normaliseLocationRecord),mode==='replace')
  };
  const dishCategories=normalizeDishCategoryNames(mode==='replace'?data.dishCategories:[...(prefs.dishCategories||[]),...data.dishCategories]);
  const hiddenDishCategories=normalizeDishCategoryNames(mode==='replace'?data.hiddenDishCategories:[...(prefs.hiddenDishCategories||[]),...data.hiddenDishCategories]);
  const nextPrefs={...prefs,dishCategories,hiddenDishCategories,labWeights:mode==='replace'?(data.rankingWeights||prefs.labWeights):prefs.labWeights};
  const incomingProfile={username:typeof data.profile?.username==='string'?data.profile.username.slice(0,30):'',photo:typeof data.profile?.photo==='string'&&data.profile.photo.startsWith('data:image/')?data.profile.photo:'',banner:cleanBanner(data.profile?.banner),wishlist:cleanWishlist(data.profile?.wishlist)};
  const nextProfile=mode==='replace'?incomingProfile:(profile.username||profile.photo||profile.wishlist?.length?{...profile,wishlist:cleanWishlist([...(profile.wishlist||[]),...(incomingProfile.wishlist||[])])}:incomingProfile);
  const existingDrafts=mode==='replace'?[]:readDrafts();
  const draftMap=new Map(existingDrafts.map(d=>[d.id,d]));
  for(const d of data.drafts){const normalized=normalizeImportedDraft(d);const old=draftMap.get(normalized.id);if(!old||newerOrSame(normalized,old))draftMap.set(normalized.id,normalized)}
  if(draftMap.size>250)throw new Error('Too many drafts to restore safely.');
  const restoredLevels=[...new Set([...(mode==='replace'?[]:earnedRewardLevels),...data.earnedThemes,...[10,20,30,40].filter(n=>staged.entries.length>=n)])].sort((a,b)=>a-b);
  const storageUpdates=[[PREF_KEY,JSON.stringify(nextPrefs)],[PROFILE_KEY,JSON.stringify(nextProfile)],[DRAFT_KEY,JSON.stringify([...draftMap.values()])],[REWARDS_KEY,JSON.stringify(restoredLevels)]];
  const prior=new Map();const applied=[];
  try{
    // Preflight all localStorage fields before touching the database. If the
    // database transaction aborts, restore those fields to their old values.
    for(const [key,value] of storageUpdates){prior.set(key,localStorage.getItem(key));localStorage.setItem(key,value);applied.push(key)}
    const snap=buildRecoverySnapshot('Before '+mode+' import');const ops=[];
    if(snap)ops.push([SNAPSHOTS,'put',snap]);
    if(mode==='replace')ops.push([MEDIA,'clear']);
    const tableMap=[[RESTAURANTS,staged.entries],[LISTS,staged.lists],[VISITS,staged.visits],[LOCATIONS,staged.locations]];
    // Database changes across all four stores are one atomic transaction.
    for(const [table,rows] of tableMap){
      if(mode==='replace')ops.push([table,'clear']);
      for(const row of rows)ops.push([table,'put',row]);
    }
    await mutateStores(ops);
  }catch(error){
    for(const key of applied.reverse()){try{const previous=prior.get(key);if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous)}catch(rollbackError){console.error('Local preference rollback failed',rollbackError)}}
    throw error;
  }
  reco50Undo=null;entries=staged.entries;lists=staged.lists;visits=staged.visits;locationMedia=staged.locations;prefs=nextPrefs;profile=nextProfile;earnedRewardLevels=restoredLevels;
  pendingImport=null;$('importDialog').close();render();renderDrafts();renderBackupStatus();notify('Backup restored: restaurants, visits, lists, photos and drafts.');
 }catch(error){console.error('Import was cancelled or rolled back',error);notify('Import failed; your journal was not overwritten.','error');alert('Recolleat did not complete the import: '+error.message)}
 finally{btns.forEach(b=>b.disabled=false)}
}
/* Global scoring preferences recalculate ranking views without rewriting source ratings. */
function labWeights(){return prefs.labWeights||DEFAULT_PREFS.labWeights}
function labScoreRaw(e){return overallScoreRaw(e)}
function labSorted(){return [...entries].sort((a,b)=>{
  const x=labScoreRaw(a),y=labScoreRaw(b);
  if(x===null)return y===null?a.restaurant.localeCompare(b.restaurant):1;
  if(y===null)return -1;
  return y-x || b.foodScore-a.foodScore || a.restaurant.localeCompare(b.restaurant);
})}
function readLabWeightInputs(){
  const fields=['labFood','labValue','labService'];const values=fields.map(id=>$(id).value.trim());
  if(values.some(v=>v==='' || !/^\d+$/.test(v)))return {ok:false,message:'Enter whole numbers for all three weights.'};
  const nums=values.map(Number);if(nums.some(v=>v<0||v>100))return {ok:false,message:'Each weight must be from 0 to 100.'};
  const total=nums.reduce((a,b)=>a+b,0);
  if(total!==100)return {ok:false,message:`Weights currently total ${total}%. They must add to exactly 100% before applying.`,total};
  return {ok:true,weights:{food:nums[0],value:nums[1],service:nums[2]},total};
}
function updateLabValidity(){
  const result=readLabWeightInputs();const status=$('labTotal');status.textContent=result.ok?'Ready: 100%. Apply to update every ranking.':result.message;
  status.style.color=result.ok?'var(--accent)':'#e48b82';$('labSubmit').disabled=!result.ok;
}
function submitLabWeights(ev){ev.preventDefault();const result=readLabWeightInputs();if(!result.ok){updateLabValidity();return}prefs.labWeights=result.weights;savePrefs();render();renderLab();notify('Ranking weights updated throughout your journal.');}
function labCuisineRanks(sorted){
  const rank=new Map(sorted.map((e,i)=>[e.id,i+1])),groups=new Map();
  for(const e of entries){const c=e.cuisine.trim()||"Uncategorised";if(!groups.has(c))groups.set(c,[]);groups.get(c).push(rank.get(e.id))}
  const medianOf=xs=>{const s=[...xs].sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2};
  return [...groups].filter(([,r])=>r.length>=3).map(([cuisine,r])=>({cuisine,count:r.length,median:medianOf(r),average:r.reduce((a,b)=>a+b,0)/r.length})).sort((a,b)=>a.median-b.median||a.average-b.average||a.cuisine.localeCompare(b.cuisine));
}
function renderLab(){
  const w=labWeights();
  for(const [k,id] of [["food","labFood"],["value","labValue"],["service","labService"]]){$(id).value=w[k]}
  updateLabValidity();
  const sorted=labSorted(),original=grandRankMap();
  const eligible=sorted.filter(e=>labScoreRaw(e)!==null);
  $("labTopRestaurants").innerHTML=leaderboardStage(eligible.map(e=>({id:e.id,name:e.restaurant,sub:e.cuisine||"Uncategorised",image:e.photos?.[0]||getLocationImage(e.location),metric:`${roundToTwoSigFigs(labScoreRaw(e))} pts`})),"RESTAURANT",false);
  const cuisineRows=labCuisineRanks(sorted).map(c=>{
    const sample=entries.filter(e=>e.cuisine===c.cuisine).sort((a,b)=>(labScoreRaw(b)??-1)-(labScoreRaw(a)??-1))[0];
    return {name:c.cuisine,sub:`${c.count} restaurants`,metric:`Median #${roundToTwoSigFigs(c.median)}`,image:sample?.photos?.[0]||getLocationImage(sample?.location)};
  });
  $("labCuisinePodium").innerHTML=leaderboardStage(cuisineRows,"CUISINE",false);

}
/* Dish Universe reuses the already-saved restaurant dishes and never duplicates entries. */
function dishCategory(item){
  if(item.category&&item.category.trim())return item.category.trim();
  const n=String(item.name||"").toLowerCase();
  const rules=[
    ["Burger",/\b(burger|cheeseburger|hamburger|smash)\b/],
    ["Pizza",/\b(pizza|margherita|pepperoni|calzone)\b/],
    ["Kebab",/\b(kebab|shawarma|doner|döner|gyros|souvlaki)\b/],
    ["Steak",/\b(steak|ribeye|sirloin|fillet mignon|filet mignon|tomahawk)\b/],
    ["Sushi",/\b(sushi|sashimi|nigiri|maki|uramaki)\b/],
    ["Curry",/\b(curry|tikka|korma|biryani|vindaloo|masala)\b/],
    ["Pasta",/\b(pasta|spaghetti|carbonara|lasagn\w*|ravioli|gnocchi|tagliatelle)\b/],
    ["Dessert",/\b(cake|ice cream|gelato|tiramisu|baklava|brownie|pudding|cheesecake|waffle|churros|mousse|cookie)\b/],
    ["Seafood",/\b(fish|prawn|shrimp|lobster|salmon|oyster|calamari|squid|crab)\b/],
    ["Breakfast",/\b(breakfast|pancake|omelette|eggs benedict|french toast)\b/],
    ["Sandwich",/\b(sandwich|panini|toastie|bagel|bánh mì|banh mi)\b/],
    ["Noodles",/\b(ramen|udon|noodle|pho|pad thai)\b/],
    ["Salad",/\b(salad|tabbouleh|fattoush)\b/]
  ];
  return rules.find(([,re])=>re.test(n))?.[0]||"Other dishes";
}
function dishRecords(){
 const legacy=entries.flatMap(e=>(e.items||[]).map((item,index)=>({item,e,index,key:`restaurant:${e.id}:${index}`,categories:dishCategoriesForItem(item),score:recordedDishScore(item.rating),source:'review'})).filter(d=>d.item.name?.trim()));
 const byId=new Map(entries.map(e=>[e.id,e]));
 const logged=visits.flatMap(v=>(v.dishes||[]).map((item,index)=>({item,e:byId.get(v.restaurantId),index,key:`visit:${v.id}:${item.id||index}`,visitId:v.id,date:v.date,categories:dishCategoriesForItem(item),score:recordedDishScore(item.rating),source:'visit'})).filter(d=>d.e&&d.item.name?.trim()));
 return [...legacy,...logged];
}
function recordedDishScore(raw){if(raw===null||raw===undefined||String(raw).trim()==='')return null;const n=Number(raw);return Number.isFinite(n)&&n>=0&&n<=10?n:null}
function allDishes(){return dishRecords().filter(d=>d.score!==null)}
function reviewDishName(raw){return String(raw||'').trim().toLowerCase().replace(/\s+/g,' ')}
function overlappingDishNames(id,items,source){
 const existing=source==='review'?visits.filter(v=>v.restaurantId===id).flatMap(v=>v.dishes||[]):(entries.find(e=>e.id===id)?.items||[]);
 const names=new Set(existing.map(i=>reviewDishName(i.name)));return [...new Set(items.filter(i=>names.has(reviewDishName(i.name))).map(i=>i.name))];
}
function confirmDishOverlap(names){return !names.length||confirm(`Already recorded in the other dish-entry area: ${names.join(', ')}. If this is the same meal, edit the original instead. Save as separate dish records?`)}
function dishRarity(score){const n=Math.max(0,Math.min(10,Number(score)||0));if(n>=10)return "food_legend";if(n>=9)return "unforgettable";if(n>=8)return "house_favourite";if(n>=7)return "crave_worthy";if(n>=6)return "everyday";if(n>=5)return "average";if(n>=4)return "one_time";if(n>=3)return "terrible";if(n>=2)return "scam";return "torture";}
const DISH_RARITY_LABELS={"food_legend":"Food of Legend","unforgettable":"Unforgettable","house_favourite":"House Favourite","crave_worthy":"Crave Worthy","everyday":"Everyday","average":"Average","one_time":"Just the one time","terrible":"Terrible","scam":"Scam","torture":"Potential Torture"};
function renderDishes(){
  const all=allDishes(),q=$('dishSearch').value.trim().toLowerCase(),selected=$('dishCategoryFilter').value,rarityFilter=$('dishRarityFilter').value,sort=$('dishSort').value;
  if(q||selected||rarityFilter)$('hallAccordion').dataset.compact='false';
  const toggle=$('toggleDishRanking');if(toggle){const compact=$('hallAccordion').dataset.compact==='true';toggle.hidden=all.length<=5;toggle.textContent=compact?`Show all ${all.length} dishes`:'Show top 5';toggle.setAttribute('aria-expanded',String(!compact));}
  const categories=dishCategoryCatalog();
  renderDishCategoryManager();
  $('dishCategoryFilter').innerHTML='<option value="">All categories</option>'+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('dishCategoryFilter').value=categories.includes(selected)?selected:'';
  const restSelect=$('dishAddRestaurant').value;
  $('dishAddRestaurant').innerHTML='<option value="">Select restaurant</option>'+[...entries].sort((a,b)=>a.restaurant.localeCompare(b.restaurant)).map(e=>`<option value="${esc(e.id)}">${esc(e.restaurant)}</option>`).join('');
  if(entries.some(e=>e.id===restSelect))$('dishAddRestaurant').value=restSelect;
  const globalRank=all.slice().sort((a,b)=>b.score-a.score||a.item.name.localeCompare(b.item.name)||a.e.restaurant.localeCompare(b.e.restaurant));
  const rankIndex=new Map(globalRank.map((d,i)=>[d.key,i+1]));
  const collection=all.filter(d=>(!selected||d.categories.some(c=>c.toLowerCase()===selected.toLowerCase()))&&(!rarityFilter||dishRarity(d.score)===rarityFilter)&&(!q||[d.item.name,...d.categories,d.e.restaurant,d.e.cuisine].join(' ').toLowerCase().includes(q)));
  collection.sort((a,b)=>sort==='low'?a.score-b.score||a.item.name.localeCompare(b.item.name):sort==='name'?a.item.name.localeCompare(b.item.name):sort==='restaurant'?a.e.restaurant.localeCompare(b.e.restaurant)||b.score-a.score:b.score-a.score||a.item.name.localeCompare(b.item.name));
  $('dishStats').innerHTML=`<div class="dish-stat"><span>Matching dishes</span><strong>${collection.length}<small> / ${all.length}</small></strong></div><div class="dish-stat"><span>Rated dishes</span><strong>${all.length}</strong></div>`;
  $('hallCount').textContent=`${collection.length} of ${all.length} dishes`;
  const rarityCounts=Object.fromEntries(Object.keys(DISH_RARITY_LABELS).map(k=>[k,0]));all.forEach(d=>rarityCounts[dishRarity(d.score)]++);
  const rarityLegend=`<div class="hof-rarity-legend"><button type="button" data-choose-dish-rarity="" class="${!rarityFilter?'active':''}">All · ${all.length}</button>${Object.keys(DISH_RARITY_LABELS).map(r=>`<button type="button" class="${r===rarityFilter?'active':''}" data-choose-dish-rarity="${r}">${DISH_RARITY_LABELS[r]} · ${rarityCounts[r]}</button>`).join('')}</div>`;
  $('hallOfFlavour').innerHTML=`<section class="hof-shell"><div class="hof-head"><div class="reco33-hof-heading"><strong>Ranked dishes</strong><span>${collection.length}</span></div>${rarityLegend}</div><div class="hof-ranking">${collection.length?collection.map(d=>{const r=dishRarity(d.score),img=d.item.photo||d.e.photos?.[0]||getLocationImage(d.e.location),rank=rankIndex.get(d.key);return `<article class="hof-ranking-row ${r}" data-global-dish-rank="${rank}"><div class="hof-position">#${rank}</div><div class="hof-thumb">${img?`<img loading="lazy" src="${esc(img)}" alt="${esc(d.item.name)}">`:'✦'}</div><div class="hof-name"><h3>${esc(d.item.name)}</h3><p><button type="button" class="name-btn" data-open-passport="${esc(d.e.id)}">${esc(d.e.restaurant)}</button></p><div class="hof-row-actions">${d.visitId?`<button type="button" data-edit-visit="${esc(d.visitId)}" aria-label="Edit dish on ${esc(formatVisitDate(d.date))}">Edit visit</button>`:`<button type="button" data-dish-photo="${esc(d.e.id)}" data-dish-index="${d.index}">Photo</button> <button type="button" data-reco33-edit-review="${esc(d.e.id)}">Edit dish</button>`}</div></div><div class="hof-rank-rarity">${DISH_RARITY_LABELS[r]}</div><div class="hof-rank-score">${d.score.toFixed(1)}<small>/10</small></div></article>`}).join(''):`<div class="hof-empty reco-empty-state"><b>${all.length?'No matching dishes':'Your dish collection starts here'}</b><p>${all.length?'Try another category, search or rating tier.':'Add your first restaurant, then record a dish and rating to start your Hall of Flavour.'}</p><button type="button" data-empty-action="${all.length?'clear-dish-filters':'add-restaurant'}">${all.length?'Clear dish filters':'Add a restaurant'}</button></div>`}</div></section>`;
  // Category stamp books show every category containing dishes, independently of the Hall filters.
  const groups=new Map();for(const d of all)for(const cat of d.categories){const name=categories.find(c=>c.toLowerCase()===cat.toLowerCase())||cat;const key=name.toLowerCase();if(!groups.has(key))groups.set(key,{name,items:[]});groups.get(key).items.push(d)}
  const pages=[...groups.values()].filter(g=>g.items.length).sort((a,b)=>b.items.length-a.items.length||a.name.localeCompare(b.name));
  $('dishCategorySectionCount').textContent=`${pages.length} stamp books`;
  $('dishCategoryHighlights').innerHTML=pages.length?pages.map(g=>{const best=[...g.items].sort((a,b)=>b.score-a.score)[0];return `<button type="button" class="dish-stamp-category" data-open-dish-book="${esc(g.name)}"><div class="dish-stamp-cat-title"><b>◈ ${esc(g.name)}</b><span>${g.items.length} stamps</span></div><p>Top dish: ${esc(best.item.name)} · ${best.score.toFixed(1)}/10</p><span class="dish-stamp-action">📖 Open ${esc(g.name)} stamp book →</span></button>`}).join(''):'<div class="hof-empty reco-empty-state"><b>No category collections yet</b><p>Add a category to a rated dish to build your first stamp book.</p><button type="button" data-empty-action="add-restaurant">Add a restaurant</button></div>';
}

function tastePartialPooling(groups, globalValues, minimumN=3){
  const valid=groups.map(g=>({...g,values:(g.values||[]).filter(Number.isFinite)})).filter(g=>g.values.length>=minimumN);
  if(!valid.length)return [];
  const all=(globalValues||[]).filter(Number.isFinite), background=all.length?all:valid.flatMap(g=>g.values);
  const globalMean=background.reduce((s,v)=>s+v,0)/background.length;
  const floorVariance=Math.pow(Math.max(0.1,(Math.max(...background)-Math.min(...background))/25),2);
  let residual=0,withinDf=0;
  const summaries=valid.map(g=>{const n=g.values.length,mean=g.values.reduce((s,v)=>s+v,0)/n;residual+=g.values.reduce((s,v)=>s+(v-mean)**2,0);withinDf+=n-1;return {...g,n,mean}});
  const totalVariance=background.reduce((s,v)=>s+(v-globalMean)**2,0)/Math.max(1,background.length-1);
  const within=Math.max(floorVariance,withinDf?residual/withinDf:totalVariance);
  const center=summaries.reduce((s,g)=>s+g.mean,0)/summaries.length;
  const meanVariance=summaries.reduce((s,g)=>s+(g.mean-center)**2,0)/Math.max(1,summaries.length-1);
  const avgSampling=summaries.reduce((s,g)=>s+within/g.n,0)/summaries.length;
  // Regularized between-group variance prevents unstable all-or-nothing pooling in tiny datasets.
  const between=Math.max(within/8,meanVariance-avgSampling);
  return summaries.map(g=>{const sampleVariance=within/g.n, weight=between/(between+sampleVariance);
    const posterior=globalMean+weight*(g.mean-globalMean), posteriorSd=Math.sqrt(between*sampleVariance/(between+sampleVariance));
    return {...g,posterior,posteriorSd,lower:posterior-1.28155*posteriorSd,shrinkageWeight:weight,globalMean};
  }).sort((a,b)=>b.lower-a.lower||b.posterior-a.posterior||b.n-a.n);
}
function renderSignatureGallery(top,chosen){
  const displayed=top.slice(0,chosen),container=$('dnaHighlights');
  if(!displayed.length){container.innerHTML='<div class="museum-empty"><span>✦</span><h4>Your exhibition starts with a dish.</h4><p>Rate dishes in your restaurant collection to fill this gallery.</p></div>';return}
  signatureGalleryIndex=Math.max(0,Math.min(displayed.length-1,signatureGalleryIndex));
  const selected=displayed[signatureGalleryIndex],count=displayed.length;
  const title=selected.item.name||'Untitled dish';
  const slots=[];
  for(let relative=-3;relative<=3;relative++){
    const i=signatureGalleryIndex+relative;
    if(i<0||i>=count)continue;
    const d=displayed[i],photo=d.item.photo||d.e.photos?.[0]||getLocationImage(d.e.location);
    slots.push(`<button type="button" class="museum-art" data-gallery-go="${i}" data-offset="${relative}" ${relative===0?'aria-current="true"':''} aria-label="View dish ${i+1}: ${esc(d.item.name)}" title="${esc(d.item.name)} · ${d.score.toFixed(1)}/10"><span class="museum-art-frame">${photo?`<img src="${esc(photo)}" loading="lazy" alt="${esc(d.item.name)}">`:'<span class="museum-art-placeholder">✦</span>'}</span><span class="museum-art-no">${String(i+1).padStart(2,'0')}</span></button>`);
  }
  container.innerHTML=`<div class="museum-gallery" id="museumGallery" role="region" aria-label="Signature dish gallery. Scroll to change dishes." tabindex="0">
    <div class="museum-horizon" aria-hidden="true">RECOLLEAT&nbsp;&nbsp; / &nbsp;&nbsp; A PRIVATE COLLECTION</div>
    <div class="museum-side-note museum-side-note-left" aria-hidden="true">THE COLLECTION <span>FOOD / MEMORY / PLACE</span></div>
    <div class="museum-side-note museum-side-note-right" aria-hidden="true">NO. ${String(signatureGalleryIndex+1).padStart(2,'0')} <span>OF ${String(count).padStart(2,'0')}</span></div>
    <div class="museum-gallery-stage">${slots.join('')}</div>
    <div class="museum-caption" aria-live="polite"><span class="museum-caption-eyebrow">SELECTED WORK / ${String(signatureGalleryIndex+1).padStart(2,'0')}—${String(count).padStart(2,'0')}</span>
      <h4>${esc(title)}</h4><p>${esc(selected.e.restaurant)} · ${esc(selected.e.cuisine||'Cuisine unspecified')}</p>
      <div class="museum-caption-bottom"><span class="museum-rating">${selected.score.toFixed(1)}<small> / 10</small></span><button class="museum-restaurant-link" type="button" data-open-passport="${esc(selected.e.id)}">View restaurant ↗</button></div>
    </div>
    <div class="museum-foot"><button type="button" class="museum-arrow" data-gallery-shift="-1" ${signatureGalleryIndex===0?'disabled':''} aria-label="Previous dish">←</button>
      <div class="museum-progress" role="progressbar" aria-label="Gallery position" aria-valuemin="1" aria-valuemax="${count}" aria-valuenow="${signatureGalleryIndex+1}"><span style="width:${100*(signatureGalleryIndex+1)/count}%"></span></div>
      <span class="museum-index">${String(signatureGalleryIndex+1).padStart(2,'0')} / ${String(count).padStart(2,'0')}</span>
      <button type="button" class="museum-arrow" data-gallery-shift="1" ${signatureGalleryIndex===count-1?'disabled':''} aria-label="Next dish">→</button></div>
    <div class="museum-instructions">SCROLL TO EXPLORE &nbsp; · &nbsp; USE ARROWS TO NAVIGATE</div>
  </div>`;
}
function galleryNavigate(next){
  const max=Math.min(40,allDishes().filter(d=>Number.isFinite(d.score)).length,Math.max(1,Math.floor(Number(prefs.dnaTopCount)||8)));
  const newIndex=Math.max(0,Math.min(Math.max(0,max-1),next));
  if(newIndex===signatureGalleryIndex)return false;
  signatureGalleryIndex=newIndex;
  // Only redraw the exhibition; don't recalculate the complete Food DNA dashboard.
  const top=allDishes().filter(d=>Number.isFinite(d.score)).sort((a,b)=>b.score-a.score||a.item.name.localeCompare(b.item.name));
  renderSignatureGallery(top,max);
  return true;
}
/* Palate Code: an observational, dish-based typology, not a psychological test. */
const PALATE_PERSONAS = {"ELVT":{"name":"The Frugal Connoisseur","description":"Your dishes span a relatively broad mix of cuisines; certain dish types recur across different restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"ELVG":{"name":"The Curious Regular","description":"Your dishes span a relatively broad mix of cuisines; certain dish types recur across different restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"ELIT":{"name":"The Selective Epicure","description":"Your dishes span a relatively broad mix of cuisines; certain dish types recur across different restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"ELIG":{"name":"The Loyal Bon Vivant","description":"Your dishes span a relatively broad mix of cuisines; certain dish types recur across different restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"ERVT":{"name":"The Budget Scout","description":"Your dishes span a relatively broad mix of cuisines; you record a wide variety of dish types with few recurring names across restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"ERVG":{"name":"The Openhearted Explorer","description":"Your dishes span a relatively broad mix of cuisines; you record a wide variety of dish types with few recurring names across restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"ERIT":{"name":"The Luxury Pathfinder","description":"Your dishes span a relatively broad mix of cuisines; you record a wide variety of dish types with few recurring names across restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"ERIG":{"name":"The Adventurous Indulger","description":"Your dishes span a relatively broad mix of cuisines; you record a wide variety of dish types with few recurring names across restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SLVT":{"name":"The Strict Traditionalist","description":"Your rated dishes concentrate in a smaller set of cuisines; certain dish types recur across different restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SLVG":{"name":"The Comfort Keeper","description":"Your rated dishes concentrate in a smaller set of cuisines; certain dish types recur across different restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SLIT":{"name":"The Discerning Patron","description":"Your rated dishes concentrate in a smaller set of cuisines; certain dish types recur across different restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SLIG":{"name":"The Devoted Epicure","description":"Your rated dishes concentrate in a smaller set of cuisines; certain dish types recur across different restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SRVT":{"name":"The Practical Purist","description":"Your rated dishes concentrate in a smaller set of cuisines; you record a wide variety of dish types with few recurring names across restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SRVG":{"name":"The Easygoing Sampler","description":"Your rated dishes concentrate in a smaller set of cuisines; you record a wide variety of dish types with few recurring names across restaurants; you tend to rate lower-spend restaurants relatively more highly; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SRIT":{"name":"The High-End Hunter","description":"Your rated dishes concentrate in a smaller set of cuisines; you record a wide variety of dish types with few recurring names across restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit below a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."},"SRIG":{"name":"The Lavish Wanderer","description":"Your rated dishes concentrate in a smaller set of cuisines; you record a wide variety of dish types with few recurring names across restaurants; higher-spend restaurants tend to earn stronger dish scores from you; and your restaurant-balanced dish ratings sit above a neutral 7.5 reference. These patterns describe your logged dishes, not your personality outside food."}};
let dnaActiveTab='signature';
function setDNATab(tab,focus=false){
  dnaActiveTab=['code','signature','stamps'].includes(tab)?tab:'code';
  document.querySelectorAll('[data-dna-tab]').forEach(b=>{
    const active=b.dataset.dnaTab===dnaActiveTab;
    b.classList.toggle('active',active);
    b.setAttribute('aria-selected',active?'true':'false');
    b.tabIndex=active?0:-1;
    if(active&&focus)b.focus();
  });
  document.querySelectorAll('[data-dna-panel]').forEach(panel=>{panel.hidden=panel.id==='dnaPanelSignature'&&$('dishesView').contains(panel)?activeDishPanel!=='signature':panel.dataset.dnaPanel!==dnaActiveTab});
}
const pcClamp=(value,lower=0,upper=100)=>Math.min(upper,Math.max(lower,value));
function pcRank(values){
  const sorted=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),rank=Array(values.length);
  for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j].v===sorted[i].v)j++;
    const avg=(i+1+j)/2;for(let k=i;k<j;k++)rank[sorted[k].i]=avg;i=j;
  }return rank;
}
function pcCorrelation(x,y){
  if(x.length!==y.length||x.length<3)return null;
  const a=pcRank(x),b=pcRank(y),ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length;
  let num=0,da=0,db=0;
  for(let i=0;i<a.length;i++){const dx=a[i]-ma,dy=b[i]-mb;num+=dx*dy;da+=dx*dx;db+=dy*dy}
  return da>0&&db>0?num/Math.sqrt(da*db):null;
}
function palateCodeModel(){
  // All metrics are observational; the maturity bar reports coverage, NOT scientific confidence.
  const rated=allDishes().filter(d=>d.item.name?.trim()&&d.item.rating!==''&&d.item.rating!=null&&Number.isFinite(Number(d.item.rating))&&Number(d.item.rating)>=0&&Number(d.item.rating)<=10);
  const n=rated.length;
  const knownCuisine=rated.filter(d=>String(d.e.cuisine||'').trim());
  const cuisineCounts=new Map();
  for(const d of knownCuisine){const k=d.e.cuisine.trim().toLocaleLowerCase();cuisineCounts.set(k,(cuisineCounts.get(k)||0)+1)}
  const cn=knownCuisine.length;
  // Unbiased pairwise concentration: chance two different ratings share a cuisine.
  const conc=cn>=2?[...cuisineCounts.values()].reduce((sum,c)=>sum+c*(c-1),0)/(cn*(cn-1)):1;
  const neff=conc>0?Math.min(cuisineCounts.size,1/conc):cuisineCounts.size;
  const explore=cn>=12?pcClamp(50+(neff-2.4)*24):null;
  // Share of named rated dishes belonging to a dish name observed in >=2 distinct restaurants.
  const nameGroups=new Map();
  for(const d of rated){const k=d.item.name.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();if(!k)continue;
    if(!nameGroups.has(k))nameGroups.set(k,{count:0,restaurants:new Set()});
    const g=nameGroups.get(k);g.count++;g.restaurants.add(d.e.id);
  }
  const loyaltyHits=[...nameGroups.values()].filter(g=>g.restaurants.size>=2).reduce((sum,g)=>sum+g.count,0);
  const distinctDishRestaurants=new Set(rated.map(d=>d.e.id)).size;
  // 8 synthetic observations at a neutral 30% baseline mitigate instability in short collections.
  const repeatObserved=n?loyaltyHits/n:0;
  const repeatShrunk=(loyaltyHits+8*.30)/(n+8);
  const roam=(n>=12&&distinctDishRestaurants>=5&&Math.abs(repeatShrunk-.30)>=.035)?pcClamp(50+(.30-repeatShrunk)*190):null;
  // One price observation per restaurant. Its listed per-person price is preferred;
  // if absent, the mean recorded personal food value of dated visits is a transparent proxy.
  const restaurantScores=new Map();
  const visitFoodValues=new Map();
  for(const v of visits){const value=Number(v.foodValue);if(v.foodValue===null||v.foodValue===undefined||!Number.isFinite(value)||value<=0)continue;
    if(!visitFoodValues.has(v.restaurantId))visitFoodValues.set(v.restaurantId,[]);
    visitFoodValues.get(v.restaurantId).push(value);
  }
  for(const d of rated){const id=d.e.id;
    const listed=Number(d.e.pp);
    const amounts=visitFoodValues.get(id)||[];
    const price=Number.isFinite(listed)&&listed>0?listed:(amounts.length?amounts.reduce((s,x)=>s+x,0)/amounts.length:null);
    if(price===null)continue;
    if(!restaurantScores.has(id))restaurantScores.set(id,{price,sum:0,count:0});
    const r=restaurantScores.get(id);r.sum+=Number(d.item.rating);r.count++;
  }
  const priced=[...restaurantScores.values()].map(r=>({price:r.price,score:r.sum/r.count})).sort((a,b)=>a.price-b.price);
  const medianPrice=rows=>{const a=rows.map(r=>r.price).sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length?(a.length%2?a[m]:(a[m-1]+a[m])/2):null;};
  const typicalPrice=medianPrice(priced), half=Math.floor(priced.length/2);
  const priceSpread=half?medianPrice(priced.slice(-half))-medianPrice(priced.slice(0,half)):0;
  const priceCoverage=priced.length>=6&&new Set(priced.map(r=>Math.round(r.price*100))).size>=3;
  const enoughPrice=priceCoverage&&priceSpread>=Math.max(10,typicalPrice*.20);
  const typicalPriceDetail=typicalPrice===null?'Typical cost not recorded.':`Typical recorded cost per person: £${typicalPrice.toFixed(2)} (median across ${priced.length} rated restaurants).`;
  // Spearman rank correlation is less affected by a few expensive outliers than Pearson.
  function averageRanks(numbers){
    const sorted=numbers.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value);
    const ranks=Array(numbers.length);for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j].value===sorted[i].value)j++;
      const rank=(i+j-1)/2+1;for(let k=i;k<j;k++)ranks[sorted[k].index]=rank;i=j;}return ranks;
  }
  const rho=enoughPrice?pcCorrelation(averageRanks(priced.map(r=>r.price)),averageRanks(priced.map(r=>r.score))):null;
  const mid=Math.floor(priced.length/2),cheap=priced.slice(0,mid),expensive=priced.slice(priced.length-mid);
  const avg=rows=>rows.length?rows.reduce((s,r)=>s+r.score,0)/rows.length:null;
  const difference=enoughPrice?(avg(expensive)-avg(cheap)):null;
  // A difference of one point on a ten-point rating scale counts as a meaningful contrast.
  const effect=enoughPrice?(0.6*(rho??0)+0.4*Math.max(-1,Math.min(1,difference/1.5))):null;
  const neutralPrice=enoughPrice&&Math.abs(effect)<0.07;
  const indulgence=enoughPrice?pcClamp(50+effect*42):null;
  // Restaurant-balanced mean score avoids inflating generosity via one large restaurant menu.
  const allRests=new Map();for(const d of rated){const id=d.e.id;if(!allRests.has(id))allRests.set(id,{sum:0,count:0});const r=allRests.get(id);r.sum+=Number(d.item.rating);r.count++}
  const means=[...allRests.values()].map(r=>r.sum/r.count),rN=means.length;
  const observedMean=rN?means.reduce((sum,x)=>sum+x,0)/rN:null;
  const shrunkMean=rN?(rN*observedMean+4*7.5)/(rN+4):null;
  const generosity=n>=12&&rN>=5&&Math.abs(shrunkMean-7.5)>=.12?pcClamp(50+(shrunkMean-7.5)*20):null;
  const axes=[
    {left:'Explorer',right:'Specialist',l:'E',r:'S',value:explore===null?null:100-explore,source:cn,target:40,explain:'Uses cuisine breadth adjusted for small samples. Repeated dishes in one cuisine do not falsely increase diversity. Threshold: about 2.4 effective cuisines.',detail:explore===null?'Needs at least 12 rated dishes with cuisines.':`${cn} cuisine-linked dishes · ${neff.toFixed(2)} effective cuisines`},
    {left:'Loyalist',right:'Roamer',l:'L',r:'R',value:roam,source:n,target:50,explain:'Loyalist means favouring the same dish types across different restaurants, not returning to the same restaurant. Compares matched normalised dish names, shrunk toward a neutral reference. Cannot prove actual ordering frequency.',detail:roam===null?'Needs 12 rated dishes across 5 restaurants and a clear pattern.':`${loyaltyHits}/${n} dishes share a name across different restaurants · adjusted ${(repeatShrunk*100).toFixed(0)}%`},
    {left:'Value-first',right:'Indulgent',l:'V',r:'I',value:indulgence,balanced:neutralPrice,source:priced.length,target:6,explain:'Compares dish ratings across separate priced restaurants using ranks and a low-versus-high price comparison. Each restaurant counts once, regardless of menu length. Requires a meaningful price spread. This measures relative rating preference, not absolute expenditure or value for money. Results are directional rather than proof that price causes enjoyment.',detail:!priceCoverage?`${priced.length} eligible priced restaurants. Record prices at 6 different restaurants, with at least 3 distinct prices. ${typicalPriceDetail}`:!enoughPrice?`Prices are too similar to infer a preference. ${typicalPriceDetail}`:neutralPrice?`Balanced price preference (≈). ${typicalPriceDetail}`:`Higher-price rating difference ${difference>0?'+':''}${difference.toFixed(2)}/10. ${typicalPriceDetail}`},
    {left:'Tough grader',right:'Generous grader',l:'T',r:'G',value:generosity,source:rN,target:35,explain:'Balances average ratings across restaurants so long dish menus cannot dominate. Mean is gently shrunk toward 7.5/10 with four neutral reference restaurants. Near-neutral results stay undecided.',detail:generosity===null?'Needs 12 rated dishes at 5 restaurants and a clear mean-rating difference.':`${rN} rated restaurants · adjusted mean ${shrunkMean.toFixed(2)}/10`}
  ];
  const letters=axes.map((a,i)=>a.balanced?'≈':a.value===null?'?':(i===0?a.value>50:a.value>=50)?a.r:a.l);
  const code=letters.join(''),complete=letters.every(letter=>/^[A-Z]$/.test(letter))&&Boolean(PALATE_PERSONAS[code]);
  const readiness=axes.reduce((sum,a)=>sum+Math.min(1,a.source/a.target),0)/axes.length*100;
  const supported=axes.filter(a=>a.value!==null).length;
  const maturity=supported<2?'Starting out':supported<4?'Developing':readiness<65?'Developing':readiness<90?'Established':'Seasoned';
  return {rated:n,code,complete,persona:complete?PALATE_PERSONAS[code]:null,axes,readiness:Math.round(readiness),supported,maturity,distinctRestaurants:rN,observedCuisineCount:cuisineCounts.size};
}

let browsedPalatePersonaCode="";
window.recoPalateCode=()=>palateCodeModel().code;
function renderPalateCode(){
  const node=$('palateCodeContent');if(!node)return;
  const model=palateCodeModel();
  const badge=$('reco49Palate');if(badge)badge.textContent=model.code;
  const balanced=model.axes.some(a=>a.balanced);
  const head=model.complete&&model.persona?`<span class="palate-kicker">YOUR PALATE PERSONA</span><h3>${esc(model.code)}</h3><strong>${esc(model.persona.name)}</strong><p>${esc(model.persona.description)}</p>`:
    balanced?`<span class="palate-kicker">YOUR PALATE CODE</span><h3>${esc(model.code)}</h3><strong>Balanced preferences</strong><p>Your recorded meals show no clear price–rating preference. That's a result, not missing data.</p>`:
    `<span class="palate-kicker">YOUR PALATE CODE IS FORMING</span><h3>${esc(model.code)}</h3><strong>Still learning</strong><p>Some traits need more evidence. No preference is invented.</p>`;
  const bars=model.axes.map((a,i)=>{
    const l=a.balanced?'≈':a.value===null?'?':(i===0?a.value>50:a.value>=50)?a.r:a.l;
    const pct=a.value===null?50:a.value;
    return `<article class="palate-axis"><div class="palate-axis-head"><span>${esc(a.left)}</span><span class="palate-letter" aria-label="Assigned letter">${l}</span><span>${esc(a.right)}</span></div>
      <div class="palate-track" role="meter" aria-valuemin="0" aria-valuemax="100" ${a.value===null?'':'aria-valuenow="'+pct.toFixed(0)+'"'} aria-label="${esc(a.left)} versus ${esc(a.right)}"><span class="palate-mid"></span><i style="left:${pct}%"></i></div>
      <p class="palate-axis-detail">${esc(a.detail)}</p></article>`;
  }).join('');
  const codes=Object.keys(PALATE_PERSONAS).sort();
  const selectedCode=codes.includes(browsedPalatePersonaCode)?browsedPalatePersonaCode:(codes.includes(model.code)?model.code:codes[0]);
  const selectedPersona=PALATE_PERSONAS[selectedCode];
  const world=`<label class="reco-31-world-label" for="palatePersonaSelect">Choose a persona</label><select id="palatePersonaSelect" aria-label="Explore persona descriptions">${codes.map(code=>`<option value="${code}" ${code===selectedCode?'selected':''}>${code} · ${esc(PALATE_PERSONAS[code].name)}</option>`).join('')}</select><article class="palate-world-item ${selectedCode===model.code?'is-current':''}"><div class="palate-world-top"><b>${selectedCode}</b>${selectedCode===model.code?'<span>YOUR CODE</span>':''}</div><h4>${esc(selectedPersona.name)}</h4><p>${esc(selectedPersona.description)}</p></article>`;
  node.innerHTML=`<div class="palate-hero">${head}<div class="palate-maturity"><div><b>${esc(model.maturity)} profile</b><span>${model.supported}/4 dimensions established · ${model.rated} rated dishes</span></div><strong>${model.readiness}%</strong></div><div class="maturity-track"><i style="width:${model.readiness}%"></i></div></div>
    <details class="palate-axes-accordion"><summary>Your four traits <span>Expand ↓</span></summary><div class="palate-axes">${bars}</div></details>
    <details class="palate-world"><summary><span><b>World of Personas</b><small>Explore all 16 possible four-letter profiles</small></span><span aria-hidden="true">⌄</span></summary><div class="palate-world-grid">${world}</div></details>`;
}

function renderDNA(){
  const rated=allDishes().filter(d=>Number.isFinite(d.score));
  const top=rated.slice().sort((a,b)=>b.score-a.score||a.item.name.localeCompare(b.item.name));
  const max=Math.min(40,top.length),chosen=Math.min(max,Math.max(1,Math.floor(Number(prefs.dnaTopCount)||8)));
  const picker=$('dnaTopCount');picker.innerHTML=Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');picker.disabled=!max;if(max)picker.value=chosen;
  $('dnaSignatureCount').textContent=max?`Displaying ${chosen} of ${top.length} rated dishes`:'No dishes recorded yet';
  const cuisines=[...new Set(entries.map(e=>(e.cuisine||'').trim().toLowerCase()).filter(Boolean))];
  const intlCount=entries.filter(e=>e.international).length;
  const overallElite=entries.filter(e=>overallScore(e)!==null&&overallScore(e)>=90).length;
  const valueElite=entries.filter(e=>e.valueScore!==null&&e.valueScore!==undefined&&Number(e.valueScore)>=85).length;
  const cuisineCount=new Set(entries.map(e=>e.cuisine?.trim().toLowerCase()).filter(Boolean)).size;
  const signatureCount=top.filter(d=>d.score>=9.5).length;
  const dates=[...entries.map(e=>firstVisitDate(e)||e.dateVisited||e.createdAt?.slice(0,10)).filter(Boolean),...visits.map(v=>v.date)].filter(Boolean).sort();
  const yearsTracked=dates.length>=2?(new Date(dates[dates.length-1])-new Date(dates[0]))/(1000*60*60*24*365.25):0;
  const levelInfo=(value,thresholds)=>{let level=0;for(const milestone of thresholds)if(value>=milestone)level++;const previous=level?thresholds[level-1]:0;const next=level>=10?null:thresholds[level];return {level,maxed:level===10,nextTarget:next,pct:level===10?100:Math.max(0,Math.min(100,100*(value-previous)/Math.max(.01,next-previous)))};};
  const achievements=[
    {icon:'🏛️',title:'Restaurant Archivist',desc:'Build a serious lifelong collection of restaurant memories.',value:entries.length,unit:'restaurants',thresholds:[3,10,25,50,90,150,230,350,500,750]},
    {icon:'🧭',title:'World on a Plate',desc:'Discover and document different cuisines.',value:cuisineCount,unit:'cuisines',thresholds:[1,3,5,10,15,20,25,30,40,50]},
    {icon:'🌍',title:'Passport of Palate',desc:'Track more restaurants outside the United Kingdom.',value:intlCount,unit:'international restaurants',thresholds:[2,5,8,12,35,75,110,160,230,320]},
    {icon:'🥇',title:'Gold Table',desc:'Collect restaurants with an overall rating of at least 90.',value:overallElite,unit:'90+ overall restaurants',thresholds:[1,2,3,7,16,25,40,60,90,140]},
    {icon:'💸',title:'Value Vault',desc:'Find exceptional restaurants scoring at least 85 for value.',value:valueElite,unit:'85+ value restaurants',thresholds:[2,5,9,12,38,60,95,140,200,290]},
    {icon:'📖',title:'Stamp Collector',desc:'Build an extensive collection of rated dishes.',value:rated.length,unit:'rated dishes',thresholds:[5,15,35,65,110,180,280,420,600,850]},
    {icon:'👑',title:'House of Legends',desc:'Collect dishes rated 9.5 or higher.',value:signatureCount,unit:'9.5+ dishes',thresholds:[1,2,3,7,20,35,55,85,125,180]},
    {icon:'🕰️',title:'The Long Table',desc:'Build an enduring dining history spanning at least five years.',value:yearsTracked,unit:'years tracked',thresholds:[.08,.16,.25,.55,1.25,1.75,2.5,3.5,4.25,5]}
  ].map(a=>({...a,...levelInfo(a.value,a.thresholds)}));
  $('culinaryPassport').innerHTML=achievements.map(a=>{const v=a.title==='The Long Table'?`${a.value.toFixed(1)} years`:`${Math.floor(a.value)} ${a.unit}`;const next=a.maxed?'All 10 levels completed':`Level ${a.level+1}: ${a.title==='The Long Table'?a.nextTarget.toFixed(a.nextTarget<1?2:1):a.nextTarget} ${a.unit}`;return `<article class="passport-badge ${a.maxed?'earned maxed':a.level>=6?'earned':''}"><div class="stamp-icon">${a.icon}</div><div class="passport-level-pill"><span>Level</span><strong>${a.level}</strong><span>/ 10</span></div><h4>${esc(a.title)}</h4><p>${esc(a.desc)}</p><div class="passport-progress"><div style="width:${a.pct.toFixed(1)}%"></div></div><div class="passport-metric"><span>${esc(v)}</span><span>${a.maxed?'Mastered':`${Math.round(a.pct)}% to next`}</span></div><small>${esc(next)}</small></article>`}).join('');
  renderSignatureGallery(top,chosen);
  renderPalateCode();
  setDNATab(dnaActiveTab);
  if($('dishesView').contains($('dnaPanelSignature')))$('dnaPanelSignature').hidden=activeDishPanel!=='signature';
}

async function deleteDishCategory(name){
  if(!name||name==='Uncategorised')return;
  const count=allDishes().filter(d=>d.categories.some(c=>c.toLowerCase()===name.toLowerCase())).length;
  if(!confirm(`Remove category "${name}" from the catalogue and ${count} matching dishes? Dishes themselves and ratings will remain.`))return;
  const key=name.toLowerCase();
  for(const e of entries){let changed=false;
    for(const item of e.items){const explicit=explicitDishCategories(item);const reduced=explicit.filter(c=>c.toLowerCase()!==key);
      if(explicit.length!==reduced.length){item.categories=reduced;item.category=reduced[0]||'';changed=true}
    }
    if(changed){e.updatedAt=new Date().toISOString();await putStore(RESTAURANTS,e)}
  }
  prefs.dishCategories=(prefs.dishCategories||[]).filter(c=>c.toLowerCase()!==key);
  prefs.hiddenDishCategories=normalizeDishCategoryNames([...(prefs.hiddenDishCategories||[]),name]);savePrefs();
  if($('dishBookDialog').open&&dishBookCategory.toLowerCase()===key)$('dishBookDialog').close();
  render();
}
function openDishBook(category){dishBookCategory=category;dishBookIndex=0;renderDishBook();$('dishBookDialog').showModal()}
function renderDishBook(){
  const pages=allDishes().filter(d=>d.categories.some(c=>c.toLowerCase()===dishBookCategory.toLowerCase())).sort((a,b)=>b.score-a.score);
  $('dishBookTitle').textContent=dishBookCategory+' · stamp book';$('dishBookSub').textContent=`${pages.length} ${pages.length===1?'dish':'dishes'} in this category`;
  if(!pages.length){$('dishBookPage').innerHTML='<p class="feature-muted">No dishes in this category yet.</p>';$('dishBookCount').textContent='Empty stamp book';$('dishBookPrev').disabled=true;$('dishBookNext').disabled=true;return}
  dishBookIndex=Math.max(0,Math.min(pages.length-1,dishBookIndex));const d=pages[dishBookIndex],img=d.item.photo||d.e.photos?.[0]||getLocationImage(d.e.location);
  $('dishBookPage').innerHTML=`<div class="dish-book-sheet"><span class="dish-book-serial">RECOLLEAT · THE FOOD COLLECTION</span><div class="dish-book-image">${img?`<img loading="lazy" src="${esc(img)}" alt="${esc(d.item.name)}">`:'<span>✦</span>'}</div><div class="dish-book-caption"><div><span class="feature-kicker">STAMP ${dishBookIndex+1} / ${pages.length}</span><h3>${esc(d.item.name)}</h3><p>${esc(d.e.restaurant)} · ${esc(d.e.cuisine||'Uncategorised')}</p></div><div class="dish-book-score">${d.score.toFixed(1)}<small>/ 10</small></div></div><div class="dish-tags">${d.categories.map(c=>`<span class="dish-category">${esc(c)}</span>`).join('')}</div><button type="button" class="name-btn" data-open-passport="${esc(d.e.id)}">Open restaurant passport →</button></div>`;
  $('dishBookCount').textContent=`Page ${dishBookIndex+1} of ${pages.length}`;$('dishBookPrev').disabled=dishBookIndex===0;$('dishBookNext').disabled=dishBookIndex===pages.length-1;
}
function openDishPhotoDialog(restaurantId,index){
  const e=entries.find(x=>x.id===restaurantId),item=e?.items[index];if(!item)return;
  dishPhotoContext={restaurantId,index};
  $('dishPhotoSub').textContent=`${item.name} · ${e.restaurant} · paste a copied image to assign a dish-only photo`;
  $('dishPhotoChoices').innerHTML=item.photo?`<div class="dish-current-photo"><img src="${esc(item.photo)}" alt="Currently assigned dish photograph"><span>Current dish photograph</span></div>`:'<p class="feature-muted">No photo assigned to this dish yet.</p>';
  $('dishPhotoPasteZone').textContent='Click to focus, then paste with Ctrl+V or Cmd+V';
  $('dishPhotoDialog').showModal();
  setTimeout(()=>$('dishPhotoPasteZone').focus(),0);
}
async function saveDishPhoto(src){if(!dishPhotoContext)return;const {restaurantId,index}=dishPhotoContext,e=entries.find(x=>x.id===restaurantId);if(!e?.items?.[index])return;e.items[index].photo=src||'';e.updatedAt=new Date().toISOString();{const recovery=buildRecoverySnapshot('Before changing a dish photograph');await mutateStores([...(recovery?[[SNAPSHOTS,'put',recovery]]:[]),[RESTAURANTS,'put',e]])}$('dishPhotoDialog').close();render()}
function startAddDish(){
  const id=$("dishAddRestaurant").value;
  if(!id){alert("Choose a restaurant first to add a dish.");return}
  edit(id);addItemRow({name:"",rating:null,category:""});
  const details=$('editor').querySelectorAll('details.editor-section')[1];if(details)details.open=true;
  const rows=$('itemsEditor').querySelectorAll('.item-edit');rows[rows.length-1]?.querySelector('.dish-name')?.focus();
}

function bind(){
  $("sidebarToggle").onclick=toggleSidebar;$("mobileSidebarBtn").onclick=openMobileMore;$("sidebarScrim").onclick=()=>setMobileSidebarOpen(false);
  $("addDishCategoryBtn").onclick=()=>{const c=addCustomDishCategory($("newDishCategory").value);if(c){$("newDishCategory").value="";renderDishes()}};$("newDishCategory").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("addDishCategoryBtn").click()}};
  const turnDishBook=direction=>{dishBookIndex+=direction;renderDishBook()};
  $('dishBookPrev').onclick=()=>turnDishBook(-1);$('dishBookNext').onclick=()=>turnDishBook(1);
  let swipeX=null;$('dishBookPage').addEventListener('touchstart',ev=>{swipeX=ev.touches?.[0]?.clientX??null},{passive:true});
  $('dishBookPage').addEventListener('touchend',ev=>{if(swipeX===null)return;const dx=(ev.changedTouches?.[0]?.clientX??swipeX)-swipeX;swipeX=null;if(Math.abs(dx)>55)turnDishBook(dx<0?1:-1)},{passive:true});
  document.addEventListener('keydown',ev=>{if(!$('dishBookDialog').open)return;if(ev.key==='ArrowRight'){ev.preventDefault();turnDishBook(1)}else if(ev.key==='ArrowLeft'){ev.preventDefault();turnDishBook(-1)}});
  $('dishPhotoClear').onclick=()=>saveDishPhoto('');$('dishPhotoPasteZone').onpaste=async ev=>{const image=[...(ev.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));if(!image)return;ev.preventDefault();ev.stopPropagation();try{await saveDishPhoto(await imageToData(image.getAsFile()))}catch(err){alert('Paste failed: '+err.message)}};
  $('dishPhotoPasteZone').onclick=()=>$('dishPhotoPasteZone').focus();
  $("dishCategoryAddFromDialog").onclick=addCategoryInDialog;$("dishCategorySave").onclick=saveDishCategoryChanges;$("dishCategoryNewInDialog").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addCategoryInDialog()}};
  $("addBtn").onclick=()=>openUnifiedQuickLog();$("editorForm").onsubmit=saveEntry;
  $('quickAddBtn').onclick=()=>openUnifiedQuickLog();
  $('chooseQuickAdd').onclick=()=>{$('addChoiceDialog').close();openUnifiedQuickLog()};
  $('chooseFullAdd').onclick=()=>{$('addChoiceDialog').close();resetEditor();setEditorStep(1);$('editor').showModal()};
  setupFoodRatingHelper();
  $('dishRankJump').onsubmit=jumpToDishRank;
  $('quickAddForm').onsubmit=e=>{e.preventDefault();if(upsertDraft(quickDraft())){$('quickAddDialog').close();notify('Saved as a draft. Finish it whenever you like.')}};
  $('quickPublish').onclick=publishQuickRestaurant;
  $('quickContinue').onclick=()=>{const d=quickDraft();$('quickAddDialog').close();resetEditor();editingDraftId=null;$('restaurant').value=d.name;$('cuisine').value=d.cuisine;$('location').value=d.location;if(Number.isFinite(d.foodScore))setFoodScore(d.foodScore);setEditorStep(1);$('editor').showModal()};
  document.querySelectorAll('[data-editor-select-step]').forEach(b=>b.onclick=()=>setEditorStep(b.dataset.editorSelectStep));
  $('editorPrevStep').onclick=()=>setEditorStep(editorStep-1);$('editorNextStep').onclick=()=>setEditorStep(editorStep+1);
  $('editor').querySelector('.editor-steps').addEventListener('keydown',event=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
    const next=event.key==='Home'?1:event.key==='End'?3:((editorStep-1+(event.key==='ArrowRight'?1:2))%3)+1;
    setEditorStep(next);$('editorStepTab'+next).focus();event.preventDefault();
  });
  $('editorSaveDraft').onclick=()=>{if(editingId){notify('Published restaurants are saved using Save memory.','error');return}const d=draftFromForm();if(upsertDraft(d)){$('editor').close();editingDraftId=null;notify('Draft saved safely on this device.')}};
  $('rankJumpForm').onsubmit=e=>{
    e.preventDefault();const rank=Math.floor(Number($('rankJumpNumber').value));const ranks=grandRankMap();
    if(!Number.isFinite(rank)||rank<1||rank>entries.length){notify(`Choose a Grand List rank from 1 to ${entries.length}.`,'error');return}
    const item=entries.find(x=>ranks.get(x.id)===rank);if(!item){notify('No restaurant has that rank.','error');return}
    // Rank always refers to Grand List, not the visible row position after another sort or filter.
    prefs.sortProperty='grandRank';prefs.sortDirection='asc';prefs.filters=clone(DEFAULT_PREFS.filters);savePrefs();syncControls();
    mobileVisibleCount=Math.max(5,rank);render();
    const target=[...$('mobileRestaurantFeed').children].find(node=>node.querySelector('[data-open-passport="'+item.id+'"]'));
    if(target){target.scrollIntoView({block:'center',behavior:'smooth'});target.classList.add('jump-highlight');setTimeout(()=>target.classList.remove('jump-highlight'),1600)}
    notify(`Showing Grand List rank #${rank}.`);
  };
  $('draftCards').onclick=e=>{const open=e.target.closest('[data-open-draft]'),del=e.target.closest('[data-delete-draft]');if(open)openDraft(open.dataset.openDraft);else if(del){if(confirm('Delete this unfinished draft?'))removeDraft(del.dataset.deleteDraft)}};
  $('calendarMonthJump').onchange=e=>{if(!/^\d{4}-\d{2}$/.test(e.target.value))return;const [y,m]=e.target.value.split('-').map(Number);visitMonthCursor=new Date(y,m-1,1);selectedCalendarDate='';calendarShowingWholeMonth=false;renderVisitHistory()};
  $("deleteBtn").onclick=deleteEntry;$("addItemBtn").onclick=()=>addItemRow();
  $("foodScore").oninput=e=>setFoodScore(e.target.value);$("foodScoreNumber").oninput=e=>setFoodScore(e.target.value);$("valueScore").oninput=e=>{editorValueRated=true;setValueScore(e.target.value);updateEditorRatingHints()};$("valueScoreNumber").oninput=e=>{editorValueRated=true;setValueScore(e.target.value);updateEditorRatingHints()};$("pp").oninput=e=>{editorPriceRated=true;setPP(e.target.value);updateEditorRatingHints()};$("ppNumber").oninput=e=>{editorPriceRated=true;setPP(e.target.value);updateEditorRatingHints()};
  $("editorAddVisit").onclick=()=>{workingVisits.push(normaliseVisit({id:uid(),date:"",spend:null,note:""}));renderEditorVisits()};
  const syncEditorVisit=event=>{
    const input=event.target.closest('.visit-date-field,.visit-food-field,.visit-spend-field,.visit-treated-field');if(!input)return;
    const row=input.closest('[data-visit-id]'),v=workingVisits.find(x=>x.id===row?.dataset.visitId);if(!v)return;
    const previousValue=v.foodValue,previousPaidFor=v.paidFor,previousSpend=v.spend;
    v.date=row.querySelector('.visit-date-field').value;
    v.foodValue=readMoneyInput(row.querySelector('.visit-food-field'));
    v.paidFor=row.querySelector('.visit-treated-field').checked;
    const own=row.querySelector('.visit-spend-field');
    if(v.paidFor){if(!own.disabled)own.dataset.previousAmount=own.value;own.value='0.00';own.disabled=true;v.spend=0}else{if(own.disabled)own.value=own.dataset.previousAmount||'';own.disabled=false;v.spend=readMoneyInput(own)}
    const text=row.querySelector('.visit-row-index small');if(text)text.textContent=v.date?'Dated memory':'Date unknown';
  };
  $("editorVisitRows").addEventListener('input',syncEditorVisit);
  $("editorVisitRows").addEventListener('change',syncEditorVisit);
  $("editorVisitRows").addEventListener("click",event=>{const btn=event.target.closest("[data-remove-editor-visit]");if(!btn)return;const v=workingVisits.find(v=>v.id===btn.dataset.removeEditorVisit);if(v&&((v.dishes||[]).length||(v.photos||[]).length||v.note||v.foodValue!==null||v.spend!==null)&&!confirm('Remove this visit and its dishes, photos, notes and payment details when you save?'))return;workingVisits=workingVisits.filter(v=>v.id!==btn.dataset.removeEditorVisit);renderEditorVisits()});

// Restaurant location search is intentionally manual. Older stored identifiers remain inert for backup compatibility.
  $("photos").onchange=async ev=>{await addImageFiles(ev.target.files);ev.target.value=""};
  $("location").addEventListener("input",refreshLocationImagePreview);
  const gallery=$("locationImage"),pasteZone=$("locationPasteZone");
  gallery.onchange=async ev=>{
    try{if(ev.target.files?.[0])await storeSharedLocationImage(ev.target.files[0])}
    catch(err){notify("Could not save location picture: "+err.message,"error")}
    finally{gallery.value=""}
  };
  $("locationImageLocation").onchange=showSelectedLocationImage;
  $("clearLocationImage").onclick=async()=>{
    try{await removeSharedLocationImage()}catch(err){notify("Could not remove picture: "+err.message,"error")}
  };
  $("locationSearchImages").onclick=()=>{
    const location=$("locationImageLocation").selectedOptions[0]?.textContent?.trim();
    if(!location)return;
    // This is a user-initiated external search; no Google API, scraping or automatic downloads.
    const url="https://www.google.com/search?tbm=isch&q="+encodeURIComponent(location+" photos");
    window.open(url,"_blank","noopener,noreferrer");
    $("locationMediaStatus").textContent="Google Images opened for “"+location+"”. Save or copy a permitted picture, then return here to upload or paste it.";
  };
  $("locationClipboardRead").onclick=async()=>{
    try{
      if(!navigator.clipboard?.read)throw new Error("Clipboard image access is unavailable in this browser.");
      const items=await navigator.clipboard.read();
      for(const item of items){
        const type=item.types.find(t=>t.startsWith("image/"));
        if(type){await storeSharedLocationImage(await item.getType(type));return}
      }
      throw new Error("The clipboard does not contain an image.");
    }catch(err){
      pasteZone.focus();
      $("locationMediaStatus").textContent=err.message+" You can save the image to your gallery, or paste it here using the keyboard.";
    }
  };
  pasteZone.onclick=()=>pasteZone.focus();
  pasteZone.onpaste=async ev=>{
    const item=[...(ev.clipboardData?.items||[])].find(i=>i.type.startsWith("image/"));
    if(!item)return;ev.preventDefault();ev.stopPropagation();
    try{await storeSharedLocationImage(item.getAsFile())}
    catch(err){notify("Could not paste location picture: "+err.message,"error")}
  };
  const zone=$("pasteZone");zone.addEventListener("click",()=>{editorPasteTarget="restaurant";zone.focus()});zone.addEventListener("focus",()=>{editorPasteTarget="restaurant"});
  $("appearanceBtn").onclick=ev=>{ev.stopPropagation();const m=$("appearanceMenu");m.classList.toggle("show");$("appearanceBtn").setAttribute("aria-expanded",m.classList.contains("show")?"true":"false");renderThemeJourney()};
  $("modeToggle").onclick=toggleMode;
  document.querySelectorAll("[data-palette]").forEach(b=>b.onclick=()=>setPalette(b.dataset.palette));
  bindGraphZoom();$("graphX").onchange=()=>{resetGraphZoom();renderGraph(filtered())}; $("graphY").onchange=()=>{resetGraphZoom();renderGraph(filtered())}; $("graphFitMode").onchange=()=>{prefs.graph.fitMode=$("graphFitMode").value;savePrefs();renderGraph(filtered())}; ["graphFilterCuisine","graphFilterLocation","graphFilterRegion","graphFilterMinFood","graphFilterMinOverall"].forEach(id=>$(id).oninput=$(id).onchange=()=>{prefs.graph.filters.cuisine=$("graphFilterCuisine").value;prefs.graph.filters.location=$("graphFilterLocation").value;prefs.graph.filters.region=$("graphFilterRegion").value;prefs.graph.filters.minFood=$("graphFilterMinFood").value;prefs.graph.filters.minOverall=$("graphFilterMinOverall").value;savePrefs();renderGraph(filtered())}); $("clearGraphFilters").onclick=()=>{prefs.graph.filters={...DEFAULT_PREFS.graph.filters};savePrefs();syncControls();renderGraph(filtered())};
  window.addEventListener("resize",()=>{if(prefs.view==="map")renderMap(entries); if(prefs.view==="graph")renderGraph(filtered())});
  document.addEventListener("paste",async ev=>{
    if($("dishPhotoDialog").open){
      const item=[...(ev.clipboardData?.items||[])].find(x=>x.type.startsWith("image/"));
      if(!item)return;ev.preventDefault();ev.stopPropagation();
      try{await saveDishPhoto(await imageToData(item.getAsFile()))}catch(err){alert("Dish photo paste failed: "+err.message)}
      return;
    }
    await handleImagePaste(ev);
  });
  $("labReset").onclick=()=>{prefs.labWeights={food:60,value:20,service:20};savePrefs();render();renderLab()};
  $("labWeightsForm").onsubmit=submitLabWeights;["labFood","labValue","labService"].forEach(id=>$(id).oninput=updateLabValidity);
  $("dnaTopCount").onchange=()=>{prefs.dnaTopCount=Math.max(1,Math.min(40,Number($("dnaTopCount").value)||8));savePrefs();renderDNA()};
  document.querySelectorAll('[data-dna-tab]').forEach(btn=>btn.addEventListener('click',()=>setDNATab(btn.dataset.dnaTab)));
  document.querySelector('.palate-nav')?.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const options=['code','signature','stamps'];let i=options.indexOf(dnaActiveTab);if(e.key==='Home')i=0;else if(e.key==='End')i=2;else i=(i+(e.key==='ArrowRight'?1:2))%3;setDNATab(options[i],true);e.preventDefault()});
  const galleryRoot=$('dnaHighlights');
  galleryRoot.addEventListener('wheel',e=>{if(!e.target.closest('.museum-gallery'))return;const now=Date.now();if(now-galleryWheelTimestamp<340){e.preventDefault();return}const next=signatureGalleryIndex+(e.deltaY>0||e.deltaX>0?1:-1);if(galleryNavigate(next)){galleryWheelTimestamp=now;e.preventDefault()}},{passive:false});
  galleryRoot.addEventListener('keydown',e=>{if(!e.target.closest('.museum-gallery'))return;if(e.key==='ArrowRight'||e.key==='ArrowDown'){if(galleryNavigate(signatureGalleryIndex+1))e.preventDefault()}else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){if(galleryNavigate(signatureGalleryIndex-1))e.preventDefault()}});
  galleryRoot.addEventListener('touchstart',e=>{galleryTouchX=e.touches?.[0]?.clientX??null},{passive:true});
  galleryRoot.addEventListener('touchend',e=>{if(galleryTouchX===null)return;const delta=(e.changedTouches?.[0]?.clientX??galleryTouchX)-galleryTouchX;galleryTouchX=null;if(Math.abs(delta)>55)galleryNavigate(signatureGalleryIndex+(delta<0?1:-1))},{passive:true});
  $("dishSearch").oninput=renderDishes;$("dishSort").onchange=renderDishes;$("dishCategoryFilter").onchange=renderDishes;$("dishRarityFilter").onchange=renderDishes;
  $("dishAddBtn").onclick=()=>startAddDish();
  $("search").oninput=render;document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  document.body.onclick=ev=>{
    const deleteCat=ev.target.closest('[data-delete-dish-category]');if(deleteCat){deleteDishCategory(deleteCat.dataset.deleteDishCategory);return}
    const openBook=ev.target.closest('[data-open-dish-book]');if(openBook){openDishBook(openBook.dataset.openDishBook);return}
    const dishPhoto=ev.target.closest('[data-dish-photo]');if(dishPhoto){openDishPhotoDialog(dishPhoto.dataset.dishPhoto,Number(dishPhoto.dataset.dishIndex));return}
    const pickPhoto=ev.target.closest('[data-pick-dish-photo]');if(pickPhoto&&dishPhotoContext){const e=entries.find(x=>x.id===dishPhotoContext.restaurantId);saveDishPhoto(e?.photos?.[Number(pickPhoto.dataset.pickDishPhoto)]||'');return}
    const dishCat=ev.target.closest("[data-edit-dish-categories]");if(dishCat){openDishCategoryDialog(dishCat.dataset.editDishCategories,Number(dishCat.dataset.dishIndex));return}
    const labreset=ev.target.closest("[data-lab-reset]");if(labreset){prefs.labWeights={food:60,value:20,service:20};savePrefs();render();renderLab();return}

    const rarityChip=ev.target.closest('[data-choose-dish-rarity]');if(rarityChip){$('dishRarityFilter').value=rarityChip.dataset.chooseDishRarity;renderDishes();return}
    const galleryJump=ev.target.closest('[data-gallery-go]');if(galleryJump){galleryNavigate(Number(galleryJump.dataset.galleryGo));return}
    const galleryShift=ev.target.closest('[data-gallery-shift]');if(galleryShift){galleryNavigate(signatureGalleryIndex+Number(galleryShift.dataset.galleryShift));return}
    if(ev.target.closest('[data-v44-new-visit]')){openNewVisit();return}
    const v44Dish=ev.target.closest('[data-v44-add-dish]');if(v44Dish){openEditorForDish(v44Dish.dataset.v44AddDish);return}
    const logShortcut=ev.target.closest("[data-log-visit]");if(logShortcut){openUnifiedQuickLog(logShortcut.dataset.logVisit);return}
    const visitPhoto=ev.target.closest('[data-visit-photo]');if(visitPhoto){const record=visits.find(v=>v.id===visitPhoto.dataset.visitPhoto);const src=record?.photos?.[Number(visitPhoto.dataset.index)];if(src)openPhotoLightbox(src);return}
    const passport=ev.target.closest("[data-open-passport]");if(passport){renderPassport(passport.dataset.openPassport);return}
    const ed=ev.target.closest("[data-edit]");if(ed){edit(ed.dataset.edit);return}
    const ph=ev.target.closest("[data-photo]");if(ph){const e=entries.find(x=>x.id===ph.dataset.photo),src=e?.photos?.[Number(ph.dataset.index)];if(src)openPhotoLightbox(src);return}
    const cover=ev.target.closest('[data-passport-cover]');if(cover){const e=entries.find(x=>x.id===cover.dataset.passportCover);if(e){const src=e.photos?.[0]||getLocationImage(e.location);if(src)openPhotoLightbox(src)}return}
    const locationPhoto=ev.target.closest('[data-location-photo]');if(locationPhoto){const src=getLocationImage(locationPhoto.dataset.locationPhoto);if(src)openPhotoLightbox(src);return}
    const gp=ev.target.closest("[data-graph-point]");if(gp){openGraphRestaurant(gp.dataset.graphPoint);return}
    const gb=ev.target.closest("[data-graph-bar]");if(gb){openGraphGroup(gb.dataset.graphBar);return}
    const gom=ev.target.closest("[data-open-map]");if(gom){prefs.view="map";mapLocationFocus=gom.dataset.openMap;savePrefs();$("passportDialog").close();applyView();return}
    const clearGraph=ev.target.closest("[data-clear-graph-filter]");if(clearGraph){prefs.graph.filters[clearGraph.dataset.clearGraphFilter]="";savePrefs();syncControls();renderGraph(filtered());return}
    const clear=ev.target.closest("[data-clear-filter]");if(clear){prefs.filters[clear.dataset.clearFilter]="";savePrefs();syncControls();render();return}
    const ls=ev.target.closest("[data-list-select]");if(ls){prefs.activeListId=ls.dataset.listSelect;savePrefs();render();return}
    const el=ev.target.closest("[data-edit-list]");if(el){openEditList(el.dataset.editList);return}
    const mv=ev.target.closest("[data-move-list]");if(mv){moveListItem(mv.dataset.moveList,Number(mv.dataset.index),Number(mv.dataset.dir));return}
    const rm=ev.target.closest("[data-remove-from-list]");if(rm){removeFromList(rm.dataset.removeFromList,rm.dataset.rid);return}
    const vv=ev.target.closest("[data-edit-visit]");if(vv){openEditVisit(vv.dataset.editVisit);return}
    const bubble=ev.target.closest("[data-location-bubble]");if(bubble){openLocationBubble(bubble.dataset.locationBubble,bubble);return}
    if(!ev.target.closest(".menu-wrap"))document.querySelectorAll(".popover").forEach(p=>p.classList.remove("show"))
  };
  $("lightboxClose").onclick=()=>$("lightbox").close();
  $("lightbox").addEventListener('click',event=>{if(event.target===$("lightbox"))$("lightbox").close()});
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-empty-action]');if(!action)return;
    if(action.dataset.emptyAction==='add-restaurant')$("addBtn").click();
    else if(action.dataset.emptyAction==='clear-dish-filters'){$("dishSearch").value='';$("dishRarityFilter").value='';$("dishCategoryFilter").value='';renderDishes()}
    else if(action.dataset.emptyAction==='clear-restaurant-filters'){$("search").value='';prefs.filters=clone(DEFAULT_PREFS.filters);savePrefs();syncControls();render()}
  });
  document.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;
    if(event.target.matches('[data-photo],[data-passport-cover],[data-location-photo]')){event.preventDefault();event.target.click()}
  });
  $("filterBtn").onclick=e=>{e.stopPropagation();$("filterMenu").classList.toggle("show");$("sortMenu").classList.remove("show")};$("sortBtn").onclick=e=>{e.stopPropagation();$("sortMenu").classList.toggle("show");$("filterMenu").classList.remove("show")};
  $("applyFilters").onclick=()=>{prefs.filters={location:$("filterLocation").value,cuisine:$("filterCuisine").value,vibe:$("filterVibe").value,region:$("filterRegion").value,service:$("filterService").value,minScore:$("filterMinScore").value,minValue:$("filterMinValue").value,maxSpend:$("filterMaxSpend").value};savePrefs();$("filterMenu").classList.remove("show");render()};
  $("clearFilters").onclick=()=>{prefs.filters=clone(DEFAULT_PREFS.filters);savePrefs();syncControls();render()};$("applySort").onclick=()=>{prefs.sortProperty=$("sortProperty").value;prefs.sortDirection=$("sortDirection").value;savePrefs();$("sortMenu").classList.remove("show");render()};
  document.querySelectorAll("th[data-sort]").forEach(th=>th.onclick=()=>{const p=th.dataset.sort;if(prefs.sortProperty===p)prefs.sortDirection=prefs.sortDirection==="asc"?"desc":"asc";else{prefs.sortProperty=p;prefs.sortDirection=["restaurant","cuisine","location","grandRank"].includes(p)?"asc":"desc"}savePrefs();syncControls();render()});
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{mobileGo(b.dataset.view);document.querySelector(".workspace").scrollTop=0;setMobileSidebarOpen(false)});
  $("profileForm").onsubmit=e=>{e.preventDefault();const username=$("profileUsername").value.trim();if(!username){$("profileSaveStatus").textContent="Enter a username.";return}const old=profile.username;profile.username=username.slice(0,30);if(saveProfile()){$("profileSaveStatus").textContent="Saved on this device ✓";renderProfile()}else{profile.username=old;$("profileSaveStatus").textContent="Could not save. Check browser storage."}};
  $("profilePhotoInput").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;$("profileSaveStatus").textContent="Preparing image…";try{await updateProfilePicture(file);$("profileSaveStatus").textContent="Picture saved ✓"}catch(error){$("profileSaveStatus").textContent=error.message}finally{e.target.value=""}};
  $("profileRemovePhoto").onclick=()=>{const old=profile.photo;profile.photo="";if(saveProfile()){$("profileSaveStatus").textContent="Picture removed";renderProfile()}else{profile.photo=old;$("profileSaveStatus").textContent="Could not save"}};
  $("newListBtn").onclick=openNewList;$("saveListBtn").onclick=saveList;$("deleteListBtn").onclick=deleteList;
  $("backToBubbles").onclick=backToBubbleGraph;
  $("logVisitBtn").onclick=openNewVisit;$("saveVisitBtn").onclick=saveVisit;$("deleteVisitBtn").onclick=deleteVisit;
  $("visitRestaurantSearch").oninput=()=>{};
  $("visitPaidFor").onchange=updateVisitTreat;
  $("prevMonthBtn").onclick=()=>{visitMonthCursor=new Date(visitMonthCursor.getFullYear(),visitMonthCursor.getMonth()-1,1);selectedCalendarDate='';calendarShowingWholeMonth=false;renderVisitHistory()};
  $("nextMonthBtn").onclick=()=>{visitMonthCursor=new Date(visitMonthCursor.getFullYear(),visitMonthCursor.getMonth()+1,1);selectedCalendarDate='';calendarShowingWholeMonth=false;renderVisitHistory()};
  $("todayMonthBtn").onclick=()=>{const d=new Date();visitMonthCursor=new Date(d.getFullYear(),d.getMonth(),1);selectedCalendarDate='';calendarShowingWholeMonth=false;renderVisitHistory()};
  $("exportBtn").onclick=exportBackup;$("importBtn").onclick=()=>$("importFile").click();
  $('importFile').onchange=async ev=>{
    const file=ev.target.files?.[0];if(!file)return;
    try{
      if(file.size>200*1024*1024)throw new Error('This backup exceeds 200 megabytes. Reduce photo size or split your journal before importing.');
      pendingImport=validateBackup(JSON.parse(await file.text()));
      const d=pendingImport;
      $('importSummary').textContent=`Ready to restore: ${d.entries.length} restaurants, ${d.lists.length} lists, ${d.visits.length} visits, ${d.locations.length} location photos and ${d.drafts.length} drafts.${d.legacy?' Legacy backup: fields not present in the file will be empty on Replace.':''}`;
      $('recoReplaceConsent').checked=false;updateReplaceConsent();renderV45ImportPreview(d);$('importDialog').showModal();
    }catch(error){pendingImport=null;alert('Could not validate the Recolleat backup: '+error.message)}
    finally{ev.target.value=''}
  };
  $("cancelImport").onclick=()=>{pendingImport=null;$("importDialog").close()};$("mergeImport").onclick=()=>importData("merge");$("replaceImport").onclick=()=>importData("replace");
}


// Quick Add and draft collection are intentionally separate from rated restaurant records.
const DRAFT_KEY='recolleat-local-drafts-v1',RECENT_KEY='recolleat-recent-restaurant-ids-v1';
let editingDraftId=null;
function readDrafts(){try{const v=JSON.parse(localStorage.getItem(DRAFT_KEY)||'[]');return Array.isArray(v)?v.filter(x=>x&&typeof x.name==='string').slice(0,250):[]}catch{return []}}
function writeDrafts(d){try{localStorage.setItem(DRAFT_KEY,JSON.stringify(d));return true}catch{notify('Device storage is full; draft was not saved.','error');return false}}
function draftFromForm(){
  const items=[...document.querySelectorAll('.item-edit')].map(row=>({name:row.querySelector('.dish-name')?.value.trim()||'',rating:recordedDishScore(row.querySelector('.dish-rating')?.value),categories:normalizeDishCategoryNames(row.querySelector('.dish-categories-input')?.value||''),photo:row.dataset.photo||''})).filter(i=>i.name);
  const visitRows=[...document.querySelectorAll('#editorVisitRows [data-visit-id]')];
  // Dates in the draft are taken from the visible editor, even if a change event has not fired.
  const savedVisits=workingVisits.map(v=>{const row=visitRows.find(x=>x.dataset.visitId===v.id);return {...v,date:row?.querySelector('.visit-date-field')?.value??v.date}});
  return {id:editingDraftId||uid(),name:$('restaurant').value.trim(),cuisine:$('cuisine').value.trim(),location:$('location').value.trim(),foodScore:Number($('foodScore').value),valueScore:Number($('valueScore').value),service:$('service').value,pp:Number($('pp').value),international:$('international').checked,vibes:[...document.querySelectorAll('.vibe-check input:checked')].map(e=>e.value),items,visits:savedVisits,photos:[...workingPhotos],locationPhoto:locationImageEdited?workingLocationImage:'',notes:$('notes').value.trim(),updatedAt:new Date().toISOString()};
}
function upsertDraft(d){if(!d.name){notify('Enter a restaurant name first.','error');return false}const saved=readDrafts();const i=saved.findIndex(x=>x.id===d.id);if(i>=0)saved[i]=d;else saved.unshift(d);if(!writeDrafts(saved))return false;renderDrafts();return true}
function renderDrafts(){const panel=$('draftsPanel');if(!panel)return;const items=readDrafts();panel.hidden=!items.length;$('draftsCount').textContent=`${items.length} unfinished`;
  $('draftCards').innerHTML=items.map(d=>`<div class="draft-row"><div><b>${esc(d.name)}</b><small>${esc([d.cuisine,d.location].filter(Boolean).join(' · ')||'Review not completed')}</small></div><div><button type="button" data-open-draft="${esc(d.id)}">Continue</button><button type="button" data-delete-draft="${esc(d.id)}" aria-label="Delete ${esc(d.name)} draft">×</button></div></div>`).join('');}
function openDraft(id){
 const d=readDrafts().find(x=>x.id===id);if(!d)return;resetEditor();editingDraftId=d.id;
 $('restaurant').value=d.name;$('cuisine').value=d.cuisine||'';$('location').value=d.location||'';$('notes').value=d.notes||'';
 if(Number.isFinite(d.foodScore))setFoodScore(d.foodScore);
 if(Number.isFinite(d.valueScore))setValueScore(d.valueScore);
 if(Number.isFinite(d.pp))setPP(d.pp);
 if(typeof d.service==='string'&&[...$('service').options].some(o=>o.value===d.service))$('service').value=d.service;
 $('international').checked=!!d.international;
 document.querySelectorAll('.vibe-check input').forEach(e=>e.checked=(d.vibes||[]).includes(e.value));
 if(Array.isArray(d.items)&&d.items.length){$('itemsEditor').innerHTML='';d.items.forEach(addItemRow)}
 if(Array.isArray(d.visits)){workingVisits=d.visits.map(normaliseVisit);renderEditorVisits()}
 if(Array.isArray(d.photos)){workingPhotos=d.photos.filter(x=>typeof x==='string'&&x.startsWith('data:image/'));photoPreview()}
 if(typeof d.locationPhoto==='string'&&d.locationPhoto.startsWith('data:image/'))setLocationImagePreview(d.locationPhoto,true);
 setEditorStep(1);$('editorTitle').textContent='Finish your draft';$('editor').showModal();
}
function removeDraft(id){if(!writeDrafts(readDrafts().filter(d=>d.id!==id)))return;renderDrafts();notify('Draft removed.');}
function openQuickAdd(){openUnifiedQuickLog()}
function quickDraft(){return {id:uid(),name:$('quickName').value.trim(),cuisine:$('quickCuisine').value.trim(),location:$('quickLocation').value.trim(),foodScore:$('quickFood').value===''?null:Number($('quickFood').value),notes:'',updatedAt:new Date().toISOString()}}
async function publishQuickRestaurant(){
 const draft=quickDraft(),score=draft.foodScore;
 if(!draft.name||score===null||!Number.isFinite(score)||score<0||score>100){notify('Enter a restaurant name and a food score from 0 to 100.','error');return}
 const duplicate=entries.find(e=>similarName(e.restaurant,draft.name)&&locationKey(e.location)===locationKey(draft.location));
 if(duplicate){notify('That restaurant is already saved. Open it to add another visit.','error');return}
 const e=normalise({id:uid(),restaurant:draft.name,cuisine:draft.cuisine,location:draft.location,foodScore:score,valueScore:null,service:'Unrated',pp:null,manualVisitCount:1,items:[]});
 const visit=normaliseVisit({id:uid(),restaurantId:e.id,date:'',spend:null,foodValue:null,note:''});
 try{await mutateStores([[RESTAURANTS,'put',e],[VISITS,'put',visit]]);entries.push(e);visits.push(visit);$('quickAddDialog').close();render();notify('Food rating saved. Add value and service later for an overall rank.')}
 catch(error){console.error(error);notify('Could not save. Check storage before retrying.','error')}
}
function rememberRestaurant(id){let a=[];try{a=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]')}catch{};a=[id,...a.filter(x=>x!==id)].slice(0,6);try{localStorage.setItem(RECENT_KEY,JSON.stringify(a))}catch{};renderRecents()}
function renderRecents(){const node=$('recentRestaurantChips');if(!node)return;let ids=[];try{ids=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]')}catch{};const found=ids.map(id=>entries.find(x=>x.id===id)).filter(Boolean).slice(0,4);node.innerHTML=found.length?found.map(e=>`<button type="button" data-open-passport="${esc(e.id)}">${esc(e.restaurant)}</button>`).join(''):'<small>Restaurants you open will appear here.</small>'}
let editorStep=1;
function setEditorStep(num){editorStep=Math.max(1,Math.min(3,Number(num)||1));const d=$('editor');d.dataset.step=String(editorStep);
  d.querySelectorAll('[data-editor-select-step]').forEach(b=>{const on=Number(b.dataset.editorSelectStep)===editorStep;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1});
  d.querySelectorAll('.editor-section:not(.editor-subsection)').forEach(sec=>{const on=Number(sec.dataset.editorStep)===editorStep;sec.hidden=!on;if(on)sec.open=true});
  $('editorStepLabel').textContent=`Step ${editorStep} of 3`;$('editorPrevStep').disabled=editorStep===1;$('editorNextStep').disabled=editorStep===3;
  d.querySelectorAll('.editor-subsection').forEach(sec=>{sec.hidden=editorStep!==3});
  const y=d.querySelector('.dialog-head');if(y)y.scrollIntoView({block:'nearest',behavior:'instant'});
}
function notify(message,type='success'){let n=$('appToast');if(!n)return;n.textContent=message;n.dataset.kind=type;n.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>n.classList.remove('show'),2600)}

let mobileVisibleCount=5;
function renderMobileHome(data,ranks){
  const count=$('mobileCurrentCount');if(count)count.textContent=`${entries.length} saved`;
  const result=$('mobileResultCount');if(result)result.textContent=`${data.length} ${data.length===1?'restaurant':'restaurants'}`;
  $('mobileRestaurantFeed').innerHTML=data.length?data.slice(0,mobileVisibleCount).map(e=>{
    const photo=e.photos?.[0]||getLocationImage(e.location),score=overallScore(e),r=ranks.get(e.id)||'—';
    return `<article class="mobile-restaurant"><button class="mobile-photo" type="button" data-open-passport="${esc(e.id)}" aria-label="Open ${esc(e.restaurant)}">${photo?`<img loading="lazy" src="${esc(photo)}" alt="${esc(e.restaurant)}">`:'✦'}<span class="photo-count">#${r}</span></button><div class="mobile-r-copy"><div class="mobile-r-upper"><div style="min-width:0"><h3>${esc(e.restaurant)}</h3><small>${esc(e.cuisine||'Restaurant')} · ${esc(e.location||'No location')}</small></div><span class="mobile-r-score" style="background:${score===null?'#68736d':scoreColor(score)}">${score===null?'—':score}</span></div><div class="mobile-pillrow"><span class="mobile-pill">Food ${e.foodScore}</span><span class="mobile-pill">Value ${e.valueScore===null?'—':Math.round(e.valueScore)}</span><span class="mobile-pill">${ppText(e.pp)}</span></div><div class="mobile-r-actions"><button type="button" data-open-passport="${esc(e.id)}">View passport</button><button type="button" data-log-visit="${esc(e.id)}">Log visit</button></div></div></article>`;
  }).join(''):`<div class="mobile-empty reco-empty-state"><b>${entries.length?'No restaurants match':'Start your restaurant journal'}</b><p>${entries.length?'Try another search or remove a filter.':'Save your first restaurant and build your own food archive.'}</p><button type="button" data-empty-action="${entries.length?'clear-restaurant-filters':'add-restaurant'}">${entries.length?'Clear search and filters':'Add first restaurant'}</button></div>`;
  renderDrafts();renderRecents();renderNeedsAttention();renderV41HomeEnhancements();
  const more=$('mobileShowMoreRestaurants');if(more){more.hidden=mobileVisibleCount>=data.length;more.textContent=`Load ${Math.min(10,Math.max(0,data.length-mobileVisibleCount))} more restaurants`;}
}
function renderNeedsAttention(){
 const panel=$('needsAttention');if(!panel)return;
 const missingPhoto=entries.filter(e=>!e.photos?.length),unclassifiedIds=new Set(dishRecords().filter(d=>!d.item.category&&!d.item.categories?.length).map(d=>d.e.id)),unclassified=entries.filter(e=>unclassifiedIds.has(e.id));
 const issues=[...missingPhoto.slice(0,3).map(e=>({e,kind:'No cover photo'})),...unclassified.slice(0,3).map(e=>({e,kind:'Uncategorised dishes'}))];
 const allCount=missingPhoto.length+unclassified.length+readDrafts().length;
 panel.hidden=allCount===0;
 $('attentionSummary').textContent=`Collection check · ${allCount} optional improvements`;
 $('attentionItems').innerHTML=`<p>These are suggestions, not required tasks. Your existing ratings remain valid.</p>${issues.map(x=>`<button type="button" data-open-passport="${esc(x.e.id)}"><b>${esc(x.e.restaurant)}</b><small>${esc(x.kind)}</small></button>`).join('')}${readDrafts().length?`<p>${readDrafts().length} unfinished drafts appear below.</p>`:''}`;
}
const MOBILE_SECTIONS={account:['Friends','Your private connections'],home:['Home','Your journal at a glance'],table:['Collection','Your restaurants and rankings'],cards:['Restaurant Cards','Your visual passport collection'],map:['Places & Memories','Explore your location constellations'],cuisines:['Cuisine Rankings','The cuisines you keep coming back to'],graph:['Grand List Graph','Explore trends and restaurant scores'],lab:['Settings','Your journal preferences'],settings:['Settings','Personalise scoring, backups and privacy'],dishes:['Dishes','Rankings and signature gallery'],dna:['Dishes','Explore all your dishes'],lists:['Saved Lists','Your personal collections'],visits:['Visit calendar','Your visits, one day at a time'],profile:['My Profile','Your local identity and collection'],help:['Help & FAQs','Guides, tips and common questions'],privacy:['Privacy & Safety','Your data, your choices'],terms:['Terms of Use','How Recolleat works and your rights']};
function mobileApplyNavigation(v){
  if(!$('mobileHome'))return;
  $('mobileHome').style.display=v==='table'?'grid':'none';
  if(v==='visits')changeCalendarMode(calendarDisplayMode);
  $('tableView').style.display='none';
  const labels=MOBILE_SECTIONS[v]||MOBILE_SECTIONS.table;
  $('mobileSectionTitle').textContent=labels[0];$('mobileSectionSubtitle').textContent=labels[1];
  $('mobileIntro').hidden=true;
  document.querySelectorAll('[data-mobile-view]').forEach(b=>{const active=b.dataset.mobileView===v;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('mobileMoreBtn').classList.toggle('active',!['home','table','profile','visits'].includes(v));
  document.querySelector('.stats').style.display=(v==='table'||v==='cards')?'grid':'none';
  document.querySelector('.controls').style.display=(v==='table'||v==='cards'||v==='graph')?'grid':'none';
  $('mobileControlMount').style.display=(v==='table'||v==='graph')?'flex':'none';
  const chips=$('chips');chips.style.display=(v==='table'||v==='cards'||v==='graph')?'flex':'none';
  if($('recoSearchResultStatus'))$('recoSearchResultStatus').hidden=!['table','cards'].includes(v)||!($('search').value.trim()||Object.values(prefs.filters||{}).some(x=>x!==''&&x!==null&&x!==undefined));
}
let recoHandlingHistory=false;
function mobileGo(view,options={}){
  if(view==='dna')view='dishes';if(view==='lab')view='settings';if(view==='graph')view='table';
  if(!(view in MOBILE_SECTIONS))view='table';
  const previous=prefs.view;
  if(view!==previous&&!options.fromHistory&&!recoHandlingHistory){
    try{window.history.pushState({recolleatView:view},'',window.location.href)}catch(e){console.warn('Navigation history unavailable',e)}
  }
  prefs.view=view;savePrefs();applyView();closeMobileMore();closeDreamHub();
  window.scrollTo({top:0,behavior:'instant'});
}
function initializeRecolleatHistory(){
  // Restore the previous screen when the user swipes back, presses Back, or uses browser history.
  if(!history.state?.recolleatView){try{history.replaceState({recolleatView:prefs.view==='dna'?'dishes':(prefs.view||'table')},'',location.href)}catch{}}
  window.addEventListener('popstate',e=>{
    recoHandlingHistory=true;
    // An ordinary earlier browser entry is not replaced with a fake in-app view.
    const v=e.state?.recolleatView;
    document.querySelectorAll('dialog[open]').forEach(dialog=>{try{dialog.close()}catch{}});
    if(v)mobileGo(v,{fromHistory:true});
    recoHandlingHistory=false;
  });
}
function openDreamHub(){/* Old hub removed in favour of the top tab navigation. */}
function closeDreamHub(){document.documentElement.classList.remove('dream-hub-open')}
function updateDreamHub(){/* No hub counters needed in compact navigation. */}

let v41MoreTrigger=null;
function openMobileMore(){
  renderBackupStatus();v41MoreTrigger=document.activeElement;
  const sheet=$('mobileMoreSheet');sheet.scrollTop=0;sheet.inert=false;
  $('mobileMoreBackdrop').classList.add('open');sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');
  $('mobileMoreBtn').setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';document.documentElement.classList.add('mobile-menu-open');
  const app=document.querySelector('.app');if(app)app.inert=true;
  $('mobileMoreClose').focus({preventScroll:true});
}
function closeMobileMore(){
  const sheet=$('mobileMoreSheet');
  $('mobileMoreBackdrop').classList.remove('open');sheet.classList.remove('open');
  const app=document.querySelector('.app');if(app)app.inert=false;
  if(sheet.contains(document.activeElement)){
    const restore=v41MoreTrigger?.isConnected?v41MoreTrigger:$('mobileMoreBtn');
    try{restore.focus({preventScroll:true})}catch{}
  }
  sheet.inert=true;sheet.setAttribute('aria-hidden','true');
  $('mobileMoreBtn').setAttribute('aria-expanded','false');
  document.body.style.overflow='';document.documentElement.classList.remove('mobile-menu-open');

}

async function eraseRecolleatLocalData(){
  // Do not delete unrelated site data, service workers or offline assets.
  const acknowledgement=window.prompt('This will permanently erase the Recolleat journal and profile stored in this browser. Export a backup first. Type DELETE to continue:');
  if(acknowledgement!=='DELETE')return;
  const answer=window.confirm('Final confirmation: erase all restaurants, dishes, visits, location images, saved lists and your local Recolleat profile on this device?');
  if(!answer)return;
  const status=$('privacyStatus');
  status.textContent='Removing local Recolleat data…';
  try{
    if(!db)throw new Error('The local database is unavailable. Nothing was changed.');
    await mutateStores([RESTAURANTS,LISTS,VISITS,LOCATIONS,MEDIA,SNAPSHOTS].map(name=>[name,'clear']));
    localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(DRAFT_KEY);localStorage.removeItem(RECENT_KEY);
    localStorage.removeItem(PREF_KEY);localStorage.removeItem(REWARDS_KEY);localStorage.removeItem(QUICK_LOG_KEY);localStorage.removeItem(BACKUP_MARK_KEY);localStorage.removeItem(BACKUP_FINGERPRINT_KEY);earnedRewardLevels=[];mediaById.clear();mediaBySource.clear();
    reco50Undo=null;entries=[];lists=[];visits=[];locationMedia=[];profile={username:'',photo:''};
    prefs=clone(DEFAULT_PREFS);
    editingId=null;editingListId=null;editingVisitId=null;
    savePrefs();applyAppearance();render();
    status.textContent='This browser’s Recolleat journal and local profile were erased. Exports and hosting-provider data are not affected.';
  }catch(error){status.textContent='Deletion was not completed: '+error.message;console.error(error)}
}


// V39: Dishes gallery tabs and a direct rank jump. No data is altered by switching views.
let activeDishPanel='hall';
function setDishPanel(which){
  activeDishPanel=['signature','categories'].includes(which)?which:'hall';
  const gallery=$('dnaPanelSignature');
  if(!gallery)return;
  const hall=$('dishPanelHall');
  hall.hidden=activeDishPanel!=='hall';gallery.hidden=activeDishPanel!=='signature';$('dishPanelCategories').hidden=activeDishPanel!=='categories';
  document.querySelectorAll('[data-dish-panel]').forEach(button=>{
    const on=button.dataset.dishPanel===activeDishPanel;
    button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;
  });
  if(activeDishPanel==='signature')renderDNA();
  if(activeDishPanel==='categories')$('dishCategoriesAccordion').open=true;
}
function setupDishPanels(){
  document.querySelectorAll('[data-dish-panel]').forEach(b=>b.addEventListener('click',()=>setDishPanel(b.dataset.dishPanel)));
  setDishPanel('hall');
}
function jumpToDishRank(event){
  event.preventDefault();
  const n=Math.floor(Number($('dishJumpNumber').value));
  const all=allDishes();
  if(!Number.isFinite(n)||n<1||n>all.length){notify(`Choose a dish rank from 1 to ${all.length}.`,'error');return}
  // Restore the global ranking so #n always refers to the original Hall of Flavour, not a filtered subset.
  $('dishSearch').value='';$('dishCategoryFilter').value='';$('dishRarityFilter').value='';$('dishSort').value='high';
  $('hallAccordion').open=true;$('hallAccordion').dataset.compact='false';
  setDishPanel('hall');renderDishes();
  const target=$('hallOfFlavour').querySelector(`[data-global-dish-rank="${n}"]`);
  if(target){target.scrollIntoView({block:'center',behavior:'smooth'});target.classList.add('highlight-dish');setTimeout(()=>target.classList.remove('highlight-dish'),1800);notify(`Hall of Flavour rank #${n}`)}
  else notify('The selected dish could not be displayed.','error');
}

// Seven-comparison rating helper: bounded adaptive search over prior food scores.
// Each answer refines an interval; suggestions are never saved without explicit acceptance.
let foodHelper=null;
function foodHelperRecency(restaurant){
  const date=typeof latestVisitDate==='function'?(latestVisitDate(restaurant)||restaurant.dateVisited||restaurant.createdAt):restaurant.dateVisited;
  const time=Date.parse(date||'');return Number.isFinite(time)?time:0;
}
function foodHelperCandidates(){
  const name=($('restaurant').value||'').trim().toLowerCase();
  return entries.filter(e=>e.id!==editingId&&e.restaurant?.trim().toLowerCase()!==name&&Number.isFinite(Number(e.foodScore))&&e.foodScore!==null&&e.foodScore!==''&&Number(e.foodScore)>=0&&Number(e.foodScore)<=100)
    .map(e=>({id:e.id,name:e.restaurant,location:e.location||'',score:Number(e.foodScore),time:foodHelperRecency(e)}));
}
function chooseFoodComparator(){
  const h=foodHelper;
  if(!h||h.steps>=7)return null;
  const pool=h.candidates.filter(e=>!h.used.has(e.id)&&!h.usedScores.has(e.score));
  if(!pool.length)return null;
  const mid=(h.low+h.high)/2;
  // Prefer the most informative midpoint comparison, then prefer recent restaurants.
  const inside=pool.filter(e=>e.score>h.low+0.5&&e.score<h.high-0.5);
  const choices=inside.length?inside:pool;
  const maxTime=Math.max(0,...choices.map(e=>e.time));
  choices.sort((a,b)=>{
    const cost=x=>Math.abs(x.score-mid)+((maxTime&&x.time)?Math.min(2, (maxTime-x.time)/(1000*60*60*24*365.25)):2.5);
    return cost(a)-cost(b)||a.name.localeCompare(b.name);
  });
  // Once there is no comparator in the remaining interval, questions are no longer informative.
  if(!inside.length&&h.steps>0)return null;
  return choices[0];
}
function foodHelperSuggestion(){
  const h=foodHelper;if(!h)return null;
  const v=h.nearScores.length?((h.low+h.high)/2+h.nearScores.reduce((a,b)=>a+b,0)/h.nearScores.length)/2:(h.low+h.high)/2;
  return Math.max(0,Math.min(100,Math.round(v)));
}
function updateFoodHelperUI(){
  const h=foodHelper;if(!h)return;
  const comp=chooseFoodComparator();
  const suggestion=foodHelperSuggestion();
  const wide=Math.round(h.high-h.low);
  $('ratingHelperProgress').textContent=`Comparison ${Math.min(h.steps+1,7)} of up to 7 · Current range: ${Math.ceil(h.low)}–${Math.floor(h.high)} out of 100`;
  const q=$('ratingHelperQuestion'),out=$('ratingHelperResult'),use=$('ratingHelperUse');
  if(!comp||h.steps>=7||wide<=4){
    q.innerHTML='';
    if(h.steps===0){out.innerHTML='<strong>No comparisons available yet.</strong><p>Add a few previously rated restaurants first. You can always enter your food rating directly.</p>';use.hidden=true;return}
    out.innerHTML=`<strong>Suggested food rating: ${suggestion}/100</strong><p>${h.steps?`Based on ${h.steps} comparison${h.steps===1?'':'s'}.`:'There were no suitable comparison restaurants.'} Your current plausible range is ${Math.ceil(h.low)}–${Math.floor(h.high)}. This is an adaptive comparison estimate, not a validated forecast of food quality.</p>`;
    use.hidden=h.steps===0;return;
  }
  h.active=comp;
  out.innerHTML='';use.hidden=true;
  q.innerHTML=`<div class="rating-helper-question"><h3>${esc(comp.name)}</h3><p>${esc(comp.location||'Previously rated restaurant')} · Your saved food rating: <strong>${comp.score}/100</strong></p><p>Compared with this restaurant, how was the food at the one you're rating now?</p><div class="rating-helper-choices"><button type="button" data-food-answer="higher">Better food</button><button type="button" data-food-answer="equal">About the same</button><button type="button" data-food-answer="lower">Worse food</button></div></div>`;
  q.querySelectorAll('[data-food-answer]').forEach(b=>b.onclick=()=>answerFoodComparator(b.dataset.foodAnswer));
}
function answerFoodComparator(answer){
  const h=foodHelper;if(!h?.active)return;
  const c=h.active;h.used.add(c.id);h.usedScores.add(c.score);h.steps++;
  if(answer==='higher')h.low=Math.max(h.low,c.score+1);
  if(answer==='lower')h.high=Math.min(h.high,c.score-1);
  if(answer==='equal'){
    h.low=Math.max(h.low,c.score-4);h.high=Math.min(h.high,c.score+4);h.nearScores.push(c.score);
  }
  if(h.low>h.high){h.low=Math.max(0,c.score-2);h.high=Math.min(100,c.score+2)}
  h.active=null;updateFoodHelperUI();
}
function stopFoodHelper(){
  if(!foodHelper?.steps){$('foodRatingDialog').close();return}
  if(foodHelper.steps>=7||!chooseFoodComparator()){$('foodRatingDialog').close();return}
  foodHelper.steps=7;updateFoodHelperUI();$('ratingHelperStop').textContent='Close';
  $('ratingHelperStop').onclick=()=>$('foodRatingDialog').close();
}
function setupFoodRatingHelper(){
  $('openFoodRatingHelper').onclick=()=>{
    foodHelper={low:0,high:100,steps:0,used:new Set(),usedScores:new Set(),nearScores:[],candidates:foodHelperCandidates(),active:null};
    $('ratingHelperUse').hidden=true;
    $('ratingHelperStop').textContent='Finish now';
    $('ratingHelperStop').onclick=stopFoodHelper;
    $('ratingHelperResult').textContent='';updateFoodHelperUI();
    $('ratingHelperStop').textContent='Finish now';
    $('foodRatingDialog').showModal();
  };
  $('ratingHelperClose').onclick=()=>$('foodRatingDialog').close();
  $('ratingHelperStop').onclick=stopFoodHelper;
  $('ratingHelperUse').onclick=()=>{
    if(foodHelper?.steps){setFoodScore(foodHelperSuggestion());$('foodRatingDialog').close();notify('Suggested food score applied. You can still adjust it before saving.')} 
  };
}

function setupPassportPages(){
 const root=$('passportContent'); if(!root)return;
 const choose=page=>{
  for(const button of root.querySelectorAll('[data-passport-page]')){const on=button.dataset.passportPage===page;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1}
  for(const [name,id] of [['ratings','passportRatingsPage'],['journal','passportJournalPage']]){const el=$(id);if(el)el.hidden=name!==page;}
 };
 root.addEventListener('click',e=>{const button=e.target.closest('[data-passport-page]');if(button)choose(button.dataset.passportPage)});
 let startX=0,startY=0;
 root.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;startX=e.touches[0].clientX;startY=e.touches[0].clientY},{passive:true});
 root.addEventListener('touchend',e=>{if(!startX)return;const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;startX=0;if(Math.abs(dx)<75||Math.abs(dx)<Math.abs(dy)*1.5)return;if(e.target.closest('button,input,select,textarea,a'))return;choose(dx<0?'journal':'ratings')},{passive:true});
}
function setupMobile(){
  setupPassportPages();
  // Rehome the existing exhibition; keep its element IDs, photos and renderer unchanged.
  const signaturePanel=$('dnaPanelSignature');
  if(signaturePanel&&!$('dishesView').contains(signaturePanel)){
    $('dishesView').appendChild(signaturePanel);
    signaturePanel.hidden=true;
  }
  setupDishPanels();
  initializeRecolleatHistory();
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>closeDreamHub()));
  // The Calendar has its own main tab; Wrapped remains one tap away.
  $('visitCalendarTab').onclick=()=>changeCalendarMode('calendar');
  $('visitWrappedTab').onclick=()=>changeCalendarMode('wrapped');
  $('visitWrappedTab').addEventListener('click',()=>renderWrappedStories());
  for(const id of ['prevMonth','nextMonth','calendarMonthJump','calendarToday']){const el=$(id);if(el)el.addEventListener('change',()=>{wrappedSlide=0;renderWrappedStories()})}
  $('calendarGrid').addEventListener('click',event=>{
    const day=event.target.closest('[data-calendar-date]');if(!day)return;
    selectedCalendarDate=day.dataset.calendarDate;calendarShowingWholeMonth=false;renderVisitHistory();renderWrappedStories();
  });
  $('calendarShowMonth').onclick=()=>{calendarShowingWholeMonth=!calendarShowingWholeMonth;renderVisitHistory();renderWrappedStories()};
  $('settingsExport').onclick=()=>{closeMobileMore();$('exportBtn').click()};
  $('settingsImport').onclick=()=>{closeMobileMore();$('importBtn').click()};
  $('settingsPrivacy').onclick=()=>mobileGo('privacy');
  $('settingsTerms').onclick=()=>mobileGo('terms');
  $('settingsHelp').onclick=()=>mobileGo('help');
  $('settingsAppearance').onclick=()=>{openMobileMore();$('appearanceBtn').click()};
  $('mobileShowMoreRestaurants').onclick=()=>{mobileVisibleCount+=10;renderMobileHome(filtered(),grandRankMap())};
  $('toggleDishRanking').onclick=()=>{const a=$('hallAccordion');a.dataset.compact=a.dataset.compact==='true'?'false':'true';renderDishes()};
  // Keep Table / Graph, Sort and Filter together inside Grand List.
  const mobileTheme=$('mobileThemeMount');if(mobileTheme&&!mobileTheme.contains($('appearanceWrap')))mobileTheme.appendChild($('appearanceWrap'));
  const mount=$('mobileControlMount');
  mount.appendChild($('grandListTools'));
  document.querySelectorAll('[data-mobile-view]').forEach(b=>b.addEventListener('click',()=>{mobileGo(b.dataset.mobileView);requestAnimationFrame(fitCollectionMetrics)}));
  window.addEventListener('resize',()=>requestAnimationFrame(fitCollectionMetrics),{passive:true});
  document.querySelectorAll('[data-more-view]').forEach(b=>b.addEventListener('click',()=>mobileGo(b.dataset.moreView)));
  // Ranking mode is a presentation preference; it never alters saved reviews.
  document.querySelectorAll('[data-cuisine-mode]').forEach(button=>button.addEventListener('click',()=>{
    const mode=button.dataset.cuisineMode;
    if(mode!=='mean'&&mode!=='median')return;
    prefs.cuisineRankMode=mode;savePrefs();renderCuisineView();renderStats(filtered());requestAnimationFrame(fitCollectionMetrics);
  }));
  document.addEventListener('change',event=>{
    if(event.target?.id==='palatePersonaSelect'){
      browsedPalatePersonaCode=event.target.value;
      renderPalateCode();
    }
  });
  $('visitView').addEventListener('click',e=>{if(e.target.closest('#prevMonth,#nextMonth,#calendarToday')){wrappedSlide=0;queueMicrotask(renderWrappedStories)}});
  $('mobileMoreBtn').onclick=openMobileMore;$('mobileMoreClose').onclick=closeMobileMore;$('mobileMoreBackdrop').onclick=closeMobileMore;
  $('mobileExport').onclick=()=>{closeMobileMore();$('exportBtn').click()};
  $('mobileImport').onclick=()=>{closeMobileMore();$('importBtn').click()};
  $('v42VerifyBackup').onclick=()=>$('v42VerifyFile').click();
  $('v42VerifyFile').onchange=async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>200*1024*1024)throw new Error('File exceeds the 200 megabyte safety limit.');
      const data=validateBackup(JSON.parse(await file.text()));
      $('v42BackupStatus').textContent=`Backup structure readable: ${data.entries.length} restaurants, ${data.visits.length} visits, ${data.lists.length} lists and ${data.drafts.length} drafts. Keep the file safe; a test restoration is still advised.`;
      notify('Backup structure verified. No stored records were changed.');
    }catch(error){$('v42BackupStatus').textContent='Backup verification failed: '+error.message;notify('Backup file is not valid.','error')}
    finally{event.target.value=''}
  };
  $('privacyExport').onclick=exportBackup;
  $('privacyErase').onclick=eraseRecolleatLocalData;
  $('privacyFooterLink').onclick=()=>mobileGo('privacy');
  $('termsFooterLink').onclick=()=>mobileGo('terms');
  $('privacyTermsLink').onclick=()=>mobileGo('terms');
  $('termsPrivacyLink').onclick=()=>mobileGo('privacy');
  $('termsPrivacyBottom').onclick=()=>mobileGo('privacy');
  const fontKey='recolleat-google-fonts-opt-in-v2';
  const fontButton=$('privacyFontToggle'),fontStatus=$('privacyFontStatus');
  const updateFontButton=()=>{
    const enabled=localStorage.getItem(fontKey)==='yes';
    fontButton.setAttribute('aria-pressed',String(enabled));
    fontButton.textContent=enabled?'Disable Google Fonts (external connection)':'Enable Google Fonts (external connection)';
    fontStatus.textContent=enabled?'Google Fonts is enabled. Google can receive connection data when your browser loads font resources.':'Google Fonts is off. Recolleat uses the device font without requesting the Google font servers.';
  };
  try{updateFontButton()}catch(error){fontButton.disabled=true;fontStatus.textContent='This browser cannot save the optional font setting; external fonts remain disabled.';}
  fontButton.onclick=()=>{
    try{
      const next=localStorage.getItem(fontKey)==='yes'?'no':'yes';
      localStorage.setItem(fontKey,next);
      // Reload so turning off the preference immediately stops future font requests.
      location.reload();
    }catch(error){fontStatus.textContent='The font preference could not be saved; no new font request was made.';}
  };
  // Device-independent dish-photo controls, including browsers without clipboard-image access.
  const dishPaste=$('dishPhotoPasteZone');
  if(dishPaste){dishPaste.textContent='Paste a dish photo here, or choose an image from your device';
  const copyBtn=document.createElement('button');copyBtn.type='button';copyBtn.id='mobileDishClipboard';copyBtn.textContent='Paste image from clipboard';copyBtn.style.cssText='display:block;width:100%;margin:10px 0;padding:12px;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-weight:800';
  dishPaste.insertAdjacentElement('afterend',copyBtn);
  const fileLabel=document.createElement('label');fileLabel.className='dish-mobile-upload';fileLabel.textContent='Choose a dish photo';
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='image/*';fileInput.setAttribute('aria-label','Choose a dish photo from your device');
  fileInput.onchange=async()=>{if(!fileInput.files?.[0])return;try{await saveDishPhoto(await imageToData(fileInput.files[0],1000,.76))}catch(e){alert('Could not add this photo: '+e.message)}finally{fileInput.value=''}};
  fileLabel.appendChild(fileInput);copyBtn.insertAdjacentElement('afterend',fileLabel);
  copyBtn.onclick=async()=>{
    if(!navigator.clipboard?.read){alert('Clipboard image reading is not supported in this browser. Long-press the paste area to paste an image or select an existing restaurant photo.');return}
    try{const items=await navigator.clipboard.read();for(const item of items){const mime=item.types.find(t=>t.startsWith('image/'));if(mime){await saveDishPhoto(await imageToData(await item.getType(mime)));return}}alert('No image was found in the clipboard. Copy a photo first.')}catch(err){alert('Clipboard permission was denied or unavailable. Long-press the paste area instead. '+err.message)}
  };
  }
  // Service worker updates are managed by setupV47AppUpdates().
  mobileApplyNavigation(prefs.view||'table');
}


// Monthly Wrapped: compact swipeable story cards; only explicitly dated visit records count.
let wrappedSlide=0;
function renderWrappedStories(){
 const target=$('wrappedReport');if(!target)return;
 const key=selectedMonthKey(),month=visits.filter(v=>monthKeyFromDate(v.date)===key),restMap=new Map(entries.map(e=>[e.id,e]));
 const linked=month.map(v=>restMap.get(v.restaurantId)).filter(Boolean),unique=[...new Map(linked.map(e=>[e.id,e])).values()];
 const paidSummary=sumRecordedMoney(month,'spend'),foodSummary=sumRecordedMoney(month,'foodValue');
 const treatedCount=month.filter(v=>v.paidFor===true).length;
 const best=unique.slice().filter(e=>overallScore(e)!==null).sort((a,b)=>overallScore(b)-overallScore(a))[0];
 const withDishes=month.flatMap(v=>(v.dishes||[]).filter(d=>d.rating!==null&&d.rating!==undefined&&Number.isFinite(Number(d.rating))&&Number(d.rating)>=0&&Number(d.rating)<=10).map(d=>({name:d.name,score:Number(d.rating),restaurant:restMap.get(v.restaurantId)?.restaurant||'Unknown restaurant'}))).sort((a,b)=>b.score-a.score);
 const cuisines=new Set(unique.map(e=>String(e.cuisine||'').trim()).filter(Boolean));
 const prevKey=(()=>{const d=new Date(visitMonthCursor.getFullYear(),visitMonthCursor.getMonth()-1,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')})();
 const prev=visits.filter(v=>monthKeyFromDate(v.date)===prevKey);
 const cards=[
  {k:'YOUR MONTH',title:formatMonth(visitMonthCursor),big:String(month.length),copy:`${month.length===1?'Logged visit':'Logged visits'} across ${unique.length} restaurants. Only visits with real dates are counted.`},
  {k:'HIGHEST RANKED',title:best?best.restaurant:'No scored restaurant',big:best?String(overallScore(best)):'—',copy:best?`${esc(best.cuisine||'Cuisine not set')} · best overall score among this month's visited restaurants.`:'Log a visit with a date to appear here.'},
  {k:'DISH OF THE MONTH',title:withDishes[0]?.name||'Not recorded',big:withDishes[0]?withDishes[0].score.toFixed(1):'—',copy:withDishes[0]?`Recorded for a visit at ${esc(withDishes[0].restaurant)} this month.`:'No dishes were rated on a specific visit this month. Restaurant-wide dish ratings are not assumed to have been eaten again.'},
  {k:'CUISINES THIS MONTH',title:`${cuisines.size} cuisines`,big:String(cuisines.size),copy:`${unique.length} unique restaurants appeared in your dated visit history this month.`},
  {k:'THE LITTLE DETAILS',title:paidSummary.count?`£${paidSummary.total.toFixed(2)} you paid`:'No personal spending recorded',big:prev.length&&month.length?`${month.length-prev.length>=0?'+':''}${month.length-prev.length}`:'—',copy:`Food value: ${foodSummary.count?'£'+foodSummary.total.toFixed(2):'not recorded'} (${foodSummary.count} of ${month.length} visits). ${paidSummary.count} visits include personal payment; ${treatedCount} ${treatedCount===1?'meal was':'meals were'} paid for by someone else. Previous month: ${prev.length} visits.`}
 ];
 wrappedSlide=Math.max(0,Math.min(wrappedSlide,cards.length-1));
 target.innerHTML=`<div class="wrapped-story-shell"><div class="wrapped-story-nav"><span>RECOLLEAT WRAPPED · ${esc(key)}</span><span>${wrappedSlide+1} / ${cards.length}</span></div>
 <article class="wrapped-story-card" role="group" aria-label="Monthly Wrapped slide ${wrappedSlide+1} of ${cards.length}"><span class="wrapped-story-kicker">${esc(cards[wrappedSlide].k)}</span><h3>${esc(cards[wrappedSlide].title)}</h3><strong>${esc(cards[wrappedSlide].big)}</strong><p>${cards[wrappedSlide].copy}</p></article>
 <div class="wrapped-story-controls"><button type="button" data-wrapped-step="-1" ${wrappedSlide===0?'disabled':''} aria-label="Previous slide">← Previous</button><div class="wrapped-story-dots">${cards.map((c,i)=>`<button type="button" data-wrapped-to="${i}" class="${i===wrappedSlide?'current':''}" aria-label="Go to slide ${i+1}" aria-current="${i===wrappedSlide?'step':'false'}"></button>`).join('')}</div><button type="button" data-wrapped-step="1" ${wrappedSlide===cards.length-1?'disabled':''} aria-label="Next slide">Next →</button></div></div>`;
 target.querySelectorAll('[data-wrapped-step]').forEach(b=>b.onclick=()=>{wrappedSlide=Math.max(0,Math.min(cards.length-1,wrappedSlide+Number(b.dataset.wrappedStep)));renderWrappedStories()});
 target.querySelectorAll('[data-wrapped-to]').forEach(b=>b.onclick=()=>{wrappedSlide=Number(b.dataset.wrappedTo);renderWrappedStories()});
 const surface=target.querySelector('.wrapped-story-card');let tx=0;
 surface.ontouchstart=e=>{tx=e.touches[0]?.clientX||0};surface.ontouchend=e=>{const dx=(e.changedTouches[0]?.clientX||0)-tx;if(Math.abs(dx)>55){wrappedSlide=Math.max(0,Math.min(cards.length-1,wrappedSlide+(dx<0?1:-1)));renderWrappedStories()}};
}

function dismissSplash(){const splash=$('recolleatSplash');if(!splash||splash.classList.contains('is-gone'))return;splash.classList.add('is-gone');setTimeout(()=>splash.remove(),450)}
$('splashSkip').onclick=dismissSplash;
// A fallback prevents animation from ever blocking the journal during a storage error.
setTimeout(dismissSplash,2200);

/* V41: useful return visit/first-run state, without altering existing database formats. */
function renderV41HomeEnhancements(){
  const empty=entries.length===0;
  const welcome=$('v41Welcome'), next=$('v41NextStep');
  if(!welcome||!next)return;
  welcome.hidden=!empty;
  const jumps=document.querySelector('#mobileHome .jump-recents');
  if(jumps)jumps.hidden=empty;
  // A new collector should see the first action, not four zero-valued statistics.
  const stats=document.querySelector('.workspace .stats');
  const control=document.querySelector('.workspace .controls');
  const quickTools=$('mobileControlMount');
  const header=document.querySelector('#mobileHome .mobile-list-header');
  for(const el of [stats,control,quickTools])if(el)el.hidden=empty;
  if(empty&&header){header.before(welcome)}
  else if(jumps)jumps.before(welcome);
  const filterWords=String($('search')?.value||'').trim();
  const clear=$('v41ClearSearch');if(clear)clear.hidden=!filterWords;
  next.hidden=true;
  if(empty)return;
  const drafts=readDrafts();
  const firstDraft=drafts[0];
  const loggedDishRestaurants=new Set(dishRecords().map(d=>d.e.id)),missingDishes=entries.find(e=>!loggedDishRestaurants.has(e.id));
  const missingPhoto=entries.find(e=>(e.photos||[]).length===0);
  let title='',description='',action='',actionLabel='Continue';
  if(firstDraft){
    title='Finish '+String(firstDraft.name||'your draft');
    description='Your unfinished restaurant review is saved locally.';
    action='draft:'+firstDraft.id;actionLabel='Review draft';
  }else if(missingDishes && entries.length<=8){
    title='Add your first dish at '+missingDishes.restaurant;
    description='A dish rating makes your food journal more personal.';
    action='passport:'+missingDishes.id;actionLabel='Open restaurant';
  }else if(missingPhoto&&entries.length<=5){
    title='Give '+missingPhoto.restaurant+' a cover photo';
    description='A photo makes your collection easier to recognise.';
    action='passport:'+missingPhoto.id;actionLabel='Open restaurant';
  }
  if(!title)return;
  $('v41NextTitle').textContent=title;
  $('v41NextCopy').textContent=description;
  const button=$('v41NextAction');button.textContent=actionLabel;button.dataset.v41Action=action;
  next.hidden=false;
}
function setupV41Experience(){
  $('v41StartQuick')?.addEventListener('click',()=>openQuickAdd());
  $('v41StartFull')?.addEventListener('click',()=>{resetEditor();setEditorStep(1);$('editor').showModal()});
  $('v41NextAction')?.addEventListener('click',event=>{
    const value=event.currentTarget.dataset.v41Action||'';
    if(value.startsWith('draft:'))document.querySelector('[data-open-draft="'+CSS.escape(value.slice(6))+'"]')?.click();
    else if(value.startsWith('passport:')){const id=value.slice(9),trigger=[...document.querySelectorAll('[data-open-passport]')].find(el=>el.dataset.openPassport===id);if(trigger)trigger.click();else{renderPassport(id);$('passportDialog').showModal()}}
  });
  $('v41ClearSearch')?.addEventListener('click',()=>{const input=$('search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()});
  // The bottom menu is a real modal surface: Escape closes it; keyboard focus stays inside.
  document.addEventListener('keydown',event=>{
    const sheet=$('mobileMoreSheet');
    if(!sheet?.classList.contains('open'))return;
    if(event.key==='Escape'){event.preventDefault();closeMobileMore();return}
    if(event.key!=='Tab')return;
    const nodes=[...sheet.querySelectorAll('button:not([disabled]):not([hidden]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
       .filter(el=>el.getClientRects().length&&!el.closest('[hidden]'));
    if(!nodes.length)return;
    const first=nodes[0],last=nodes[nodes.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
  // Use an obvious, repeatable add action; preserve the original Quick/Full choice.
  $('addBtn')?.setAttribute('title','Choose Quick Add or Full Review');
  $('mobileMoreSheet')?.setAttribute('aria-labelledby','v42MoreHeading');
  // Save operation and data structures remain untouched.
}


// Build 44: useful, low-pressure reasons to return. No accounts, tracking or remote services.
function v44DatedVisits(){return visits.filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v.date||'')))}
function v44RecentRestaurants(){
 const map=new Map(entries.map(e=>[e.id,e]));
 const today=new Date(),start=new Date(today.getFullYear(),today.getMonth(),today.getDate()-19).getTime();
 const ordered=v44DatedVisits().filter(v=>{const time=Date.parse(v.date+'T12:00:00');return Number.isFinite(time)&&time>=start&&time<=Date.now()+86400000})
   .sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 const found=[],seen=new Set();
 for(const visit of ordered){const e=map.get(visit.restaurantId);if(e&&!seen.has(e.id)){
   found.push({e,label:'Visited '+formatVisitDate(visit.date)});seen.add(e.id);
 }}
 return found;
}
function renderV44Pulse(){
 const pulse=$('recoPulse');if(!pulse)return;
 const view=prefs.view==='battles'?'table':prefs.view;
 pulse.hidden=view!=='home';
 const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
 const monthVisits=v44DatedVisits().filter(v=>monthKeyFromDate(v.date)===month);
 const dishRows=allDishes().map(d=>({dish:d.item,e:d.e}));
  // Collection metrics moved to the At a glance disclosure in Build 51.
  // The dedicated metric-grid element was removed; rendering it here crashed startup.
 const bestDish=[...dishRows].sort((a,b)=>Number(b.dish.rating)-Number(a.dish.rating))[0];
 const recordedIds=new Set(dishRecords().map(d=>d.e.id)),possible=entries.find(e=>!recordedIds.has(e.id));
 const feature=$('recoPulseFeature');
 if(bestDish){
  feature.innerHTML=`<summary><span>YOUR HIGHEST-RATED DISH</span><b>${esc(bestDish.dish.name)} · ${Number(bestDish.dish.rating).toFixed(1)}/10</b></summary><div><p>${esc(bestDish.e.restaurant)} · from your own dish ratings.</p><button type="button" data-open-passport="${esc(bestDish.e.id)}">View the restaurant</button></div>`;
 }else if(possible){
  feature.innerHTML=`<summary><span>ONE SMALL NEXT STEP</span><b>Capture your first standout dish</b></summary><div><p>Rate an item you ate at ${esc(possible.restaurant)}. Every dish counts.</p><button type="button" data-v44-add-dish="${esc(possible.id)}">Add a dish</button></div>`;
 }else{
  feature.innerHTML='<summary><span>YOUR FOOD ARCHIVE</span><b>Keep collecting what matters</b></summary><p>A revisit, dish rating or short note is enough to remember a good meal.</p>';
 }
 feature.open=!bestDish;
 const recent=v44RecentRestaurants();
 const recentRow=({e,label})=>`<div class="reco-pulse-recent-row"><span><strong>${esc(e.restaurant)}</strong><small>${esc(label)}</small></span><button type="button" data-log-visit="${esc(e.id)}" aria-label="Log another visit at ${esc(e.restaurant)}">Log again</button></div>`;
 $('recoPulseRecent').innerHTML=recent.length?recent.slice(0,3).map(recentRow).join('')+(recent.length>3?`<details class="reco-more-recent"><summary>See all ${recent.length} restaurants from the last 20 days</summary>${recent.slice(3).map(recentRow).join('')}</details>`:''):'<p class="field-hint">No visits in the last 20 days. Use Quick Log to record a meal.</p>';
 let prepared=null;try{prepared=localStorage.getItem(BACKUP_MARK_KEY)}catch{}
 const last=Date.parse(prepared||''),days=Number.isFinite(last)?(Date.now()-last)/86400000:Infinity;
 const themeHome=$('recoThemeHome');if(themeHome)themeHome.hidden=entries.length>=40;
 const backup=$('recoPulseBackup');backup.hidden=days<30;
 if(!backup.hidden)$('recoPulseBackupText').textContent=Number.isFinite(days)?'Backup is over 30 days old. Save a fresh copy elsewhere.':'No backup recorded. Save a copy outside this device.';
}
function openEditorForDish(id){
 const e=entries.find(x=>x.id===id);if(!e)return;
 edit(id);setEditorStep(3);
 let target=[...$('itemsEditor').querySelectorAll('.item-edit')].find(row=>!row.querySelector('.dish-name')?.value.trim());
 if(!target){addItemRow({name:'',rating:null,category:''});target=$('itemsEditor').querySelector('.item-edit:last-child')}
 target?.querySelector('.dish-name')?.focus();
}
function updateReplaceConsent(){
 const hasData=entries.length||visits.length||readDrafts().length;
 $('recoReplaceConsentWrap').hidden=!hasData;
 $('recoReplaceConsent').checked=hasData&&$('recoReplaceConsent').checked;
 $('replaceImport').disabled=!!hasData&&!$('recoReplaceConsent').checked;
}
async function v44ProtectStorage(){
 const button=$('v44ProtectStorage');button.disabled=true;
 try{
  if(!navigator.storage?.persisted||!navigator.storage?.persist)throw new Error('This browser does not offer the protected-storage setting.');
  const already=await navigator.storage.persisted();
  const allowed=already||await navigator.storage.persist();
  notify(allowed?'Browser storage protection enabled. Keep external backups too.':'Browser did not grant protected storage. Export backups regularly.',allowed?'success':'error');
  button.textContent=allowed?'Device storage protected':'Protect device storage';
 }catch(e){notify(e.message,'error')}
 finally{button.disabled=false}
}
function setupV44(){
 $('recoPulseLog').addEventListener('click',()=>openUnifiedQuickLog());
 $('recoPulseExport').addEventListener('click',exportBackup);
 $('recoThemeHomeOpen').addEventListener('click',()=>{if(window.matchMedia('(max-width:1100px)').matches){openMobileMore()}const btn=$('appearanceBtn'),menu=$('appearanceMenu');if(!menu.classList.contains('show'))btn.click();btn.scrollIntoView({block:'nearest',behavior:'smooth'});btn.focus({preventScroll:true})});
 $('recoReplaceConsent').addEventListener('change',updateReplaceConsent);
 $('recoSafetyExport').addEventListener('click',exportBackup);
 $('v44ProtectStorage').addEventListener('click',v44ProtectStorage);
}

// Build 45: all experiences below remain local to this browser. No telemetry,
// account requirement, network service or invented restaurant data.
const QUICK_LOG_KEY='recolleat-unfinished-quick-meal-v45';
let v45QuickPhoto='',v45VisitPhotos=[];
const v45DateToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
function v45Number(id,max){const v=$(id).value.trim();if(!v)return null;const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=max?n:null}
function v45Money(id){const raw=$(id).value.trim();if(raw==='')return null;const value=Number(raw);return Number.isFinite(value)&&value>=0&&value<=10000000?Math.round(value*100)/100:undefined}
function v45QuickMatched(value){const q=value.trim().toLowerCase();const exact=entries.find(e=>visitDisplayValue(e).trim().toLowerCase()===q);if(exact)return exact;const matches=entries.filter(e=>e.restaurant.trim().toLowerCase()===q);return matches.length===1?matches[0]:null}
function v45SaveQuickDraft(){
 if(!$('recoQuickLogDialog').open)return;
 const fields=['recoQuickRestaurant','recoQuickCuisine','recoQuickDate','recoQuickFood','recoQuickValue','recoQuickPaid','recoQuickTreated','recoQuickNote'];
 const data={};for(const id of fields)data[id]=$(id).type==='checkbox'?$(id).checked:$(id).value;
 data.recoQuickDishes=captureQuickDishes(false);
 try{localStorage.setItem(QUICK_LOG_KEY,JSON.stringify(data))}catch(e){console.warn('Quick meal draft not saved',e)}
}
function v45ClearQuickDraft(){try{localStorage.removeItem(QUICK_LOG_KEY)}catch{}}
function v45QuickState(){
 const match=v45QuickMatched($('recoQuickRestaurant').value);
 $('recoQuickCuisineWrap').hidden=!!match;
 $('recoQuickHint').textContent=match?`Adding a new visit to ${match.restaurant}. Its existing overall rating will not be overwritten.`:'New restaurant: enter a food score to save a rated entry. Details can be completed later.';
 const paid=$('recoQuickPaid');if($('recoQuickTreated').checked){if(!paid.disabled)paid.dataset.previousAmount=paid.value;paid.value='0.00';paid.disabled=true}else{if(paid.disabled)paid.value=paid.dataset.previousAmount||'';paid.disabled=false}
}
function v45QuickPhotoPreview(){
 $('recoQuickPhotoPreview').innerHTML=v45QuickPhoto?`<div class="reco-photo-selected"><img src="${esc(v45QuickPhoto)}" alt="Selected meal photograph"><button type="button" id="recoQuickPhotoRemove" aria-label="Remove photograph">Remove</button></div>`:'';
 $('recoQuickPhotoRemove')?.addEventListener('click',()=>{v45QuickPhoto='';v45QuickPhotoPreview()});
}
function openUnifiedQuickLog(id=''){
 v51ReceiptSelected=[];
 const dialog=$('recoQuickLogDialog');$('recoQuickLogForm').reset();$('recoQuickPaid').disabled=false;$('recoQuickPaid').dataset.previousAmount='';$('recoQuickDishRows').innerHTML='';document.querySelector('#recoQuickLogForm .reco-quicklog-extras').open=false;v45QuickPhoto='';v45QuickPhotoPreview();
 $('recoQuickRestaurants').innerHTML=entries.slice().sort((a,b)=>a.restaurant.localeCompare(b.restaurant)).map(e=>`<option value="${esc(visitDisplayValue(e))}"></option>`).join('');
 $('recoQuickDate').value=v45DateToday();
 if(id){const selected=entries.find(e=>e.id===id);if(selected)$('recoQuickRestaurant').value=visitDisplayValue(selected)}
 else{try{const saved=JSON.parse(localStorage.getItem(QUICK_LOG_KEY)||'null');if(saved&&typeof saved==='object'){
  for(const [key,value] of Object.entries(saved)){const el=$(key);if(!el)continue;if(el.type==='checkbox')el.checked=!!value;else if(typeof value==='string')el.value=value}
  if(Array.isArray(saved.recoQuickDishes))saved.recoQuickDishes.forEach(v=>recoB3AddDish(v));
 }}catch{}}
 if($('reco50QuickLocationWrap'))$('reco50QuickLocationWrap').hidden=!$('reco50NewBranch').checked;v45QuickState();dialog.showModal();$('recoQuickRestaurant').focus();
}
async function v45UploadPhoto(file,callback){
 if(!file)return;if(!file.type.startsWith('image/')){notify('Choose a photograph.','error');return}
 if(file.size>18*1024*1024){notify('Choose a photograph under 18 MB.','error');return}
 try{callback(await imageToData(file,900,.68))}catch(err){notify('The photo could not be processed: '+err.message,'error')}
}
function captureQuickDishes(includePhoto=true){return [...document.querySelectorAll('.reco-b3-quick-dish')].map(row=>({name:row.querySelector('.reco-b3-name').value,rating:row.querySelector('.reco-b3-score').value,price:validVisitMoney(row.dataset.price),receipt:row.dataset.receipt==='true',...(includePhoto?{photo:row.dataset.photo||''}:{})}))}
function recoB3AddDish(d={}){
 const row=document.createElement('div');row.className='reco-b3-quick-dish';row.dataset.photo=d.photo||'';row.dataset.price=validVisitMoney(d.price)??'';row.dataset.receipt=String(d.receipt===true);
 row.innerHTML=`<div class="reco-b3-dish-fields"><label>Dish name <input class="reco-b3-name" maxlength="140" placeholder="e.g. Ramen" value="${esc(d.name||'')}"></label><label>Rating /10 <input class="reco-b3-score" type="number" min="0" max="10" step="0.5" placeholder="Optional" value="${d.rating===null||d.rating===undefined?'':esc(d.rating)}"></label></div><div class="reco-b3-dish-bottom">${d.receipt===true?`<span class="reco33-receipt-tag">Receipt · £${Number(d.price||0).toFixed(2)}</span>`:''}<label class="reco-build3-photo-label">Choose dish photo<input class="reco-b3-upload" type="file" accept="image/*"></label><span class="reco-b3-photo-state">${row.dataset.photo?'Photo selected ✓':'No photo'}</span><button type="button" class="reco-b3-remove" aria-label="Remove this dish">Remove</button></div>`;
 row.querySelector('.reco-b3-remove').onclick=()=>{const oldTotal=receiptQuickTotal();row.remove();if(row.dataset.receipt==='true'&&v45Money('recoQuickValue')===oldTotal){const total=receiptQuickTotal();$('recoQuickValue').value=total?total.toFixed(2):''}v45SaveQuickDraft()};
 row.querySelector('.reco-b3-upload').onchange=async e=>{await v45UploadPhoto(e.target.files?.[0],src=>{row.dataset.photo=src;row.querySelector('.reco-b3-photo-state').textContent='Photo selected ✓'});e.target.value=''};
 $('recoQuickDishRows').appendChild(row);return row;
}
async function saveUnifiedQuickLog(ev,reviewAfter=false){
 ev.preventDefault();if(!db){notify('Journal storage is not available.','error');return}
 const name=$('recoQuickRestaurant').value.trim(),newBranch=$('reco50NewBranch')?.checked,branchLocation=$('reco50QuickLocation')?.value.trim()||'',match=newBranch?null:v45QuickMatched(name);
 if(!name){notify('Enter a restaurant first.','error');return}
 const rating=v45Number('recoQuickFood',100),foodValue=v45Money('recoQuickValue'),paidFor=$('recoQuickTreated').checked,spend=paidFor?0:v45Money('recoQuickPaid');
 if(foodValue===undefined||spend===undefined||rating===null){
  notify('Check your scores and monetary amounts.','error');return;
 }
 if(!newBranch&&!match&&entries.filter(e=>e.restaurant.trim().toLowerCase()===name.toLowerCase()).length>1){notify('Several branches share this name. Select the full restaurant and location from the suggestions.','error');return}
 if(newBranch&&entries.some(e=>similarName(e.restaurant,name))&&!branchLocation){notify('Enter a distinct branch location.','error');return}if(!match&&entries.some(e=>similarName(e.restaurant,name)&&locationKey(e.location)===locationKey(branchLocation))&&!confirm('A similar restaurant at this location already exists. Create a separate record anyway?'))return;
 const submit=$('recoQuickSave'),review=$('recoQuickFull');if(submit.disabled)return;submit.disabled=true;review.disabled=true;let committed=false;
 try{
  const now=new Date().toISOString(),id=match?.id||uid(),dishes=[];
  for(const row of $('recoQuickDishRows').querySelectorAll('.reco-b3-quick-dish')){
   const dishName=row.querySelector('.reco-b3-name').value.trim(),raw=row.querySelector('.reco-b3-score').value.trim();
   if(!dishName){if(raw||row.dataset.photo||row.dataset.price){notify('Give every rated, priced or photographed dish a name.','error');return}continue}
   const score=raw===''?null:Number(raw);
   if(score!==null&&(!Number.isFinite(score)||score<0||score>10)){notify('Dish ratings must be between 0 and 10.','error');return}
   dishes.push({id:uid(),name:dishName,rating:score,price:validVisitMoney(row.dataset.price),category:'',categories:[],photo:row.dataset.photo||'',receipt:row.dataset.receipt==='true'});
  }
  if(match&&!confirmDishOverlap(overlappingDishNames(match.id,dishes,'visit')))return;
  if(dishes.some(a=>a.receipt&&dishes.some(b=>!b.receipt&&reviewDishName(a.name)===reviewDishName(b.name)))&&!confirm('A receipt item and a manually added dish share a name. Keep both as separate items?'))return;
  const date=$('recoQuickDate').value,note=$('recoQuickNote').value.trim();
  const newEntry=match?null:normalise({id,restaurant:name,location:newBranch?branchLocation:'',cuisine:$('recoQuickCuisine').value.trim(),foodScore:rating,ratingMode:'visits',valueScore:null,service:'Unrated',pp:null,manualVisitCount:1,items:[],photos:v45QuickPhoto?[v45QuickPhoto]:[],dateVisited:date});
  const visit=normaliseVisit({id:uid(),restaurantId:id,date,foodRating:rating,foodValue,spend,paidFor,note,dishes,photos:v45QuickPhoto?[v45QuickPhoto]:[],createdAt:now,updatedAt:now});
  let update=match?{...match,manualVisitCount:Math.max(Number(match.manualVisitCount)||0,visits.filter(v=>v.restaurantId===id).length+1),updatedAt:now}:newEntry;
  update=reco50RateEntry(update,[...visits,visit]);
  await mutateStores([[RESTAURANTS,'put',update],[VISITS,'put',visit]]);committed=true;
  if(match)entries=entries.map(e=>e.id===id?update:e);else entries.push(update);
  visits.push(visit);v51ReceiptSelected=[];v45ClearQuickDraft();v45QuickPhoto='';$('recoQuickLogDialog').close();
  rememberRestaurant(id);if(date)visitMonthCursor=new Date(Number(date.slice(0,4)),Number(date.slice(5,7))-1,1);
  render();notify(match?'Visit added to your restaurant history.':'Restaurant and first visit saved.');
  if(reviewAfter){edit(id);setEditorStep(1);notify("Meal saved. Complete the detailed restaurant review without adding another visit.")}
 }catch(err){console.error('Quick Log',err);notify(committed?'Meal saved. Reopen the journal to refresh the display.':'Meal not saved. Your inputs are still available.',committed?'success':'error')}
 finally{submit.disabled=false;review.disabled=false}
}
function prepareV45VisitForm(visit){
 v45VisitPhotos=Array.isArray(visit?.photos)?[...visit.photos]:[];
 $('recoVisitFoodRating').value=visit?.foodRating??'';
 const list=$('recoVisitDishes');list.innerHTML='';
 (visit?.dishes||[]).forEach(v45AddVisitDishRow);
 v45VisitPhotoPreview();
}
function v45AddVisitDishRow(d={}){
 const id=d.id||uid(),row=document.createElement('div');row.className='reco-visit-dish-row';row.dataset.dishId=id;
 row.innerHTML=`<label>Dish <input class="reco-vdish-name" value="${esc(d.name||'')}" maxlength="140" placeholder="What did you have?"></label><label>Score /10 <input class="reco-vdish-rating" type="number" step="0.5" min="0" max="10" value="${d.rating===null||d.rating===undefined?'':esc(d.rating)}" placeholder="—"></label><label>Price (£) <input class="reco-vdish-price" type="number" step="0.01" min="0" value="${d.price===null||d.price===undefined?'':esc(d.price)}" placeholder="—"></label><input type="hidden" class="reco-vdish-category" value="${esc(d.category||(d.categories||[]).join(', '))}"><label class="reco-build3-photo-label">Choose dish photo<input class="reco-vdish-upload" type="file" accept="image/*"></label><span class="reco-vdish-photo-state">${d.photo?'Photo selected ✓':'Optional'}</span><button class="reco-vdish-remove" type="button" aria-label="Remove dish">×</button>`;
 row.dataset.photo=d.photo||'';row.querySelector('.reco-vdish-upload').onchange=async e=>{await v45UploadPhoto(e.target.files?.[0],src=>{row.dataset.photo=src;row.querySelector('.reco-vdish-photo-state').textContent='Photo selected ✓'});e.target.value=''};row.querySelector('.reco-vdish-remove').onclick=()=>row.remove();
 $('recoVisitDishes').appendChild(row);
}
function v45VisitPhotoPreview(){
 const wrap=$('recoVisitPhotoPreview');wrap.innerHTML=v45VisitPhotos.map((src,i)=>`<div class="reco-photo-selected"><img src="${esc(src)}" alt="Selected visit photograph ${i+1}"><button type="button" data-delete-visit-photo="${i}">Remove</button></div>`).join('');
 wrap.querySelectorAll('[data-delete-visit-photo]').forEach(b=>b.onclick=()=>{v45VisitPhotos.splice(Number(b.dataset.deleteVisitPhoto),1);v45VisitPhotoPreview()});
}
function collectV45VisitDetails(){
 const value=$('recoVisitFoodRating').value.trim(),foodRating=value===''?null:v45Number('recoVisitFoodRating',100);
 if(value&&foodRating===null){notify('Visit food score must be between 0 and 100.','error');return null}
 const dishes=[];for(const row of $('recoVisitDishes').querySelectorAll('.reco-visit-dish-row')){
   const name=row.querySelector('.reco-vdish-name').value.trim();if(!name){if(row.querySelector('.reco-vdish-rating').value||row.querySelector('.reco-vdish-price').value||row.dataset.photo){notify('Name every rated, priced or photographed dish.','error');return null}continue;}
   const scoreInput=row.querySelector('.reco-vdish-rating').value, priceInput=row.querySelector('.reco-vdish-price').value;
   const rating=scoreInput===''?null:Number(scoreInput),price=priceInput===''?null:Number(priceInput);
   if((rating!==null&&(!Number.isFinite(rating)||rating<0||rating>10))||(price!==null&&(!Number.isFinite(price)||price<0||price>10000000))){notify('Check dish ratings and prices.','error');return null}
   const categories=normalizeDishCategoryNames(row.querySelector('.reco-vdish-category').value);
   dishes.push({id:row.dataset.dishId,name,rating,price,category:categories[0]||'',categories,photo:row.dataset.photo||''});
 }
 return {dishes,photos:[...v45VisitPhotos],foodRating};
}
function v45MemoryCards(now=new Date()){
 const day=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/86400000,map=new Map(entries.map(e=>[e.id,e]));
 const candidates=visits.filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v.date||''))).map(v=>{
  const e=map.get(v.restaurantId),d=new Date(v.date+'T12:00:00');if(!e||!Number.isFinite(d.getTime()))return null;
  const days=day-Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;if(days<30)return null;
  const anniversary=d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();return {v,e,days,anniversary};
 }).filter(Boolean).sort((a,b)=>String(a.v.date).localeCompare(String(b.v.date))||String(a.v.id).localeCompare(String(b.v.id)));
 if(!candidates.length)return [];
 const anniversary=candidates.filter(x=>x.anniversary),pool=candidates.filter(x=>!x.anniversary),result=[];
 if(anniversary.length)result.push(anniversary[day%anniversary.length]);
 const remaining=result.length?pool: candidates;
 for(let i=0;i<Math.min(3-result.length,remaining.length);i++)result.push(remaining[(day+i)%remaining.length]);
 return result;
}
function renderV45Home(){
 const journey=$('recoJourney'),feed=$('recoMemoryFeed');if(!journey||!feed)return;
 const n=entries.length;journey.hidden=n>=40;const cuisines=new Set(entries.map(e=>String(e.cuisine||'').trim().toLowerCase()).filter(Boolean)).size,dishCount=allDishes().length;
 const early=[1,3,5].filter(level=>n>=level).length,active=[1,3,5,10,20,30,40].filter(level=>n>=level||earnedRewardLevels.includes(level));
 const next=[1,3,5,10,20,30,40].find(level=>!active.includes(level));
 const title=n<3?'Your first memories are the foundation':n<10?'Your journal is taking shape':n<30?'You have a real food collection':'Your food archive keeps growing';
 const action=n<3?'Log a meal':n<10?'Add your next meal':'Log another experience';
 journey.innerHTML=`<div class="reco-journey-top"><div><span class="feature-kicker">YOUR COLLECTION JOURNEY</span><h3>${title}</h3><p>${n} restaurants · ${cuisines} cuisines · ${dishCount} rated dishes. ${next?`${Math.max(0,next-n)} more saved restaurants until your next progress badge.`:'You have reached every collection-size badge.'}</p></div><button type="button" class="primary" data-v45-quicklog>${action}</button></div><div class="reco-journey-badges" aria-label="Your restaurant achievements">${[1,3,5,10,20,30,40].map(l=>`<span class="${active.includes(l)?'earned':'locked'}" title="${l} saved restaurants">${active.includes(l)?'✓':'○'} ${l}</span>`).join('')}</div>`;
 const memories=v45MemoryCards();const memoryDetails=feed.closest('details');if(memoryDetails)memoryDetails.hidden=!memories.length;
 feed.innerHTML=memories.length?`<div class="reco-memory-heading"><small>A fresh selection each day</small></div><div class="reco-memory-grid">${memories.map(({v,e,days,anniversary})=>{const photo=v.photos?.[0]||e.photos?.[0]||'';return `<article class="reco-memory"><div class="reco-memory-photo">${photo?`<img loading="lazy" src="${esc(photo)}" alt="Photograph from your logged meal">`:'<span>✦</span>'}</div><div><small>${anniversary?'ON THIS DATE':'FROM YOUR ARCHIVE'} · ${esc(formatVisitDate(v.date))}</small><h4>${esc(e.restaurant)}</h4><p>${esc(v.note||v.dishes?.map(i=>i.name).join(' · ')||`A visit you logged ${days} days ago.`)}</p><button type="button" data-open-passport="${esc(e.id)}">Open memory</button></div></article>`}).join('')}</div>`:'';
}
function renderV45AnnualFinance(){
 if($('recoFinance')?.hidden)return;const panel=$('recoFinanceContent'),select=$('recoFinanceYear');if(!panel||!select)return;
 const years=[...new Set(visits.map(v=>/^\d{4}-\d{2}-\d{2}$/.test(v.date||'')?Number(v.date.slice(0,4)):null).filter(Boolean))].sort((a,b)=>b-a);
 const today=new Date().getFullYear();if(!years.length)years.push(today);
 const previous=Number(select.value),selected=years.includes(previous)?previous:years[0];
 select.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');select.value=String(selected);
 const rows=visits.filter(v=>String(v.date||'').startsWith(selected+'-'));
 if(!rows.length){panel.innerHTML='<p class="feature-muted">No dated visits in this year yet. A visit with no prices still counts as a visit, but not as £0 spent.</p>';return}
 const spend=sumRecordedMoney(rows,'spend'),value=sumRecordedMoney(rows,'foodValue'),treated=rows.filter(v=>v.paidFor).length;
 const spendAvg=spend.count?spend.total/spend.count:null,perRestaurant=new Map();
 const map=new Map(entries.map(e=>[e.id,e]));
 for(const v of rows){const paid=visitMoney(v,'spend');if(paid===null)continue;const old=perRestaurant.get(v.restaurantId)||{total:0,count:0};old.total+=paid;old.count++;perRestaurant.set(v.restaurantId,old)}
 const leaders=[...perRestaurant].sort((a,b)=>b[1].total-a[1].total).slice(0,3);
 const months=Array.from({length:12},(_,i)=>{const records=rows.filter(v=>Number(v.date.slice(5,7))===i+1),sp=sumRecordedMoney(records,'spend'),fv=sumRecordedMoney(records,'foodValue');return {month:new Date(selected,i,1).toLocaleDateString('en-GB',{month:'short'}),spent:sp.total,value:fv.total,spendCount:sp.count,valueCount:fv.count}});
 const ceiling=Math.max(1,...months.map(m=>Math.max(m.spent,m.value)));
 panel.innerHTML=`<div class="reco-finance-grid"><div><span>Personally paid</span><strong>${spend.count?moneyLabel(spend.total):'—'}</strong><small>${spend.count}/${rows.length} visits recorded</small></div><div><span>Food value</span><strong>${value.count?moneyLabel(value.total):'—'}</strong><small>${value.count}/${rows.length} visits recorded</small></div><div><span>Treated meals</span><strong>${treated}</strong><small>Marked as paid for by someone else</small></div><div><span>Average personal payment</span><strong>${spendAvg===null?'—':moneyLabel(spendAvg)}</strong><small>Per visit with a payment amount</small></div></div><div class="reco-finance-months" role="img" aria-label="Monthly recorded personal spending versus food value">${months.map(m=>`<div class="reco-finance-month"><div class="reco-finance-bars"><span title="Food value: ${m.valueCount?'£'+m.value.toFixed(2):'unknown'}" class="value" style="height:${m.valueCount?Math.max(2,m.value/ceiling*100):0}%"></span><span title="Personally paid: ${m.spendCount?'£'+m.spent.toFixed(2):'unknown'}" class="paid" style="height:${m.spendCount?Math.max(2,m.spent/ceiling*100):0}%"></span></div><small>${m.month}</small></div>`).join('')}</div><p class="reco-finance-legend"><i class="value"></i> Food value <i class="paid"></i> Personal payment · Missing amounts are excluded, never treated as zero.</p>${leaders.length?`<div class="reco-finance-restaurants"><h4>Where you personally spent most</h4>${leaders.map(([id,r])=>`<p><span>${esc(map.get(id)?.restaurant||'Deleted restaurant')}</span><strong>£${r.total.toFixed(2)}</strong></p>`).join('')}</div>`:''}`;
}
function buildRecoverySnapshot(label){
 const payload={app:'Recolleat Local',version:16,entries:entries.map(clone),lists:lists.map(clone),visits:visits.map(clone),locations:locationMedia.map(clone),dishCategories:prefs.dishCategories||[],hiddenDishCategories:prefs.hiddenDishCategories||[],profile:clone(profile),drafts:readDrafts(),earnedThemes:[...earnedRewardLevels]};
 // Snapshots remain an optional convenience in this browser, NOT an external backup.
 const chars=JSON.stringify(payload).length;
 if(chars>9*1024*1024){console.warn('Local snapshot too large; external export is essential');return null}
 return {id:'most-recent',label,createdAt:new Date().toISOString(),payload};
}
function renderV45ImportPreview(data){
 const box=$('recoImportPreview');if(!box)return;
 const old=new Map(entries.map(e=>[e.id,e])),overlap=data.entries.filter(e=>old.has(e.id)),changed=overlap.filter(e=>JSON.stringify(e)!==JSON.stringify(old.get(e.id))).length;
 const photos=data.entries.reduce((n,e)=>n+(e.photos||[]).length+(e.items||[]).filter(i=>i.photo).length,0)+data.visits.reduce((n,v)=>n+(v.photos||[]).length+(v.dishes||[]).filter(i=>i.photo).length,0);
 const missingLinks=data.visits.filter(v=>!data.entries.some(e=>e.id===v.restaurantId)&&!old.has(v.restaurantId)).length;
 box.innerHTML=`<strong>Before you restore</strong><p>${data.entries.length} restaurants · ${data.visits.length} visits · ${photos} photographs · ${data.drafts.length} drafts.</p><p><b>Merge:</b> ${overlap.length} restaurant IDs already exist; ${changed} differ and will be compared by last update time. New IDs will be added.</p><p><b>Replace:</b> ${entries.length} current restaurants and ${visits.length} visits will be replaced. Only records inside the backup remain.</p>${data.weightsWarning?'<p class="reco-warning">The backup ranking preferences are invalid or unsupported. Your current ranking weights will be retained; journal records are unaffected.</p>':''}${missingLinks?`<p class="reco-warning">${missingLinks} visits refer to restaurants not found in this backup. Review before restoring.</p>`:''}<p class="feature-muted">A local recovery point will be attempted before changing your data. Keep a separate downloaded backup.</p>`;
}
async function openV45Recovery(){
 if(!db)return;
 try{const rows=await allStore(SNAPSHOTS),snap=rows.find(r=>r.id==='most-recent');
 if(!snap){notify('No local recovery point exists yet. Export a JSON backup regularly.','error');return}
 pendingImport=validateBackup(snap.payload);
 $('importSummary').textContent=`Recovery point: ${snap.label}, ${new Date(snap.createdAt).toLocaleString('en-GB')}. Preview the changes below.`;
 renderV45ImportPreview(pendingImport);$('recoReplaceConsent').checked=false;updateReplaceConsent();$('importDialog').showModal();
 }catch(error){notify('Recovery point could not be read: '+error.message,'error')}
}
function setupV45(){
 $('recoQuickLogForm').addEventListener('submit',saveUnifiedQuickLog);
 $('recoQuickAddDish').onclick=()=>{const row=recoB3AddDish();row.querySelector('.reco-b3-name').focus()};
 $('recoQuickRestaurant').addEventListener('input',v45QuickState);
 $('recoQuickTreated').addEventListener('change',v45QuickState);$('recoQuickValue').addEventListener('input',v45QuickState);
 let autosave;
 $('recoQuickLogForm').addEventListener('input',()=>{clearTimeout(autosave);autosave=setTimeout(v45SaveQuickDraft,400)});
 for(const id of ['recoQuickCamera','recoQuickGallery'])$(id).onchange=async ev=>{await v45UploadPhoto(ev.target.files?.[0],src=>{v45QuickPhoto=src;v45QuickPhotoPreview()});ev.target.value=''};
 $('recoQuickFull').onclick=ev=>{if($('recoQuickLogForm').reportValidity())saveUnifiedQuickLog(ev,true)};
 $('recoVisitAddDish').onclick=()=>v45AddVisitDishRow();
 for(const id of ['recoVisitCamera','recoVisitPhotoChoose'])$(id).onchange=async ev=>{await v45UploadPhoto(ev.target.files?.[0],src=>{v45VisitPhotos.push(src);v45VisitPhotoPreview()});ev.target.value=''};
 $('recoEditorCamera').onchange=async ev=>{await addImageFiles(ev.target.files);ev.target.value=''};
 $('recoRecoveryOpen').onclick=openV45Recovery;
 $('recoOptimiseMedia').onclick=async()=>{const b=$('recoOptimiseMedia');b.disabled=true;try{const n=await migrateExistingMedia(),pruned=await pruneUnusedMedia();notify(`Photo optimisation complete: ${n} records migrated, ${pruned} unused images removed.`)}catch(err){notify('Photo optimisation could not finish. Original records were retained.','error');console.error(err)}finally{b.disabled=false}};
 $('recoFinanceYear').onchange=renderV45AnnualFinance;
 $('recoTableMore').onclick=()=>{visibleTableRows+=150;render()};
 $('recoCardMore').onclick=()=>{visibleCardRows+=24;render()};
 document.addEventListener('click',e=>{if(e.target.closest('[data-v45-quicklog]'))openUnifiedQuickLog()});
 // Keep the original full editor discoverable; new Quick Log replaces only the primary add button.
 $('v41StartQuick')?.addEventListener('click',e=>{e.stopImmediatePropagation();openUnifiedQuickLog()},true);
}


// Build 51: deliberate, local-only retention and receipt workflows.
// Existing database stores, restaurant identifiers, rewards and app install identity are unchanged.
let v51ReceiptRows=[],v51ReceiptSelected=[],v51ReceiptObjectUrl=null,v51ReceiptContext='home',v51QuickFormBeforeReceipt=null;
const v51Pounds=n=>'£'+Number(n||0).toFixed(2);
function v51ReceiptParse(text){
 const parsed=[];const lines=String(text||'').split(/\r?\n/).map(line=>line.trim().replace(/\s{2,}/g,' ')).filter(Boolean);
 const excluded=/^(?:sub\s*total|subtotal|total|grand total|balance|vat|tax|gst|service|tip|gratuity|card|cash|change|discount|amount (?:due|paid)|payment|visa|mastercard|amex|receipt|date|time|table|order|transaction|rounding|loyalty|cashier|thank you|authorisation|auth(?:orization)?|terminal|invoice|bill|net amount)\b/i;
 for(const line of lines.slice(0,180)){
  if(excluded.test(line)||/^[-=\s\d/:]+$/.test(line))continue;
  let name='',total=null,qty=1;
  let match=line.match(/^(.+?)\s+(?:£\s*)?(\d{1,6}[.,]\d{2})\s*$/);
  if(match){name=match[1].trim();total=Number(match[2].replace(',','.'))}
  else{match=line.match(/^(?:£\s*)?(\d{1,6}[.,]\d{2})\s+(.+)$/);if(match){name=match[2].trim();total=Number(match[1].replace(',','.'))}}
  if(total===null||!Number.isFinite(total)||total<0||total>10000||name.length<2||name.length>110)continue;
  let number=name.match(/^(\d{1,2})\s*[x×]\s+(.+)$/i)||name.match(/^(\d{1,2})\s+(.+)$/);
  if(number){qty=Math.min(30,Number(number[1]));name=number[2].trim()}
  number=name.match(/^(.+?)\s*[x×]\s*(\d{1,2})$/i);
  if(number){qty=Math.min(30,Number(number[2]));name=number[1].trim()}
  if(!name||/^(?:item|qty|quantity|price|discount|savings|total)\b/i.test(name))continue;
  parsed.push({id:uid(),name,qty,price:Math.round(total*100)/100,selected:false});
 }
 return parsed;
}
function v51ReceiptUI(){
 const target=$('recoReceiptLines');if(!target)return;
 target.innerHTML=v51ReceiptRows.length?v51ReceiptRows.map((r,i)=>`<div class="reco-receipt-row"><label class="reco-receipt-check"><input data-receipt-select="${i}" type="checkbox" ${r.selected?'checked':''} aria-label="I ate ${esc(r.name)}"></label><label class="reco-receipt-name">Item<input data-receipt-name="${i}" maxlength="110" value="${esc(r.name)}"></label><label class="reco-receipt-quantity">Qty<input data-receipt-qty="${i}" type="number" min="1" max="30" step="1" value="${r.qty}"></label><label class="reco-receipt-price">Line total (£)<input data-receipt-price="${i}" type="number" min="0" max="10000" step="0.01" value="${r.price.toFixed(2)}"></label></div>`).join(''):'<p class="field-hint">No recognisable item lines yet. Paste text in the format “Gyoza 6.50” and try again.</p>';
 v51ReceiptRecalculate();
}
function v51ReceiptRecalculate(){
 const items=v51ReceiptRows.filter(r=>r.selected&&r.name.trim()&&Number.isFinite(r.price));
 $('recoReceiptSelectedTotal').textContent=v51Pounds(items.reduce((sum,r)=>sum+r.price,0));
 $('recoReceiptContinue').disabled=!items.length;
}
function v51ReceiptFromText(){
 const rows=v51ReceiptParse($('recoReceiptText').value);
 v51ReceiptRows=rows;v51ReceiptUI();
 $('recoReceiptStatus').textContent=rows.length?`${rows.length} possible item${rows.length===1?'':'s'} found. Select only what you had, and correct any errors.`:'No item prices found. Check the text or add lines such as “Gyoza 6.50”.';
}
function v51ReceiptOpen(context='home'){
 v51ReceiptContext=context;
 const quick=$('recoQuickLogDialog');
 v51QuickFormBeforeReceipt=quick.open?captureReceiptHandoff():null;
 if(quick.open){v45SaveQuickDraft();quick.close()};
 v51ReceiptRows=[];$('recoReceiptText').value='';$('recoReceiptPreview').hidden=true;$('recoReceiptPreview').removeAttribute('src');v51ReceiptUI();
 $('recoReceiptDialog').showModal();
}
async function v51ReadReceiptPhoto(file){
 if(!file)return;
 if(!file.type.startsWith('image/')||file.size>18*1024*1024){$('recoReceiptStatus').textContent='Choose a receipt image under 18 megabytes.';return}
 if(v51ReceiptObjectUrl)URL.revokeObjectURL(v51ReceiptObjectUrl);
 v51ReceiptObjectUrl=URL.createObjectURL(file);
 $('recoReceiptPreview').src=v51ReceiptObjectUrl;$('recoReceiptPreview').hidden=false;
 const status=$('recoReceiptStatus');status.textContent='Checking on-device text recognition…';
 if(typeof TextDetector==='undefined'){
   status.textContent='Automatic image text recognition is not available in this browser. Use Copy text from image (for example from your phone’s photo app) and paste the lines below.';
   return;
 }
 try{
  const bitmap=await createImageBitmap(file),detector=new TextDetector(),blocks=await detector.detect(bitmap);
  bitmap.close?.();
  const rows=blocks.map(b=>({text:b.rawValue||'',top:b.boundingBox?.y||0})).sort((a,b)=>a.top-b.top);
  $('recoReceiptText').value=rows.map(b=>b.text).join('\n');
  v51ReceiptFromText();
  if(!v51ReceiptRows.length)status.textContent='The image was read, but no priced lines matched. Review the recognised text below.';
 }catch(error){status.textContent='Text detection was not available for this image. Paste text copied from your phone’s photo app instead.';console.warn('Receipt recognition',error)}
}
function receiptQuickTotal(){return Math.round(captureQuickDishes(false).filter(d=>d.receipt).reduce((sum,d)=>sum+(d.price??0),0)*100)/100}
function captureReceiptHandoff(){const ids=['recoQuickRestaurant','recoQuickCuisine','recoQuickDate','recoQuickFood','recoQuickValue','recoQuickPaid','recoQuickNote'];return {fields:Object.fromEntries(ids.map(id=>[id,$(id).value])),treated:$('recoQuickTreated').checked,previousPayment:$('recoQuickPaid').dataset.previousAmount||'',photo:v45QuickPhoto,dishes:captureQuickDishes(),extras:document.querySelector('#recoQuickLogForm .reco-quicklog-extras').open}}
function restoreReceiptHandoff(saved){if(!saved)return;for(const [id,value] of Object.entries(saved.fields))$(id).value=value;$('recoQuickTreated').checked=saved.treated;$('recoQuickPaid').disabled=false;if(saved.treated)$('recoQuickPaid').value=saved.previousPayment;v45QuickPhoto=saved.photo;v45QuickPhotoPreview();$('recoQuickDishRows').innerHTML='';saved.dishes.forEach(recoB3AddDish);document.querySelector('#recoQuickLogForm .reco-quicklog-extras').open=saved.extras;v45QuickState()}
function v51ReceiptContinue(){
 const selections=v51ReceiptRows.filter(r=>r.selected&&r.name.trim()).map(r=>({name:r.name.trim(),qty:r.qty,price:r.price}));if(!selections.length)return;
 const saved=v51QuickFormBeforeReceipt;v51QuickFormBeforeReceipt=null;$('recoReceiptDialog').close();openUnifiedQuickLog();restoreReceiptHandoff(saved);
 const oldValue=v45Money('recoQuickValue'),oldSubtotal=receiptQuickTotal();
 const selected=selections.flatMap(r=>{const count=Math.max(1,Math.min(30,r.qty)),pennies=Math.round(r.price*100),base=Math.floor(pennies/count),remainder=pennies%count;return Array.from({length:count},(_,i)=>({name:count===1?r.name:`${r.name} (${i+1}/${count})`,price:(base+(i<remainder?1:0))/100,receipt:true,rating:null}))});
 selected.forEach(recoB3AddDish);v51ReceiptSelected=[];
 if(oldValue===null||oldValue===oldSubtotal)$('recoQuickValue').value=receiptQuickTotal().toFixed(2);
 document.querySelector('#recoQuickLogForm .reco-quicklog-extras').open=true;v45QuickState();v45SaveQuickDraft();
 $('recoQuickHint').textContent=`${selected.length} receipt item${selected.length===1?'':'s'} added above. Add ratings if you like, review meal value and enter what you paid.`;
 $('recoQuickRestaurant').focus();
}
function v51RenderYear(){
 const year=Number($('recoYearSelect')?.value),box=$('recoYearContent');if(!box||!year)return;
 const dated=visits.filter(v=>String(v.date||'').startsWith(String(year)+'-'));
 const unique=[...new Set(dated.map(v=>v.restaurantId))],cuisines=new Set(entries.filter(e=>unique.includes(e.id)).map(e=>String(e.cuisine||'').trim()).filter(Boolean));
 const paid=sumRecordedMoney(dated,'spend'),value=sumRecordedMoney(dated,'foodValue');
 const dishes=dated.flatMap(v=>(v.dishes||[]).filter(d=>d.name)),best=dishes.filter(d=>d.rating!==null&&Number.isFinite(Number(d.rating))).sort((a,b)=>Number(b.rating)-Number(a.rating))[0];
 const visitsByMonth=Array.from({length:12},(_,i)=>dated.filter(v=>Number(String(v.date).slice(5,7))===i+1).length);
 const max=Math.max(1,...visitsByMonth);
 if(!dated.length){box.innerHTML='<div class="reco-empty-state"><b>No visits recorded for this year</b><p>Log dated visits to start your yearly food story.</p></div>';return}
 box.innerHTML=`<div class="reco-year-stats"><div><strong>${dated.length}</strong><span>visits</span></div><div><strong>${unique.length}</strong><span>restaurants</span></div><div><strong>${cuisines.size}</strong><span>cuisines</span></div></div><div class="reco-year-chart" aria-label="Visits per month">${visitsByMonth.map((v,i)=>`<div><i style="height:${Math.max(3,Math.round(v/max*75))}px" title="${v} visits"></i><small>${'JFMAMJJASOND'[i]}</small></div>`).join('')}</div><div class="reco-year-foot"><span>Food value: <b>${value.count?v51Pounds(value.total):'Not recorded'}</b> <small>${value.count}/${dated.length} visits</small></span><span>You paid: <b>${paid.count?v51Pounds(paid.total):'Not recorded'}</b> <small>${paid.count}/${dated.length} visits</small></span><span>${dated.filter(v=>v.paidFor).length} treated meals${best?` · Top visit dish: ${esc(best.name)} (${Number(best.rating).toFixed(1)}/10)`:''}</span></div>`;
}
function renderV51YearWrap(){
 const el=$('recoYearSelect');if(!el)return;
 const today=new Date(),nowYear=today.getFullYear(),wrap=$('recoYearWrap');if(wrap)wrap.hidden=today.getMonth()!==0;if(today.getMonth()!==0)return;const years=[String(nowYear-1)];
 const selected=el.value;
 const fingerprint=years.join(',');if(el.dataset.years!==fingerprint){el.dataset.years=fingerprint;el.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');el.value=years.includes(String(nowYear-1))?String(nowYear-1):String(nowYear)}
 v51RenderYear();
}
function setupV51(){
 $('recoReceiptOpen').addEventListener('click',()=>v51ReceiptOpen());
 $('recoReceiptFromQuick').addEventListener('click',()=>v51ReceiptOpen('quick'));
 $('recoReceiptCancel').addEventListener('click',()=>$('recoReceiptDialog').close());
 $('recoReceiptParse').addEventListener('click',v51ReceiptFromText);
 $('recoReceiptContinue').addEventListener('click',v51ReceiptContinue);
 for(const id of ['recoReceiptCamera','recoReceiptFile'])$(id).addEventListener('change',e=>{v51ReadReceiptPhoto(e.target.files?.[0]);e.target.value=''});
 $('recoReceiptLines').addEventListener('input',e=>{
  const el=e.target;const r=Number(el.dataset.receiptName??el.dataset.receiptQty??el.dataset.receiptPrice);if(!Number.isInteger(r)||!v51ReceiptRows[r])return;
  if(el.dataset.receiptName!==undefined)v51ReceiptRows[r].name=el.value.slice(0,110);
  else if(el.dataset.receiptQty!==undefined)v51ReceiptRows[r].qty=Math.max(1,Math.min(30,Math.floor(Number(el.value)||1)));
  else if(el.dataset.receiptPrice!==undefined)v51ReceiptRows[r].price=Math.max(0,Math.min(10000,Number(el.value)||0));
  v51ReceiptRecalculate();
 });
 $('recoReceiptLines').addEventListener('change',e=>{if(e.target.dataset.receiptSelect!==undefined){const i=Number(e.target.dataset.receiptSelect);if(v51ReceiptRows[i])v51ReceiptRows[i].selected=e.target.checked;v51ReceiptRecalculate()}});
 $('recoYearSelect').addEventListener('change',v51RenderYear);
 $('recoReceiptDialog').addEventListener('close',()=>{if(v51ReceiptObjectUrl){URL.revokeObjectURL(v51ReceiptObjectUrl);v51ReceiptObjectUrl=null}if(v51QuickFormBeforeReceipt){const saved=v51QuickFormBeforeReceipt;v51QuickFormBeforeReceipt=null;openUnifiedQuickLog();restoreReceiptHandoff(saved);v45SaveQuickDraft()}});
}
function setupV47Accessibility(){
  document.addEventListener('keydown',event=>{
    const target=event.target,group=target.closest?.('[role="tablist"]');
    if(!group||target.getAttribute('role')!=='tab'||!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
    const tabs=[...group.querySelectorAll('[role="tab"]')].filter(el=>el.getClientRects().length&&!el.disabled);
    const index=tabs.indexOf(target);if(index===-1||!tabs.length)return;
    event.preventDefault();let next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    const button=tabs[next];button.focus();button.click();
  });
  // Avoid keyboard focus disappearing into concealed passport pages.
  const root=$('passportContent');if(root)root.setAttribute('aria-label','Restaurant passport pages');
}
let v47UpdateRequested=false;
function setupV47AppUpdates(){
  const notice=$('recoUpdateReady'),button=$('recoUpdateNow'),connection=$('recoConnectionState');
  if(!notice||!button)return;
  const setConnection=()=>{if(connection)connection.textContent=navigator.onLine?'Online · Journal saved on this device':'Offline · Existing journal remains available';};
  setConnection();window.addEventListener('online',setConnection);window.addEventListener('offline',setConnection);
  if(!('serviceWorker' in navigator)||location.protocol!=='https:')return;
  const show=registration=>{if(!registration?.waiting||!navigator.serviceWorker.controller)return;notice.hidden=false;
    button.onclick=()=>{if(document.querySelector('dialog[open]')&&!confirm('A form is open. Leave it and update Recolleat now? Unsaved changes may be lost.'))return;
      v47UpdateRequested=true;button.disabled=true;button.textContent='Updating…';registration.waiting.postMessage({type:'SKIP_WAITING'});
    };
  };
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(v47UpdateRequested)location.reload()});
  navigator.serviceWorker.register('./service-worker.js').then(registration=>{
    show(registration);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;
      if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed')show(registration)});
    });
  }).catch(error=>console.warn('Offline update checking unavailable',error));
}
function freshRenderPlaces(){
 const input=$('freshPlaceQuery'),out=$('freshPlaceResults'),status=$('freshPlaceStatus');if(!input||!out||!status)return;
 const q=input.value.trim(),terms=q.toLocaleLowerCase().split(/\s+/).filter(x=>x&&!['in','near','at','the'].includes(x));
 const matches=q&&terms.length?entries.filter(e=>{const text=[e.restaurant,e.cuisine,e.location].join(' ').toLocaleLowerCase();return terms.every(t=>text.includes(t))}):[];
 $('freshMapsLink').href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q||'restaurants');
 status.textContent=q?(matches.length?`${matches.length} saved ${matches.length===1?'restaurant':'restaurants'} match`:'No matches in your journal. Try Maps to discover new places.'):'Search saved restaurants by name, cuisine or location.';
 out.innerHTML=matches.slice(0,8).map(e=>{const photo=e.photos?.[0]||getLocationImage(e.location);const score=overallScore(e);return `<button class="fresh-place-row" type="button" data-open-passport="${esc(e.id)}"><span class="fresh-place-thumb">${photo?`<img src="${esc(photo)}" alt="" loading="lazy">`:'<span aria-hidden="true">⌖</span>'}</span><span class="fresh-place-copy"><b>${esc(e.restaurant)}</b><small>${esc([e.cuisine,e.location].filter(Boolean).join(' · ')||'Saved restaurant')}</small></span><span class="fresh-place-score">${score===null?'—':esc(score)}</span></button>`}).join('');
 if(matches.length>8)out.insertAdjacentHTML('beforeend',`<small class="fresh-privacy-note">Showing 8 of ${matches.length}. Refine your search to see others.</small>`);
}
function setupFreshUI(){
 $('freshPlaceQuery')?.addEventListener('input',freshRenderPlaces);
 $('freshHomeDiscover')?.addEventListener('click',()=>{mapLocationFocus=null;mobileGo('map');renderMap(entries);freshRenderPlaces();$('freshPlaceQuery')?.focus({preventScroll:true})});
 $('freshLogPlace')?.addEventListener('click',()=>openUnifiedQuickLog());
 document.addEventListener('click',ev=>{const btn=ev.target.closest('[data-reco34-location-photo]');if(!btn)return;const key=locationKey(btn.dataset.reco34LocationPhoto);const select=$('locationImageLocation');if(![...select.options].some(o=>o.value===key))return;select.value=key;showSelectedLocationImage();const manager=$('locationMediaManager');manager.open=true;manager.scrollIntoView({block:'nearest'});$('locationImageLocation').focus({preventScroll:true});});
 freshRenderPlaces();
}

function setupReco49(){
 const online=true;
 function profileTab(key){const panels={account:'reco49AccountSection',palate:'profilePersonaHome',stamps:'profileStampsHome'};if(!panels[key])return;for(const [k,id] of Object.entries(panels))$(id).hidden=k!==key;for(const b of document.querySelectorAll('[data-reco49-profile]')){const on=b.dataset.reco49Profile===key;b.setAttribute('aria-selected',String(on));b.classList.toggle('active',on);b.tabIndex=on?0:-1}}
 window.recoSelectProfileTab=profileTab;document.querySelectorAll('[data-reco49-profile]').forEach(b=>b.onclick=()=>profileTab(b.dataset.reco49Profile));profileTab('account');
 document.querySelector('.reco49-profile-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...document.querySelectorAll('[data-reco49-profile]')];const i=tabs.findIndex(b=>b.getAttribute('aria-selected')==='true');const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:Math.max(0,Math.min(tabs.length-1,i+(e.key==='ArrowRight'?1:-1)));e.preventDefault();tabs[next].click();tabs[next].focus()});
 $('reco49FriendsLink').onclick=()=>mobileGo('account');
 // Swipe on the content as well as the tab strip; never intercept vertical scroll or photo galleries.
 let start=null;const exclusions='input,textarea,select,button,a,summary,[contenteditable],.museum-gallery,.monthly-wrapped,.photo-preview,canvas,.graph-canvas,#passportContent,.reco49-intro-inner';
 const groups=[['#profileView','.reco49-profile-tabs button'],['#dishesView','.dish-section-tabs button'],['#visitView','.visit-mode-tabs button'],['#accountView .reco-connections','.reco-social-tabs button'],['#accountView','.reco-account-nav button'],['#editor','.editor-steps button']];
 document.addEventListener('touchstart',e=>{start=null;if(e.touches.length!==1||e.target.closest(exclusions))return;const v=groups.find(([root,sel])=>e.target.closest(root)&&document.querySelectorAll(sel).length>1);if(v)start={x:e.touches[0].clientX,y:e.touches[0].clientY,group:v};},{passive:true});
 document.addEventListener('touchcancel',()=>start=null,{passive:true});document.addEventListener('touchend',e=>{if(!start)return;const p=start;start=null;const t=e.changedTouches[0];if(!t)return;const dx=t.clientX-p.x,dy=t.clientY-p.y;if(Math.abs(dx)<65||Math.abs(dx)<Math.abs(dy)*1.6)return;const buttons=[...document.querySelectorAll(p.group[1])].filter(b=>!b.disabled&&b.getClientRects().length);const i=buttons.findIndex(b=>b.getAttribute('aria-selected')==='true'||b.getAttribute('aria-pressed')==='true'||b.classList.contains('active'));if(i<0)return;buttons[i+(dx<0?1:-1)]?.click()},{passive:true});
 const slides=[['Welcome to Recolleat','A little journal for all the meals you want to remember. Keep your food memories together.','book'],['Make every meal a memory','Log restaurants, rate food, value and service, record dishes and add your own photos or receipt details.','meal'],['Your collection, your rules','Rank restaurants, build saved lists, explore cuisines and revisit favourite places.','cards'],['A calendar of flavour','See your visits, personal spending and monthly Wrapped. Treated meals and what you paid are tracked separately.','calendar'],['Discover your Palate Code','Your recorded dishes reveal four taste traits as evidence builds. Collect Culinary Stamps as you explore.','stamp'],...(online?[['Share with friends, not strangers','Add friends through an invitation link and accept requests. Follow accepted friends to see their shared restaurant entries.','friends'],['You choose what friends see','Publish only selected ratings, dishes and reviews. Share your Palate Code separately if you want. Photos, spending and the rest of your journal stay local.','lock']]:[]),['Keep your memories safe','For privacy, your personal journal stays on this device. You are responsible for exporting backups and keeping them somewhere safe. Signing in does not back up your journal. Clearing browser data, losing your device or changing websites may erase access to it.','lock'],['Make it yours',online?'Use the journal without an account, or sign in to connect with friends. Google is supported; email delivery remains limited during development.':'Start your private offline journal. No account needed.','book']];
 const dlg=$('reco49Intro'),key='recolleat-intro-49-'+(online?'connected':'offline');let index=0;
 const icons={book:'<rect x="65" y="40" width="110" height="140" rx="15"/><path d="M86 42v136M111 88h39M111 109h28M111 130h36M145 42v30l10-8 10 8V42"/>',meal:'<circle cx="120" cy="110" r="57"/><circle cx="120" cy="110" r="42"/><path d="M108 79v63M98 79v22q10 13 20 0V79M140 79q-18 22 0 39v24M140 79v39"/>',cards:'<rect x="50" y="65" width="99" height="117" rx="13" transform="rotate(-12 99 123)"/><rect x="94" y="37" width="99" height="117" rx="13" fill="#17634d"/><circle cx="143" cy="83" r="23"/><path d="M119 119h48M125 133h36"/>',calendar:'<rect x="55" y="55" width="130" height="122" rx="14"/><path d="M55 84h130M85 42v26M155 42v26M78 105h14m19 0h14m19 0h14M78 128h14m19 0h14m19 0h14M78 151h14m19 0h14"/>',stamp:'<circle cx="120" cy="100" r="52"/><path d="m120 64 10 22 24 3-18 17 5 24-21-12-21 12 5-24-18-17 24-3zM89 143l-12 41 24-12 19 12 1-30m30-11 12 41-24-12-19 12"/>',friends:'<circle cx="88" cy="83" r="27"/><circle cx="155" cy="83" r="27"/><path d="M42 168v-15q0-33 46-33t46 33v15M134 121q57-8 57 32v15M42 168h149"/>',lock:'<rect x="68" y="95" width="104" height="78" rx="15"/><path d="M87 95V74a33 33 0 0 1 66 0v21M120 128v18"/><circle cx="120" cy="125" r="5"/>'};
 function draw(){const [title,copy,art]=slides[index];$('reco49Art').innerHTML=`<svg viewBox="0 0 240 220" fill="none" stroke="#f5ead1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="120" cy="110" r="98" fill="#195842" stroke="none"/>${icons[art]}</svg>`;$('reco49IntroTitle').textContent=title;$('reco49IntroCopy').textContent=copy;$('reco49Progress').textContent=`${index+1} / ${slides.length}`;$('reco49Dots').replaceChildren(...slides.map((_,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Slide '+(i+1));b.setAttribute('aria-current',String(i===index));b.onclick=()=>{index=i;draw()};return b}));const end=index===slides.length-1;$('reco49Back').disabled=index===0;$('reco49Next').hidden=end&&online;$('reco49Next').textContent=end?'Start journalling':'Next';$('reco49SignIn').hidden=!(end&&online);$('reco49Local').hidden=!(end&&online)}
 function finish(signIn=false){try{localStorage.setItem(key,'1')}catch{}dlg.close();if(signIn){mobileGo('profile');profileTab('account')}}
 function open(){if(dlg.open)return;index=0;draw();dlg.showModal()}
 $('reco49Skip').onclick=()=>finish();$('reco49Back').onclick=()=>{if(index>0){index--;draw()}};$('reco49Next').onclick=()=>{if(index<slides.length-1){index++;draw()}else finish()};$('reco49Local').onclick=()=>finish();$('reco49SignIn').onclick=()=>finish(true);$('reco49Replay').onclick=open;dlg.addEventListener('cancel',e=>{e.preventDefault();finish()});let introStart=null;dlg.addEventListener('touchstart',e=>{if(!e.target.closest('button'))introStart=[e.touches[0].clientX,e.touches[0].clientY]},{passive:true});dlg.addEventListener('touchend',e=>{if(!introStart)return;const dx=e.changedTouches[0].clientX-introStart[0],dy=e.changedTouches[0].clientY-introStart[1];introStart=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5){index=Math.max(0,Math.min(slides.length-1,index+(dx<0?1:-1)));draw()}},{passive:true});
 try{if(!localStorage.getItem(key)&&!window.recoAuthCallback&&!location.search.includes('code=')&&!location.hash.includes('invite=')&&!document.querySelector('dialog[open]'))open()}catch{}
}

// Build 4.50 / 3.9: local-only extensions. Existing storage names are unchanged.
function cleanBanner(value){return ['classic','royal','citrus','crimson','golden'].includes(value)?value:'classic'}
function cleanWishlist(value){if(!Array.isArray(value))return [];const seen=new Set();return value.filter(x=>x&&typeof x.name==='string'&&x.name.trim()).map(x=>({id:String(x.id||uid()).slice(0,100),name:x.name.trim().slice(0,120),location:String(x.location||'').trim().slice(0,120)})).filter(x=>!seen.has(x.id)&&seen.add(x.id)).slice(0,1000)}
let reco50Undo=null;
function reco50RateEntry(e,records){if(!e)return e;const vals=records.filter(v=>v.restaurantId===e.id&&v.foodRating!=null&&Number.isFinite(v.foodRating)).map(v=>v.foodRating);return {...e,foodScore:e.ratingMode==='visits'&&vals.length?Math.round(vals.reduce((a,x)=>a+x,0)/vals.length*10)/10:e.manualFoodScore??e.foodScore};}
function reco50ApplyMeans(){const totals=new Map();for(const v of visits){if(v.foodRating==null||!Number.isFinite(v.foodRating))continue;const t=totals.get(v.restaurantId)||[0,0];t[0]+=v.foodRating;t[1]++;totals.set(v.restaurantId,t)}for(const e of entries){const t=totals.get(e.id);e.foodScore=e.ratingMode==='visits'&&t?.[1]?Math.round(t[0]/t[1]*10)/10:e.manualFoodScore??e.foodScore}}
function reco50RenderBanner(){const art=document.querySelector('#profileView .profile-identity-art');if(!art)return;const banner=cleanBanner(profile.banner),req={classic:0,royal:10,citrus:20,crimson:30,golden:40};const unlocked=k=>k==='classic'||earnedRewardLevels.includes(req[k]);art.dataset.banner=unlocked(banner)?banner:'classic';const select=$('reco50Banner'),previews=$('reco50BannerPreviews');if(!select||!previews)return;const options=[['classic','Classic'],['royal','Banana Club'],['citrus','Electric Citrus · Kiwis'],['crimson','Strawberry Fields'],['golden','Golden Orchard']];select.replaceChildren(...options.map(([k,n])=>{const o=document.createElement('option');o.value=k;o.textContent=n+(unlocked(k)?'':` · unlock at ${req[k]} restaurants`);o.disabled=!unlocked(k);return o}));select.value=art.dataset.banner;previews.replaceChildren(...options.slice(1).map(([k,n])=>{const b=document.createElement('button');b.type='button';b.className='reco50-banner-sample';b.dataset.banner=k;b.disabled=!unlocked(k);b.setAttribute('aria-label',n+(unlocked(k)?'':' locked'));b.textContent=unlocked(k)?n:`${req[k]} restaurants`;b.onclick=()=>{select.value=k;select.dispatchEvent(new Event('change'))};return b}));}
function reco50RenderExtras(){const b=$('reco50Undo');if(b)b.hidden=!reco50Undo;const groups=$('reco50Groups');if(groups)groups.replaceChildren(...[...new Set(entries.map(e=>e.group).filter(Boolean))].sort().map(g=>{const o=document.createElement('option');o.value=g;return o}));const box=$('reco50GroupSummary');if(box){const map=new Map();for(const e of entries){if(!e.group)continue;const k=e.group.toLocaleLowerCase();if(!map.has(k))map.set(k,[]);map.get(k).push(e)}box.innerHTML=map.size?[...map.values()].map(es=>{const mean=es.reduce((a,e)=>a+e.foodScore,0)/es.length;return `<details><summary>${esc(es[0].group)} · ${es.length} branches · ${mean.toFixed(1)}/100</summary>${es.map(e=>`<button type="button" data-open-passport="${esc(e.id)}">${esc(e.restaurant)} · ${esc(e.location||'Location not recorded')} · ${e.foodScore}/100</button>`).join('')}</details>`}).join(''):'<p class="muted">Link branches to a group in a restaurant’s detailed editor. Each saved branch contributes equally to the group’s mean food score.</p>'}reco50RenderWishlist();renderBackupStatus()}
function reco50RenderWishlist(){const root=$('reco50WishRows');if(!root)return;root.replaceChildren();for(const w of profile.wishlist||[]){const row=document.createElement('div');row.className='reco50-wish-row';const t=document.createElement('div');const name=document.createElement('b');name.textContent=w.name;const loc=document.createElement('small');loc.textContent=w.location||'Location not recorded';t.append(name,loc);const log=document.createElement('button');log.type='button';log.textContent='Log visit';log.onclick=()=>{openUnifiedQuickLog();$('recoQuickRestaurant').value=w.name;$('recoQuickRestaurant').dispatchEvent(new Event('input'));notify('Save your visit, then remove this wishlist item if you wish.')};const del=document.createElement('button');del.type='button';del.textContent='Remove';del.onclick=()=>{const prev=profile.wishlist;profile.wishlist=prev.filter(x=>x.id!==w.id);if(!saveProfile()){profile.wishlist=prev;notify('Could not save wishlist.','error')}reco50RenderExtras()};row.append(t,log,del);root.append(row)}if(!root.children.length)root.textContent='No places saved for later.'}
function reco50PickList(list){const dlg=$('reco50Picker'),search=$('reco50PickerSearch'),rows=$('reco50PickerRows'),cuisine=$('reco50PickerCuisine'),location=$('reco50PickerLocation');if(!dlg)return;let selected=new Set(list.restaurantIds);search.value='';for(const [node,key,label] of [[cuisine,'cuisine','All cuisines'],[location,'location','All locations']]){node.replaceChildren(new Option(label,''),...[...new Set(entries.map(e=>e[key]).filter(Boolean))].sort().map(x=>new Option(x,x)));node.value=''}function draw(){const q=search.value.toLowerCase().trim();rows.replaceChildren();for(const e of entries.filter(e=>(!q||[e.restaurant,e.location,e.cuisine].join(' ').toLowerCase().includes(q))&&(!cuisine.value||e.cuisine===cuisine.value)&&(!location.value||e.location===location.value)).sort((a,b)=>a.restaurant.localeCompare(b.restaurant))){const label=document.createElement('label');label.className='reco50-picker-row';const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(e.id);const copy=document.createElement('span');copy.textContent=e.restaurant+(e.location?' · '+e.location:'');const score=document.createElement('b');score.textContent=e.foodScore+'/100';check.onchange=()=>{if(check.checked)selected.add(e.id);else selected.delete(e.id);$('reco50PickerCount').textContent=selected.size+' selected'};label.append(check,copy,score);rows.append(label)}$('reco50PickerCount').textContent=selected.size+' selected'}search.oninput=draw;cuisine.onchange=draw;location.onchange=draw;$('reco50PickerSave').onclick=async()=>{const current=lists.find(l=>l.id===list.id);if(!current)return;const next={...current,restaurantIds:[...selected],updatedAt:new Date().toISOString()};try{await putStore(LISTS,next);lists=lists.map(l=>l.id===next.id?next:l);dlg.close();render()}catch(e){notify('List could not be saved.','error')}};draw();dlg.showModal()}
function reco50BindDrag(list){if(list.ranked===false)return;let from=null;document.querySelectorAll('[data-reco50-order]').forEach(row=>{row.ondragstart=e=>{from=Number(row.dataset.reco50Order);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(from))};row.ondragover=e=>e.preventDefault();row.ondrop=async e=>{e.preventDefault();const to=Number(row.dataset.reco50Order);if(from==null||from===to)return;const next={...list,restaurantIds:[...list.restaurantIds],updatedAt:new Date().toISOString()};next.restaurantIds.splice(to,0,next.restaurantIds.splice(from,1)[0]);from=null;try{await putStore(LISTS,next);lists=lists.map(l=>l.id===next.id?next:l);render()}catch(err){notify('Could not reorder.','error')}}})}
async function reco50RestoreUndo(){const u=reco50Undo;if(!u||entries.some(e=>e.id===u.entry.id))return;const restored=lists.map(l=>{const m=u.memberships.find(m=>m.id===l.id);if(!m||l.restaurantIds.includes(u.entry.id))return l;const ids=[...l.restaurantIds];ids.splice(Math.min(m.index,ids.length),0,u.entry.id);return {...l,restaurantIds:ids,updatedAt:new Date().toISOString()}});try{await mutateStores([[RESTAURANTS,'put',u.entry],...u.visits.map(v=>[VISITS,'put',v]),...restored.filter((l,i)=>l!==lists[i]).map(l=>[LISTS,'put',l])]);entries.push(u.entry);visits.push(...u.visits);lists=restored;reco50Undo=null;render();notify('Restaurant and its visits restored locally. Online posts are unchanged.')}catch(e){notify('Undo failed. Use the recovery backup.','error')}}
window.reco50LocalMatch=pid=>{const rows=entries.filter(e=>pid&&e.googlePlaceId===pid);return rows.length===1?{name:rows[0].restaurant,food:rows[0].foodScore}:null};
window.reco50ShareLists=()=>lists.map(l=>({id:l.id,name:l.name,ranked:l.ranked!==false,items:l.restaurantIds.map(id=>entries.find(e=>e.id===id)).filter(Boolean).map(e=>({name:e.restaurant,location:e.location||''}))}));
window.reco50WishlistAdd=(name,location)=>{const old=profile.wishlist||[];if(old.some(w=>w.name.toLowerCase()===String(name).toLowerCase()&&w.location.toLowerCase()===String(location||'').toLowerCase())){notify('Already in your wishlist.');return}profile.wishlist=cleanWishlist([...old,{id:uid(),name,location}]);if(!saveProfile()){profile.wishlist=old;notify('Wishlist could not be saved.','error');return}reco50RenderExtras();notify('Saved to your private wishlist.')};
function reco50Setup(){
 $('reco50NewBranch')?.addEventListener('change',()=>{$('reco50QuickLocationWrap').hidden=!$('reco50NewBranch').checked});
 const home=$('reco50Backup');if(home){const b=document.createElement('button');b.type='button';b.id='reco50Undo';b.hidden=true;b.textContent='Undo last restaurant deletion';b.onclick=reco50RestoreUndo;home.after(b)}$('reco50Export')?.addEventListener('click',exportBackup);
 const select=$('reco50Banner');if(select)select.onchange=()=>{const old=profile.banner;profile.banner=cleanBanner(select.value);if(!saveProfile()){profile.banner=old;notify('Banner could not be saved.','error')}reco50RenderBanner()};
 for(const logo of document.querySelectorAll('.sidebar-brand,.sidebar-brand-name,.header-brand .recolleat-mark')){logo.removeAttribute('aria-hidden');logo.tabIndex=0;logo.setAttribute('role','button');logo.setAttribute('aria-label','Recolleat home');logo.addEventListener('click',()=>mobileGo('home'));logo.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();mobileGo('home')}})}
 const main=$('listMain');if(main){const wrap=document.createElement('section');wrap.className='reco50-extras';wrap.innerHTML='<details><summary>Want to visit · Private wishlist</summary><form id="reco50WishForm"><input id="reco50WishName" required maxlength="120" placeholder="Restaurant name" aria-label="Restaurant name"><input id="reco50WishLocation" maxlength="120" placeholder="Location (optional)" aria-label="Location"><button type="submit">Add to wishlist</button></form><div id="reco50WishRows"></div></details><details><summary>Restaurant groups · Branch passport</summary><div id="reco50GroupSummary"></div></details>';main.after(wrap);$('reco50WishForm').onsubmit=e=>{e.preventDefault();window.reco50WishlistAdd($('reco50WishName').value,$('reco50WishLocation').value);e.target.reset()}}
 const dlg=document.createElement('dialog');dlg.id='reco50Picker';dlg.className='reco50-picker';dlg.innerHTML='<div class="dialog-head"><h2>Select restaurants</h2><button type="button" id="reco50PickerClose" aria-label="Close">×</button></div><div class="dialog-body"><input id="reco50PickerSearch" placeholder="Search collection" aria-label="Search collection"><div class="reco50-picker-filters"><select id="reco50PickerCuisine" aria-label="Cuisine"></select><select id="reco50PickerLocation" aria-label="Location"></select></div><p id="reco50PickerCount" aria-live="polite"></p><div id="reco50PickerRows"></div><button class="primary" type="button" id="reco50PickerSave">Save selection</button></div>';document.body.append(dlg);$('reco50PickerClose').onclick=()=>dlg.close();reco50RenderExtras();reco50RenderBanner();
}

async function start(){
  try{await openDB();{
  const media=await allStore(MEDIA);for(const p of media){mediaById.set(p.id,p.src);mediaBySource.set(p.src,p.id)}
  entries=(await allStore(RESTAURANTS)).map(e=>normalise(hydrateMediaRecord(e)));
  lists=(await allStore(LISTS)).map(normaliseList);
  visits=(await allStore(VISITS)).map(v=>normaliseVisit(hydrateMediaRecord(v)));
  locationMedia=(await allStore(LOCATIONS)).map(r=>normaliseLocationRecord(hydrateMediaRecord(r)));
  }$("storageStatus").textContent="Local database ready."}catch(err){$("storageStatus").textContent="This browser blocked local database storage. Try a different browser or check its site-storage settings.";$("storageCritical").hidden=false;$("addBtn").disabled=true;console.error(err)}
  // Move existing rendered models without changing their data identifiers or renderer contracts.
  for(const [panel,home] of [['dnaPanelCode','profilePersonaHome'],['dnaPanelStamps','profileStampsHome']]){
    const node=$(panel),target=$(home);node.removeAttribute('data-dna-panel');node.hidden=false;target.appendChild(node);
  }
  setDNATab('signature');
  bind();applyAppearance();applySidebarState();syncControls();setFoodScore(75);setValueScore(70);setPP(25);
  // Bind navigation before a complex dashboard render. A failed optional panel
  // must not leave Home/Places/Collection/Calendar buttons inert.
  setupMobile();setupV41Experience();setupV44();setupV45();setupV51();setupV47Accessibility();setupV47AppUpdates();setupBuild33();setupFreshUI();
  try{render()}catch(error){
    console.error('Recolleat view could not fully render',error);
    notify('Some journal panels could not load; navigation remains available.','error');
    try{applyView()}catch(nextError){console.error('View fallback unavailable',nextError)}
  }
  closeDreamHub();renderV41HomeEnhancements();
  try{localStorage.setItem('recolleat-opened-v43','1')}catch{}
  dismissSplash();renderBackupStatus();setupReco49();reco50Setup();document.dispatchEvent(new Event('reco-core-ready'));
  // Media migration is idempotent and never required before an entry can be used.
  const migrate=()=>migrateExistingMedia().catch(e=>console.warn('Deferred media migration did not finish',e));
  if('requestIdleCallback' in window)window.requestIdleCallback(migrate,{timeout:8000});else setTimeout(migrate,1800);
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>start(),{once:true});
}else{start()}
})();
