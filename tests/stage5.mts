import assert from 'node:assert/strict';
import {Repo,pkt,oid,writePack,readPack} from '../git-store.ts';
import {gitHttp} from '../git-http.ts';
const r=new Repo();
const blob=r.put({type:'blob',data:Buffer.from('hello')});
const tree=r.put({type:'tree',data:Buffer.concat([Buffer.from('100644 file\0'),Buffer.from(blob,'hex')])});
const parent={type:'commit',data:Buffer.from(`tree ${tree}\n\nparent\n`)};
const parentId=oid(parent);
const child=r.put({type:'commit',data:Buffer.from(`tree ${tree}\nparent ${parentId}\n\nchild\n`)});
// Failed traversal must never mark its partial graph as validated.
assert.throws(()=>r.validate(child),/missing object/);
assert.throws(()=>r.validate(child),/missing object/);
r.put(parent);r.validate(child);r.validate(child);
// New commits can reuse a fully checked history without traversing it again.
const next=r.put({type:'commit',data:Buffer.from(`tree ${tree}\nparent ${child}\n\nnext\n`)});
const links=r.links.bind(r);let visits=0;
r.links=(id,parents=true)=>{visits++;return links(id,parents);};
r.validate(next);assert.equal(visits,1);
r.refs.set(r.head,next);
const fetch=(depth:number,v2=false)=>{
 const body=Buffer.concat([...(v2?[pkt('command=fetch\n'),Buffer.from('0001')]:[]),pkt(`want ${next}\n`),pkt(`deepen ${depth}\n`),pkt('done\n'),Buffer.from('0000')]);
 let bytes:Buffer|undefined;
 gitHttp({headers:{'git-protocol':v2?'version=2':''}} as any,{writeHead(){},end(b:Buffer){bytes=b;}} as any,r,'git-upload-pack',body,new URL('http://entry'));
 return bytes!;
};
for(const v2 of [false,true])for(const depth of [1,2,0]){
 const first=fetch(depth,v2),cache=r.fetchCache;
 assert.ok(cache);assert.deepEqual(fetch(depth,v2),first);assert.equal(r.fetchCache,cache);
 r.put({type:'blob',data:Buffer.from(`unrelated ${v2} ${depth}`)});
 assert.deepEqual(fetch(depth,v2),first);assert.notEqual(r.fetchCache,cache);
}
// Pack failure remains atomic; successful packs preserve canonical IDs.
const pack=writePack([parent]);const dest=new Repo();const bad=Buffer.from(pack);bad[bad.length-1]^=1;
assert.throws(()=>readPack(bad,dest));assert.equal(dest.objects.size,0);
readPack(pack,dest);assert.ok(dest.objects.has(parentId));
console.log('STAGE 5 CACHE AND VALIDATION CHECKS PASSED');
