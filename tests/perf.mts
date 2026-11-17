// In-process transport, exact kit workload bodies and request/response bytes.
import {Readable} from 'node:stream';
const {createApp}=await import(process.env.PERF_APP_MODULE||'../app.ts');
import {runBenchmark} from '../../git-forge-kit/program/env/src/bench.ts';
process.env.MAKEFUN_SHOP_TOKEN='test';
const app=createApp();
globalThis.fetch=async(input:any,init:any={})=>new Promise((resolve,reject)=>{
 const u=new URL(String(input));const req:any=Readable.from(init.body?[Buffer.from(init.body)]:[]);req.url=u.pathname+u.search;req.method=init.method||'GET';req.headers=Object.fromEntries(new Headers(init.headers).entries());
 const headers=new Headers();const chunks:Buffer[]=[];const res:any={statusCode:200,headersSent:false,setHeader(k:string,v:any){headers.set(k,String(v));},writeHead(s:number,h:any={}){this.statusCode=s;this.headersSent=true;for(const [k,v]of Object.entries(h))headers.set(k,String(v));},write(b:any){chunks.push(Buffer.from(b));},end(b?:any){if(b)chunks.push(Buffer.from(b));resolve(new Response(this.statusCode===204?null:Buffer.concat(chunks),{status:this.statusCode,headers}));}};
 try{app.emit('request',req,res);}catch(e){reject(e);}
});
console.log(JSON.stringify(await runBenchmark({baseUrl:'http://entry',token:'test',log:console.error}),null,2));
