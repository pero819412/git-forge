import {createServer,type ServerResponse} from 'node:http';
import {Repo} from './git-store.ts';
import {gitHttp} from './git-http.ts';
import {resolve,treeOf,directorySha,commit,mergeBase,mergeFiles,changedFiles} from './git-rest.ts';
function json(res:ServerResponse,status:number,body:unknown,headers:Record<string,string>={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers});res.end(status===204?undefined:JSON.stringify(body)+'\n');}
type RecordData=Record<string,any>;
type Repository={git:Repo,meta:RecordData,labels:Map<string,RecordData>,issues:Map<number,RecordData>,pulls:Map<number,RecordData>,comments:Map<number,RecordData[]>,nextNumber:number};
export function createApp(){
 const repos=new Map<string,Repository>();let clock=0;
 const now=()=>new Date(1700000000000+clock*1000).toISOString();
 const owner='adaiversen',user={login:owner,id:1,type:'User'};
 return createServer(async(req,res)=>{res.setHeader('x-github-request-id',String(++clock));try{
 const url=new URL(req.url||'/','http://entry'),path=decodeURIComponent(url.pathname),method=req.method;
 const send=(status:number,body:unknown,headers:Record<string,string>={})=>json(res,status,body,headers);
 const error=(status=404,message='Not Found')=>send(status,{message});
 const page=(items:unknown[])=>{const per=Math.min(100,Math.max(1,Number(url.searchParams.get('per_page'))||30)),n=Math.max(1,Number(url.searchParams.get('page'))||1),headers:Record<string,string>={};if(n*per<items.length){const next=new URL(url.pathname+url.search,'http://'+(req.headers.host||'entry'));next.searchParams.set('page',String(n+1));headers.link=`<${next}>; rel="next"`;}send(200,items.slice((n-1)*per,n*per),headers);};
 if(path==='/healthz'){send(200,{ok:true});return;}
 const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const raw=Buffer.concat(chunks);
 const git=/^\/([^/]+)\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(path);
 if(git){const r=repos.get(git[1]+'/'+git[2]);if(!r){error();return;}gitHttp(req,res,r.git,git[3],raw,url);return;}
 const token=/^(?:Bearer|token) (.+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!token||(process.env.MAKEFUN_SHOP_TOKEN&&token!==process.env.MAKEFUN_SHOP_TOKEN)){error(401,'Bad credentials');return;}
 let data:RecordData={};if(raw.length){try{data=JSON.parse(raw.toString());if(!data||typeof data!=='object'||Array.isArray(data))throw Error();}catch{error(400,'Invalid JSON');return;}}
 if((path==='/api/v3'||path==='/api/v3/')&&method==='GET'){send(200,{current_user_url:'/api/v3/user',current_user_repositories_url:'/api/v3/user/repos',repository_url:'/api/v3/repos/{owner}/{repo}',rate_limit_url:'/api/v3/rate_limit'},{'x-oauth-scopes':'repo, read:org'});return;}
 if(path==='/api/v3/meta'&&method==='GET'){send(200,{installed_version:'1.0'});return;}
 if(path==='/api/v3/user'&&method==='GET'){send(200,user);return;}
 if(path==='/api/v3/user/repos'){
 if(method==='GET'){page([...repos.values()].map(r=>r.meta));return;}
 if(method==='POST'){
 if(typeof data.name!=='string'||!data.name||data.name.includes('/')){error(422,'Invalid repository name');return;}
 const key=owner+'/'+data.name;if(repos.has(key)){error(422,'Repository already exists');return;}
 const meta={id:clock,node_id:`Repository:${clock}`,name:data.name,full_name:key,owner:user,description:data.description||'',private:!!data.private,default_branch:'main',fork:false,archived:false,disabled:false,created_at:now(),updated_at:now(),pushed_at:null,html_url:`/${key}`,url:`/api/v3/repos/${key}`,clone_url:`/${key}.git`,size:0,open_issues_count:0};
 repos.set(key,{git:new Repo(),meta,labels:new Map(),issues:new Map(),pulls:new Map(),comments:new Map(),nextNumber:1});send(201,meta);return;
 }}
 const m=/^\/api\/v3\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(path);
 if(!m||m[1]!==owner){error();return;}const key=m[1]+'/'+m[2],r=repos.get(key);if(!r){error();return;}const route=m[3]||'',g=r.git;
 if(!route){
 if(method==='DELETE'){repos.delete(key);send(204,null);return;}
 if(method==='PATCH'){for(const field of ['description','private','default_branch','archived'])if(data[field]!==undefined)r.meta[field]=data[field];g.head='refs/heads/'+r.meta.default_branch;r.meta.updated_at=now();send(200,r.meta);return;}
 if(method==='GET'){send(200,r.meta);return;}
 }
 if(route==='git/refs'&&method==='POST'){
 if(typeof data.ref!=='string'||!data.ref.startsWith('refs/heads/')||g.refs.has(data.ref)||g.objects.get(data.sha)?.type!=='commit'){error(422,'Invalid reference');return;}g.refs.set(data.ref,data.sha);send(201,{ref:data.ref,object:{type:'commit',sha:data.sha}});return;
 }
 if(route==='branches'&&method==='GET'){page([...g.refs].filter(([ref])=>ref.startsWith('refs/heads/')).sort(([a],[b])=>a.localeCompare(b)).map(([ref,sha])=>({name:ref.slice(11),commit:{sha},protected:false})));return;}
 if(route==='commits'&&method==='GET'){
 const tip=resolve(g,url.searchParams.get('sha')||r.meta.default_branch);if(!tip){if(g.refs.size)error();else send(200,[]);return;}
 const seen=new Set<string>(),queue=[tip],items:unknown[]=[];while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);const raw=g.objects.get(id)!.data.toString(),split=raw.indexOf('\n\n');items.push({sha:id,commit:{message:raw.slice(split+2).replace(/\n$/,''),tree:{sha:raw.match(/^tree (\w+)/)?.[1]}},parents:g.parents(id).map(sha=>({sha}))});queue.push(...g.parents(id));}page(items);return;
 }
 if(route==='contents'||route.startsWith('contents/')){
 const file=route.slice(9).replace(/\/$/,''),branch=data.branch||url.searchParams.get('ref')||r.meta.default_branch,tip=resolve(g,branch),files=treeOf(g,tip),entry=files.get(file);
 const shape=(p:string,e:{sha:string,mode:string})=>{const blob=g.objects.get(e.sha)!.data;return {type:'file',name:p.split('/').pop(),path:p,sha:e.sha,size:blob.length,encoding:'base64',content:blob.toString('base64')};};
 if(method==='GET'){
 if(entry){send(200,shape(file,entry));return;}
 const prefix=file?file+'/':'',children=new Map<string,unknown>();for(const [p,e]of files){if(!p.startsWith(prefix))continue;const rest=p.slice(prefix.length),slash=rest.indexOf('/');if(slash<0)children.set(rest,shape(p,e));else {const name=rest.slice(0,slash);children.set(name,{type:'dir',name,path:prefix+name,sha:directorySha(g,tip!,prefix+name),size:0});}}
 if(children.size||(!file&&tip)){send(200,[...children].sort(([a],[b])=>a.localeCompare(b)).map(([,e])=>e));return;}error();return;
 }
 if(method==='PUT'||method==='DELETE'){
 if(!file||file.split('/').some(p=>!p||p==='.'||p==='..')){error(422,'Invalid path');return;}
 if(!tip&&(g.refs.size||branch!==r.meta.default_branch)){error(404,'Branch not found');return;}
 if(method==='DELETE'&&!entry){error();return;}
 if((entry&&data.sha!==entry.sha)||(!entry&&data.sha)){error(409,'sha does not match');return;}
 if(method==='PUT'&&typeof data.content!=='string'){error(422,'Missing content');return;}
 let content:unknown=null;if(method==='DELETE')files.delete(file);else{const sha=g.put({type:'blob',data:Buffer.from(data.content,'base64')}),e={sha,mode:entry?.mode||'100644'};files.set(file,e);content=shape(file,e);}
 const id=commit(g,files,tip?[tip]:[],data.message||'Update '+file,clock);g.refs.set('refs/heads/'+branch,id);r.meta.pushed_at=now();send(method==='PUT'&&!entry?201:200,{content,commit:{sha:id,parents:tip?[{sha:tip}]:[]}});return;
 }
 }
 if(route==='labels'){
 if(method==='POST'){if(typeof data.name!=='string'||!data.name){error(422,'Invalid label');return;}const label={id:clock,name:data.name,color:data.color||'ededed',description:data.description||''};r.labels.set(data.name,label);send(201,label);return;}
 if(method==='GET'){page([...r.labels.values()]);return;}
 }
 const issueRoute=/^issues(?:\/(\d+)(?:\/(comments))?)?$/.exec(route);
 if(issueRoute){const number=Number(issueRoute[1]),issue=r.issues.get(number)||r.pulls.get(number);
 if(!issueRoute[1]){
 if(method==='POST'){
 const labels=data.labels||[];if(typeof data.title!=='string'||!data.title||!Array.isArray(labels)||labels.some((name:unknown)=>typeof name!=='string'||!r.labels.has(name))){error(422,'Validation Failed');return;}
 const n=r.nextNumber++,item={id:clock,number:n,title:data.title,body:data.body||'',state:'open',labels:labels.map((name:string)=>r.labels.get(name)),user,created_at:now(),updated_at:now(),closed_at:null,comments:0};r.issues.set(n,item);r.meta.open_issues_count++;send(201,item);return;
 }
 if(method==='GET'){const state=url.searchParams.get('state')||'open',sort=url.searchParams.get('sort')==='updated'?'updated_at':'created_at',dir=url.searchParams.get('direction')==='asc'?1:-1;page([...r.issues.values()].filter(i=>state==='all'||i.state===state).sort((a,b)=>dir*(a[sort].localeCompare(b[sort])||a.number-b.number)));return;}
 }else if(!issue){error();return;}
 else if(issueRoute[2]){
 if(method==='POST'){if(typeof data.body!=='string'){error(422,'Invalid comment');return;}const comment={id:clock,body:data.body,user,created_at:now(),updated_at:now()},comments=r.comments.get(number)||[];comments.push(comment);r.comments.set(number,comments);issue.comments=(issue.comments||0)+1;send(201,comment);return;}
 if(method==='GET'){page(r.comments.get(number)||[]);return;}
 }else{
 if(method==='GET'){send(200,issue);return;}
 if(method==='PATCH'){if(data.state!==undefined&&!['open','closed'].includes(data.state)){error(422,'Invalid state');return;}for(const field of ['title','body','state'])if(data[field]!==undefined)issue[field]=data[field];issue.updated_at=now();issue.closed_at=issue.state==='closed'?now():null;send(200,issue);return;}
 }
 }
 const prRoute=/^pulls(?:\/(\d+)(?:\/(files|merge))?)?$/.exec(route);
 if(prRoute){const number=Number(prRoute[1]),pull=r.pulls.get(number);
 if(!prRoute[1]){
 if(method==='POST'){
 const head=typeof data.head==='string'?data.head.split(':').pop():'',base=data.base||r.meta.default_branch,headSha=resolve(g,head),baseSha=resolve(g,base);if(!headSha||!baseSha||!data.title){error(422,'Invalid pull request');return;}
 const n=r.nextNumber++,item={id:clock,number:n,title:data.title,body:data.body||'',state:'open',head:{ref:head,sha:headSha},base:{ref:base,sha:baseSha},user,labels:[],created_at:now(),updated_at:now(),closed_at:null,merged:false,merged_at:null,merge_commit_sha:null};r.pulls.set(n,item);send(201,item);return;
 }
 if(method==='GET'){const state=url.searchParams.get('state')||'open';page([...r.pulls.values()].filter(p=>state==='all'||p.state===state).sort((a,b)=>(url.searchParams.get('direction')==='asc'?1:-1)*(a.number-b.number)));return;}
 }else if(!pull){error();return;}
 else if(prRoute[2]==='files'&&method==='GET'){
 const head=resolve(g,pull.head.ref)||pull.head.sha,base=resolve(g,pull.base.ref)||pull.base.sha;page(changedFiles(g,treeOf(g,mergeBase(g,base,head)),treeOf(g,head)));return;
 }else if(prRoute[2]==='merge'){
 if(method==='GET'){send(pull.merged?204:404,pull.merged?null:{message:'Not Found'});return;}
 if(method==='PUT'){
 if(pull.state!=='open'){error(405,'Pull Request is not mergeable');return;}
 const base=resolve(g,pull.base.ref)!,head=resolve(g,pull.head.ref)!;if(!base||!head){error(405,'Pull Request is not mergeable');return;}
 const files=mergeFiles(g,treeOf(g,mergeBase(g,base,head)),treeOf(g,base),treeOf(g,head));if(!files){pull.mergeable=false;pull.mergeable_state='dirty';send(405,{message:'Pull Request is not mergeable',merged:false});return;}
 const sha=commit(g,files,[base,head],data.commit_message||`Merge pull request #${number} from ${pull.head.ref}\n\n${pull.title}`,clock);g.refs.set('refs/heads/'+pull.base.ref,sha);Object.assign(pull,{state:'closed',merged:true,merged_at:now(),closed_at:now(),updated_at:now(),merge_commit_sha:sha,mergeable:true,mergeable_state:'clean'});
 if(pull.base.ref===r.meta.default_branch){let text=pull.body+'\n'+pull.title;const seen=new Set<string>(),queue=[head];while(queue.length){const id=queue.pop()!;if(seen.has(id)||id===mergeBase(g,base,head))continue;seen.add(id);text+='\n'+g.objects.get(id)!.data.toString().split('\n\n').slice(1).join('\n\n');queue.push(...g.parents(id));}for(const match of text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)){const linked=r.issues.get(Number(match[1]));if(linked)Object.assign(linked,{state:'closed',closed_at:now(),updated_at:now()});}}
 send(200,{sha,merged:true,message:'Pull Request successfully merged'});return;
 }
 }else if(!prRoute[2]&&method==='GET'){send(200,pull);return;}
 }
 error();
 }catch(e){if(!res.headersSent)json(res,400,{message:e instanceof Error?e.message:'Bad Request'});else res.end();}});
}
