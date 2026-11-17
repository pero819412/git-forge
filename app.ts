import {createServer,type ServerResponse} from 'node:http';
import {Repo} from './git-store.ts';
import {gitHttp} from './git-http.ts';
function json(res:ServerResponse,status:number,body:unknown,headers:Record<string,string>={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(body)+'\n');}
export function createApp(){
 const repos=new Map<string,{git:Repo,meta:any}>();let clock=0;
 return createServer(async(req,res)=>{res.setHeader('x-github-request-id',String(++clock));try{
 const url=new URL(req.url||'/','http://entry'),path=decodeURIComponent(url.pathname),method=req.method;
 if(path==='/healthz'){json(res,200,{ok:true});return;}
 const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const raw=Buffer.concat(chunks);
 const git=/^\/([^/]+)\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(path);
 if(git){const r=repos.get(git[1]+'/'+git[2]);if(!r){json(res,404,{message:'Not Found'});return;}gitHttp(req,res,r.git,git[3],raw,url);return;}
 let data:any={};if(raw.length){try{data=JSON.parse(raw.toString());}catch{json(res,400,{message:'Invalid JSON'});return;}}
 if(path==='/api/v3'||path==='/api/v3/'){json(res,200,{current_user_url:'/api/v3/user',rate_limit_url:'/api/v3/rate_limit'},{'x-oauth-scopes':'repo, read:org'});return;}
 if(path==='/api/v3/meta'){json(res,200,{installed_version:'1.0'});return;}
 if(path==='/api/v3/user/repos'&&method==='POST'){
 const owner='adaiversen',key=owner+'/'+data.name;if(repos.has(key)){json(res,422,{message:'Repository already exists'});return;}
 const meta={id:clock,name:data.name,full_name:key,owner:{login:owner},description:data.description||'',private:!!data.private,default_branch:'main',created_at:new Date(1700000000000+clock*1000).toISOString()};repos.set(key,{git:new Repo(),meta});json(res,201,meta);return;}
 const m=/^\/api\/v3\/repos\/([^/]+)\/([^/]+)$/.exec(path);if(m){const key=m[1]+'/'+m[2],r=repos.get(key);if(r){if(method==='DELETE'){repos.delete(key);res.writeHead(204);res.end();return;}if(method==='PATCH')Object.assign(r.meta,data);json(res,200,r.meta);return;}}
 json(res,404,{message:'Not Found'});
 }catch(e){if(!res.headersSent)json(res,400,{message:e instanceof Error?e.message:'Bad Request'});else res.end();}});
}
