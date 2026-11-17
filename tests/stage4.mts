import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createApp} from '../app.ts';
import {GRAPHQL_CHECKS,configureGraphQLGit} from '../../git-forge-kit/sdk/conformance/checks-graphql.ts';
import {MCP_CHECKS} from '../../git-forge-kit/sdk/conformance/checks-mcp.ts';
import {GIT_CHECKS} from '../../git-forge-kit/sdk/conformance/checks-git.ts';
import {buildScenario} from '../../git-forge-kit/sdk/conformance/wire.ts';
import {restChecks,restProtocolChecks} from '../../git-forge-kit/sdk/conformance/checks-rest.ts';
process.env.MAKEFUN_SHOP_TOKEN='test';
const app=createApp();
const replayHash=createHash('sha256');
globalThis.fetch=async(input:any,init:any={})=>new Promise((resolve,reject)=>{
 const u=new URL(String(input));const req:any=Readable.from(init.body?[Buffer.from(init.body)]:[]);req.url=u.pathname+u.search;req.method=init.method||'GET';req.headers=Object.fromEntries(new Headers(init.headers).entries());
 const headers=new Headers();const chunks:Buffer[]=[];const res:any={statusCode:200,headersSent:false,setHeader(k:string,v:any){headers.set(k,String(v));},writeHead(s:number,h:any={}){this.statusCode=s;this.headersSent=true;for(const [k,v]of Object.entries(h))headers.set(k,String(v));},write(b:any){chunks.push(Buffer.from(b));},end(b?:any){if(b)chunks.push(Buffer.from(b));replayHash.update(String(this.statusCode));replayHash.update(JSON.stringify([...headers]));replayHash.update(Buffer.concat(chunks));resolve(new Response(this.statusCode===204?null:Buffer.concat(chunks),{status:this.statusCode,headers}));}};
 try{app.emit('request',req,res);}catch(e){reject(e);}
});
const api=async(method:string,path:string,body?:any)=>{const res=await fetch('http://entry/api/v3'+path,{method,headers:{authorization:'Bearer test'},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();if(res.status>=400)throw Error(JSON.stringify(data));return data;};
configureGraphQLGit({pushBranch:async(r:any)=>{try{const path='/repos/'+r.owner+'/'+r.repo;if(r.from){const branches=await api('GET',path+'/branches');await api('POST',path+'/git/refs',{ref:'refs/heads/'+r.branch,sha:branches.find((b:any)=>b.name===r.from).commit.sha});}await api('PUT',path+'/contents/'+r.path,{branch:r.branch,message:r.message,content:Buffer.from(r.content).toString('base64')});return null;}catch(e){return String(e);}}});
let passed=0;for(const check of [...GRAPHQL_CHECKS,...GIT_CHECKS,...restChecks(),...restProtocolChecks(),...MCP_CHECKS]){const result=await check.fn({baseUrl:'http://entry',token:'test',scenario:buildScenario(),signal:new AbortController().signal,deadlineMs:Infinity,timeoutMs:15000,log:()=>{}});if(result.ok)passed++;console.log(check.id,JSON.stringify(result));}console.log('TOTAL PASSED',passed,'/ 120');

// Additional wire and identity cases beyond the twenty conformance checks.
const assert=(ok:any,message:string)=>{if(!ok)throw Error(message);};
const gql=async(body:any,path='/api/graphql')=>{const r=await fetch('http://entry'+path,{method:'POST',headers:{authorization:'Bearer test'},body:typeof body==='string'?body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
for(const query of ['{ viewer { login }','{ viewer { noSuchField } }','{viewer(unknown:1){login}}','{repository(owner:3,name:"x"){id}}','query A {viewer{login}} query B {viewer{login}}']){const r=await gql({query});assert(r.status===200&&r.body.errors?.[0]?.message&&!('data'in r.body),'hard errors omit data');}
assert((await gql('{')).status===400,'malformed JSON is HTTP 400');
assert((await gql({query:'{viewer{login}}'},'/graphql')).body.data.viewer.login==='adaiversen','short path alias');
const repo=await api('POST','/user/repos',{name:'batch-identities'});
const repositoryId=Buffer.from('Repository:'+repo.id).toString('base64');
const op={query:'mutation($input:CreateIssueInput!){createIssue(input:$input){issue{id number}}}',variables:{input:{repositoryId,title:'batched'}}};
const batch=(await gql([op,op])).body;
const left=batch[0].data.createIssue.issue,right=batch[1].data.createIssue.issue;
assert(left.id!==right.id&&left.number!==right.number,'batched creations have distinct identities');
const n=(await gql({query:'query($id:ID!){node(id:$id){id ... on Issue {title}}}',variables:{id:right.id}})).body;
assert(n.data.node.id===right.id&&n.data.node.title==='batched','issue node resolves');
const selected=(await gql({query:'query A {viewer{login}} query B {user(login:"adaiversen"){login}}',operationName:'B'})).body;
assert(selected.data.user.login==='adaiversen','operationName selection');
const page=(await gql({query:'query($o:String!,$n:String!){repository(owner:$o,name:$n){issues(first:1){edges{cursor node{id}} pageInfo{endCursor hasNextPage}}}}',variables:{o:repo.owner.login,n:repo.name}})).body.data.repository.issues;
assert(page.edges.length===1&&page.edges[0].cursor===page.pageInfo.endCursor&&page.pageInfo.hasNextPage,'connection edges and pageInfo agree');
console.log('EXTRA WIRE CHECKS PASSED');
if(passed!==120)throw Error('Conformance regression');
console.log('REPLAY SHA256',replayHash.digest('hex'));
