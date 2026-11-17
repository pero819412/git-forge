import {Repo} from './git-store.ts';
export type Entry = {sha:string,mode:string};
export type Files = Map<string,Entry>;
export function resolve(r:Repo,ref:string){const id=r.refs.get(ref)||r.refs.get('refs/heads/'+ref)||r.refs.get('refs/tags/'+ref)||ref;return r.objects.get(id)?.type==='commit'?id:undefined;}
export function treeOf(r:Repo,id?:string):Files {
 const out:Files=new Map();if(!id)return out;
 const tree=r.objects.get(id)?.data.toString().match(/^tree ([a-f0-9]{40})/m)?.[1];
 const walk=(sha:string,prefix:string)=>{const b=r.objects.get(sha)?.data;if(!b)throw Error('Missing tree');let p=0;while(p<b.length){const sp=b.indexOf(32,p),z=b.indexOf(0,sp);const mode=b.toString('ascii',p,sp),name=b.toString('utf8',sp+1,z),child=b.subarray(z+1,z+21).toString('hex');p=z+21;if(mode==='40000'||mode==='040000')walk(child,prefix+name+'/');else out.set(prefix+name,{sha:child,mode});}};
 if(tree)walk(tree,'');return out;
}
export function directorySha(r:Repo,tip:string,path:string){
 let id=r.objects.get(tip)?.data.toString().match(/^tree ([a-f0-9]{40})/m)?.[1];
 for(const part of path.split('/').filter(Boolean)){
  const bytes=id?r.objects.get(id)?.data:undefined;if(!bytes)return undefined;
  let next:string|undefined;for(let p=0;p<bytes.length;){const sp=bytes.indexOf(32,p),z=bytes.indexOf(0,sp),mode=bytes.toString('ascii',p,sp),name=bytes.toString('utf8',sp+1,z);if(name===part&&(mode==='40000'||mode==='040000'))next=bytes.subarray(z+1,z+21).toString('hex');p=z+21;}id=next;
 }
 return id;
}
export function writeTree(r:Repo,files:Files):string {
 const build=(prefix:string):string=>{const entries=new Map<string,{mode:string,sha:string}>(),dirs=new Set<string>();for(const [path,e] of files){if(!path.startsWith(prefix))continue;const rest=path.slice(prefix.length),slash=rest.indexOf('/');if(slash<0)entries.set(rest,e);else dirs.add(rest.slice(0,slash));}for(const dir of dirs){if(entries.has(dir))throw Error('File/directory conflict');entries.set(dir,{mode:'40000',sha:build(prefix+dir+'/')});}const ordered=[...entries].sort(([a,x],[b,y])=>Buffer.compare(Buffer.from(a+(x.mode==='40000'?'/':'')),Buffer.from(b+(y.mode==='40000'?'/':''))));return r.put({type:'tree',data:Buffer.concat(ordered.map(([name,e])=>Buffer.concat([Buffer.from(`${e.mode} ${name}\0`),Buffer.from(e.sha,'hex')])))});};return build('');
}
export function commit(r:Repo,files:Files,parents:string[],message:string,tick:number){const tree=writeTree(r,files),identity=`Ada Iversen <adaiversen@example.com> ${1700000000+tick} +0000`;return r.put({type:'commit',data:Buffer.from(`tree ${tree}\n${parents.map(p=>'parent '+p+'\n').join('')}author ${identity}\ncommitter ${identity}\n\n${message}\n`)});}
export function mergeBase(r:Repo,a:string,b:string){
 const distances=(tip:string)=>{const found=new Map<string,number>([[tip,0]]),queue=[tip];for(let i=0;i<queue.length;i++){const id=queue[i];for(const parent of r.parents(id))if(!found.has(parent)){found.set(parent,found.get(id)!+1);queue.push(parent);}}return found;};
 const left=distances(a),right=distances(b),common=[...left.keys()].filter(id=>right.has(id)),older=new Set<string>();
 // Every parent of a common ancestor is also common. Discard these older candidates,
 // rather than returning the first intersection (which can select an older merge base).
 for(const id of common)for(const parent of r.parents(id))older.add(parent);
 return common.filter(id=>!older.has(id)).sort((x,y)=>(left.get(x)!+right.get(x)!)-(left.get(y)!+right.get(y)!)||x.localeCompare(y))[0];
}
const lines=(b:Buffer)=>b.toString('utf8').match(/[^\n]*\n|[^\n]+$/g)||[];
type Edit={start:number,end:number,text:string[]};
// LCS yields line edits in base coordinates, allowing independent edits in one file to merge.
export function edits(a:string[],b:string[]):Edit[]{
 if(a.length*b.length>4000000)return [{start:0,end:a.length,text:b}];
 const dp=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
 let i=0,j=0,current:Edit|undefined;const out:Edit[]=[];while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){current=undefined;i++;j++;continue;}if(!current){current={start:i,end:i,text:[]};out.push(current);}if(j<b.length&&(i===a.length||dp[i][j+1]>=dp[i+1][j]))current.text.push(b[j++]);else current.end=++i;}return out;
}
function mergeText(base:Buffer,a:Buffer,b:Buffer):Buffer|undefined {
 if([base,a,b].some(x=>x.includes(0)))return;
 const original=lines(base),left=edits(original,lines(a)),right=edits(original,lines(b)),all=[...left];
 for(const e of right){let duplicate=false;for(const x of left){if(e.start===x.start&&e.end===x.end&&e.text.join('')===x.text.join('')){duplicate=true;break;}const overlap=Math.max(e.start,x.start)<Math.min(e.end,x.end)||(e.start===e.end&&x.start===x.end&&e.start===x.start)||(e.start===e.end&&e.start>x.start&&e.start<x.end)||(x.start===x.end&&x.start>e.start&&x.start<e.end);if(overlap)return;}if(!duplicate)all.push(e);}
 all.sort((x,y)=>y.start-x.start||y.end-x.end);for(const e of all)original.splice(e.start,e.end-e.start,...e.text);return Buffer.from(original.join(''));
}
const equal=(a?:Entry,b?:Entry)=>a?.sha===b?.sha&&a?.mode===b?.mode;
export function mergeFiles(r:Repo,base:Files,ours:Files,theirs:Files):Files|undefined {
 const result:Files=new Map();for(const path of new Set([...base.keys(),...ours.keys(),...theirs.keys()])){const o=base.get(path),a=ours.get(path),b=theirs.get(path);let e:Entry|undefined;
 if(equal(a,b))e=a;else if(equal(o,a))e=b;else if(equal(o,b))e=a;else {if(!o||!a||!b||a.mode!==b.mode)return;const merged=mergeText(r.objects.get(o.sha)!.data,r.objects.get(a.sha)!.data,r.objects.get(b.sha)!.data);if(!merged)return;e={mode:a.mode,sha:r.put({type:'blob',data:merged})};}if(e)result.set(path,e);}
 for(const path of result.keys()){const parts=path.split('/');parts.pop();while(parts.length){if(result.has(parts.join('/')))return;parts.pop();}}return result;
}
export function changedFiles(r:Repo,base:Files,head:Files){return [...new Set([...base.keys(),...head.keys()])].sort().filter(p=>!equal(base.get(p),head.get(p))).map(filename=>{const a=base.get(filename),b=head.get(filename),before=a?r.objects.get(a.sha)?.data||Buffer.alloc(0):Buffer.alloc(0),after=b?r.objects.get(b.sha)?.data||Buffer.alloc(0):Buffer.alloc(0);const diff=edits(lines(before),lines(after)),additions=diff.reduce((s,e)=>s+e.text.length,0),deletions=diff.reduce((s,e)=>s+e.end-e.start,0);return {sha:b?.sha||a?.sha,filename,status:!a?'added':!b?'removed':'modified',additions,deletions,changes:additions+deletions};});}
