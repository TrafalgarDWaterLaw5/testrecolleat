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
 const display=profile.username.trim()||"Recolleat collector", avatar=profileAvatarMarkup(prefs.kingdomAvatar?palateCodeModel().character.avatar:profile.photo,display);
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
async function updateProfilePicture(file){if(!file)return;if(!file.type.startsWith("image/"))throw new Error("Choose an image file.");if(file.size>12*1024*1024)throw new Error("Choose an image smaller than 12 megabytes.");const encoded=await imageToData(file,440,.76);const previous=profile.photo;profile.photo=encoded;if(!saveProfile()){profile.photo=previous;throw new Error("This browser could not save the image. Try a smaller picture.")}prefs.kingdomAvatar=false;savePrefs();renderProfile()}
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
    if(terms.length&&!terms.every(term=>hay.includes(term)||reco51NormalName(e.restaurant).includes(reco51NormalName(term))&&reco51NormalName(term).length>1))return false;if(f.location&&locationKey(e.location)!==locationKey(f.location))return false;if(f.cuisine&&e.cuisine!==f.cuisine)return false;
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
    if(p==="service"){av=SERVICE_ORDER[av]??null;bv=SERVICE_ORDER[bv]??null}
    if(p==="updatedAt"){av=new Date(av).getTime();bv=new Date(bv).getTime()}
    const missing=v=>v===null||v===undefined||v===""||(typeof v==="number"&&!Number.isFinite(v));
    if(missing(av)||missing(bv))return missing(av)&&missing(bv)?a.restaurant.localeCompare(b.restaurant):missing(av)?1:-1;
    if(typeof av==="string"||typeof bv==="string")return String(av||"").localeCompare(String(bv||""))*d;
    return (Number(av)-Number(bv))*d||a.restaurant.localeCompare(b.restaurant)
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
      <div><span>${cuisineRankingMode()==='mean'?'Average':'Median'} position</span><b>${cuisinePosition(c).toFixed(1)}</b></div>
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
 $('cuisinePodium').innerHTML=eligible.length?`<div class="reco33-cuisine-list"><div class="reco33-cuisine-list-head"><span>Cuisine</span><span>${mode==='mean'?'Average':'Median'} rank</span></div>${eligible.map(c=>row(c,c.cuisineRank)).join('')}</div>`:'<div class="reco-empty-state"><b>No qualified cuisine yet</b><p>Log three restaurants in a cuisine to rank it.</p></div>';
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
 const pages=[`<div class="reco33-cuisine-cover">${image?`<img src="${esc(image)}" alt="">`:''}<div><small>CUISINE PASSPORT</small><h3>${esc(c.cuisine)}</h3><span>${c.eligible?'Cuisine rank #'+c.cuisineRank:'Provisional cuisine'}</span></div></div><div class="reco33-cuisine-metrics"><div><b>${c.count}</b><span>Restaurants</span></div><div><b>${c.avgScore.toFixed(1)}</b><span>Mean food /100</span></div><div><b>${cuisinePosition(c).toFixed(1)}</b><span>${mode==='mean'?'Average':'Median'} rank</span></div></div><small class="reco33-caption">Rank is position in your overall restaurant collection. Lower is better.</small>`,
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

function renderLists(){return r52RenderLists()}
function legacyRenderLists(){
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
const R54_GREETINGS=["What are we having today?","What’s on the menu?","Ready for another tasty memory?","Let’s find something delicious.","A good meal is worth remembering.","What flavours are calling today?","There’s always room for another favourite.","What’s cooking in your collection?","Every great meal has a story.","Pull up a chair — what did you eat?"];
const r54Greeting=R54_GREETINGS[Math.floor(Math.random()*R54_GREETINGS.length)];
window.recoFoodGreeting=()=>r54Greeting;
function r54SetGreeting(){const h=$('recoPulseHeadline');if(h)h.textContent=r54Greeting;}
function render(){
  r54SetGreeting();
  reco50ApplyMeans();updateEarnedRewards();refreshLists();const data=filtered(),ranks=grandRankMap(),dishByRestaurant=new Map();for(const d of dishRecords()){if(!dishByRestaurant.has(d.e.id))dishByRestaurant.set(d.e.id,[]);dishByRestaurant.get(d.e.id).push(d)}renderStats(data);renderChips();renderSortMarks();
  $("tbody").innerHTML=data.slice(0,visibleTableRows).map(e=>{const rv=restaurantVisits(e.id),latest=latestVisitDate(e),restaurantDishes=dishByRestaurant.get(e.id)||[];return `<tr>
  <td><span class="rank">#${ranks.get(e.id)}</span></td>
  <td><button class="name-btn" data-open-passport="${e.id}"><span class="name">${esc(e.restaurant)}</span></button></td>
  <td>${overallScore(e)===null?'<span class="muted">—</span>':`<span class="overall-score" style="background:${scoreColor(overallScore(e))}">${overallScore(e)}</span>`}</td>
  <td>${e.cuisine?`<span class="pill">${esc(e.cuisine)}</span>`:'<span class="muted">—</span>'}</td>
  <td><span class="score" style="background:${scoreColor(e.foodScore)}">${e.foodScore}</span></td>
  <td><div class="photo-row">${e.photos.length?e.photos.slice(0,5).map((p,i)=>`<img loading="lazy" src="${esc(p)}" alt="Photo of ${esc(e.restaurant)}" role="button" tabindex="0" aria-label="Enlarge photo ${i+1} of ${esc(e.restaurant)}" data-photo="${e.id}" data-index="${i}">`).join(""):'<span class="muted">—</span>'}</div></td>
  <td>${e.valueScore===null?'<span class="muted">—</span>':`<span class="score" style="background:${scoreColor(e.valueScore)}">${Math.round(e.valueScore)}</span>`}</td>
  <td><div class="dishes">${restaurantDishes.length?restaurantDishes.slice(0,3).map(d=>`<div class="dish"><span>${esc(d.item.name)}</span><b>${d.score===null?'Unrated':`${d.score.toFixed(1)}/10`}</b></div>`).join('')+(restaurantDishes.length>3?`<details><summary>+${restaurantDishes.length-3} more</summary>${restaurantDishes.slice(3).map(d=>`<div class="dish"><span>${esc(d.item.name)}</span><b>${d.score===null?'Unrated':d.score.toFixed(1)+'/10'}</b></div>`).join('')}</details>`:''):'<span class="muted">—</span>'}</div></td>
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
  renderMap(entries);freshRenderPlaces();renderCuisineView();renderGraph(data);renderLists();renderVisitHistory();renderWrappedStories();renderLab();renderDishes();renderDNA();renderProfile();renderV44Pulse();renderV45Home();renderV51YearWrap();reco50RenderExtras();renderBackupStatus();applyAppearance();updateDreamHub();applyView();$("storageStatus").textContent=`Saved locally · ${entries.length} restaurants · ${lists.length} custom lists`;
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
  const v=prefs.view==="battles"?"table":(prefs.view||"table");if(prefs.view==="battles"){prefs.view="table";savePrefs()}$("tableView").style.display=v==="table"?"block":"none";$("cardView").style.display=v==="cards"?"grid":"none";$("mapView").style.display=v==="map"?"grid":"none";$("cuisineView").style.display=v==="cuisines"?"block":"none";$("graphView").style.display=v==="graph"?"grid":"none";$("listView").style.display=v==="lists"?"grid":"none";$("visitView").style.display=v==="visits"?"block":"none";$("labView").style.display=v==="settings"?"flex":"none";$("dishesView").style.display=v==="dishes"?"flex":"none";$("dnaView").style.display="none";$("profileView").style.display=v==="profile"?"block":"none";$("accountView").style.display=["account","admin","official"].includes(v)?"block":"none";$("privacyView").style.display=v==="privacy"?"block":"none";$("termsView").style.display=v==="terms"?"block":"none";$("helpView").style.display=v==="help"?"block":"none";$("grandListTools").style.display=(v==="table"||v==="graph")?"flex":"none";$("grandListTools").classList.toggle("is-graph",v==="graph");document.querySelector(".app").classList.toggle("is-profile",v==="profile");document.querySelector(".app").classList.toggle("is-journal-home",v==="home");if(v==="map")renderMap(entries);if(v==="graph")renderGraph(filtered());
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
  r.innerHTML=`<textarea class="dish-name" rows="1" placeholder="Dish / item" aria-label="Dish name">${esc(item.name||"")}</textarea><input type="hidden" class="dish-categories-input" value="${esc(cats.join(', '))}"><input class="dish-rating" type="number" min="0" max="10" step="0.1" value="${item.rating===null||item.rating===undefined?'':esc(item.rating)}" placeholder="—" inputmode="decimal" aria-label="Dish rating out of 10"><label class="reco-build3-photo-label">Choose dish photo<input type="file" class="reco-item-photo-file" accept="image/*"></label><span class="reco-build3-photo-state">${r.dataset.photo?'Photo selected ✓':''}</span><button type="button" class="remove-item" aria-label="Remove dish">−</button>`;
  r.querySelector('.reco-item-photo-file').onchange=async ev=>{await v45UploadPhoto(ev.target.files?.[0],src=>{r.dataset.photo=src;r.querySelector('.reco-build3-photo-state').textContent='Photo selected ✓'});ev.target.value=''};
  r.querySelector(".remove-item").onclick=()=>r.remove();$("itemsEditor").appendChild(r);const nameField=r.querySelector(".dish-name");const fit=()=>{nameField.style.height="auto";nameField.style.height=Math.max(44,nameField.scrollHeight+2)+"px"};nameField.addEventListener("input",fit);requestAnimationFrame(fit);
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
    <label>Food rating /100<input type="number" min="0" max="100" step="0.1" class="visit-rating-field" value="${v.foodRating??''}" placeholder="Unrated"></label><label>Meal value (£)<input class="visit-food-field" inputmode="decimal" type="number" min="0" step="0.01" value="${v.foodValue===null?'':v.foodValue}" aria-label="Food value for visit ${i+1}"></label>
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
let r53SavingEntry=false;
async function saveEntry(ev){if(r53SavingEntry){ev.preventDefault();return}r53SavingEntry=true;try{await r53SaveEntry(ev)}finally{r53SavingEntry=false}}
async function r53SaveEntry(ev){
  ev.preventDefault();const old=editingId?entries.find(e=>e.id===editingId):null;
  const name=$("restaurant").value.trim(),location=$("location").value.trim();if(!name){notify("Enter a restaurant name before saving.","error");return}
  const pid=window.recoGoogleSelection?.(name,old?.googlePlaceId)||'';const possibleDuplicate=entries.find(x=>x.id!==editingId&&((pid&&x.googlePlaceId===pid)||(similarName(x.restaurant,name)&&location&&x.location&&locationKey(x.location)===locationKey(location))));
  if(possibleDuplicate&&!confirm(`“${possibleDuplicate.restaurant}” at this location looks like the same restaurant already in your collection. Save a separate entry anyway?`))return;
  const items=[...document.querySelectorAll(".item-edit")].map(r=>({name:r.querySelector(".dish-name").value.trim(),rating:recordedDishScore(r.querySelector(".dish-rating").value),categories:normalizeDishCategoryNames(r.querySelector(".dish-categories-input")?.value||""),category:normalizeDishCategoryNames(r.querySelector(".dish-categories-input")?.value||"")[0]||"",photo:r.dataset.photo||""})).filter(i=>i.name);
  if(old&&!confirmDishOverlap(overlappingDishNames(old.id,items.filter(i=>!(old.items||[]).some(x=>reviewDishName(x.name)===reviewDishName(i.name))),'review')))return;
  prefs.dishCategories=normalizeDishCategoryNames([...(prefs.dishCategories||[]),...items.flatMap(i=>i.categories)]);savePrefs();
  const vibes=[...document.querySelectorAll(".vibe-check input:checked")].map(x=>x.value);
  if(workingVisits.some(v=>v.foodValue===undefined||v.spend===undefined||v.foodRating===undefined)){notify('Check visit ratings (0–100) and non-negative monetary amounts.','error');return}
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
    render();$("editor").close();r53SavedMeal(e.id);
  }catch(err){console.error(err);alert("Couldn't save the restaurant or visits: "+err.message)}
}
async function deleteEntry(){
 if(!editingId||!confirm('Delete this restaurant memory?'))return;
 const id=editingId,undoRecord={entry:clone(entries.find(e=>e.id===editingId)),visits:clone(visits.filter(v=>v.restaurantId===editingId)),memberships:lists.filter(l=>l.restaurantIds.includes(editingId)).map(l=>({id:l.id,index:l.restaurantIds.indexOf(editingId)}))},updatedLists=lists.map(l=>l.restaurantIds.includes(id)?{...l,restaurantIds:l.restaurantIds.filter(rid=>rid!==id),updatedAt:new Date().toISOString()}:l);
 const snap=buildRecoverySnapshot('Before deleting a restaurant');const ops=[...(snap?[[SNAPSHOTS,'put',snap]]:[]),[RESTAURANTS,'delete',id],...visits.filter(v=>v.restaurantId===id).map(v=>[VISITS,'delete',v.id]),...updatedLists.filter(l=>lists.find(x=>x.id===l.id)!==l).map(l=>[LISTS,'put',l])];
 try{await mutateStores(ops);entries=entries.filter(e=>e.id!==id);if(Array.isArray(prefs.shareDrafts)){prefs.shareDrafts=prefs.shareDrafts.filter(r=>r&&r.id!==String(id));savePrefs()}visits=visits.filter(v=>v.restaurantId!==id);lists=updatedLists;reco50Undo=undoRecord;$('editor').close();render();notify('Restaurant deleted. Undo is available on Home until this session ends.')}catch(error){notify('Delete failed; collection was not changed.','error');console.error(error)}
}
function syncControls(){const f=prefs.filters,g=prefs.graph.filters;$("filterLocation").value=f.location||"";$("filterCuisine").value=f.cuisine||"";$("filterVibe").value=f.vibe||"";$("filterRegion").value=f.region||"";$("filterService").value=f.service||"";$("filterMinScore").value=f.minScore??"";$("filterMinValue").value=f.minValue??"";$("filterMaxSpend").value=f.maxSpend??"";$("sortProperty").value=prefs.sortProperty||"grandRank";$("sortDirection").value=prefs.sortDirection||"asc";$("graphFitMode").value=prefs.graph.fitMode||"off";$("graphFilterLocation").value=g.location||"";$("graphFilterCuisine").value=g.cuisine||"";$("graphFilterRegion").value=g.region||"";$("graphFilterMinFood").value=g.minFood??"";$("graphFilterMinOverall").value=g.minOverall??""}

function openNewList(){r52Collapsed=false;prefs.r53ListCollapsed=false;savePrefs();editingListId=null;$("listDialogTitle").textContent="Create list";$("listName").value="";$("listDescription").value="";$("reco50ListType").value="ranked";$("deleteListBtn").style.visibility="hidden";$("listDialog").showModal()}
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
  $('hallOfFlavour').innerHTML=`<section class="hof-shell"><div class="hof-head"><div class="reco33-hof-heading"><strong>Ranked dishes</strong><span>${collection.length}</span></div>${rarityLegend}</div><div class="hof-ranking">${collection.length?collection.map(d=>{const r=dishRarity(d.score),rank=rankIndex.get(d.key);return `<article class="hof-ranking-row ${r}" data-global-dish-rank="${rank}"><div class="hof-position">#${rank}</div><div class="hof-name"><h3>${esc(d.item.name)}</h3><p><button type="button" class="name-btn" data-open-passport="${esc(d.e.id)}">${esc(d.e.restaurant)}</button></p><div class="hof-row-actions">${d.visitId?`<button type="button" data-edit-visit="${esc(d.visitId)}" aria-label="Edit dish on ${esc(formatVisitDate(d.date))}">Edit visit</button>`:`<button type="button" data-reco33-edit-review="${esc(d.e.id)}">Edit dish</button>`}</div></div><div class="hof-rank-rarity">${DISH_RARITY_LABELS[r]}</div><div class="hof-rank-score">${d.score.toFixed(1)}<small>/10</small></div></article>`}).join(''):`<div class="hof-empty reco-empty-state"><b>${all.length?'No matching dishes':'Your dish collection starts here'}</b><p>${all.length?'Try another category, search or rating tier.':'Add your first restaurant, then record a dish and rating to start your Hall of Flavour.'}</p><button type="button" data-empty-action="${all.length?'clear-dish-filters':'add-restaurant'}">${all.length?'Clear dish filters':'Add a restaurant'}</button></div>`}</div></section>`;
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
const KINGDOM = {"ELT":{"name":"Truffle-at-Arms","description":"An adventurous knight who crosses culinary borders, yet always returns to a few trusted favourites. High standards mean that only truly exceptional dishes earn a place of honour.","art":"data:image/webp;base64,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","avatar":"data:image/webp;base64,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"},"ELG":{"name":"Sir Honeycomb","description":"A warm-hearted explorer who enjoys discovering unfamiliar cuisines and revisiting the dishes that make them feel at home. A generous palate finds something worth celebrating in many meals.","art":"data:image/webp;base64,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","avatar":"data:image/webp;base64,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"},"ERT":{"name":"The Pepper Marksman","description":"A curious and exacting diner who rarely orders the same thing twice. With a keen eye for detail and a willingness to experiment, every high rating is hard-earned.","art":"data:image/webp;base64,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","avatar":"data:image/webp;base64,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"},"ERG":{"name":"The Saffron Sorcerer","description":"A culinary wanderer who delights in new cuisines and unfamiliar dishes. This enthusiastic palate treats the menu as a spellbook, finding magic in unexpected combinations.","art":"data:image/webp;base64,UklGRjItAABXRUJQVlA4ICYtAAAwkQCdASrwAPAAPlEgjUQjoiEWis38OAUEsQHgfw/rZB58PzaLI/mv7h5zezrtLy2+mv0d7Uv9r/3P8L7tv0n/7PcG/V/9eOuz+4f4zfA7+nf6L9zfeJ/43q9/znqNf4D/qda/6FX7fenh7NX9a/5n7te1V//+zs6U7Knjp9m/vP+S/43+K9v3Gv13ah3yv8A/tf8F6P/9nw1+Kv+n/hfYI/J/6D/lf7t+2v+E9XXbm2w9Aj3m+w/7X+//lJ8OH3/nJ9lfYG/N3kcqBnkzf4f/y/3PqE+rP/Z/r/gX/nX95/4H3QIb7HvrWrehqLEteCcL4SojVJwz3lBr6zp3bE77pigk72kgAf6LnLhH6rmBC2VzQ14XQ0W4HC7FytK6FblmQ0jYsTpJIz0h9Ven6oeaheUd8kqofVfYUP+EBnXUAlseBvbj1PxiWxeyIjr4/oHupCHw7ktMqkwP1ajhtqJqrtHcNOIZDffP+yl5xJtl6cIwbw89Bt3MZvdGpg//fvTYz6i7zxZWPUFiMaUgJZPq/+nB0V3v/cCdDki30d9Vr72BPJ5tLPOBlwytqm6XemU4cShQHOFpbf2yFdF+vSeaEBhfclvJ51Gav8f//5cjcx+RO6Lv/J5mfDeag9wT9XjbYcWUpdvgnF+/VU04tUqb65nFb7vXGmhFdFRtoNmjFBIhgY/3UPCkvfY1to+/mU/Yo7YMUbd1BFbtON+yuOHfAMSMvftfkvDnpWPwLDQl6XYWW4TvknwyPDKZL5y/+2hdUdFy/Pe60q1y6CwBk/ZGWJbtYXYymjyUsEOWERVqhAXd0tpR1QHoeLIAW6aWIcH+Z1d3Aq1oGLLrvvhbfnWBjR38DnHXPzpOuWFFzIC561i5C1AbrE1q884IRQpFj6Kl7fUQfll+elaf2Q5774Pzicw7ZTVEWZS0UQV6CH01CNfDHAWSUicjHQ1u6eoa3CT0S89ojGyy/TIpkRTlRmO4v5VtjOfd7L2+3ujnwAGLrtI91jdwaupDgd1GVWpi2b8+TBYA6yZ1PNeNYkC3jo3P6a+xKwWjMc0kk4xIB3rkEokdd+mmN1Dtpuo2Eetc5LPV7WB4jxck6guQDU1wsBal52C0RHicuR+tNPLe0eYfakGViRucpBKQu2gv/Ud1w5ukE2J18MhPMQCcpD20K2msQ7nXiXvWnh86p+nKwMl144gimHNN7IEqejplz0caXbEiGaW1snfKX9ETBesahW6V9uwVf9++xi5K74jHlja3R28R/+Gd4CZWHmzAPtf9Mgpl6y6G9WXYVE4VEq/LSsQPTPniNudSUhy5VwBvLiZ4uTQ0GZvduLnxlAqm72Osj2FdrNAVWHLdS+cxuh1DPjxf1L9l9JhcCz/Tm4UGF2iszn6DgtFw9sVG43VRqZdU/Jnt1S/0xqQwfua/5srFgeis67+tqfKffHrhlX9emdSitDPLgapA1o8l+9TQYmki5++lFfq9p1JYBQmIHx8hiGOq1u6/xlL90HOLDi7JBAcbfDOi3gv0v5w4S62rxxeKQZEMouOSBwTGEgYYgZKsKZfIluAA/v19/Hh+iLymXw53tIsA9+m+WYAxCkIOcQ3w1pY+Irdo4tV1N7Mz9QORasKN1HEzkJ331uk2td7B1HBMCuAt+i4gnkm4wKN2aPoDCaul+9DVPjpM5NGSIBQWXtSiC0ewX1Qwgi5J0uQF3mOIMNG6EQgxq2+c/tmq5ZQMvANBAqoLcd+FyXg0860GUm8rK2hrKPwYvWOPfcg1s0dvJnj5CMtOw/ijhzZjO5nlBH3jtv0NJVVC/Jik6j0W0IqM6Zu3BV4cGAoobHVQWvGtcHrsMd04GT7k+DmQnQ7qxC940zv/34KciiymIf2HhDA5T3UwsB8SayEpo6UX/GmDvO4i7MyeDU1LdiGtymNyRhU8DiUhvv+VlWn3TeiTrJZYpgb0fRuYwPGch39pq6pPbc+7WLzwX4w93a/s8bzMlSRpGrdcLxc0zNUvxejJF2RNP6kXyV94qjZlb2SQ+nJRcyDyuG0BiXebL0c8Y4zHGtm8pmdmZN/GqpYp4DxxZ2qpYDXVQRf4Xjn4IChlkcTtPUnMvGQFKq5uuj75Eavh3huCZdSyReVMX2/DV0bkE049mpAm0+Ih19k5zYsNfFKSb2NMUymX9Q5VrI6blCNsv27p4z9LavOjA1wvxyjgfDmMVFmzMNCb5GHZS4y36yjeMKKigQzB359r9ZCXiJSO6R2YIM6GLWO4AV1Ack0BzYXwViLb1FYJ95JfsTMNoY8QOcm6cJTShe/4aB/6CZqoLnZkgWe8abJFgL72PgFqIwkTYYSnz4ay7LD0vBJos8UsNExyFCWOzip3Gy3DjQWvY56NwFcVyqqCAv44DVhvcig/sEgoROcib32+F/m9J9Pvq6PU1L+zUZll+6f6jxPmNA9o7Mzy21358zWZ1c8XndMsXHXHBKxpYopGbd7nNwHUdh1LSFF/2FG6M+i3K/Wxwpit1IP6RxsbYzv/EXyR0qW5/bY6rj72iuW/vPa8B5Fqpa0/ke1vOfOZRpN0A5dvox7l9wrxAif18NJy/+E6GcwK+DoKXv5WCjDeOifBPvMRrs4YvX9UPQL6NeR/wTgrw+OjVVjnwAWGBrbRKnrB9Eg+xo5mQw89HVv+uyQIEzk+yL6MWhJTNTGf7YT1b2GCnExPM0KxdXjme/uEms3BwUVPVwAAohLE+O9dxvmj7/au7XKH9g8xGGrblJBwU98FgFBNuC1Zur5xV+VjgZaJnoeB1Fbf+V/e2NQu3Agvg06sD7ykFlGKKbc3kz5J4PYKUwpxthKI05IJBoxEu8/sQzDBDDq0jUfafZsevLLU/n1iJt/AJO/R5Kks16qYTz3r3dS3rkeYakpjOqnHArGOvmpI9Wz67CABBU7VDHt5adke5VEMBhqwiDKEuA2sfaENQNLM9aoW9/6BgQ5PmrZtM2UlaeeuNi/oY5FkiAm0UfCclDjGlEtyedg919zxjcdAoBWjsCIIg0Rk2Swf7zd7wWY+95gTd46s97Yocu7ipko3OHkNzP8h7sFXW3SUjImi9rcl/dY230EzefWcWifhqWelxKTgt+idjc7KtBM8Fhsq2NiP9HFtVsjtssMKy5eT+F03+kqPiCi8FBsl65CypP169woAXQ2YJ7PTKbURWcToE5bO2RKXpGjtm87wYMIWSXOHLpUK2KVExiaUlGonLnqszp/S72LklNoSBYZMXJWD96c97hOAgR/K5+lg+KhPhRcr26I2FOsdJU+XZgtLoWg2Oje+fOaP4ZHKspfsYdH4c9ArTivhgmgWw21Kj7EvqBIxT/GZ8AXHoNR3RaUoa+UqWFGt69nxo11V1fj4o3JSmj9Mjx8pmTMN4fpLi7445/qByV8H9tPPX6XfLVYuo76d5pKqRoyTasQ80ES0TqvUAP4ssnqpTYj09VKXJbjKCJkva/vw1BV+D5f9w05vy0XxuIjXhPXnb9FuNEiQiLVCyq/265GZPwXo2+GuaI/GH/6UGuK9dSr/gyM5tR/J/PNGcl/ivKxOc7sjxG9jn7/dcFHMogLh1fGYtCzKl7nQpWH4PEPvh0QMJCr0tNRFbpb3/DvHq3kK1ocoEu7pk0MAovEirtvL2/9fgVbBmQCvCCeS5dcw3WkDXx3LEMKnBqJ7GKBo7P2tNL/MGCB0gMZy0SABov5qpDvh5qNUTOJiv2ka1EwgxYVbdmRd4hqNBrhKCEkNOWtV2vz7E59xXhPc480mplBPu1XzF5pBgZM/rx7SB4dQTVeqJV0jvKWPL1bvfP9wYZexJa2c/VhedM/Skl1uRtuZVxHk/QQcqVANbQT+aIxvFfAg99zDFdlcAB7JAEqallHDBKCNUXd++isFzSi2vT4wh7S1NgJLsa7sQq/S2cq+HESFNH9iQalgkXJYx3hJxiVQbPAU2QnyTbvukNavHuGPu4rfNQROzgqDFXUkXjcQo1ZvTc/y3bO+8ZUzmsV+ACIiaR+DBZnDbHD2vP9zgYnm7SDKWk1ufRLstunWtUwl+qERMxpcZSQDpFmuKIcpNpIh0qt/j/CnwWzbSfz6fFGS6/EJG96GVwwkOQfY12LvbU9erRVpAd7mavWStQqDuG8ucjcGNUFxyCtVZZUqAH0dy9TqCx94IPlw4FY8qtKruefng40h/DJC5GqfKyQppiTXoVBzDKcVO36KOAkify59bOlj0V4T5HhcI+0SWUQx/cpIh+cxNeCo7ihDIaP7LMa+eHvzG6FKadFAY16MtV3x3iy07ADSHHiirUyWxsLwy02O8/xHjJi8huhbKnhVIxqDv8OZaE0LiG2AVCMaITPoKvwd5/aDXE4HaciDfT2oNERHjGDKy4uJD8kA8uqSZF2FCUVycDHd7hh6mPw+fVanKQOEc2v5mZ0Iv+kNV3AfrtB8fbIAT8XKwQsvH/Ja1g5CzPCqPbJahWy0Fm9XSyDrQbqK0N/Z1+Y7qc0IJcxzZMk39E2lk3e3rw77nE6H71Nxqp84iMtyv0BgxhnjbwW2MRJ1h62sKh02dL+C78ubF7HOEoNzc6zJLAtAMu8fLJZs5sjcNOFqWysnP/uZREjmVcAZLy2/IkUiLW7tGzxSlQ/4QG0whs0Lthap61435T9GfYS3afYGTLvdHigLMdxHr5hDKhs+WkdlrcdmAWxHLjHGUNvZNuX8ZEhATD83aJwhMrSNCOt42Exf6c2kX4MSCG2bK/zR/wz82qCrLJE9yg79k2VWVRGn8NwI80xmGLf3c+TwISDbQmWYpVd4pzMQNtDCdBvA4QfHU4KBNobclNxxp54ykKTCMsCqtfXK/PzkhFuWU30RsvNP9tFsZY8toAclAoIerPC/Ji7eIh3NfX1rjWLZriHNil5VYL0D7H7yPwXQLb1WKJw7cWZfRscujpBqf4cJS6HPUa01BXgk62B/0DpSmeTfZ8svFAm7woQrjAS34MLvtxoQkpCf5obWYP1JXhF0BD2qY+pgkjFUSoCT4Zpu1pZ84O0mS8CChKFOeIF+QggqO5XKfVox4nUKHpeYUQsuQoPhllew8WLGCrnvaly1EQYodzraeEX0uGDWdWmNqZhxkH80//rISpFppDP2ZCRAq1Rue8pHfZdc/4J2kwTHFeaZuaj3McK/Xlf+H6k78bfiroYprmGRxRdmbWbZPG+IZYk4uQNb7qpbD2bFvGHOAjUa7iIJU8XYmUzGYX7XUhrx3LgzcuaCqTlX6KbXa+LPUe0RevENC1bgaV5Jl1A7DD2s5uH6+Y3Zu5NeteGyn5LG7+n2ESLNIiovW78/b2amL7xsUpxbQ3DC7dQqy3h9pCVnXw3AeLgx1Qct54jIvo+W4Fezp9TDgmqE12ZjU8kdVIuc5oaGfq3xbl1wYCaeE9kgsXaHBrWgsB275DoPpHXglxeDf0WtiivvtU1SZvXiTTLhAMGptQzIPpH5xN+zcJcJOWPE2huz7y9DtwN/dtVvB46WDsPN/E5MOk62SHeJAilj4vzENnXxMGeVJKB7KzxAZ2gNXWPBLEL5Errh4PsPiqO0ELOqqN1VgdaDHwxWBkk1/P4gb9XfXF7YEEz+x5b1Ww39BzhFEdNdaWf8bbGiSRy439aitWwaDbUS7YtqnvCB03AQb1DKyel/oi1CGp0d9CzhCiKWYK+oUT/nwOesC0cRPubVrb5BZb09sDmoexnW11i+jBPhhIT4C0sgPAkfUBdyiOqoYCRI/H2YMYqu0ax1Tr4mllQkmAuuEyMjIxA2pO5qY6GWuWeeFVbwHesHDLrfj2Jz03+XJgUBqOYKx12GPe4JTPD1ahXlb2pWlLBy+jaQa5N+kytUD2O84DXkU5jI99NFwM4rwOfKxZBW7I4XMHKX47KqYYIgZWaFeTd2K8uPjosQ76126yVuAr6MSJ7mrphcoz936Q3HyanZXY62YEk3Oow4fHfQfIB+nddezuBKFcv2xtUqk1Tjo/RscnW0BFbmkP/TJM5T1GdC1y9PAd+7X+E1uENWpMOsKBTSge/Htee1qwPVtkQwDyVLcR+FWQP2NmNsGOskMG3sDoSspsIOrg8e6Zb4R+7ny6GD+BxPeirqlsSNpUFEOh4V83W7W4/OWoBecYPUbZ0ARo31ePt+ak1escJ7M+JXxbtQg57JMdU7oSXj5PcC5EC5qBIed8eaFHZEVcAtFb27EyEqXJ9vSYLtAi6KbenG6S1bMx7aVz0ZEJ4stAnOaxO0zwNwew6LVMjvoEuTiCzrptbXzYxfbiolG9yKTvMvkzVrg0/5wnIsr2Y9k5wFVnkJh1tXjK7aQqC8tV0wvHZKyCRP9zHYPH4jr6+qUmKRdXo2sU1QSudwiO0KmvXgKzXMw0U78lJT+JHgPgj4GeXMy/NIuq7AzGC4by5unPrZhQvagXX5zjBL6KTwwBJ8IlFlBg4e5YJ1r5zdbqVkcdVWngygVWMxf5buoad4YeWhXuTBULZ2HlOA3WSwMCUEngMv51PVnP4GdVVGc8HL13dPqX4PR4LWKgRz8MAi8mFIS6tkSfAfHX7NY3as7UDO9epl5SbdNuXtZnTztI1aknP6uuy13giEdSAMyNB0aP+BV3MjT9gtDJAWQB7bP2w1KRY8zm1kzARRBBSMxYTCN50UDlgUiN6Ji5+Tk8QvheKurt4f0J0rQKmrUZeW9C0GKsjaw6PySq0bjSx6nmXSg7iYeHihaPVP/a864ZMrlf8mhzbxXJm2UJPUVV1B5DTH4J9ksqxZrEHN9ZzTrDPthkd+S7ip4ECna+gqjxKj3kBvUU2OQlyPbHiBHGocTmPzM19ajCgZeVy3aEg2clHir9IYDiZJde/fEr6gJgbE48+EYkIsw+J0Fqz1oCAXeZbVObnVPXugYjOg6PoZdylafFJnbB3HdqjZlXwftjksAWqEiMTpoWiaAGYrfhoLICw0Gpk3hm0naTGsnfcqDXLsXlCrummEl4uV6W1OjnK1DaStVmLRNwbPfmXWm2Qjp5k9D+d/mmxpzkP4oe35C5Bpc42AkWgiAF8qBoQOPJeEcbLQkiuuRMqIpZiQzC0Y+Sb8XndMAQ/WXj/dndrxoTtG2Gj4JANnOz577lp3Q2fwfciVdweE8srvrkXiV1FPypw3NGk4P+m0hU6iYtlKqEZfVLSr5DOz5TSVVvIg4eJ88SQvob5Wqlpuq+kJev4xLoIswgJAyog6fME+y6m6IL7gx3wXk1nV5H/IG/df7uEtXjL01PCKWXKsn4u/NLsUlFG+6whlQhhFz3rulajIaov1US/T6NHyf2Sr07NaOYs87TkQN73MYGu97fuB/is8Hz3UyIx5K/jBWk/+1lg3na/hqvfSsHxa2mnTKInCXQdxQl7Ka24tgpuLq435Xh912hVGYjIscR2eVR3ZTUuaCsWFnAC+PH9pSJdxcLIaHkuBd2tP+HnU3LumAWI/iwd4fGhBFrLACSGf/0y7H/TJ67JHO6gW9lcNO7hVPpeHPowAAYpM2iNHG1hJfja8DZrUUYLyv5vfEcDm4nkN2qOB9FA+DFLFvuLTSDV9vEr1N5eoWzd+4KN95E/P8AZS/iPMkREQOzQZM+SpoAVTePoMnJoFecvwtah61yEshsH2HjdL+oA03Xy+B7CTVb5PlqBAB88qzTsCjsnh/HciLLkgGa3gGL6BYVmWPIs34R9XL3WJybrythDh6yKc+EqJ/yqkBCsEO+6nb/iGiF/LZeHRXK9rZ4ik39BFj76aWGjV/92IPC9AoasM93J4sEdqkkbv1BvdYMlypYiq05PgMDj6lRhDvXA74GazCKgwMBnAhc6ivPSKKbWbVv1daQgOI1OlKv2C/PnRTbNKqdQtMlXtC8nc9Wx3gTDpJTHeN+q1o4GiqvN0dm5yE+nWXWAevdKKbTE4Xk1XRkRWutjkRJzrPikSlnzNwlAye5FkXeZlt/zZ/Qh0hiJuc0mXjoXtVyVNHU1bQEV9iDdin85Ae1bUQ+LzhKsQAeWNA3YS4JJXLiFmHiU+aJbu9+qyxz8/ZyitXkZqTPUz/UOMLhLfJVgakTzgVQQSeF5ahuu9qCuspqsjE1QNOvWsSVNezY1FGPxfhrmfJJ+pmGMnin0F0zk/tZy5vveo3XgyaDsc7KuN0Yhg1fEQntRjle2qgcolHs8krWI0ll5gTcM/bcj7HhkHSwNmjRp/2WaQq2L+lYCMEs0mNTdA9urBFSXMCGlcChekbclaiavyJRnAcnXkEYvU4s0UVNumHCmF2INLydXrRHZa90Fa+JUpbRmGIwU5yS/SBbYPy1UHSlhrvk+SuPcw4pBC2mQqdPmJXQQSO+fWXCkb8FuvQmht8u3sbHUv5uCqtgvGU4HkR84dr6j9zJlFlvVXMrK/vRY9YpMh5OEhDK4CLcJOnux4zlalX2vyAZqkXC4axAJld8CdEqGZdtygi0etD/X8ijglcxI3ZR2D8hGApZmdsVmmlIxipENbPrUjBHVwFHMldfafvhTDNZJSmJUf4gfE0RYohdqFS3Pj8F/SDhb+Zoi8VIEggtAxveC1xnLj9OvBppsRzWn5krvq7EbAiMRmijl4B+oa5R9Yik/SHUQOt2rG+FN6EWLtFLvNxEgRh6FEDJ9tM4JpFyvusLZpCs6OM8TlrmMHVDxHFK6v1g0yRQFFddIYTYQqS++etFiqpkRo1IIW3tuTxnb/h9e7hE02bPmxraSyC1LbfTxyZtYvxysUJu7o2+DgBzrBTfkU2WFW0s+2ileTUg43dtvoskWVZOtu19CsCupdnIzFxAV8Cca5RA+K6Y71Sjc+jkAQaIAxvKmiqdMp0ev1BJCr17ugwUznqswzeLTJzjUXESWbDWbPWQTfyzLcw7FDaiG3pubq2ffm4PkgPCT/7U0LCwPgQGgBs+v5fxQ7NMbf9JmEbm3sSUcbUlc8niVAI6tOaw+SbEeKh/qLOgxOE2b8LVPx0RTpvm84visr5GuGOkhrzN3eqaO8ZQbeGHMeziqIhnLeWR4z5bU5MYkr08C5C1oQ2tOXr/1I9jTMlNsIVE1r4yByN+OVHx9VDYF8UC2vcOtLXqdGlrReiJ+3mtbkANvg1+dWKybGnz7AK+Qa1E3ZYj+t8egc+LJlGu3XLcqF5T1acLEQCsAmMLrjX51OCKjrToG+hPFGos8rPLiuoxJT8U/R8xe3f/t3RRKFrT6PDf7XG5jlAZnowtvM4j5peR5THsaYB0t2WFevskkrfR6dijn+gcxuuZq0QblL0Nz6Hnc+2pIc+HKpQk/TIj7sz5S2d8/ov7a1gVvnOG3jpMOZarC0IKVRfh1TgS0jps91c5jCGr/FfwWzvc5nQFXLPad6xmbplZZb9tivqB6elSlpFZYXWjPxRCaLbWVn1+MpE/8uDnyUZNFhkX1cyoGh9qF3hRPDpfvyiZCp4lfOd7wB8Cz4uiXU5RfaBNHVIn/3cbrnPI/9pBvUffvGIZj1XKIbExxdisqgFP+OfMbBibe0FIud8OlEs16WCDFvqPZ3hH2RWzbrBniuHl5PNE+uKQYLBQN/3Nq+mqehxAVDqJvNRikfRwlsFMnF9b+VRkYoRHDOf78TIbthm1TB1NDPF0Yy12qrZTYbJkInVVxLgsthJrqyy1c02WoEYgHW9juJaNkrRHKXi0EUx69CHu3XpFLw7/6JgeiFrrpQ1PQslcPN+jZ1f3xrDqLydAHjPWB1wyW10/MjFopWtSPx3Nots/4UPTh0kV8711FqYs7VL99JydWoKRzHxsyK4mwQGwG1kqGP+bQ/hwRHnZrpt0Jyd6xDxo0aA576FRt/dRmnxuO1jUy3gXPX51+jknQ+R7WUdfIwkFrgRjxakSF44xgOtFI1QDgEpjIMHu13ya7ePgDhlvUAH7kKTJn6KYdJSfXm83euljvvyydlxScSM2ZinAMFWI2vHhAHKxelLyCH4tCUwjT1FsBp52YeIa1o2vgD8fkkEhc5k1konGjmh8NpkpCWyaf4HZWjdZ/hdewJU5fucg/xguk7kcyppUmVb6S2zS2+M+xxm4PjuT7rqK/nbY+b6OQcMGPz0bYHHITxaori15KZ2hdp6IyT3eE6F2D2/bd5iMSh313V56DoGS68M+pTmSOjYsPAV7yisrZBXOTimSN7/lXAEzruqDzgSfPwrqXahhsrsbbAUs+XuptUe5WYwUaAK6VfVyB+4/nqtBBo54MPZE9q7co0147JQSBiDAyZLtXo/P+rpYsEWxX4Rh/B446M5T5g/fLwlTd+pXjt7rdgs1fmli7hB9ccnxBy1oFyE0rLNUO89cEWWviU9OZ9jQlFMt1sLmHqTpqGdm8Cn5S8nENjXHgnlEk1PHOSBaOXNn85mi2wl5QPLtC75419YNpydblbBDygE6bs+0Uwfr7e6ootcfyICUbUnZpO5MfIpiH99VSppy2nMEqJ4tLq0jq5d6EhMBJUovhUgkS5v+xj6BalnwwXS7KXpKjWEXzjF5n0E3ZF2v5i5USPBNubcsz0dXv/Mt/Ik6T+vbYYf0rhzmXWT/as0C3zrlhlLrjITY2cmjEkr3XdlPqvrMaLu3D00tKcWZ0R9meWWewANPNoLHKR7CM2VARYrBVBL9YfR2l/ilc+uk6pwWkceZCyUR7anXAhXbxTry4E6U4V9Af5SkgsC4jruT11L1yMf3smcEVM9dnpxDJcGKpHe9NQ/M5LpZVGHQ1KzjgXm8u5Z26kTeYsJYQg88n7GUtZaOeGractVBA/BXxVSPYodDwu08vjt1KQT0UPFl8cqdhutFN72bpIDJTSgWOG8n/Tyyecm5jT0dPFNbUktKENTvOEv5QdcH+gfvB6NivzysiGfRXeV5eNQIbh3uUiZpeXCpBs5oCtoIhMpLpHSg6wvmrQN6ZMJhrldHaQBDXyR3Ba2lhh/PaMN1vUCRqhpOjWLI0HyzziE0AeOyqS0j6CPRsPBwWMZoUAZyL7zSIvlREGC0Pu/Xx5PnTDinEhvseFF1cRjRFFGb3R5s6gBtDLoL68PkU6ExPEpLdCmF6le25mMpUZ9hLEe6sbMl5q4YKwoDSLjLDdVZvPTDaLpNFkrUgYnkEw9BhV1eRmeGSf9zuuoWAYJ9J4RkaXYuDzu+HpzepWrWsrtxhNglYfx5D8Xnlqc7PA/yGgxUN+RNaa4Z1CK8m+/q024z7+t9FrNcGGxSGTH4bML2Fi+yTsF4azJ+m11kpRKKVDP1jm+x6rLPQfEfSE5T1I0lfrF6v5sN6n3jiGQhtFaGhEP+fdi4pfo4P2l/hCyxjG12SSjB/d7Xt5YSViExOMjqi6wz1BSSIRoY/rkQIE0cDdG8erxjdPnd1QZdv/+qBVk42Rk74g1Sec7zfuZDXjox56nxA4101nBZDZnRICKQxVArQPe3WvrsMRXgBPC3XX0zhi6Dy81g0JAFRanJ9/Ai9Yv2+ngH+TP21h2P+ztVPinllbziJQv8Q1pERhHOWFkUsc9FQ3J6BhyXlDr/eq5PB/koTMZ4OqsiFmAAhFJ5Tz/negSdrSJWe9i+znvooMwCtinSsH+qviAM89te151D6t2XrVBKzcBMlXkuTl9GFzW4FiTJZp+R8exylnCjzluyPPwgeV6y9V/ECPkAbUpfRU30a0ficwQF5/ZJaezzDBGijtWGJDI7145gNKmh0ukdrYtFe1dt3D24I8sSMKiKkd+eHnmJhAbkur2bTCvDL37cLB1TDCygxr8APzY13c3+VdYdw5arhJ/pYcOe4GjPMhmnMBooDCgJzpBfbY2QylvR02kYTISrLcCiaUVJk2Dv+o1nOVHLWovxmUTyLQry93muxk69OBdFTOo2ILGweoqhkaOZ2qDHsobJ6zxdsXYo6sKetJVle2r/B9YqlLacO30tvOnxY4Z6AsNEJqQe2lH3LfY8luqMwiQThnQnwi0d8QQYysqo8v23cqNdc40VHYKTSmGdq3HWaVzQdZnXlDMy62zRkNpaHibuGwwPHkdSOP/jePv/AwjpSM/aCbzFdHi35MHTJ3VE4Fn6W/3ORj5brFZXOREmvmabzEiYdiuwCbLXPC9UzJKlm03wZLN8CB5V95tF1T9OUbunA9hKTsM6ujYklawhVWJlUgO81c3ziK4leCRZ5NNGMNMgRjAVn6UIpPTxghrFU2vApDv1oRBBV/WK3i/+EciQUTExmUQoB/8/sdXri0+fU6TrhNCABNXWSx73s8pARUNrdm/n+VPiCi5t7O8o22GZ9yyv8b1Ze7ctgtzwYkqBZ19Yp6IWXQ+gK4bhh+7ru3o3QHZiysqrA/J3/q8YudRFZDlgT4uBOe4A3syhg0Sj+1Z2OZTB6MmCPr9C84kiytbAQLQy4lQ+qm2Tu/01LYD9271Rm/vboefR7I013J30S1xD/8R8g9/8SSTXvsfK+NIHHXXQD8TnRX3A5mXVirGtVVixh25MmPGA5lQneoKH8ozWr/FZjVUIK7RUjunZk4ZYro/v+TNA2DCWAFBDbKsJAn9HNEGoh0O0S0DcTL3pg01OaGTB3F6tVyA9YO5O/KgcyoETCfqUr0H/w7cnzDGY85C3LZVnoMQqpL/UsIWKTh7NscTAeiOtR2qXyEiMBH9zc2jTBt5/81BMquc649xr+BKrnQlkDh8hQFULrxHNbXMMvxyBUpweM74zgjj3Rgri6W13OfnYny6mgvFExDT6sdun+fc7hJsANAO8MW0wmO3UeMmtpbtzqy5tnbt8DIjrB5jlYFhxBhVGa1heo7Q3MycQL4mLDDOz1sq/513rgCRP43MrPEWiyxQe9EEtzbD+j+Hk02W+Ug4QAGpqkW4V4DrJVC9JL94MHnc9XePxAxYxBdB0N+dYCBXOuDDqP7mzPxcJhkGAtZjDiq4O60ggPDLfK2ZqTrc0KEzEe4Wt7F3OWMQdITlEQTFvttHgvP9VrtMdAmcwHQsCa4HPhNrzjYapU76mtJ4mmhrWgQHnwYevlnYk0HW/K+4M74ktCH0GcOYBry12l/psVkDtllmgvwPnXUgq0UkuWr31crFCSk8EC8LO4drAUUDbFAP1XZ0oLF9dfPIjVpwhovUzNEVr/8p41OmD1Tvobj4SjrETXb4nAKuEjNjdN6b9hXB5Qah6z9lsIgARaCslqCHhSxILxv9ythRg5s0ztDpLjQmU1Gtu6zPT116zJ5ldd/CkAZk91Op7lGTtXLzsXCIbPNr/6I8pCchMq3LwWv/2PqS7NkQnMY1hXLv1pR3XoUEJlSidi/2B1P2zeCtSza7CWZSNc1xqU0xyJCblF/l4EBTw9klknbZ+JGhi/B2AN1bmBQco5b81pAMh32ggBjQ+NdIHHc4x25942mBwrRDDWNQyty5IICOs6+5VllQPM90OzLy/8gpPiw7yooODTeHzuY6DNYzj6eMNwQf/VVPlWrKuhkPk9qSybAlBe7kXjMvpPAoU3699iszn+SknGxFhYz7ngRASdgoPqZOi6DBtGFHxUeT6xL3WKKRJOzw/0Zb0wWFknEqRlyiOHeAnXi33PitqkxsWo/Olnwuc9yPww0v5o3LXcaRm5ql2xy9i5SuPwraTGv+TaKCn+ABqPqYb4C7854fKnWqsw+8gT+8WoxlLWMPUlfzGLFHvAd5tXyzPQR0pk81qxHBS1eJXTtgoYeZDGdvxjF0plYZ7YPoS/onaAXVqBayILa4hAYGzAbYESNZMWtakq3v2XYmEEFipNUcFanbmb4l9LWav9rr75pZcHmBlSqyclUiSthMXD6ySzcC+Yb4xG8licothSq8HdSPKBxYiOmG3F7pVCwQPUh/n5G85EFOLfBiMT94QhqhFqcFwNMgTWCE69TnlxFqjjtF8RoN/lS2J0P3XoLWqDH78SjqfxrLfEPI/h0uhzEN4EmjHWP6O5FC31x1YCGDO36dGUBf58L78ajgW0QrMKOMo3wcwE0F+ZK9JeMWOlVENPHP8qptR2+ZeANUZv0xSBxMdS7qCk0hnh5PiNBwWs5wYepNXrEBAA90A3b0P7Rm3AryGmiDIg3M/NTQ32C5rCHugOWwxZbuVjcBhhtIhG3E4hnDTgN8izMQMmjHngXBNvgka7+nJSjd0VMHjk56QCVTwHLhGJZxfpiJ1MBs1CfDh7ehYT8ZSCvT2r8p6Ou8tBr7SvkL+Ze2wj/B5irnHvQ2o6by5NC29f1CN3uBzNFdoQpmzFVtWo2mkH56/+IVcnuOC5/q8SPIhjqWVaqojUXBNFmeH02/3o4RMEecMkxxbWmSb3TQT9c8smhL+tSbFlVqjmTLQ9Omnc7uSA9IMjAMoklhaELsrfXfuWH+OPkmz54Qg9GdlXW1QkBuRjUi6ZLN0Hw1Toyfm5HYb9FSqnuhcAP8MdpOBANU0YSMCvpx/rteU/CF7EtG1kSL37xVezqah4S0piC+ClQxVBT9CaPu5Qgh8mMkMrwcPfFD4pZ68Mf6QEeBKq95/HKLGeVU3IfNrKgZylUVpIghrf2q8APexnJTfB7B6BmSbsYhCjiz6oi0axMrTCiewQp+YeAOLJ35vtBfftsY1/86S0XqUlLozp8INO2qv79hS5/UA9zQF+gtY+lpbL/JsNfJXbFqS0qfS16Ka91n/6PtnXB5L8f4c3sDIBc0rb/4UfKh3bA6D/hCMI0252Q+wDeAYxWxGHj97GktCHwUG14jO/XOgwLgJppyFwDIASCyqAT/LS/ULbjonsgVUHMrFawLZqYdZczLMAAKW74dPj2jKEkQ+uJaHndJLLtP6yj2N6igLiMX6TbXnahtF58qhFwEdrRC2fnF2T2AcD2zXg6VkfSDPOmx3rXqJcOKnwRIY2QLL6HYwG+pl2xY3aIUxjX1NFYPyH4FRE8f58JMKvBAKBdN/penDBvcQqmD7BIleai92ATgkzh7wd+BqCvDpsdkaWsrQYYJ6WEgnu4C0UM6/b9wyUqzj931t2qOn75WcpEwEux3jGOa9jV8d+jRo7vzk8bur3mBtpwR1NU9LrkG3SjNipMYDEvzgDFXe2+z4A9CFP8ouRgeYS+KfUiRGgR7r2Q9T4VfwAeW5PdfvMrIUKRngA81MDCgK75zSli9qevHG06Xicp02vBtx4t9bc0ydUS7I1/v2np3djbGq3JTNVX7ZlYinB+176G87W8iku8yq83Zk9kK+eNHUdq/Wng3wwRDGuPzWF4ECnHfGDKtwiQh9NGPhF6VV4YUlRyBenvLfzq+oE2JIglZnEhMvalnRagNnSAkaAUDoRCE1XXfw4caaJi+5UQ5AAAXKRdPABH0o3daM9gNY53n3aqsUqh+4SdartM8Jbxm97LONnW8RqCNqciEzvIgWMuIwO1UJAqhFPc/VyoXOY+FTCaZt+mahSFQWVihKogLIqCnqU9eFkWokhjqkYhEzGE/+Dl/mh6c8ghEDT2UWFi+new73kXJSOSK4vROGZllWT8/P7YsHie8av66+nYA/KRgAAAAA==","avatar":"data:image/webp;base64,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"},"SLT":{"name":"The Steak Sentinel","description":"A guardian of familiar cuisines and time-tested favourites. Loyal but discerning, this diner expects consistency and rewards restaurants that deliver the quality they promise.","art":"data:image/webp;base64,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","avatar":"data:image/webp;base64,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"},"SLG":{"name":"Queen Applecrumble","description":"A champion of comforting flavours, trusted restaurants and dishes worth returning for. This generous diner values the joy of familiar food and finds pleasure in a well-made classic.","art":"data:image/webp;base64,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","avatar":"data:image/webp;base64,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"},"SRT":{"name":"The Chilli Dragon","description":"A fierce experimenter within familiar cuisines, always seeking a new twist rather than a new kingdom. This exacting palate breathes fire at mediocrity but treasures a genuinely remarkable dish.","art":"data:image/webp;base64,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","avatar":"data:image/webp;base64,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"},"SRG":{"name":"The Cinnamon Minstrel","description":"A cheerful diner who explores new dishes within beloved cuisines. Like a minstrel collecting stories, this palate celebrates small discoveries, memorable meals and unexpected favourites.","art":"data:image/webp;base64,UklGRmovAABXRUJQVlA4IF4vAAAwjwCdASrwAPAAPlEijkSjoiEV21XYOAUEsjdurmFPdXXzPmlWJ/Uf3jzfd1HZvly9S+dH/T+p/9G/sj8Af6x+eX6s/3f9R/7d/uz70X+/9W3+P9RH/Jf9XrWvQk8vD2ZP6v/1f3o9rv//9nx0j8S1ibmL9v/vP7ff4f28ccfVf/r+gv8w+/H6z+3+if/P8N/jz/g/4T2DvyT+cf4/8x/7n6se5Gtf/zvUL9ufr/+4/vn+L/bH4YfvfOb50PcD/X//tcfpQH8mD+9/+H+w9Nn1F/5v838C39D/tf+7/vv5Snz6/q2J53X7OHF9XOAd+3fVMeUkbpCfXS/04f5uQXV6dHpFkd5wjp+J2qUassKWgUnyq4m/Y5gt6YZjg1Yl9H//ESePZD6/R8i1kO1Ekj1VpKCl/N/PfJyf8FRzbPEFRL17WLWDOMUOzCSqfF9j8uS3HvSW9cl4imulcuco8cRyD/fZ9/z3dV+G7WeR0tYSX+8xefGdpL8MVM9I3rDqMuOTdtCYr2nGzDONpchLxcGUG4BXYPnIoRMO9X0MkVUkrKNoG79CYdpFvAsrgp3A0EgP86u0liCWB6ftwN2Q2HWGO5VUq5sdtNInmUbsCAspzY2W/mIV3O+UJvZmZ6yAvdlt4+4EJq7KZsvr4UXJMH4aHhxP1Co4iKNPK6JsuKkXeVazwPfSJux2rvqAUtDgHlM7Sp9qZ4KZY/Imm9+ArYCrg3XBkV+VpQLZ8dnAWqHEiCuzITqkzVcdUPleQABfG38CbolYv6XtQ0U14pEc7LAtJ8aPmDUqQIFFxKe6IZKUypDSZP9PzngbeYWhbBw3xOCfr2nCf9AbYxNn4CFeI+twQzl5NjV4zYQdy/AHngQCPaNf5jG9ypRupHHaUkkTOIEHtbf4VO7KhnmUlo2pRqOD9iL+vv5W8x6Zj7K4MNnswkylfxLP2AvVLSaiPBDM3eB0h9mZL5MbrjHz/ItYbgyIH47d3flH4xXEz0u541TKHf8zg/WkcxBhCY4zIq9aHItYwfqDCFbylzsQTXoo9vEB7cKzuNq/OTP2P0vplDgIxUgnWMFaqilu1tPLgYYjlDS78zZiMhQ+cRu12jWEFUdCXEbUlRaDiqkZJ7U9xKjccYNE/41JAF//Ibw4xIqvJmQ6DPDqJHQ32m4we7D4moirLJLfpCJtJoD+bI5PYlvfJHIXlL3PEPJdmaZvwIaS46J0G8hlwa0GxXTY7JTYI4lqNDR4McmXVOqqOadU3aUKkK09Tjb9VIOXMn49nux5lLUT/M9+9XBa3ull3cZ0LZsIwJRx1/2JpyBJYFSzMPF1nsxOOf9cYfAo1QGTyx+2hHegvnCMm+EKO5t9x+3SIq6X6t8/IdbuQGPW2vrbE6jY69T0u4CXhJlPLPmF2JVsazclXnvIyU5cTl34kfYYDDekuFv7lLjtWmP8xeNFNd/n70dsS1V6b1cvRrHg0InGqzQeiz/j/4//9aGzJiTti3atgFm78p+FkRWOU9KpuhQmr9WyyTslFhRv+QPteFzevy6LAAD+/Tyzsfsgs1fHJJG5XWfgkIKnVOKNCVKJeXNbA2Fy9Puv4f2qr0Va9eku23aTWfPR/Xl9WS1GMozQBOJWIUf1pwvbzQ1cY7qkUE22/Hu4NBggNKam8fhM+AbruBT97ZjQ9iOyaBNfxJCudqG538pPV218JqHTpoh5m/u77kB45qMGo3shsLf5xYD4PZZ0K5ruUhda2bymxcnmKQ1P/Br9Kk31pI1R+Fk55Atg/LsIzFxIjzELANSQIourpTqxL4GxUtZQcKoGNNPvnw50obwkoznbLC698FSxLZ1WMR0N1v4rP4kW7JOwk+79Y675bVMpm3j32lEO211na7HxA+jsoeqTVT+De2ORUU3L3HBkl89bWdeiMrfesD1N0S0Yk+81sljW7mAYnxM5+vHgvZlv+6MeDNPTKPE4IupsaB5/ORB117FYtVUe82ePQ5xt+tTdedbLNmW/X2ARNSyXhPuOpApHBeFn7LFWgYvlsN/94Sh4oQGp36N74ZEv+LuQiFSnQLOoMnRzMvI8fsi8vwPtRfNzvLXqRDRkaXQTfQo1hXnYS5koIfqSIby0X2UP9+bBeermPiur4WHl2AXuOcYBw9GpcoyMyv2UhdmUOaBuDq+geoBRWtHXaOadr+SpAMeBAZOHlFc+1d0Wnb1hQBuQTPIl/3L717ReW/AOxHu4qysLVYTzctJSCsx6Wf8s0O59WAaSRhEKCQ9U+VT3gJfBOVb/NWap+HU/HoexaVLNrqODt02gioz9j4fdQuwIb/zqctM2KswoHDkrGzeqLQQraY82AexgvnUyOjR03jeDNyzFJsmJnlozE/xpoe+Pc5vO/GW8FyHK3V7hmaUeRl8loNy5kxiEBjW/AGCwMotKjPVNiRoIyD5vhqHC5SkkDbva6Psmdl+1EP3tk22ZwmzT6t96723igooYMMcMOmSD5FmoBK1RKye6GmXGZ6uYlOy+2Zuf3/5RWeOii5NqNhOO4Da65yvqB1UUYNnq31QIs/SYdzvnbMIMPBtxjfdrpjnTcQAwJS91Q1rd+E80zIGNgCw2lVO0k5DUjfjdV3U9oGziQgAvvs0l9vH5jaqH6zKw43DBKvrY4m6e/2YISWZXvkbCnTrdhX9waXBMJirlKgUcd2UtqYZ7VdOrPRmu8h2qaN8+FOvlH8XMuP49yhiGBY8Esv3cbdY1NJCsf9cD0Z4R5B0PnaFLfZY/V/SU2DO+UpBgVhUVMCmzfEfCmnN4uof1/lFwL+7W2kGkzBl9fF+FeQdPH1J6+NylNf6k9BXCjkh9fRXLstVjrIuQbh0UzUhISZjVO1iAeKT2NGdKtKp9q4dUHfuzQdkIJKj6ksfbuHC6AI9ZN36EZurO97Dy0kWgQFMnhj54IO74nAV/eXR4DCjBU/CoH8G4zS4Inn6uIFF0vLdKSEh5QhNLVrMJumPwxRR1G1B0/SL1Wpp+3y7X6e+rgCpsS4SEWVGCoUJdHB6Z0pCrF9jFDW/Pe4malxBjXM79VxjSfJsVaom4RizivYPxOxefPDwZ1pGMUsRb+kGwzlu/utp2LsInVj4OBdX7TrYrEL3D1MIIWhteI97SzppOt3P9IvwDJ1eSKHxhOnNw8oG5tp2U+/UJPAamT9vFdkxBaTL7j3hxfdJFcE64/ylGao1jLO60ZJ1STzulnW0qe8GH1P8R7WJUHcoAfnW8H06T51hDQXfd3QoDU/vIztHqmJV51djhjxbIzePvM6LLDpgLGbxRVauL+HDpG5J1Pldmo1xwtvJ2JSa7Yrj0uVeXJRR4wnFv8A3NjmiC0TzKCKMwy1WOoYrgs5OcGWjXVj7kSPsbIQQwiWQoYe6jViAOYGhbrSnrYNIG+tqrj/wI/2VJKzYx66vlM8btC7R8FJ7RUwa41/WXEdVVVl4LBrCAAW1u8iv9N4DzrG+UwQpk0dMc7Pxza/GgU7jmxrFCN89AX2nXBh+ggS46Y/Wg9daPNE8rDD43EJZfJD+hPspDqx6cp0/WXwHGcFGPy8lX+E1vjT7D8Xs/jcDTcp151ab98zzEU2iueBy5pDuCuMH/NCntXykZiOyQwEEbdcYy5py7X1wX2aWP82zusfoAF+QbVZQgVJMzGbMpfewfhggBu51RsDpmMzPAvjDL9NdmaiiL/bNU27MCMnolQJRy7AHuDlBujs5nIqSHohGyjytPqnnSyar2uR5OnPs5ALHRm2RISmIYhqlJFtDtGUMJLDRDFph8jv/YTUo4oXpcsmxeU6D/sIPxgxdr7UIZDajuBZujo1pbDoaVycT5vvfbInSxolfkDusIL+/w1uLcQ7cBqDk1SNW5e44VQIRpAPGE5paql6Rr+kobtuBK/P+JppQuBCyp6SuCKtFl2E1novfIeo55JxI1/rfxl9Z4xf++9IoHIZdPsBwf5YJ+Pg8wpJ6zuEGa5th+e6ZS/lyvLvzxhoW3YMrIbCF61QipAm0HbLIvCXycl1YsL5rQ7YCLG6OQPsSSeitGvH//0nvSBLnSviJXwsTIqjveNP0HY/yDazlQvAkgMTRONs/EvXC6TjDXs9KbmxjV13IITR5Lf2L8XMJ46eXIMPxPrLHNdV5sqrLw37AKguu2f2PmtW4H7YlesbsXogoB6R0QJoshvOzRuc7eiacZ6hQXj/TETf9PSYu/dZOs34MVZoAgHBAjQ5R37lqS+2ijbolTtJftnJsAaLhAYCsaSf89PF0KLygx/PtcO0HN54aKGI9efYv4nGJP8U0Jf+RlRRJMFMOT+1+t2AeReOdekzPjbUTmZK4DGjxebctCBRv+DEICTM3S0zPeWvKmQFL0aqAlXx3HTLM/7yd4WtPTUpabdrPJAykU+v1Gt7TYlKXTOlfsIUFsI+I7kplDxBkZpvP7Ewud6QTB7GQj/tdJe031CQf84hwg/xU98X4EK2IuDKpJ2JsJ6othSsEOpb0EzH4Y7b9O6ubamwFqDk0UJlgiBINalUoMLUP88zhU/lQ33LyOjyu304t/sMUxBdDZQD85wVN/tqv+5p057Fe/ByuamSecI4AG1sUfai7MpEd2NgtZ38bb7z6TV9KBXbwjcJi9Fktmg3YdozXxYVhjoi2muyw9P7/XejzndxiOtPplnfv8fGQh2xKH/UAkdCKE9Xy7o2WLzdjz9qTIm3c645JD3nldwOJBWzoscgheHeAiay9J8t84o6I9rsIyGrijhOruSq/I/yfBkfACkW71LJ9ham8EkkqqmY0+4VOgSRl/PRj7idXeworjeKnnE8PVzumCtA1DzEth0LwAdu86fYOUsnTq81nrXt86vCfwu9W9NBuXeCH3ozhzmJHzY3HtkeTBEct6dpghPEr6b691FE5PU3QkNHiGil+RavHR+zq7TGiQ7koWEfwAIZtGa9MGAQUQXeh4MtplIUVPWBGEkX+Q89aVSqM5izIhvac9mx+6s0EC9+N7QsmNxegrmIjlpKRK5ywoZLqdThILPe62mUscjNA4XL6A7o4bVy5v/a2KbUidYQitjqRc1ZH//TLdsggEDSt7o0x+xFk/vXjkdaojpWeqWb8dJsddNYhstLdOOtL9HHsGnIZkSCRo21w5aDixw/pQZ8h6kkZ2rEmr+E5jbpB6/GYkp3wl1GhA6tB9A96EVkOMRBYt7/KBNvdQExW1MyhMvoGrKYFUEC9P7bMssrkWYuuNJjXCXO6iNiJt/H8e2aGcoyRSVxupW/wnd15RHoMy74R6C/rAumjZ3yHOTa0ctkWxyrcSIad2Wtociy7Kf33dr+f4BTaUIXiyAAaTu92Oki0nipjG83EliHBy17Z+O2bndppUTQ52jhkYmjsMwpwFTIj/HaxAi4iE+1gDB6THZcPZp3F8mYnQ4qpfZgeIt7/nnSvu/xmV6FBnClxpE7hYX4J6pjES5hyi32AjKh3BX7iq9I7fUom2ZDXQs1Uw2FCZ0hNga9dTlaL4DkJUhQRTXlfRhiDsZdq9xZH8ClSJiBpyerK8PjnRnq96TuCFrxVTJMNh71QEJkgIcOg6+Io+5gljRM7IzdTgWopTheCy7+a/OGi8T5hM3aqjOqSUziDJJtoCTAJYpZIjP2wmAYM7ogyfEnlEOTfg0pJyoskhHCFedo+R1xRljqqmfgXHYIwrwrWfEvNQo1ENXU1/TxNb4Nm9RW0pMrdZJNSAFpHTAUwiKCWmEV2FafVzyMml/xhwVHVsiUZeYRDKbNrlIrQTFej8zDb1ai+PJeTY49TL84j3gYZBzyhY7HWwjfIEsnZtGX+vGxvhzcX2AUDf1NUOD5bsTwMatZxZOoiCYE5r+/7f8K4Cx9fj1zBWoWjiS6IkcN7p0CRQEBq3j1fVXegP23DOJIAfQ5NN2swWKoCyrp3uY1/FZRH939rEfZiwizu9GorKd4x6akX0EUah+gcWx1Hjv4kFVe8fLqWk7pU9VTlBGuZPr1iaGlJAyZnDcvxXh2/esS8ooNwHzbBp7mPn4OfWMOx5VSSIkc1vtjF1aGM5a37H1UZX/KjTZtSRHjyZqHPKasj1wZwdMk3ztwFg/fOixoejms+k1f58i5bloTNcq35a4HRYwd90HsQHXyeJxb1kKD1s0A73dmvi6JSbgZmtGz8hXgxmRKm3dDcW0eSkbvvb14G2Jr12KWIuzqpttCJ5sVqG41ThKuSGzIP2aqN9sVlEGmkbRgOfrOmDmux/DZxNFlBfuQxqHqP9kjlUEjvEZJGQ7e67mbwimToGeO8TiMZ3U7UBb024zpkoHfjt5VlR5xi9pEoAcGrANmVvZ9z6uszjb3cxHpjeRe/Q1z2RXQPa9T0R+g9cx2ofd97dABQ+CSZEagl/ZhXDrgdA5ISiAKS8Z+vmcxfp0/LM2jK7Jm27ZT8dViWR/tORAkpSIS4zowLFfPNgYSaiBm66zdN7yt6XKaCp2JDF8oNgDLEq0vVxYi1F/CsJ7NaaL8JmxRzaTOcEYWtcpBRkHkqrnuyZ7zsXEVihkNpl5ohzcEW3o2RivKO70fPoizZNw2RExLua/WUctrPLfzcW6NCQcPiEhyHxzVQclWkRG3JIa1hmjS0pqcdDVnW9uX2+nEYfbhUaujujfDFlCaxOqKM/OdfCI8lNUc0UsYhZ9ovOck+HeA6nSxNekCQaArH/au7d/fv4hi+oSt2fHyD+Zk0Q10YImdQpPtADVc6FgKbceUmPwDhngskZ0Jf84ykwbWgiFLwWOVcKCAXRTjCLbYUt0OO3yhH6RfJbHmjhOtc+xCzndrJ+4u538niqGomPtu8UyMrjb9+z1jesWg7calUC0czeLBwH/5yhQ3LosB4r2+tcvRTAT1FUOvi/mCWEyVqQx2wwsqZlcQY2Bi0oA5TURwyLeynMs3vSKdUhsxutOlyIIr435wYKmFmEYecamd7Fvq56qs2+fTXsP3g/nEhE9p2R2IEapzuAs/RURTPU92xT8ijet3TmUOXp2O541PS1FmmmyIzmBolkBCYw3OM/GKcaAk3wrMq+jaCFWBXRMrfh/XlBCiOIiQxxxQNj72+3oayIyFXORlGKRzxPA2ghbVSFBvoWbRR/B1uBR5F/tXMAGRF9UPLUondERwIkiQ03G7kV12hzq2dr/xBZy8BZWSRk81JAOBNQsiv8g3XkqLH8kWVZZWgjQ8DBV/Omv/DO2nXovlkOkDDkaw3SxjCN56sSV6bGDe/oDXNYQARd71SRcRfdlcriyGomOd8RTPS6bLOQLwSwI2iwgPpLWbsWY4kX1mHtwfKzHzyyQp23wb2hSycr6e1qcHjSYyLKe+lscWJbla3HBaRoeo+bcwAvg3m+uxWrS/G+PfOEl6qWnORilZevj2S+2NP1nbL6nbOxXo6v5iOhDyk4IHzywMBrNXi30Y0cknVUaaxRVCwTmE+DNEThopa0SeSqO03wIE0Kz+QP2RPn1CNBfuTMCTnGd1d6oFj60puY3CFnlebVwlMtosLn/tCzEgB56LDa4JDfQa1jI8WDoEp0opm/Sg7VClr2oZaKLTZxM/uIcRdQrAi183zmhXvp3TppgiKJfXNkRtNdLrvs2nz01VzwRoPOhsBW5A/NWhHGjCftrrSXh9jNLquzMLs0Zoy8aiXYOaDu84jggz/Qs63+j//GzS8XE5skfSGaDjFooa6d23ZUnvemjs7nY7mmJekQo1MgBs7uWTCumy8ay69JpKm8MTgOwVNQYft0SKY3C5X+A2dUTlcMBczh3V/TWtlsNMvk1QQRdFwGCJvZAo7ba8iYkbWVZnRi5a+RK5FyiX4TLq7nT1DFLVdG9eyN0ahn2s7bjsJ23yfX5VE+LrE2Ab6uIsrcj2MpNh/c1Xq+RHe1EsBPtVuy5G0IsSaE7m+Jb1f1L+eKAsXwm6AD/A82gUnqDmLtTCgoEL2wX6BAmjUO9PQw+fXUtITRyYE3U3ezPQKon6grdkO7knGo3OszImQm5hRPtoKV0j6eBvcccLJf3ie2Hk3VTwAzhrkoKyJ/jn+d5dEu0V19cwnyEEEzehJ1YJie8M+SqgZKsh0IJ9lBSCwX9JjfbJmp0nLFL0Ivag9ut+tNlw6ufpbbwLTzcG+Z7jk8DFGUfhuu3LroVDLkufFiMubi2b8VngRTF2KB5TIjBuu8ViCT7o1grT6bUk7GOsNUfhSLNEK4NniKAJM4x1xblZK2fXmwM9pz3Bm3xKmpD2Ud5i9d5fbA7HVlJqa1QH2HGxFMiyur1gFsd3VXazV/ECjcsUB00IlG+qqjjIHfrVcuUJqsQ879LGblr8K80WeajugmRqMp0R741vf+/DtgiDN3trEtc2jDO0KskE8E2ExALbUakdtZ8KelTKvtUWdzBNj/RfwNu01WUk2N4TmpJm/R2eXSlaDsocFU773d37+NTTo9ol8pnYtV2mF8cPqYyK7HHQAlStNGYZn/RuFznMxRXKZ6l0SwXrnuNi32APPkj1B1l8HsSd3+SrJX3p57TH6XDZrHoD045w/bxHUP/AmgKxZrYHJ3EDfLvqjQqLzLxvUD/kq+EffEh6rSqi98JPsugPfkPO1td89WmutljJQR761rM6TLWzJbYWYwrD1cvUkFPqcw9aP8PCCEaRRy/q/ci5dK7EkH4IuqJ2Td87+SBVGsvzGforkzxoc7Rv7aikCI5w6jkig8Azm7N8f8TsQ1HmzlvST/jwidnvbRSSoXz0p9vjEn5AtCZLeqQmk9tGNt9rFuch0YK4lh4mHoa/06PkR3LrtNVyWRhCT1mzYS/BFNBzcNMtn3sua9J2Rma9PE77w3rnG3c0gftJKRC4UwjjdIilqa6PCtGA50R5dx2DIbSUn6IC/G5vdAqRHQfu9awxQS4ehdfINEMDPTHWHoqZ7G/dQNT4NOaODftQMMTADY6zjQ29LUh+Mcl5ElR0aoyTpmX+7Td6qO27LOxOG52ZyoCm5CI3XCN7v9omtujtw1YmyexY89EwWYvvL+1xv6MRoRsLAM5mCu2azzgy6hKH1nbDmZOVlwj3iJEn1xCz1oGoQ2TGjuceqN17hGyshdbtFFcqeBKXCr4WNnwLkQn7dBuzT5FJHiwjGBhv07PcwRj0Dh+yMr02mbZSFtVmQu/RvFsoR0rpfw6jt3G81lmKN0q5ZElpltLaPptXB7hdUEAPW4WVWH2WhhJBsHxlFgsLGqC30LVToDJtRqX4HwFPcNdFhbq2NJBXGsISVIfL6csw/y/ayWRVh/K/N1yL+SJcx5RAae4ZxvyUiUBTofFHK1YSiG4+T7Pp/tRAaYG2YJu//444qlBR0LPc4AskFbYaxG/ki9rrhdDyhWMqKeoMUcloiVcEfIqVlgYDtQ19g6lMOv71053GjOAvEmSSGLXwPPxfmx4j3WxYHYgY/T+mDTXysISt8y4/R+YFYWy3+b1oDz9hA4DkPjLBiPXklg1LCzlbdbqcem7rE21YG/kYa+jil9uTBVDYh7dsjMiyMF3Jv9JBmAMlTXOTOWfL/p+pH0QZYidtb2ZSs75+HBIKGIIbQnho+f+hkYW55EFVTqtOI0YowwbfUFgkYke0vCoFj8E/e3R/P3w86ebNXt8EfHZ8F+BVTrjVMZNAo+PxUfoEnS1scFuIQRPPNmHvdrItT8iWhRpdvnRZ4ZLW+7lRrF4Uj7e9c6m49pvU6/BJjHRZ37cVavRPIcv7HtUy2iD0TWTOAlu6JNdCv6OZY6ySnqHyz+hQL9+qFuVkytwgk4A9lW9IeeWg66KrTcYyaHaoAElyQPB6n4e8rHwJ/vTskrl6xeDRagVZqmIYuT8i0/9rxILSQeBdwQK4Rk7//zgjpKRdG3W/L2/PL9I+cpJlJEZdrWNDnY0Kq0asB7U0Sa0vvHheuM2EzOZRrNno/HKLCfIYrNPw+NWWVEj5fwgDrzUA0xnwBgv09W3d7POCRK1lA/psIr1ctrVb4iWsnhpMr2SAdwYu1CPLkj+dKcYTFg1e8sRMXl+eXhKuxZjciom0kMDX+iQqD90J8FDPJnwyj9nUD9m3qjybA375wqMrcZVxyhAoqlmOSs6AqxpTtL/m9eyhN+MhyKUs6UmlZAzkk6cZ8adpRjmpiS+giwcMvn0GHU7UEQcKmOec9fJMNaA9uu9mRBRAX9Se6lFfth9CqJVEnzkwCn9ooFjsPVlpcpfil3wmAy90M4KO0G1ohGtVTsJOKDQjTvMdD7k96uKkRfoxW8kNnMVhn7gPC+kt+M42M/rEv93DMb9J1QmQvDkW2XHBQLiXgEYSkPIdAyJCzF8P7Eicy7LWbxJOEiR7VZmkmq7ZvDmqhxl+Mz0Kz5NTR4Brm90vrbi5I7oCvDGxeMF4p46AWuy+sjbtDRJr8Ir5vlDX+e8b7wRTyfgJxQDU2p9UIEEhpDTujwNvq/MErvbP8DxJopTrjKh+laY6YHXx17JXcV0JaPSj0LIqg9g4ZiOWYw6f9VpVmxTU3BBfV/jiWgx8S+zjccHKidrnyG9DD2tCFQ1peB/fdbszVF1/YeC+AXprLwleE73g7Yh7MBIcbzqlsjBhddWWoF9FgHuiXrqfIa84YG46IJe4H0P7y6EEgfybxLJp+EyAmXZkio7gq9y0aNtV4Nr0VETKYebLsA11GjJra+f49FqmEx3HX/Vsw4QA7JeS+5DfSGFf3kR2T/O89YbRF5dnqf5AF4tmDLvSquYA9ezChxAC66lqClIuvxm/hp8pg+/4px0TlzaU1z8plBcJVM87sWHwjoGMTAGRfslQW+7OCNYKRN6w9YUGyJm7wGf0TpYz4JdJF6j/sAfJPQnjN5syOQKZ2jJdWEMwMsaFwv6ZiaZxAfl47fKcZKGwi5D626+Tc6gMPtHIgFaEXrFvoA9TYnPgHZ17dl0G5UUDiFXY1+PlR//4hno7Ftaj0t+7qNiEKcHBD2DOG0YC5xTuXmLVXV9fx9aTNwtkKa95d4zY1f+J48lp1rveJYHWsChP+1V0k5tJ+VHDl3bWo2L3f/S8oLMZ9gCmHk8U+arQc2coclnzdcxOmDdFIr1zPi0j2govrvR7Bg0JVz3Wb09jpl+Ujr3+9C6S5NxS0xeqQMVmpZzxg5xxiiZsKpQZZ0pPRxyfzsN7zHaXaDBkibYMuK1t9Ds+7q2OGYCQHryrMh2vZuj+0ot+gMLpQNBOzT7DVhplgF2594IUSVtTUJ4JcsssWLEBte0Pwo0jHaq/K0eBCy13pTi36LItxXBkCfSG9W5HhyJTncPu0lc7tvtzuHkP9Tq/6W+C+OoaZidXhDrm2QYUjye+SO0t6PeCV1XsgUkj927oMRBhdIRKXmM+ZPqWL9m8ShLPX8HkIB+9cydpZEFqfF+tkHKFES60i2EcjbaNbAqnqXzZg6SjNEwSQuDIaXtflLbS5gP6voNQ8leWL0hBLUkhpiRCGRftdLDWcnD9PsUidVt8SD5hpQuhjqxIUcI+1njAe82yVZ7vg5OzwXFc0H6aDcx8eThlMsoJczTNqAKHAjQV+4zE4tAMieb0mnt5RVGHMeoT2BGylDrv8ffqLZ3qXYGgyn6lESF6Oyu5BhqCpDMGUcVSLZrXaf4R/KQZb07mu1A6lCwfX7wN1DPfvYjld0xQpHWjbfiVwo0Bg8ZYsT1aGqIJ8IX+DiprNn4o8nL1M5+iLyb3ElvX06DpdmIkLvb00DASjM2d0YXUT0BAPHqohlGzXzaWWqDkTXQqQmCsRIxRtK7G/J7MGMUC/z7XYZuqwjz/Ax3i9TB0TH8fGvp36ycevc01oswc/um/JCQwonO14KXB00Odw5Be0YuHUDmowG/6So4cz8GgomvihONnQKBIGkf1FpwqymcuM5fUMYyS/DTWJ5C/Knu0zlfEV/visCSKr0y/sXUP94SAjCSzY4BZvNxiBsiBP+mp0DtlgrqZ41B/IH8+TW5wG8rysacYW92iUC4p+SnAiLt/0jBQ7l48JVakGjh5c8sFKlHZvEkQEvIe1bkYmDURseaBxYjkj1Wr6fqSUQ2ar60o7SFnBV/+ipdT1fbfG0J1R6tLK6lcgnUvYnhqm/Kjxi1Y31jsb43o+BZ6TlKMVsj8n8Y50R5WTUb5qRSbH8dIXBI/bZXVNdgEO31X+Yvy8SMN303LkLOeaSy6FdukA27eVjUsMpFQF5oDu4s+tGHcP0yb3oxGLAbcYO35GUcKnj/klQmg0MzAQq4iO1+30OAqQYKQCHc9N+UxRgrCxuw380TtzpYIwhHvsrROGfDA6cubbmsulB2UquV/9CHJdrvWXOEnSa1zuYeb2wSq9e1jsijgMpyMQgmJ2yDk2MtVlD7KpjFrAhIBmhXBB0bpExBmsfoVeNgKnTTO7cZ8omTUMIZiMsjF7S/H11FyOWS68HZvt/lEQxqJb8gzFs1DmD/9dbvrKycB5eKehltGz4kWhdj0K7prywUh862Aj/PBFNAtA6W58oICPjUuAF1hufmOHcDlfuKEMxbHdbyx7vT9XfmfWLhrd9XrMEoelLNLv5Oz0ppEMxqdDyrrsilOC4IlET6aWK9sYNUYJevAP+BOpDtux4vaqssmBZ2QAE+asOT7oX80MjWTzzLr6BHMpv4WyackVBTmLb/TtpRby6ZPUN15/ff008UVWTqXXGElmq2YMxjqW2FgsOsQVEV9u4qV8NYpSbd+nCkacBKck40yG8gb3kBXZ8FJhHo1Bwb8PMtHoNac5h75Cy882/+DmbGm6wxp2ZRBntTnB4QBUAmZIEasxITqbhiKn/gKRcsuQvUmUU9h0daIkBRnMcq4u2xnMj/TmSdUUGjx3xe6PBIbKB01XrT/WxXYvaGVUVH7YYij6SM3A5rreJF3H6tZ+M+5b1oh6khuPzhuFlkq8u+V+4n71x/QACO5CbnMYkvvixg0lsqnIvlzcKFt42xlaUwedWTDeCrzQCJ9m3y2m2vQWED/kuvOS+moLXTq8x9B2h5aBM3G8hjL9d9vj+w2yg+bsofZb5CQHZcFrdLcFcUxi8iNMIMfgZc8ZweRgYSNdqvrKxLSUOwEnnmoQ/bAUbXtE4nB+cqKh4ePoWc8vUeB6eaOLFg9xqGg7hpEs16/4MMNt7ZFwd9udVW0ToTFK1aAc3aCHSeAifmdTX5mWPR2UKuOyoS1BZviuy5XEGBdyrlf8XKEgXyB33kDuFHkHMnugXI8EjpgFl7JDqyaTKk1x4opC6x1WLAO+MNZYgxbDu+SI67gQKH4zwgqzMXUitSA4bey4SgFA4uOu37jaDm68bnMhx7oyGE8fNFz8bD9Lqk1innJiUQEOvswHfNgfmzRBOuCp00DjFjam7mPF00c+FmDCpM0BL+0618XJeVl5qj9a5kE0japlOQf6x09YyRo41e5Ozp9BT/b7lFMFPJisS7OiCmSl9XTERbou1SeItflH0DK3YIsZ2hYA3aNI2xQjo6IEeTxdWoBJKxbtQ4u7OJJW2GpkeJqTSWAhKgWLcETxRErESIJGzO+lVtPIqt1+T3X/2qdQhRN7wx7QHl4txeyZkjIOl7bQaZy+RG6NRqkRDV6E63jUlvTx1rD3XINsoKpMyDzmfbd9AZrsTgYbh69495/KGygAB0wJAa5V1O3DRuetn07bvyns+ywqzmSxSoPoMQG9pSzKAs0PVt9zpYZ7MKbY4maPZmPdX1BJvK3pw/ZCI1Rx815ZIuGxRVxK/HXlf25yGTkeLP5Haprs3RAh7XexW2spi6GV9Z2nKu0ziYZsciRZF0NGzcyTBN2o7aqpWVUJi9h/VgQclLTka6bTJIdFciMjHGWztEdyoHADxAs7o6OlVgdPyJ/RcuJ3AKEkTbd96EG1+V61Rjrws/yCOp1aLdnqN8oDVeVM8zz1LPmyb/pzdn80DpIzbyHtOfYiurCq5sPcvLqs0IeRtd+a6tjCUeKVZJ70FxVLAe+kBOSCWo43MwPzIM6dbiRK3qqPSAmNTPKziwjxoA6xsvjbzvXVUcRgFpT4ngvcnOz8quziyNXVhQczX8RKMuRMcI0G7xyrgH0NxUdu2SzKR1c0OAtBTVHIAfqtK2OjJlr2AQ+LY4lwyD2nRPreaT01g28NbmeR7ul9NC+rmofhtJ/5zK/V9SIk3nirXatQn8n5iRlZEbTu+cbHZE1Go6W6RJj7dDzBDBemZRFF6Nj+5sc7DCi60YVMXQmDNxhME+YYWTd/mXaHx9URNsHToZn0myv5jUfNTOuMurQRxXDTb18LIP/l26me+j7UXhimViZlYg2kG/9eWpbeEHzeoZ++9ictf2gi0mlHQ+dN99hRn4TVitl6z3gJdDCmpNqR2Vo3XbsLU4RQpMqoDMYc7d4ozb8oxS7QuYP2BBuw0yAwBoN8F6KHS/15Msfk4Sd/bioLsbrGjucNyxcFHMhirvQ1Gwc4EfAvSPvgu8en6u+6e9HXXwyx9gCh7DzH9XQ+xWXNlaRbYTdPWRjfS+R4xQ57xOtDyXlU52ohBBX7m+ioXZ2PAkNXupgIBxnvf3GYn6GVI5exlHky1wHRZAvrcJHVuDR0Z6kucjiAqWsa411wBCW1g3ABKssYz3mo5zI/Opx3W7Z1Lia/lkygYmXUMKQIAPSGrU4VHdd2AEilM9AyseS+4Z9ULQ/2EN0bnAmEgsNKNHmzRLNBUJYAEryX+BkTkfccD7F2UbJzpEMZ6Se4sRdsVFcimeeJYJPINSP1zILJsrzNAGJdBaTGz9zHrIvfnuEJgpmCeo1mXb2rWA8YZLEAmcnr6/OwafqCqQlGe4+XqEc8HjDR/D4x6irMPB9bIUDPgWEE9f2MugjY/3/Glar+B9kyAk9FLeiGf1iWE+xXJC2aG5rISr3z8OH9uI3wHh/6PNApwcsF7Ys9xfI+xUu1GOb4Y0/pE+choaodo+YvrLB2DWE10rPdhbx3DZbTmxvFRCl1bS8LwO0h899+buFfra5qLEtXCNlOh4Rj6diStz/Vl2z0rIdzfntP56XyF+ejRYKoNYnkrqrkElIAYmwzeMIQxPJeeoIOhICchV7dzMBQLE70vOD1fR1NOpQ9eoEasP7fT4WGB4AyjjO20/8QpEhhuHpGdvU4s8Pc4ChAOhMYvfsmysxnRYBkkooHBIqNvwsug05XBaQii5RuNwv2zY4sAhlg/oaKeELH4IJLQNNo7FZ7ao1FlTeb1aQzrPapGGKEBkluuwkF6UmS83quuqaqLSXNgNaQ8RJ72Ul0CDcIIMjGWjrYoHSMCd9TuyGy0uB2F5egatpxoM1o2fBj+VG7Q/rluBNQs1FaIbM0feE09T7LfhyK7N/L21rQ09RjysDLeWDbPanxdMDqh4pGzW/kDg+4T7KCHZOMZ/YamP12+GhhmP3PHy7ngQ+9u4T6m9LBVbE2FV5VIpRsqmYXVfcMsO8Qgk8UIVNsJGfGT5jWtynBUlFEyUFILEqF9F2DcbDw+OLsgsbvGASr6kKaPzN0nEJ/I1I50sGMQhAZ2njRfjqJ5dAEKB9AlUKHuMmeTRyCZbB0OjMWaVrXKAIQFerJVp5RlkgJV47o39TmXcA4CZKVR92WpgU6XgxyAJiLWaMap5t5R58QJ91uNn/vVElA11mPzbzwxiSrDa7u/K3/nrNi1I7WokN1t9F/Q3wHGXdNtmC3xWbzOUW4gdu5lMxs9Ecd8ml6e+WA02xOXMAS/nKXG5HaqpjutK6A3fA43ojkGEJqo452l0vMof1zqNW8QksiaIWP5ASIF4hmLYJmIx7ew/HnOYQFeXGGNGwgvmcA8XzDyZcI2m9TVNc7s4PX66jBTwfC4m6zenzEAt21jonfm68yaR+EOVXLJiOfL9BSsE4i3D+lC3LYdT8aiDT9Tc/ZhPEEGedMkR/ncxLH1WVSQE1NsutWxUxxYHjKhcn+7VLc47bhL55XEoXK8D6dog5JGUgGermC4HiFvqiJNBdIe3XqiDM6JF3ao6MW7XytW8F4I3bbp5EatNjt/4KCWoAty9/7SooOu0VpDUMumAo89tZ4oaQ9WXmYSmAp72/AT7BPZbj55U0Rr/9dvRWhTbw/RXSHgEeCD8gAFUbGYEZi4e1R+mYvxckQNDkQrWkrfGeQ8yMHgZ6c8OB/typZGSezrn5t5ICs/snJRpNMpH70palXMWeUxS55HVDjOGUCSQ4reDte4cW8fPoICtYUFpW3gtO4+qSh7uucJ3zzxl9geCuFJFRDVArK6gSEOEAxr87g4Hi3K0/suoAA=","avatar":"data:image/webp;base64,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"},"???":{"name":"The Bread Squire","description":"Every culinary adventure begins with a first bite. Your journal has not yet established all three preferences, so the Squire represents a developing profile rather than a judgement of your taste.","art":"data:image/webp;base64,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","avatar":"data:image/webp;base64,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"}};
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
  // Restaurant-balanced mean score avoids inflating generosity via one large restaurant menu.
  const allRests=new Map();for(const d of rated){const id=d.e.id;if(!allRests.has(id))allRests.set(id,{sum:0,count:0});const r=allRests.get(id);r.sum+=Number(d.item.rating);r.count++}
  const means=[...allRests.values()].map(r=>r.sum/r.count),rN=means.length;
  const observedMean=rN?means.reduce((sum,x)=>sum+x,0)/rN:null;
  const shrunkMean=rN?(rN*observedMean+4*7.5)/(rN+4):null;
  const generosity=n>=12&&rN>=5&&Math.abs(shrunkMean-7.5)>=.12?pcClamp(50+(shrunkMean-7.5)*20):null;
  const axes=[
    {left:'Explorer',right:'Specialist',l:'E',r:'S',value:explore===null?null:100-explore,source:cn,target:40,explain:'Uses cuisine breadth adjusted for small samples. Repeated dishes in one cuisine do not falsely increase diversity. Threshold: about 2.4 effective cuisines.',detail:explore===null?'Needs at least 12 rated dishes with cuisines.':`${cn} cuisine-linked dishes · ${neff.toFixed(2)} effective cuisines`},
    {left:'Loyalist',right:'Roamer',l:'L',r:'R',value:roam,source:n,target:50,explain:'Loyalist means favouring the same dish types across different restaurants, not returning to the same restaurant. Compares matched normalised dish names, shrunk toward a neutral reference. Cannot prove actual ordering frequency.',detail:roam===null?'Needs 12 rated dishes across 5 restaurants and a clear pattern.':`${loyaltyHits}/${n} dishes share a name across different restaurants · adjusted ${(repeatShrunk*100).toFixed(0)}%`},
    {left:'Tough grader',right:'Generous grader',l:'T',r:'G',value:generosity,source:rN,target:35,explain:'Balances average ratings across restaurants so long dish menus cannot dominate. The average is gently shrunk toward 7.5/10 with four neutral reference restaurants. Near-neutral results stay undecided.',detail:generosity===null?'Needs 12 rated dishes at 5 restaurants and a clear mean-rating difference.':`${rN} rated restaurants · adjusted mean ${shrunkMean.toFixed(2)}/10`}
  ];
  const letters=axes.map((a,i)=>a.value===null?'?':(i===0?a.value>50:a.value>=50)?a.r:a.l);
  const code=letters.join(''),complete=!code.includes('?');
  return {rated:n,code,complete,axes,character:KINGDOM[complete?code:'???']};
}

let kingdomIndex=-1,kingdomWheelAt=0;
window.recoPalateCode=()=>palateCodeModel().code;
window.recoKingdomArt=code=>(KINGDOM[code]||KINGDOM['???']).avatar;
function renderPalateCode(){
 const node=$('palateCodeContent');if(!node)return;const model=palateCodeModel(),badge=$('reco49Palate');if(badge)badge.textContent=model.code;
 const current=model.character,codes=Object.keys(KINGDOM);if(kingdomIndex<0)kingdomIndex=codes.indexOf(model.complete?model.code:'???');const c=codes[kingdomIndex],k=KINGDOM[c];
 const bars=model.axes.map((a,i)=>{const l=model.code[i],pct=a.value??50;return `<article class="palate-axis"><div class="palate-axis-head"><span>${esc(a.left)}</span><b>${l}</b><span>${esc(a.right)}</span></div><div class="palate-track" role="meter" aria-valuemin="0" aria-valuemax="100" ${a.value===null?'':'aria-valuenow="'+pct.toFixed(0)+'"'} aria-label="${esc(a.left)} versus ${esc(a.right)}"><span class="palate-mid"></span><i style="left:${pct}%"></i></div></article>`}).join('');

 const slots=[];for(let relative=-3;relative<=3;relative++){const i=(kingdomIndex+relative+codes.length)%codes.length,code=codes[i],item=KINGDOM[code];slots.push(`<button type="button" class="museum-art" data-kingdom-go="${i}" data-offset="${relative}" ${relative===0?'aria-current="true"':''} aria-label="${esc(item.name)}"><span class="museum-art-frame"><img src="${item.art}" alt="${esc(item.name)}"></span><span class="museum-art-no">${code}</span></button>`)}
 node.innerHTML=`<div class="r53-kingdom-hero"><span>You are a ...</span><h3>${esc(current.name)}</h3><b>${model.code}</b><img src="${current.art}" alt="${esc(current.name)}"></div><section class="r53-traits"><h3>Your traits</h3>${bars}</section><section class="r53-kingdom"><h3>The Kingdom</h3><div class="museum-gallery r54-kingdom-wheel" tabindex="0" role="region" aria-label="The Kingdom. Swipe or use arrow keys to explore characters."><div class="museum-gallery-stage">${slots.join('')}</div><div class="museum-caption" aria-live="polite"><span class="museum-caption-eyebrow">${c}</span><h4>${esc(k.name)}</h4><p>${esc(k.description)}</p></div><div class="museum-foot"><button type="button" class="museum-arrow" aria-label="Previous character" id="r53KingdomPrev">←</button><div class="museum-progress" role="progressbar" aria-label="Character position" aria-valuemin="1" aria-valuemax="9" aria-valuenow="${kingdomIndex+1}"><span style="width:${(kingdomIndex+1)/9*100}%"></span></div><span class="museum-index">${kingdomIndex+1} / 9</span><button type="button" class="museum-arrow" aria-label="Next character" id="r53KingdomNext">→</button></div><div class="museum-instructions">SWIPE OR SCROLL TO EXPLORE</div></div></section>`;
 const move=n=>{kingdomIndex=(n+codes.length)%codes.length;renderPalateCode()};$('r53KingdomPrev').onclick=()=>move(kingdomIndex-1);$('r53KingdomNext').onclick=()=>move(kingdomIndex+1);node.querySelectorAll('[data-kingdom-go]').forEach(b=>b.onclick=()=>move(Number(b.dataset.kingdomGo)));const car=node.querySelector('.r54-kingdom-wheel');let x=null;car.ontouchstart=e=>x=e.touches[0].clientX;car.ontouchend=e=>{if(x!==null&&Math.abs(e.changedTouches[0].clientX-x)>35)move(kingdomIndex+(e.changedTouches[0].clientX<x?1:-1));x=null};car.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();move(kingdomIndex+(e.key==='ArrowRight'?1:-1));node.querySelector('.r54-kingdom-wheel').focus()}};car.addEventListener('wheel',e=>{e.preventDefault();if(Date.now()-kingdomWheelAt<340)return;kingdomWheelAt=Date.now();move(kingdomIndex+(e.deltaY>0||e.deltaX>0?1:-1))},{passive:false});
}

function renderDNA(){
  const rated=allDishes().filter(d=>Number.isFinite(d.score));
  const top=rated.slice().sort((a,b)=>b.score-a.score||a.item.name.localeCompare(b.item.name));
  const max=Math.min(40,top.length),chosen=Math.min(max,Math.max(1,Math.floor(Number(prefs.dnaTopCount)||8)));
  const picker=$('dnaTopCount');picker.value=Math.max(1,Math.min(40,Math.floor(Number(prefs.dnaTopCount)||8)));
  $('dnaSignatureCount').textContent=max?`Displaying ${chosen} of ${top.length} rated dishes`:'Your exhibition is waiting';
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
  const stampTotal=achievements.reduce((sum,a)=>sum+a.level,0),closest=achievements.filter(a=>!a.maxed).sort((a,b)=>b.pct-a.pct).slice(0,3);const progress=$('reco51StampProgress');if(progress)progress.innerHTML=`<div class="reco51-progress-total"><strong>${stampTotal}/80</strong><span>Levels unlocked</span><progress max="80" value="${stampTotal}"></progress></div><h4>Closest to unlocking</h4>${closest.map(a=>`<div class="reco51-next-stamp"><b>${esc(a.title)}</b><span>Level ${a.level+1} · ${Math.round(a.pct)}%</span><progress max="100" value="${a.pct}"></progress><small>${Math.max(0,a.nextTarget-a.value).toFixed(a.title==='The Long Table'?2:0)} ${esc(a.unit)} remaining</small></div>`).join('')||'<p>All levels unlocked.</p>'}`;
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
    const input=event.target.closest('.visit-date-field,.visit-food-field,.visit-spend-field,.visit-treated-field,.visit-rating-field');if(!input)return;
    const row=input.closest('[data-visit-id]'),v=workingVisits.find(x=>x.id===row?.dataset.visitId);if(!v)return;
    const previousValue=v.foodValue,previousPaidFor=v.paidFor,previousSpend=v.spend;
    v.date=row.querySelector('.visit-date-field').value;
    v.foodValue=readMoneyInput(row.querySelector('.visit-food-field'));const score=row.querySelector('.visit-rating-field');v.foodRating=score.value===''?null:(score.validity.valid?Number(score.value):undefined);
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
  $("dnaTopCount").onchange=()=>{prefs.dnaTopCount=Math.max(1,Math.min(40,Math.floor(Number($("dnaTopCount").value)||8)));savePrefs();renderDNA()};
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
    const ls=ev.target.closest("[data-list-select]");if(ls){r52Collapsed=prefs.activeListId===ls.dataset.listSelect?!r52Collapsed:false;prefs.activeListId=ls.dataset.listSelect;prefs.r53ListCollapsed=r52Collapsed;savePrefs();render();return}
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
  $("profileRemovePhoto").onclick=()=>{const old=profile.photo;profile.photo="";prefs.kingdomAvatar=false;savePrefs();if(saveProfile()){$("profileSaveStatus").textContent="Picture removed";renderProfile()}else{profile.photo=old;$("profileSaveStatus").textContent="Could not save"}};
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
function r53SavedMeal(id){notify('Another meal remembered — saved to your Collection.');const n=$('appToast');if(!n)return;const b=document.createElement('button');b.type='button';b.textContent='View restaurant';b.onclick=()=>{n.classList.remove('show');renderPassport(id);$('passportDialog').showModal()};n.append(document.createElement('br'),b);clearTimeout(notify.timer);notify.timer=setTimeout(()=>n.classList.remove('show'),6500)}

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
const MOBILE_SECTIONS={account:['Friends','Your private connections'],admin:['Founder Dashboard','Account and content administration'],official:['Recolleat Official','Platform announcements'],home:['Table','Your journal at a glance'],table:['Collection','Your restaurants and rankings'],cards:['Restaurant Cards','Your visual passport collection'],map:['Places & Memories','Explore your location constellations'],cuisines:['Cuisine Rankings','The cuisines you keep coming back to'],graph:['Grand List Graph','Explore trends and restaurant scores'],lab:['Settings','Your journal preferences'],settings:['Settings','Personalise scoring, backups and privacy'],dishes:['Dishes','Rankings and signature gallery'],dna:['Dishes','Explore all your dishes'],lists:['Saved Lists','Your personal collections'],visits:['Visit calendar','Your visits, one day at a time'],profile:['My Profile','Your local identity and collection'],help:['Help & FAQs','Guides, tips and common questions'],privacy:['Privacy & Safety','Your data, your choices'],terms:['Terms of Use','How Recolleat works and your rights']};
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
const r53ScrollPositions=new Map();
function mobileGo(view,options={}){
  if(view==='dna')view='dishes';if(view==='lab')view='settings';if(view==='graph')view='table';
  if(!(view in MOBILE_SECTIONS))view='table';
  const previous=prefs.view;if(view!==previous)r53ScrollPositions.set(previous,window.scrollY);
  if(view!==previous&&!options.fromHistory&&!recoHandlingHistory){
    try{window.history.pushState({recolleatView:view},'',window.location.href)}catch(e){console.warn('Navigation history unavailable',e)}
  }
  prefs.view=view;savePrefs();applyView();closeMobileMore();closeDreamHub();
  window.scrollTo({top:r53ScrollPositions.get(view)||0,behavior:'instant'});
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
  const sheet=$('mobileMoreSheet');$('appearanceMenu').classList.remove('show');$('appearanceBtn').setAttribute('aria-expanded','false');sheet.scrollTop=0;sheet.inert=false;
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
    window.r52EraseFavourites?.();localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(DRAFT_KEY);localStorage.removeItem(RECENT_KEY);
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
function v45QuickMatched(value){const q=value.trim().toLowerCase();const exact=entries.filter(e=>visitDisplayValue(e).trim().toLowerCase()===q);if(exact.length===1)return exact[0];if(exact.length>1)return null;const matches=entries.filter(e=>e.restaurant.trim().toLowerCase()===q);return matches.length===1?matches[0]:null}
function v45SaveQuickDraft(){
 if(!$('recoQuickLogDialog').open)return;
 const fields=['recoQuickRestaurant','recoQuickCuisine','recoQuickDate','recoQuickFood','recoQuickValue','recoQuickPaid','recoQuickTreated','recoQuickNote'];
 const data={};for(const id of fields)data[id]=$(id).type==='checkbox'?$(id).checked:$(id).value;
 data.recoQuickDishes=captureQuickDishes(false);
 try{localStorage.setItem(QUICK_LOG_KEY,JSON.stringify(data))}catch(e){console.warn('Quick meal draft not saved',e)}
}
function v45ClearQuickDraft(){try{localStorage.removeItem(QUICK_LOG_KEY)}catch{}}
function v45QuickState(){
 const match=$('reco50NewBranch')?.checked?null:v45QuickMatched($('recoQuickRestaurant').value);
 $('recoQuickCuisineWrap').hidden=!!match;
 $('recoQuickHint').textContent=match?`Adding a visit to ${match.restaurant}. ${match.ratingMode==='visits'?'The average food rating will update.':'Its manual restaurant rating is retained.'}`:'New restaurant: enter a food score to save a rated entry. Details can be completed later.';
 reco51SimilarQuick();
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
 if(!newBranch&&!match&&entries.filter(e=>e.restaurant.trim().toLowerCase()===name.toLowerCase()||visitDisplayValue(e).trim().toLowerCase()===name.toLowerCase()).length>1){notify('Several branches share this name. Select the full restaurant and location from the suggestions.','error');return}
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
  await mutateStores([[RESTAURANTS,'put',update],[VISITS,'put',visit]]);committed=true;r52FinishBucket(id);
  if(match)entries=entries.map(e=>e.id===id?update:e);else entries.push(update);
  visits.push(visit);v51ReceiptSelected=[];v45ClearQuickDraft();v45QuickPhoto='';$('recoQuickLogDialog').close();
  rememberRestaurant(id);if(date)visitMonthCursor=new Date(Number(date.slice(0,4)),Number(date.slice(5,7))-1,1);
  render();r53SavedMeal(id);
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
 const day=Math.floor(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/86400000);
 const unique=new Map();for(const d of allDishes()){if(d.score<8)continue;const k=d.e.id+'|'+reviewDishName(d.item.name);const prev=unique.get(k);if(!prev||d.score>prev.score)unique.set(k,d)}
 const pool=[...unique.values()].sort((a,b)=>a.key.localeCompare(b.key)),count=Math.min(3,Math.floor(pool.length/10));if(!count)return [];
 // Stable per-install shuffle, then rotate by day without overlapping adjacent sets.
 let seed=2166136261;const salt=pool.map(d=>d.key).join('|');for(let i=0;i<salt.length;i++)seed=Math.imul(seed^salt.charCodeAt(i),16777619)>>>0;
 for(let i=pool.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]]}
 return Array.from({length:count},(_,i)=>pool[((day*count+i)%pool.length+pool.length)%pool.length]);
}
function renderV45Home(){
 const journey=$('recoJourney'),feed=$('recoMemoryFeed');if(!journey||!feed)return;
 const n=entries.length;journey.hidden=n>=40;const cuisines=new Set(entries.map(e=>String(e.cuisine||'').trim().toLowerCase()).filter(Boolean)).size,dishCount=allDishes().length;
 const early=[1,3,5].filter(level=>n>=level).length,active=[1,3,5,10,20,30,40].filter(level=>n>=level||earnedRewardLevels.includes(level));
 const next=[1,3,5,10,20,30,40].find(level=>!active.includes(level));
 const title=n<3?'Your first memories are the foundation':n<10?'Your journal is taking shape':n<30?'You have a real food collection':'Your food archive keeps growing';
 const action=n<3?'Log a meal':n<10?'Add your next meal':'Log another experience';
 journey.innerHTML=`<div class="reco-journey-top"><div><span class="feature-kicker">YOUR COLLECTION JOURNEY</span><h3>${title}</h3><p>${n} restaurants · ${cuisines} cuisines · ${dishCount} rated dishes. ${next?`${Math.max(0,next-n)} more saved restaurants until your next progress badge.`:'You have reached every collection-size badge.'}</p></div><button type="button" class="primary" data-v45-quicklog>${action}</button></div><div class="reco-journey-badges" aria-label="Your restaurant achievements">${[1,3,5,10,20,30,40].map(l=>`<span class="${active.includes(l)?'earned':'locked'}" title="${l} saved restaurants">${active.includes(l)?'✓':'○'} ${l}</span>`).join('')}</div>`;
 const memories=v45MemoryCards();const memoryDetails=feed.closest('.reco-home-memories');if(memoryDetails)memoryDetails.hidden=!memories.length;
 feed.innerHTML=memories.length?`<div class="reco-memory-heading"><small>Daily flashbacks · ${memories.length} of 3 unlocked · Private to this device</small></div><div class="reco-memory-grid">${memories.map(d=>{const photo=d.item.photo||d.e.photos?.[0]||'';return `<article class="reco-memory reco51-memory ${photo?'':'r52-no-photo'}"><div class="reco51-memory-by"><div class="r53-post-by"><img src="./icon-192.png" alt=""><div><strong>Meals Worth Remembering</strong><small>Only you · ${d.date?esc(formatVisitDate(d.date)):'Date not recorded'}</small></div></div></div><div class="reco51-memory-image">${photo?`<img loading="lazy" src="${esc(photo)}" alt="${d.item.photo?'Your dish photograph':'Restaurant photograph'}">`:'<span>No photograph</span>'}</div><div class="reco51-memory-copy"><strong>${esc(d.item.name)}</strong><span>${esc(d.e.restaurant)}${d.e.location?' · '+esc(d.e.location):''}</span><b>${Math.round(d.score*10)}/100 dish score</b><button type="button" data-open-passport="${esc(d.e.id)}">View memory</button></div></article>`}).join('')}</div>`:'';

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
 $('recoQuickFull').onclick=ev=>{if(!$('recoQuickRestaurant').value.trim()){if($('recoQuickLogForm').querySelector('.reco-b3-name')?.value&&!confirm('Open Deep Dive? Your quick-log draft is retained separately.'))return;v45SaveQuickDraft();$('recoQuickLogDialog').close();resetEditor();setEditorStep(1);$('editor').showModal();return}if($('recoQuickLogForm').reportValidity())saveUnifiedQuickLog(ev,true)};
 $('recoVisitAddDish').onclick=()=>v45AddVisitDishRow();
 for(const id of ['recoVisitCamera','recoVisitPhotoChoose'])$(id).onchange=async ev=>{await v45UploadPhoto(ev.target.files?.[0],src=>{v45VisitPhotos.push(src);v45VisitPhotoPreview()});ev.target.value=''};
 $('recoEditorCamera').onchange=async ev=>{await addImageFiles(ev.target.files);ev.target.value=''};
 $('recoRecoveryOpen').onclick=openV45Recovery;
 $('recoOptimiseMedia').onclick=async()=>{const b=$('recoOptimiseMedia');b.disabled=true;try{const n=await migrateExistingMedia(),pruned=await pruneUnusedMedia();notify(`Photo optimisation complete: ${n} records migrated, ${pruned} unused images removed.`)}catch(err){notify('Photo optimisation could not finish. Original records were retained.','error');console.error(err)}finally{b.disabled=false}};
 
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
 const matches=q&&terms.length?entries.filter(e=>{const text=[e.restaurant,e.cuisine,e.location].join(' ').toLocaleLowerCase();return terms.every(t=>text.includes(t)||(reco51NormalName(t).length>1&&reco51NormalName(e.restaurant).includes(reco51NormalName(t))))}):[];
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
 window.recoSelectProfileTab=profileTab;document.querySelectorAll('[data-reco49-profile]').forEach(b=>b.onclick=()=>profileTab(b.dataset.reco49Profile));profileTab('palate');
 document.querySelector('.reco49-profile-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...document.querySelectorAll('[data-reco49-profile]')];const i=tabs.findIndex(b=>b.getAttribute('aria-selected')==='true');const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:Math.max(0,Math.min(tabs.length-1,i+(e.key==='ArrowRight'?1:-1)));e.preventDefault();tabs[next].click();tabs[next].focus()});
 $('reco49FriendsLink').onclick=()=>mobileGo('account');
 // Swipe on the content as well as the tab strip; never intercept vertical scroll or photo galleries.
 let start=null;const exclusions='input,textarea,select,button,a,summary,[contenteditable],.museum-gallery,.monthly-wrapped,.photo-preview,canvas,.graph-canvas,#passportContent,.reco49-intro-inner';
 const groups=[['#profileView','.reco49-profile-tabs button'],['#dishesView','.dish-section-tabs button'],['#visitView','.visit-mode-tabs button'],['#accountView .reco-connections','.reco-social-tabs button'],['#accountView','.reco-account-nav button'],['#editor','.editor-steps button']];
 document.addEventListener('touchstart',e=>{start=null;if(e.touches.length!==1||e.target.closest(exclusions))return;const v=groups.find(([root,sel])=>e.target.closest(root)&&document.querySelectorAll(sel).length>1);if(v)start={x:e.touches[0].clientX,y:e.touches[0].clientY,group:v};},{passive:true});
 document.addEventListener('touchcancel',()=>start=null,{passive:true});document.addEventListener('touchend',e=>{if(!start)return;const p=start;start=null;const t=e.changedTouches[0];if(!t)return;const dx=t.clientX-p.x,dy=t.clientY-p.y;if(Math.abs(dx)<65||Math.abs(dx)<Math.abs(dy)*1.6)return;const buttons=[...document.querySelectorAll(p.group[1])].filter(b=>!b.disabled&&b.getClientRects().length);const i=buttons.findIndex(b=>b.getAttribute('aria-selected')==='true'||b.getAttribute('aria-pressed')==='true'||b.classList.contains('active'));if(i<0)return;buttons[i+(dx<0?1:-1)]?.click()},{passive:true});
 const slides=[['Welcome to Recolleat','A little journal for all the meals you want to remember. Keep your food memories together.','book'],['Make every meal a memory','Log restaurants, rate food, value and service, record dishes and add your own photos or receipt details.','meal'],['Your collection, your rules','Rank restaurants, build saved lists, explore cuisines and revisit favourite places.','cards'],['A calendar of flavour','See your visits, personal spending and monthly Wrapped. Treated meals and what you paid are tracked separately.','calendar'],['Discover your Palate Code','Your recorded dishes reveal three taste traits as evidence builds. Collect Culinary Stamps as you explore.','stamp'],...(online?[['Share with friends, not strangers','Add friends through an invitation link and accept requests. Follow accepted friends to see their shared restaurant entries.','friends'],['You choose what friends see','Publish only selected ratings, dishes and reviews. Share your Palate Code separately if you want. Photos, spending and the rest of your journal stay local.','lock']]:[]),['Keep your memories safe','For privacy, your personal journal stays on this device. You are responsible for exporting backups and keeping them somewhere safe. Signing in does not back up your journal. Clearing browser data, losing your device or changing websites may erase access to it.','lock'],['Make it yours',online?'Use the journal without an account, or sign in to connect with friends. Google is supported; email delivery remains limited during development.':'Start your private offline journal. No account needed.','book']];
 const dlg=$('reco49Intro'),key='recolleat-intro-49-'+(online?'connected':'offline');let index=0;
 const icons={book:'<rect x="65" y="40" width="110" height="140" rx="15"/><path d="M86 42v136M111 88h39M111 109h28M111 130h36M145 42v30l10-8 10 8V42"/>',meal:'<circle cx="120" cy="110" r="57"/><circle cx="120" cy="110" r="42"/><path d="M108 79v63M98 79v22q10 13 20 0V79M140 79q-18 22 0 39v24M140 79v39"/>',cards:'<rect x="50" y="65" width="99" height="117" rx="13" transform="rotate(-12 99 123)"/><rect x="94" y="37" width="99" height="117" rx="13" fill="#17634d"/><circle cx="143" cy="83" r="23"/><path d="M119 119h48M125 133h36"/>',calendar:'<rect x="55" y="55" width="130" height="122" rx="14"/><path d="M55 84h130M85 42v26M155 42v26M78 105h14m19 0h14m19 0h14M78 128h14m19 0h14m19 0h14M78 151h14m19 0h14"/>',stamp:'<circle cx="120" cy="100" r="52"/><path d="m120 64 10 22 24 3-18 17 5 24-21-12-21 12 5-24-18-17 24-3zM89 143l-12 41 24-12 19 12 1-30m30-11 12 41-24-12-19 12"/>',friends:'<circle cx="88" cy="83" r="27"/><circle cx="155" cy="83" r="27"/><path d="M42 168v-15q0-33 46-33t46 33v15M134 121q57-8 57 32v15M42 168h149"/>',lock:'<rect x="68" y="95" width="104" height="78" rx="15"/><path d="M87 95V74a33 33 0 0 1 66 0v21M120 128v18"/><circle cx="120" cy="125" r="5"/>'};
 function draw(){const [title,copy,art]=slides[index];$('reco49Art').innerHTML=`<svg viewBox="0 0 240 220" fill="none" stroke="#f5ead1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="120" cy="110" r="98" fill="#195842" stroke="none"/>${icons[art]}</svg>`;$('reco49IntroTitle').textContent=title;$('reco49IntroCopy').textContent=copy;$('reco49Progress').textContent=`${index+1} / ${slides.length}`;$('reco49Dots').replaceChildren(...slides.map((_,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Slide '+(i+1));b.setAttribute('aria-current',String(i===index));b.onclick=()=>{index=i;draw()};return b}));const end=index===slides.length-1;$('reco49Back').disabled=index===0;$('reco49Next').hidden=end&&online;$('reco49Next').textContent=end?'Start journalling':'Next';$('reco49SignIn').hidden=!(end&&online);$('reco49Local').hidden=!(end&&online)}
 function finish(signIn=false){try{localStorage.setItem(key,'1')}catch{}dlg.close();if(signIn){mobileGo('settings')}}
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
function reco50RenderExtras(){const b=$('reco50Undo');if(b)b.hidden=!reco50Undo;const groups=$('reco50Groups');if(groups)groups.replaceChildren(...[...new Set(entries.map(e=>e.group).filter(Boolean))].sort().map(g=>{const o=document.createElement('option');o.value=g;return o}));const box=$('reco50GroupSummary');if(box){const map=new Map();for(const e of entries){if(!e.group)continue;const k=reco51NormalName(e.group)||e.group.toLocaleLowerCase();if(!map.has(k))map.set(k,[]);map.get(k).push(e)}box.innerHTML=map.size?[...map.values()].map(es=>{const mean=es.reduce((a,e)=>a+e.foodScore,0)/es.length;return `<details><summary>${esc(es[0].group)} · ${es.length} branches · ${mean.toFixed(1)}/100</summary>${es.map(e=>`<button type="button" data-open-passport="${esc(e.id)}">${esc(e.restaurant)} · ${esc(e.location||'Location not recorded')} · ${e.foodScore}/100 · ${effectiveVisitCount(e)} visits · View branch review</button>`).join('')}</details>`}).join(''):'<p class="muted">Link branches to a group in a restaurant’s detailed editor. Each saved branch contributes equally to the group’s average food score.</p>'}reco50RenderWishlist();renderBackupStatus()}
function reco50RenderWishlist(){const root=$('reco50WishRows');if(!root)return;root.replaceChildren();for(const w of profile.wishlist||[]){const row=document.createElement('div');row.className='reco50-wish-row';const t=document.createElement('div');const name=document.createElement('b');name.textContent=w.name;const loc=document.createElement('small');loc.textContent=w.location||'Location not recorded';t.append(name,loc);const log=document.createElement('button');log.type='button';log.textContent='Log visit';log.onclick=()=>{r52BucketLog(w)};const del=document.createElement('button');del.type='button';del.textContent='Remove';del.onclick=()=>{const prev=profile.wishlist;profile.wishlist=prev.filter(x=>x.id!==w.id);if(!saveProfile()){profile.wishlist=prev;notify('Could not save The Bucket List.','error')}reco50RenderExtras()};row.append(t,log,del);root.append(row)}if(!root.children.length)root.textContent='No places saved for later.'}
function reco50PickList(list){const dlg=$('reco50Picker'),search=$('reco50PickerSearch'),rows=$('reco50PickerRows'),cuisine=$('reco50PickerCuisine'),location=$('reco50PickerLocation');if(!dlg)return;let selected=new Set(list.restaurantIds);const position=$('r52InsertPosition');position.max=list.restaurantIds.length+1;position.value=list.restaurantIds.length+1;position.parentElement.hidden=list.ranked===false;search.value='';for(const [node,key,label] of [[cuisine,'cuisine','All cuisines'],[location,'location','All locations']]){node.replaceChildren(new Option(label,''),...[...new Set(entries.map(e=>e[key]).filter(Boolean))].sort().map(x=>new Option(x,x)));node.value=''}function draw(){const q=search.value.toLowerCase().trim();rows.replaceChildren();for(const e of entries.filter(e=>(!q||[e.restaurant,e.location,e.cuisine].join(' ').toLowerCase().includes(q))&&(!cuisine.value||e.cuisine===cuisine.value)&&(!location.value||e.location===location.value)).sort((a,b)=>a.restaurant.localeCompare(b.restaurant))){const label=document.createElement('label');label.className='reco50-picker-row';const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(e.id);const copy=document.createElement('span');copy.textContent=e.restaurant+(e.location?' · '+e.location:'');const score=document.createElement('b');score.textContent=e.foodScore+'/100';check.onchange=()=>{if(check.checked)selected.add(e.id);else selected.delete(e.id);$('reco50PickerCount').textContent=selected.size+' selected'};label.append(check,copy,score);rows.append(label)}$('reco50PickerCount').textContent=selected.size+' selected'}search.oninput=draw;cuisine.onchange=draw;location.onchange=draw;$('reco50PickerSave').onclick=async()=>{const current=lists.find(l=>l.id===list.id);if(!current)return;if(current.ranked!==false&&(!position.value||!Number.isInteger(Number(position.value))||Number(position.value)<1||Number(position.value)>current.restaurantIds.length+1)){notify('Choose a valid list position.','error');return;}const kept=current.restaurantIds.filter(id=>selected.has(id)),added=[...selected].filter(id=>!current.restaurantIds.includes(id));const at=current.ranked===false?kept.length:Math.max(0,Math.min(kept.length,(Number(position.value)||1)-1));kept.splice(at,0,...added);const next={...current,restaurantIds:kept,updatedAt:new Date().toISOString()};try{await putStore(LISTS,next);lists=lists.map(l=>l.id===next.id?next:l);dlg.close();render()}catch(e){notify('List could not be saved.','error')}};draw();dlg.showModal()}
function reco50BindDrag(list){if(list.ranked===false)return;let from=null;document.querySelectorAll('[data-reco50-order]').forEach(row=>{row.ondragstart=e=>{from=Number(row.dataset.reco50Order);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(from))};row.ondragover=e=>e.preventDefault();row.ondrop=async e=>{e.preventDefault();const to=Number(row.dataset.reco50Order);if(from==null||from===to)return;const next={...list,restaurantIds:[...list.restaurantIds],updatedAt:new Date().toISOString()};next.restaurantIds.splice(to,0,next.restaurantIds.splice(from,1)[0]);from=null;try{await putStore(LISTS,next);lists=lists.map(l=>l.id===next.id?next:l);render()}catch(err){notify('Could not reorder.','error')}}})}
async function reco50RestoreUndo(){const u=reco50Undo;if(!u||entries.some(e=>e.id===u.entry.id))return;const restored=lists.map(l=>{const m=u.memberships.find(m=>m.id===l.id);if(!m||l.restaurantIds.includes(u.entry.id))return l;const ids=[...l.restaurantIds];ids.splice(Math.min(m.index,ids.length),0,u.entry.id);return {...l,restaurantIds:ids,updatedAt:new Date().toISOString()}});try{await mutateStores([[RESTAURANTS,'put',u.entry],...u.visits.map(v=>[VISITS,'put',v]),...restored.filter((l,i)=>l!==lists[i]).map(l=>[LISTS,'put',l])]);entries.push(u.entry);visits.push(...u.visits);lists=restored;reco50Undo=null;render();notify('Restaurant and its visits restored locally. Online posts are unchanged.')}catch(e){notify('Undo failed. Use the recovery backup.','error')}}
window.reco50LocalMatch=pid=>{const rows=entries.filter(e=>pid&&e.googlePlaceId===pid);return rows.length===1?{name:rows[0].restaurant,food:rows[0].foodScore}:null};
window.reco50ShareLists=()=>lists.map(l=>({id:l.id,name:l.name,ranked:l.ranked!==false,items:l.restaurantIds.map(id=>entries.find(e=>e.id===id)).filter(Boolean).map(e=>({name:e.restaurant,location:e.location||''}))}));
window.reco50WishlistAdd=(name,location)=>{const old=profile.wishlist||[];if(old.some(w=>w.name.toLowerCase()===String(name).toLowerCase()&&w.location.toLowerCase()===String(location||'').toLowerCase())){notify('Already in The Bucket List.');return}profile.wishlist=cleanWishlist([...old,{id:uid(),name,location}]);if(!saveProfile()){profile.wishlist=old;notify('Wishlist could not be saved.','error');return}reco50RenderExtras();notify('Saved to The Bucket List.')};
function reco51NormalName(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]/g,'')}
function reco51SimilarQuick(){
 const field=$('recoQuickRestaurant'),out=$('reco51QuickMatches');if(!field||!out)return;out.replaceChildren();const q=field.value.trim();if(q.length<3||$('reco50NewBranch')?.checked||v45QuickMatched(q))return;
 const matches=entries.filter(e=>similarName(e.restaurant,q)||reco51NormalName(e.restaurant).includes(reco51NormalName(q))).slice(0,6);if(!matches.length)return;
 const label=document.createElement('small');label.textContent='Similar saved restaurants — select the correct branch';out.append(label);for(const e of matches){const b=document.createElement('button');b.type='button';b.textContent=visitDisplayValue(e);b.onclick=()=>{field.value=visitDisplayValue(e);field.dispatchEvent(new Event('input'));};out.append(b)}
}
function reco51Setup(){
 const quick=$('recoQuickRestaurant');if(quick){const matches=document.createElement('div');matches.id='reco51QuickMatches';matches.className='reco51-quick-matches';quick.closest('label').after(matches);$('reco50NewBranch')?.addEventListener('change',v45QuickState)}

 $('reco51ResetTable')?.addEventListener('click',()=>{$('search').value='';prefs.filters=clone(DEFAULT_PREFS.filters);prefs.sortProperty='grandRank';prefs.sortDirection='asc';visibleTableRows=150;visibleCardRows=72;savePrefs();syncControls();render();$('sortMenu').classList.remove('show');$('filterMenu').classList.remove('show');notify('Table reset. Your restaurants are unchanged.')});
 for(const id of ['reco51AccountLink','reco51AccountTop'])$(id)?.addEventListener('click',()=>mobileGo('settings'));
 $('reco51HelpFooter')?.addEventListener('click',()=>mobileGo('help'));
}
function reco50Setup(){
 $('reco50NewBranch')?.addEventListener('change',()=>{$('reco50QuickLocationWrap').hidden=!$('reco50NewBranch').checked});
 const home=$('reco50Backup');if(home){const b=document.createElement('button');b.type='button';b.id='reco50Undo';b.hidden=true;b.textContent='Undo last restaurant deletion';b.onclick=reco50RestoreUndo;home.after(b)}$('reco50Export')?.addEventListener('click',exportBackup);
 const select=$('reco50Banner');if(select)select.onchange=()=>{const old=profile.banner;profile.banner=cleanBanner(select.value);if(!saveProfile()){profile.banner=old;notify('Banner could not be saved.','error')}reco50RenderBanner()};
 for(const logo of document.querySelectorAll('.sidebar-brand,.sidebar-brand-name,.header-brand .recolleat-mark')){logo.removeAttribute('aria-hidden');logo.tabIndex=0;logo.setAttribute('role','button');logo.setAttribute('aria-label','Recolleat home');logo.addEventListener('click',()=>mobileGo('home'));logo.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();mobileGo('home')}})}
 const main=$('listMain');if(main){const wrap=document.createElement('section');wrap.className='reco50-extras';wrap.innerHTML='<details><summary>The Bucket List</summary><form id="reco50WishForm"><input id="reco50WishName" required maxlength="120" placeholder="Restaurant name" aria-label="Restaurant name"><input id="reco50WishLocation" maxlength="120" placeholder="Location (optional)" aria-label="Location"><button type="submit">Add to The Bucket List</button></form><div id="reco50WishRows"></div></details><details><summary>Restaurant groups · Branch passport</summary><div id="reco50GroupSummary"></div></details>';main.after(wrap);$('reco50WishForm').onsubmit=e=>{e.preventDefault();window.reco50WishlistAdd($('reco50WishName').value,$('reco50WishLocation').value);e.target.reset()}}
 const dlg=document.createElement('dialog');dlg.id='reco50Picker';dlg.className='reco50-picker';dlg.innerHTML='<div class="dialog-head"><h2>Select restaurants</h2><button type="button" id="reco50PickerClose" aria-label="Close">×</button></div><div class="dialog-body"><input id="reco50PickerSearch" placeholder="Search collection" aria-label="Search collection"><div class="reco50-picker-filters"><select id="reco50PickerCuisine" aria-label="Cuisine"></select><select id="reco50PickerLocation" aria-label="Location"></select></div><label>Insert new restaurants at position <input id="r52InsertPosition" type="number" min="1" step="1"></label><p id="reco50PickerCount" aria-live="polite"></p><div id="reco50PickerRows"></div><button class="primary" type="button" id="reco50PickerSave">Save selection</button></div>';document.body.append(dlg);$('reco50PickerClose').onclick=()=>dlg.close();reco50RenderExtras();reco50RenderBanner();
}

