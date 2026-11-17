import { createHash } from 'node:crypto';
import { inflateSync, deflateSync } from 'node:zlib';
export type Obj = {type:string,data:Buffer};
export const ZERO='0'.repeat(40);
export function sha(b:Buffer){return createHash('sha1').update(b).digest('hex');}
export function oid(o:Obj){return createHash('sha1').update(`${o.type} ${o.data.length}\0`).update(o.data).digest('hex');}
// Each app owns its repositories; object IDs depend exclusively on canonical Git bytes.
export class Repo {
 objects=new Map<string,Obj>(); refs=new Map<string,string>(); head='refs/heads/main';
 // Only complete, successfully traversed immutable object graphs enter this set.
 // Weak references keep validation metadata bounded by the live object store.
 private validated=new WeakSet<Obj>();
 refsCache?:{key:string,bytes:Buffer};
 fetchCache?:{key:string,version:number,bytes:Buffer};
 validate(tip:string){
  const seen=new Set<string>(),pending:Obj[]=[];
  const visit=(id:string)=>{const o=this.objects.get(id);if(!o)throw Error('missing object');if(this.validated.has(o)||seen.has(id))return;seen.add(id);pending.push(o);for(const c of this.links(id))visit(c);};
  visit(tip);for(const o of pending)this.validated.add(o);
 }
 put(o:Obj){const id=oid(o);this.objects.set(id,o);return id;}
 parents(id:string){const o=this.objects.get(id);return o?.type==='commit'?[...o.data.toString().split('\n\n')[0].matchAll(/^parent ([a-f0-9]{40})$/gm)].map(m=>m[1]):[];}
 links(id:string,parents=true){const o=this.objects.get(id);if(!o)throw Error('missing object');
 if(o.type==='commit')return [...o.data.toString().split('\n\n')[0].matchAll(/^(tree|parent) ([a-f0-9]{40})$/gm)].filter(m=>parents||m[1]==='tree').map(m=>m[2]);
 if(o.type==='tag')return [o.data.toString().match(/^object ([a-f0-9]{40})/)![1]];
 if(o.type==='tree'){let p=0;const a:string[]=[];while(p<o.data.length){const z=o.data.indexOf(0,p);if(z<0||z+21>o.data.length)throw Error('bad tree');const mode=o.data.subarray(p,o.data.indexOf(32,p)).toString();if(mode!=='160000')a.push(o.data.subarray(z+1,z+21).toString('hex'));p=z+21;}return a;}return [];
 }
 closure(tips:string[],stop=new Set<string>()){const seen=new Set<string>();const visit=(id:string)=>{if(seen.has(id))return;seen.add(id);for(const c of this.links(id,!stop.has(id)))visit(c);};for(const t of tips)if(this.objects.has(t))visit(t);return seen;}
 ancestor(old:string,next:string){const seen=new Set<string>(),q=[next];while(q.length){const id=q.pop()!;if(id===old)return true;if(seen.has(id))continue;seen.add(id);q.push(...this.parents(id));}return false;}
 peel(id:string){const seen=new Set<string>();while(this.objects.get(id)?.type==='tag'&&!seen.has(id)){seen.add(id);id=this.links(id)[0];}return id;}
}
function delta(base:Buffer,d:Buffer){let p=0;const num=()=>{let n=0,s=0,b;do{b=d[p++];n+=(b&127)*2**s;s+=7;}while(b&128);return n;};if(num()!==base.length)throw Error('delta base size');const size=num(),out:Buffer[]=[];let total=0;while(p<d.length){const op=d[p++];if(op&128){let off=0,len=0;for(let i=0;i<4;i++)if(op&(1<<i))off+=d[p++]*2**(8*i);for(let i=0;i<3;i++)if(op&(16<<i))len+=d[p++]*2**(8*i);if(!len)len=65536;if(off+len>base.length)throw Error('delta range');out.push(base.subarray(off,off+len));total+=len;}else{if(!op||p+op>d.length)throw Error('delta instruction');out.push(d.subarray(p,p+op));p+=op;total+=op;}}if(total!==size)throw Error('delta result size');return Buffer.concat(out);}
// Resolve deltas in passes: REF_DELTA bases may occur later, or live in a previous pack.
// Nothing enters the repository until the checksum and every object have been validated.
export function readPack(b:Buffer,r:Repo){if(b.length<32||b.toString('ascii',0,4)!=='PACK'||![2,3].includes(b.readUInt32BE(4))||sha(b.subarray(0,-20))!==b.subarray(-20).toString('hex'))throw Error('invalid pack');let p=12;const entries:any[]=[],byOffset=new Map<number,any>(),resolved=new Map<string,Obj>();
 for(let i=0;i<b.readUInt32BE(8);i++){const start=p;let c=b[p++],type=(c>>4)&7,size=c&15,shift=4;while(c&128){c=b[p++];size+=(c&127)*2**shift;shift+=7;if(shift>53)throw Error('bad size');}let baseOffset,baseId;if(type===6){c=b[p++];let n=c&127;while(c&128){c=b[p++];n=(n+1)*128+(c&127);}baseOffset=start-n;}else if(type===7){baseId=b.subarray(p,p+20).toString('hex');p+=20;}
 const z=inflateSync(b.subarray(p,-20),{info:true}) as any;const data=z.buffer as Buffer;p+=z.engine.bytesWritten;if(data.length!==size)throw Error('pack size');const e={start,type,data,baseOffset,baseId,obj:undefined};entries.push(e);byOffset.set(start,e);}
 if(p!==b.length-20)throw Error('pack trailing bytes');
 let remaining=entries.length;while(remaining){let progress=0;for(const e of entries){if(e.obj)continue;let o:Obj;if(e.type===6||e.type===7){const base=e.type===6?byOffset.get(e.baseOffset)?.obj:resolved.get(e.baseId)||r.objects.get(e.baseId);if(!base)continue;o={type:base.type,data:delta(base.data,e.data)};}else{const name=({1:'commit',2:'tree',3:'blob',4:'tag'} as any)[e.type];if(!name)throw Error('pack type');o={type:name,data:e.data};}e.obj=o;resolved.set(oid(o),o);remaining--;progress++;}if(!progress)throw Error('unresolved delta');}
 for(const [id,o] of resolved)r.objects.set(id,o);
}
export function writePack(objects:Obj[]){const h=Buffer.alloc(12);h.write('PACK');h.writeUInt32BE(2,4);h.writeUInt32BE(objects.length,8);const parts=[h];for(const o of objects){let n=o.data.length;const type=({commit:1,tree:2,blob:3,tag:4} as any)[o.type];const a=[(type<<4)|(n&15)];n=Math.floor(n/16);while(n){a[a.length-1]|=128;a.push(n&127);n=Math.floor(n/128);}parts.push(Buffer.from(a),deflateSync(o.data));}const b=Buffer.concat(parts);return Buffer.concat([b,Buffer.from(sha(b),'hex')]);}
export function pkt(s:string|Buffer){const b=Buffer.isBuffer(s)?s:Buffer.from(s);return Buffer.concat([Buffer.from((b.length+4).toString(16).padStart(4,'0')),b]);}
export function packets(b:Buffer,stop=false){const lines:Buffer[]=[];let p=0;while(p<b.length){const h=b.toString('ascii',p,p+4);if(!/^[a-f0-9]{4}$/i.test(h))throw Error('bad pkt');const n=parseInt(h,16);p+=4;if(n<4){if(n>2)throw Error('bad pkt size');if(stop&&n===0)break;continue;}if(n>65520||p+n-4>b.length)throw Error('truncated pkt');lines.push(b.subarray(p,p+n-4));p+=n-4;}return {lines,p};}
export function bands(b:Buffer,band=1){const parts:Buffer[]=[];for(let p=0;p<b.length;p+=65000)parts.push(pkt(Buffer.concat([Buffer.from([band]),b.subarray(p,p+65000)])));return Buffer.concat(parts);}
