/* Push notifikace – šifrování zprávy pro konkrétní zařízení (Web Push, RFC 8291 „aes128gcm“) a podpis VAPID (RFC 8292).
   Jen Web Crypto, žádné knihovny. Stejný soubor používá Pipeline (předšifrované připomínky – prostředník je nepřečte)
   i prostředník na Cloudflare (upozornění na nový dotazník / rezervaci a odeslání na zařízení). */
(()=>{
"use strict";
const C=globalThis.crypto.subtle,TE=new TextEncoder();
const b64u=b=>{const u=b instanceof Uint8Array?b:new Uint8Array(b);let s="";for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")};
const unb64u=s=>{const t=String(s||"").replace(/-/g,"+").replace(/_/g,"/");const bin=atob(t+"===".slice((t.length+3)%4));const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u};
const cat=(...a)=>{const n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length}return o};
async function hkdf(salt,ikm,info,len){const k=await C.importKey("raw",ikm,"HKDF",false,["deriveBits"]);return new Uint8Array(await C.deriveBits({name:"HKDF",hash:"SHA-256",salt,info},k,len*8))}
/* zašifruje zprávu (objekt nebo text) pro odběr {p256dh,auth} → tělo požadavku pro push službu */
async function encrypt(sub,payload,opt={}){
  const ua=unb64u(sub.p256dh),auth=unb64u(sub.auth);
  if(ua.length!==65||auth.length!==16)throw new Error("neplatný odběr");
  const uaKey=await C.importKey("raw",ua,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const as=opt.asKeys||await C.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const asPub=new Uint8Array(await C.exportKey("raw",as.publicKey));
  const ecdh=new Uint8Array(await C.deriveBits({name:"ECDH",public:uaKey},as.privateKey,256));
  const ikm=await hkdf(auth,ecdh,cat(TE.encode("WebPush: info\0"),ua,asPub),32);
  const salt=opt.salt||crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(salt,ikm,TE.encode("Content-Encoding: aes128gcm\0"),16);
  const nonce=await hkdf(salt,ikm,TE.encode("Content-Encoding: nonce\0"),12);
  const text=typeof payload==="string"?payload:JSON.stringify(payload);
  const plain=cat(TE.encode(text),new Uint8Array([2]));
  if(plain.length>3800)throw new Error("zpráva je moc dlouhá");
  const key=await C.importKey("raw",cek,"AES-GCM",false,["encrypt"]);
  const ct=new Uint8Array(await C.encrypt({name:"AES-GCM",iv:nonce},key,plain));
  const rs=new Uint8Array([0,0,16,0]); /* 4096 */
  return cat(salt,rs,new Uint8Array([65]),asPub,ct);
}
/* VAPID: pár klíčů prostředníka (ECDSA P-256) a hlavička Authorization pro push službu */
async function vapidKeys(){const kp=await C.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  return {pub:b64u(await C.exportKey("raw",kp.publicKey)),priv:await C.exportKey("jwk",kp.privateKey)}}
async function vapidAuth(endpoint,keys,subject,nowSec){
  const aud=new URL(endpoint).origin,now=nowSec||Math.floor(Date.now()/1000);
  const h=b64u(TE.encode(JSON.stringify({typ:"JWT",alg:"ES256"}))),c=b64u(TE.encode(JSON.stringify({aud,exp:now+12*3600,sub:subject})));
  const k=await C.importKey("jwk",keys.priv,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=new Uint8Array(await C.sign({name:"ECDSA",hash:"SHA-256"},k,TE.encode(h+"."+c)));
  return "vapid t="+h+"."+c+"."+b64u(sig)+", k="+keys.pub}
/* krátký identifikátor odběru (z adresy zařízení) – Pipeline posílá jen tohle, ne adresu */
async function subId(endpoint){const d=new Uint8Array(await C.digest("SHA-256",TE.encode(String(endpoint))));return b64u(d).slice(0,16)}
const api={b64u,unb64u,encrypt,vapidKeys,vapidAuth,subId};
globalThis.PushCrypto=api;
})();
