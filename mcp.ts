// MCP is an adapter over the REST dispatcher; it owns no repository state.
type Data=Record<string,any>;
type Reply=(status:number,body:unknown,headers?:Record<string,string>)=>void;
type Dispatch=(method:string,path:string,args:Data,reply:Reply)=>void;
const string={type:'string'},integer={type:'integer',minimum:1};
const location={owner:string,repo:string};
const tools=[
 {name:'create_repo',description:'Create a repository for the authenticated user.',inputSchema:{type:'object',properties:{name:string,description:string,private:{type:'boolean'}},required:['name']}},
 {name:'get_repo',description:'Read a repository.',inputSchema:{type:'object',properties:location,required:['owner','repo']}},
 {name:'create_issue',description:'Create an issue in a repository.',inputSchema:{type:'object',properties:{...location,title:string,body:string,labels:{type:'array',items:string}},required:['owner','repo','title']}},
 {name:'list_issues',description:'List repository issues with filtering and pagination.',inputSchema:{type:'object',properties:{...location,state:{type:'string',enum:['open','closed','all']},sort:{type:'string',enum:['created','updated']},direction:{type:'string',enum:['asc','desc']},page:integer,per_page:integer},required:['owner','repo']}},
 {name:'create_pull_request',description:'Open a pull request between repository branches.',inputSchema:{type:'object',properties:{...location,title:string,head:string,base:string,body:string},required:['owner','repo','title','head','base']}},
 {name:'merge_pull_request',description:'Merge an open pull request.',inputSchema:{type:'object',properties:{...location,pull_number:integer,commit_message:string},required:['owner','repo','pull_number']}},
];
const serverInfo={name:'git-forge',version:'1.0.0'},capabilities={tools:{listChanged:false}};
const record=(value:any):value is Data=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function handleMcp(method:string|undefined,raw:Buffer,send:Reply,dispatch:Dispatch){
 let id:any=null;
 const error=(code:number,message:string,status=200)=>send(status,{jsonrpc:'2.0',id,error:{code,message}});
 const result=(value:unknown)=>send(200,{jsonrpc:'2.0',id,result:value});
 if(method!=='POST'){send(405,{message:'Method Not Allowed'},{allow:'POST'});return;}
 let request:Data;
 try{request=JSON.parse(raw.toString());}catch{error(-32700,'Parse error',400);return;}
 if(!record(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string'||('id'in request&&typeof request.id!=='string'&&typeof request.id!=='number'&&request.id!==null)){error(-32600,'Invalid Request',400);return;}
 id=request.id??null;
 if(!('id'in request)){send(202,null);return;}
 const params=request.params??{};
 if(!record(params)){error(-32602,'Invalid params');return;}
 switch(request.method){
 case 'server/discover':result({serverInfo,capabilities,supportedVersions:['2026-07-28','2025-11-25']});return;
 case 'initialize':result({protocolVersion:'2025-11-25',capabilities,serverInfo});return;
 case 'ping':result({});return;
 case 'tools/list':result({tools});return;
 case 'tools/call':break;
 default:error(-32601,'Method not found');return;
 }
 const tool=tools.find(t=>t.name===params.name);
 if(!tool){error(-32602,'Unknown tool');return;}
 const args=params.arguments;
 if(!record(args)){error(-32602,'Missing arguments');return;}
 const schema=tool.inputSchema;
 for(const key of schema.required)if(!(key in args)){error(-32602,'Missing argument: '+key);return;}
 for(const [key,value]of Object.entries(args)){
 const prop=(schema.properties as Data)[key];if(!prop)continue;
 if((prop.type==='integer'?(typeof value!=='number'||!Number.isSafeInteger(value)||value<1):prop.type==='array'?(!Array.isArray(value)||value.some(v=>typeof v!=='string')):typeof value!==prop.type)||(prop.enum&&!prop.enum.includes(value))){error(-32602,'Invalid argument: '+key);return;}
 }
 const repo='/api/v3/repos/'+encodeURIComponent(args.owner)+'/'+encodeURIComponent(args.repo);
 let verb='GET',path=repo;
 switch(tool.name){
 case 'create_repo':verb='POST';path='/api/v3/user/repos';break;
 case 'create_issue':verb='POST';path=repo+'/issues';break;
 case 'list_issues':{const query=new URLSearchParams();for(const key of ['state','sort','direction','page','per_page'])if(args[key]!==undefined)query.set(key,String(args[key]));path=repo+'/issues?'+query;break;}
 case 'create_pull_request':verb='POST';path=repo+'/pulls';break;
 case 'merge_pull_request':verb='PUT';path=repo+'/pulls/'+args.pull_number+'/merge';break;
 }
 dispatch(verb,path,args,(status,body)=>result({content:[{type:'text',text:JSON.stringify(body)}],isError:status>=400}));
}