// 4.54 / 3.11: local-first navigation, lists and search.
let r52Collapsed=!!prefs.r53ListCollapsed,r52BucketPending=null,r52ListMode='personal';
function r52BucketLog(w){
 try{const draft=JSON.parse(localStorage.getItem(QUICK_LOG_KEY)||'null');if(draft?.recoQuickRestaurant&&!confirm('Start a new meal from The Bucket List? Your unfinished quick-log draft may be replaced.'))return}catch{}
 const hits=entries.filter(e=>reco51NormalName(e.restaurant)===reco51NormalName(w.name)&&locationKey(e.location)===locationKey(w.location));
 openUnifiedQuickLog(hits.length===1?hits[0].id:'');
 if(hits.length!==1){$('recoQuickLogForm').reset();$('recoQuickDishRows').replaceChildren();v45QuickPhoto='';v45QuickPhotoPreview();$('recoQuickDate').value=v45DateToday();$('recoQuickRestaurant').value=w.name;$('reco50NewBranch').checked=true;$('reco50QuickLocation').value=w.location||'';v45QuickState();}
 r52BucketPending={id:w.id,name:w.name,location:w.location||''};
}
function r52FinishBucket(id){const pending=r52BucketPending;r52BucketPending=null;if(!pending)return;const name=$('recoQuickRestaurant').value,branch=$('reco50NewBranch').checked,location=branch?$('reco50QuickLocation').value:(entries.find(e=>e.id===id)?.location||'');const match=entries.find(e=>e.id===id);if(reco51NormalName(match?.restaurant||name)!==reco51NormalName(pending.name)||locationKey(location)!==locationKey(pending.location))return;const prior=profile.wishlist;profile.wishlist=(prior||[]).filter(x=>x.id!==pending.id);if(!saveProfile()){profile.wishlist=prior;notify('Visit saved; Bucket List item could not be removed.','error')}}
function r52ListTab(mode){r52ListMode=mode;const personal=mode==='personal';$('r52Personal').setAttribute('aria-pressed',String(personal));$('r52Others')?.setAttribute('aria-pressed',String(!personal));for(const n of [$('listMain'),$('savedLists')?.closest('aside'),document.querySelector('#listView .reco50-extras')])if(n)n.hidden=!personal;$('r52OtherLists').hidden=personal;if(!personal)window.r52DrawFavourites?.($('r52OtherLists'));}
async function r52Reorder(list,from,to){if(!Number.isInteger(from)||!Number.isInteger(to)||from===to||from<0||to<0||from>=list.restaurantIds.length||to>=list.restaurantIds.length)return;const current=lists.find(l=>l.id===list.id);if(!current)return;const ids=[...current.restaurantIds];ids.splice(to,0,ids.splice(from,1)[0]);const next={...current,restaurantIds:ids,updatedAt:new Date().toISOString()};try{await putStore(LISTS,next);lists=lists.map(l=>l.id===next.id?next:l);render()}catch(e){notify('Could not reorder this list.','error')}}
function r52HoldDrag(list){if(list.ranked===false)return;const rows=[...$('listMain').querySelectorAll('[data-reco50-order]')];for(const row of rows){let timer,start,active=false,target=null;const grip=row.querySelector('.r52-grip');const cleanup=()=>{clearTimeout(timer);row.classList.remove('r52-dragging');rows.forEach(x=>x.classList.remove('r52-drop'));active=false;target=null;start=null;};grip.addEventListener('pointerdown',e=>{if(e.button!==0)return;start={x:e.clientX,y:e.clientY};grip.setPointerCapture(e.pointerId);timer=setTimeout(()=>{active=true;row.classList.add('r52-dragging');target=row},280)});grip.addEventListener('pointermove',e=>{if(!start)return;if(!active){if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>12)cleanup();return}const at=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-reco50-order]');if(at&&rows.includes(at)){target=at;rows.forEach(x=>x.classList.toggle('r52-drop',x===at&&x!==row))}});grip.addEventListener('pointerup',()=>{const to=target?Number(target.dataset.reco50Order):null;const from=Number(row.dataset.reco50Order),was=active;cleanup();if(was&&to!==null)r52Reorder(list,from,to)});grip.addEventListener('pointercancel',cleanup);grip.addEventListener('lostpointercapture',cleanup);grip.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;e.preventDefault();const pos=prompt('Move to position (1–'+rows.length+')',String(Number(row.dataset.reco50Order)+1));if(pos!==null&&/^\d+$/.test(pos))r52Reorder(list,Number(row.dataset.reco50Order),Number(pos)-1)})}}
function r52RenderLists(){
 if(prefs.activeListId&&!lists.some(l=>l.id===prefs.activeListId))prefs.activeListId=null;if(!prefs.activeListId&&lists.length)prefs.activeListId=lists[0].id;
 $('savedLists').innerHTML=lists.length?lists.slice().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).map(l=>`<button type="button" class="saved-list ${l.id===prefs.activeListId&&!r52Collapsed?'active':''}" data-list-select="${esc(l.id)}"><b>${esc(l.name)}</b><span>${l.restaurantIds.length} restaurants · ${l.ranked===false?'Unranked':'Ranked'}</span><span aria-hidden="true">${l.id===prefs.activeListId&&!r52Collapsed?'⌃':'⌄'}</span></button>`).join(''):'<p class="muted">Curate something worth remembering.</p>';
 const active=lists.find(l=>l.id===prefs.activeListId),root=$('listMain');if(!active||r52Collapsed){root.innerHTML='';return}const map=new Map(entries.map(e=>[e.id,e]));
 root.innerHTML=`<div class="list-top"><div><h2>${esc(active.name)}</h2><p>${esc(active.description||(active.ranked===false?'Unranked list':'Ranked list'))}</p></div><div class="list-actions"><button type="button" data-edit-list="${esc(active.id)}">Edit / delete</button><button type="button" id="r52Collapse">Minimise</button></div></div><button type="button" class="primary" id="addRestaurantToList">+ Add restaurants</button><div class="ranked-list">${active.restaurantIds.map((id,i)=>{const e=map.get(id);if(!e)return '';return `<div class="ranked-row r52-ranked-row" data-reco50-order="${i}">${active.ranked===false?'':`<button class="r52-grip" type="button" aria-label="Hold to reorder ${esc(e.restaurant)} or press Enter to choose position">⠿ <span>${i+1}</span></button>`}<div class="ranked-info"><button type="button" class="r52-row-name" data-open-passport="${esc(id)}">${esc(e.restaurant)}</button><small>${esc(e.location||e.cuisine||'Location not recorded')} · ${esc(e.cuisine||'Uncategorised')}</small></div><b>${e.foodScore}/100</b><button type="button" class="r52-remove" data-remove-from-list="${esc(active.id)}" data-rid="${esc(id)}" aria-label="Remove ${esc(e.restaurant)} from list">×</button></div>`}).join('')||'<p class="muted">Search your collection to add restaurants.</p>'}</div>`;
 $('addRestaurantToList').onclick=()=>reco50PickList(active);$('r52Collapse').onclick=()=>{r52Collapsed=true;prefs.r53ListCollapsed=true;savePrefs();r52RenderLists()};r52HoldDrag(active);
}
function r52Search(){const dlg=$('r52SearchDialog'),input=$('r52SearchInput'),out=$('r52SearchResults');const draw=()=>{const q=input.value.trim().toLowerCase();out.replaceChildren();if(!q){out.textContent='Search your journal, pages and settings. Everything stays on this device.';return}const items=[];const add=(label,detail,hay,fn)=>{if(q.split(/\s+/).every(t=>`${label} ${detail} ${hay}`.toLowerCase().includes(t)))items.push({label,detail,fn})};for(const [view,meta] of Object.entries(MOBILE_SECTIONS)){if(['lab','dna','graph','admin','official','privacy','terms'].includes(view))continue;add(meta[0],'Page',meta[1],()=>mobileGo(view))}const shortcuts=[['Privacy & Safety','privacy','data protection delete data sharing block'],['Terms of Service','terms','legal terms'],['Backup & restore','settings','export import recovery storage photos optimise'],['Colour themes','settings','appearance banner dark mode'],['The Bucket List','lists','wishlist restaurants to visit'],['Palate Code','profile','identity'],['Culinary Stamps','profile','achievement rewards'],['Add restaurant','home','save meal deep dive receipt quick log']];for(const [name,v,tags] of shortcuts)add(name,'Shortcut',tags,()=>{mobileGo(v);if(name==='Add restaurant')openUnifiedQuickLog();else if(name==='Palate Code')$('reco49TabPalate').click();else if(name==='Culinary Stamps')$('reco49TabStamps').click();else if(name==='The Bucket List'){r52ListTab('personal');document.querySelector('#reco50WishRows')?.closest('details')?.setAttribute('open','');}else if(v==='settings'){const match=[...document.querySelectorAll('.reco-settings-group')].find(d=>d.textContent.toLowerCase().includes(name==='Colour themes'?'appearance':'backups'));if(match){match.open=true;match.scrollIntoView({block:'center'})}}});for(const e of entries)add(e.restaurant,'Restaurant · '+(e.location||e.cuisine||''),[e.cuisine,e.location,e.notes,e.group].join(' '),()=>{renderPassport(e.id);$('passportDialog').showModal()});for(const d of dishRecords())add(d.item.name,'Dish · '+d.e.restaurant,[d.e.cuisine,d.e.location,d.item.category].join(' '),()=>{renderPassport(d.e.id);$('passportDialog').showModal()});for(const l of lists)add(l.name,'Personal list',l.description,()=>{prefs.activeListId=l.id;r52Collapsed=false;prefs.r53ListCollapsed=false;savePrefs();mobileGo('lists');r52ListTab('personal');renderLists()});for(const w of profile.wishlist||[])add(w.name,'The Bucket List',w.location,()=>{mobileGo('lists');r52ListTab('personal');document.querySelector('#reco50WishRows')?.closest('details')?.setAttribute('open','')});for(const [label,detail,tags,fn] of window.r52FavouriteSearch?.()||[])add(label,detail,tags,fn);if(!items.length){out.textContent='This search only came with an empty plate.';return}for(const x of items.slice(0,150)){const b=document.createElement('button');b.type='button';const title=document.createElement('b'),detail=document.createElement('small');const at=x.label.toLowerCase().indexOf(q);if(at>=0){title.append(document.createTextNode(x.label.slice(0,at)));const mark=document.createElement('mark');mark.textContent=x.label.slice(at,at+q.length);title.append(mark,document.createTextNode(x.label.slice(at+q.length)))}else title.textContent=x.label;detail.textContent=x.detail;b.append(title,detail);b.onclick=()=>{dlg.close();x.fn()};out.append(b)}if(items.length>150)out.append('Refine your search to see more matches.');};input.value='';input.oninput=draw;draw();if(!dlg.open)dlg.showModal();input.focus()}
window.r52LocalBanner=()=>document.querySelector('#profileView .profile-identity-art')?.dataset.banner||'classic';window.r52Navigate=mobileGo;window.r52OpenRestaurant=id=>{renderPassport(id);$('passportDialog').showModal()};window.r52CommonMatch=p=>{const hits=p.place_id?entries.filter(e=>e.googlePlaceId===p.place_id):[];if(hits.length===1)return {id:hits[0].id,name:hits[0].restaurant,confirmed:true};if(!p.location)return null;const possible=entries.filter(e=>(!p.place_id||!e.googlePlaceId)&&reco51NormalName(e.restaurant)===reco51NormalName(p.restaurant)&&locationKey(e.location)===locationKey(p.location));return possible.length===1?{id:possible[0].id,name:possible[0].restaurant,confirmed:false}:null};
window.r52OpenLists=()=>{mobileGo('lists');r52ListTab('others')};
function r52Setup(){
 $('r52SearchOpen').onclick=r52Search;$('r52SearchClose').onclick=()=>$('r52SearchDialog').close();const nav=$('mobileBottomNav');let start=null;nav.addEventListener('touchstart',e=>{start=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null},{passive:true});nav.addEventListener('touchend',e=>{if(start){const t=e.changedTouches[0];if(start.y-t.clientY>32&&Math.abs(start.x-t.clientX)<65)r52Search()}start=null},{passive:true});nav.addEventListener('touchcancel',()=>start=null);const desk=document.createElement('button');desk.type='button';desk.textContent='Search journal';desk.className='r52-desktop-search';desk.onclick=r52Search;document.querySelector('.sidebar-nav')?.prepend(desk);
 const sheet=$('mobileMoreSheet'),grip=sheet.querySelector('.mobile-more-handle');let y=null;for(const target of [grip,sheet.querySelector('.mobile-more-top')]){target?.addEventListener('touchstart',e=>y=e.touches[0]?.clientY,{passive:true});target?.addEventListener('touchend',e=>{if(y!==null&&e.changedTouches[0].clientY-y>35)closeMobileMore();y=null},{passive:true})}
 const backup=$('reco50Backup');if(backup)backup.hidden=true;const finance=$('recoFinance');if(finance)finance.hidden=true;const optimize=$('recoOptimiseMedia');if(optimize){optimize.textContent='Optimise Photo Storage';const p=document.createElement('p');p.className='r52-muted';p.textContent='Organises locally stored images, deduplicates identical copies and removes unused image records. Active photographs remain on this device; export a backup first.';optimize.after(p)}
 $('r52Personal').onclick=()=>r52ListTab('personal');if($('r52Others'))$('r52Others').onclick=()=>r52ListTab('others');const wrap=document.querySelector('#listView .reco50-extras');if(wrap){const bucket=wrap.querySelector('details');bucket.open=true;$('listMain').before(wrap);const heading=bucket.querySelector('summary');heading.textContent='The Bucket List';const hint=document.createElement('p');hint.className='r52-muted';hint.textContent='Places you want to visit. Logging a meal removes the matching saved place only after the meal is saved.';heading.after(hint)}
 $('recoQuickLogDialog').addEventListener('close',()=>{r52BucketPending=null});$('recoQuickRestaurant').addEventListener('input',()=>{if(r52BucketPending&&reco51NormalName($('recoQuickRestaurant').value)!==reco51NormalName(r52BucketPending.name))r52BucketPending=null});
 const editor=$('editor');let editorDirty=false;editor.addEventListener('input',()=>editorDirty=true);editor.addEventListener('change',()=>editorDirty=true);editor.addEventListener('close',()=>editorDirty=false);editor.addEventListener('cancel',e=>{if(editorDirty&&!confirm('Discard unsaved review changes?'))e.preventDefault()});editor.addEventListener('click',e=>{const b=e.target.closest('button');if(editorDirty&&b&&(b.id==='cancelBtn'||b.value==='cancel'||b.dataset.close==='editor'||b.getAttribute('aria-label')==='Close dialog')&&!confirm('Discard unsaved review changes?')){e.preventDefault();e.stopImmediatePropagation()}},true);$('r53MoreSearch').onclick=()=>{closeMobileMore();r52Search()};$('r53UseCharacter').onclick=()=>{prefs.kingdomAvatar=true;savePrefs();renderProfile();notify('Your current Kingdom character is now your local profile picture.')};
 document.querySelectorAll('.r53-friends-count').forEach(b=>b.onclick=()=>mobileGo('account'));$('r53FriendPreview').onclick=()=>window.r53FriendPreview?.();r52ListTab('personal');renderLists();
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
  dismissSplash();renderBackupStatus();setupReco49();reco50Setup();reco51Setup();r52Setup();document.dispatchEvent(new Event('reco-core-ready'));
  // Media migration is idempotent and never required before an entry can be used.
  const migrate=()=>migrateExistingMedia().catch(e=>console.warn('Deferred media migration did not finish',e));
  if('requestIdleCallback' in window)window.requestIdleCallback(migrate,{timeout:8000});else setTimeout(migrate,1800);
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>start(),{once:true});
}else{start()}
})();
