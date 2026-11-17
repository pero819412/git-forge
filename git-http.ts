import type {IncomingMessage,ServerResponse} from 'node:http';
import {Repo,ZERO,pkt,packets,bands,readPack,writePack} from './git-store.ts';
const flush=Buffer.from('0000'),delim=Buffer.from('0001');
export function gitHttp(req:IncomingMessage,res:ServerResponse,r:Repo,action:string,body:Buffer,url:URL){
 const service=action==='info/refs'?url.searchParams.get('service'):action;
 if(service!=='git-upload-pack'&&service!=='git-receive-pack'){res.writeHead(400);res.end();return;}
 const upload=service==='git-upload-pack',v2=upload&&String(req.headers['git-protocol']).includes('version=2');
 const reply=(parts:Buffer[])=>{res.writeHead(200,{'content-type':`application/x-${service}-${action==='info/refs'?'advertisement':'result'}`,'cache-control':'no-cache'});res.end(Buffer.concat(parts));};
 const refs=()=>{const a:[string,string][]=[];const head=r.refs.get(r.head);if(head)a.push(['HEAD',head]);a.push(...[...r.refs].sort(([a],[b])=>a<b?-1:1));return a;};
 if(action==='info/refs'){
  if(v2){reply([pkt('version 2\n'),pkt('ls-refs=unborn\n'),pkt('fetch=shallow\n'),pkt('object-format=sha1\n'),flush]);return;}
  const caps=upload?`multi_ack_detailed side-band-64k ofs-delta shallow no-progress symref=HEAD:${r.head}`:'report-status side-band-64k delete-refs ofs-delta';
  const a=refs();if(!a.length)a.push(['capabilities^{}',ZERO]);const parts=[pkt(`# service=${service}\n`),flush];a.forEach(([name,id],i)=>{parts.push(pkt(`${id} ${name}${i===0?'\0'+caps:''}\n`));if(name.startsWith('refs/tags/')&&r.peel(id)!==id)parts.push(pkt(`${r.peel(id)} ${name}^{}\n`));});parts.push(flush);reply(parts);return;
 }
 if(!upload){const parsed=packets(body,true),commands=parsed.lines.map(b=>b.toString().split('\0')[0].trim().split(' '));const side=parsed.lines[0]?.toString().includes('side-band-64k');let error='';try{if(body.length>parsed.p)readPack(body.subarray(parsed.p),r);}catch(e){error='invalid pack';}
 const lines=[pkt(`unpack ${error||'ok'}\n`)];for(const [old,next,ref] of commands){let reason=error?'unpacker error':'';if(!ref?.startsWith('refs/')||!/^([0-9a-f]{40})$/.test(old)||!/^([0-9a-f]{40})$/.test(next))reason='invalid command';else if((r.refs.get(ref)||ZERO)!==old)reason='stale old oid';else if(next!==ZERO&&!r.objects.has(next))reason='missing object';else if(next!==ZERO){try{r.closure([next]);}catch{reason='missing object';}if(!reason&&ref.startsWith('refs/heads/')&&old!==ZERO&&!r.ancestor(old,next))reason='non-fast-forward';}
 if(!reason){if(next===ZERO)r.refs.delete(ref);else r.refs.set(ref,next);}lines.push(pkt(reason?`ng ${ref} ${reason}\n`:`ok ${ref}\n`));}lines.push(flush);reply(side?[bands(Buffer.from('Processing objects complete\n'),2),bands(Buffer.concat(lines)),flush]:lines);return;
 }
 const lines=packets(body).lines.map(b=>b.toString().trim());
 if(v2&&lines.includes('command=ls-refs')){const prefixes=lines.filter(l=>l.startsWith('ref-prefix ')).map(l=>l.slice(11));const out:Buffer[]=[];for(const [name,id] of refs()){if(prefixes.length&&!prefixes.some(p=>name.startsWith(p)))continue;let attrs='';if(name==='HEAD'&&lines.includes('symrefs'))attrs+=` symref-target:${r.head}`;if(lines.includes('peel')&&r.peel(id)!==id)attrs+=` peeled:${r.peel(id)}`;out.push(pkt(`${id} ${name}${attrs}\n`));}out.push(flush);reply(out);return;}
 const values=(key:string)=>lines.filter(l=>l.startsWith(key+' ')).map(l=>l.split(' ')[1]);const wants=values('want'),haves=values('have'),oldShallow=new Set(values('shallow'));const depth=Number(values('deepen')[0]||0);if(!wants.length)throw Error('no wants');for(const id of wants)if(!r.objects.has(id))throw Error('unknown want');
 const selected=new Set<string>(),boundary=new Set<string>();const best=new Map<string,number>();const visit=(id:string,d:number)=>{const o=r.objects.get(id);if(!o)throw Error('missing object');if((best.get(id)??Infinity)<=d)return;best.set(id,d);selected.add(id);if(o.type==='commit'){for(const c of r.links(id,false))visit(c,d);const parents=r.parents(id);if(depth&&d>=depth){if(parents.length)boundary.add(id);return;}boundary.delete(id);for(const p of parents)visit(p,d+1);}else for(const c of r.links(id))visit(c,d);};for(const w of wants)visit(w,1);
 // A shallow client's haves include only history up to its declared boundaries.
 const excluded=r.closure(haves,oldShallow);for(const id of excluded)selected.delete(id);
 const pack=writePack([...selected].map(id=>r.objects.get(id)!));const shallow=[...boundary].map(id=>pkt(`shallow ${id}\n`));const unshallow=[...oldShallow].filter(id=>best.has(id)&&!boundary.has(id)).map(id=>pkt(`unshallow ${id}\n`));
 const out:Buffer[]=[];if(v2){if(shallow.length||unshallow.length)out.push(pkt('shallow-info\n'),...shallow,...unshallow,delim);out.push(pkt('packfile\n'),bands(pack),flush);}else{if(depth)out.push(...shallow,...unshallow,flush);out.push(pkt('NAK\n'),bands(pack),flush);}reply(out);
}
