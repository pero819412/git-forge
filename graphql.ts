// Small GraphQL executor for the forge's declared schema. Domain writes use REST dispatch.
type Obj=Record<string,any>;
type Field={name:string,key:string,args:Obj,children:Field[],on?:string};
type Value={variable:string}|{literal:any};
class Parser {
 tokens:string[]=[]; p=0;
 constructor(source:string){const re=/\s+|#[^\n]*|,|\.\.\.|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|[_A-Za-z][_0-9A-Za-z]*|[!$():=@\[\]{}]/gy;let pos=0;while(pos<source.length){re.lastIndex=pos;const m=re.exec(source);if(!m)throw Error('Syntax error in GraphQL document');pos=re.lastIndex;if(!/^(?:\s|#|,)/.test(m[0]))this.tokens.push(m[0]);}}
 peek(){return this.tokens[this.p];}
 take(expected?:string):string {const t=this.tokens[this.p++];if(t===undefined||(expected&&t!==expected))throw Error(`Expected ${expected||'token'}, found ${t||'end of document'}`);return t;}
 name(){const t=this.take();if(!/^[_A-Za-z]\w*$/.test(t))throw Error('Expected a name');return t;}
 value():Value {if(this.peek()==='$'){this.take();return {variable:this.name()};}if(this.peek()==='{'){this.take();const o:Obj={};while(this.peek()!=='}'){const n=this.name();this.take(':');o[n]=this.value();}this.take('}');return {literal:o};}if(this.peek()==='['){this.take();const a=[];while(this.peek()!==']')a.push(this.value());this.take(']');return {literal:a};}const t=this.take();return {literal:t.startsWith('"')?JSON.parse(t):t==='null'?null:t==='true'?true:t==='false'?false:/^-?\d/.test(t)?Number(t):t};}
 selection():Field[]{this.take('{');const out:Field[]=[];while(this.peek()!=='}'){if(this.peek()==='...'){this.take();this.take('on');const on=this.name();out.push({name:'...',key:'...',args:{},children:this.selection(),on});continue;}let name=this.name(),key=name;if(this.peek()===':'){this.take();name=this.name();}const args:Obj={};if(this.peek()==='('){this.take();while(this.peek()!==')'){const n=this.name();this.take(':');args[n]=this.value();}this.take(')');}const children=this.peek()==='{'?this.selection():[];out.push({name,key,args,children});}this.take('}');if(!out.length)throw Error('Empty selection set');return out;}
 document(){const ops:{type:string,name?:string,defaults:Obj,required:string[],fields:Field[]}[]=[];while(this.peek()){let type='query',name:string|undefined;const defaults:Obj={},required:string[]=[];if(this.peek()!=='{'){type=this.name();if(!['query','mutation'].includes(type))throw Error('Unsupported operation');if(this.peek()!=='('&&this.peek()!=='{')name=this.name();if(this.peek()==='('){this.take();while(this.peek()!==')'){this.take('$');const n=this.name();this.take(':');let last='';while(this.peek()&&!['$','=',')'].includes(this.peek()))last=this.take();if(last==='!')required.push(n);if(this.peek()==='='){this.take();defaults[n]=this.value();}}this.take(')');}}ops.push({type,name,defaults,required,fields:this.selection()});}if(!ops.length)throw Error('Missing operation');return ops;}
}
const schema:Record<string,Record<string,string>>={
 Query:{viewer:'User',user:'User',repository:'Repository',node:'Node',__type:'__Type',__schema:'__Schema'},
 Mutation:{createIssue:'CreateIssuePayload',closeIssue:'CloseIssuePayload',createPullRequest:'CreatePullRequestPayload',mergePullRequest:'MergePullRequestPayload',addComment:'AddCommentPayload'},
 User:{id:'',databaseId:'',login:'',name:'',url:''},Repository:{id:'',databaseId:'',name:'',nameWithOwner:'',description:'',owner:'User',defaultBranchRef:'Ref',viewerPermission:'',hasIssuesEnabled:'',issue:'Issue',issues:'IssueConnection',pullRequests:'PullRequestConnection',pullRequest:'PullRequest'},
 Issue:{id:'',databaseId:'',number:'',title:'',body:'',state:'',author:'User',comments:'CommentConnection',createdAt:'',updatedAt:''},
 PullRequest:{id:'',databaseId:'',number:'',title:'',body:'',state:'',merged:'',headRefName:'',baseRefName:'',mergeable:'',files:'FileConnection',author:'User',comments:'CommentConnection'},
 IssueComment:{id:'',body:'',author:'User'},Ref:{name:''},PullRequestChangedFile:{path:'',additions:'',deletions:'',changeType:''},
 PageInfo:{hasNextPage:'',hasPreviousPage:'',startCursor:'',endCursor:''},
 CreateIssuePayload:{issue:'Issue',clientMutationId:''},CloseIssuePayload:{issue:'Issue',clientMutationId:''},CreatePullRequestPayload:{pullRequest:'PullRequest',clientMutationId:''},MergePullRequestPayload:{pullRequest:'PullRequest',clientMutationId:''},AddCommentPayload:{commentEdge:'CommentEdge',clientMutationId:''},
 __Type:{name:'',kind:'',fields:'__Field',enumValues:'__EnumValue'},__Field:{name:''},__EnumValue:{name:''},__Schema:{queryType:'__Type',mutationType:'__Type',types:'__Type'},Node:{id:''}
};
for(const [prefix,node]of Object.entries({Issue:'Issue',PullRequest:'PullRequest',Comment:'IssueComment',File:'PullRequestChangedFile'})){schema[prefix+'Connection']={nodes:node,edges:prefix+'Edge',pageInfo:'PageInfo',totalCount:''};schema[prefix+'Edge']={node,cursor:''};}
const enums:Record<string,string[]>={IssueState:['OPEN','CLOSED'],PullRequestState:['OPEN','CLOSED','MERGED'],MergeableState:['MERGEABLE','CONFLICTING','UNKNOWN'],PullRequestMergeMethod:['MERGE','SQUASH','REBASE'],RepositoryPermission:['ADMIN','MAINTAIN','WRITE','TRIAGE','READ'],SearchType:['ISSUE','REPOSITORY','USER'],IssueOrderField:['CREATED_AT','UPDATED_AT','COMMENTS'],OrderDirection:['ASC','DESC']};
// Argument declarations also reject bad arguments before any mutation can write.
const argumentsByField:Record<string,Record<string,string>>={
 'Query.repository':{owner:'String!',name:'String!'},'Query.user':{login:'String!'},'Query.node':{id:'ID!'},'Query.__type':{name:'String!'},
 'Repository.issue':{number:'Int!'},'Repository.pullRequest':{number:'Int!'},
 'Repository.issues':{first:'Int',after:'String',states:'IssueStates',orderBy:'IssueOrder'},
 'Repository.pullRequests':{first:'Int',after:'String',states:'PullStates'},
 'PullRequest.files':{first:'Int',after:'String'},'Issue.comments':{first:'Int',after:'String'},'PullRequest.comments':{first:'Int',after:'String'},
 '__Type.fields':{includeDeprecated:'Boolean'},'__Type.enumValues':{includeDeprecated:'Boolean'},
 ...Object.fromEntries(Object.keys(schema.Mutation).map(name=>['Mutation.'+name,{input:name+'Input!'}]))
};
const inputs:Record<string,Record<string,string>>={
 createIssueInput:{repositoryId:'ID!',title:'String!',body:'String',clientMutationId:'String'},closeIssueInput:{issueId:'ID!',clientMutationId:'String'},
 createPullRequestInput:{repositoryId:'ID!',title:'String!',body:'String',baseRefName:'String!',headRefName:'String!',clientMutationId:'String'},
 mergePullRequestInput:{pullRequestId:'ID!',mergeMethod:'PullRequestMergeMethod',commitBody:'String',commitHeadline:'String',clientMutationId:'String'},
 addCommentInput:{subjectId:'ID!',body:'String!',clientMutationId:'String'},IssueOrder:{field:'IssueOrderField!',direction:'OrderDirection!'}
};
function checkValue(type:string,value:any,label:string){
 if(value==null){if(type.endsWith('!'))throw Error('Missing required '+label);return;}
 type=type.replace(/!$/,'');
 if(inputs[type]){if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid '+label);checkArguments(inputs[type],value,label);return;}
 if(type==='IssueStates'||type==='PullStates'){for(const state of Array.isArray(value)?value:[value])checkValue(type==='IssueStates'?'IssueState':'PullRequestState',state,label);return;}
 const valid=type==='Int'?Number.isInteger(value):type==='Boolean'?typeof value==='boolean':type==='String'||type==='ID'?typeof value==='string':enums[type]?enums[type].includes(value):false;
 if(!valid)throw Error('Invalid '+label+' (expected '+type+')');
}
function checkArguments(declarations:Record<string,string>,values:Obj,label:string){
 for(const key of Object.keys(values))if(!(key in declarations))throw Error('Unknown argument '+label+'.'+key);
 for(const [key,type]of Object.entries(declarations))checkValue(type,values[key],label+'.'+key);
}
const b64=(s:string)=>Buffer.from(s).toString('base64');
const wrap=(type:string,data:Obj)=>({__type:type,...data});
function evaluate(value:any,vars:Obj):any {if(value&&typeof value==='object'){if('variable'in value){if(!(value.variable in vars))throw Error(`Missing variable $${value.variable}`);return vars[value.variable];}if('literal'in value)return evaluateLiteral(value.literal,vars);}return value;}
function evaluateLiteral(value:any,vars:Obj):any {if(Array.isArray(value))return value.map(v=>evaluate(v,vars));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,evaluate(v,vars)]));return value;}
export function executeGraphQL(body:any,repos:Map<string,any>,user:Obj,dispatch:(method:string,url:URL,data:Obj,reply:(status:number,body:any)=>void)=>void,tick:()=>void):any {
 const rest=(method:string,path:string,data:Obj={})=>{let answer:any;dispatch(method,new URL(path,'http://entry'),data,(status,body)=>{if(status>=400)throw Error(body?.message||'Request failed');answer=body;});return answer;};
 const repoNode=(r:any)=>wrap('Repository',{r});
 const itemNode=(type:string,r:any,item:any)=>item?wrap(type,{r,item}):null;
 const idOf=(type:string,item:Obj)=>b64(type+':'+item.id);
 const find=(id:any)=>{if(typeof id!=='string')throw Error('Invalid node ID');const decoded=Buffer.from(id,'base64').toString();if(b64(decoded)!==id)throw Error('Invalid node ID');const [type,n]=decoded.split(':');for(const r of repos.values()){if(type==='Repository'&&String(r.meta.id)===n)return repoNode(r);for(const [t,items]of [['Issue',r.issues],['PullRequest',r.pulls]] as const)if(type===t)for(const item of items.values())if(String(item.id)===n)return itemNode(t,r,item);if(type==='IssueComment')for(const comments of r.comments.values())for(const item of comments)if(String(item.id)===n)return itemNode(type,r,item);}return null;};
 const connection=(items:any[],a:Obj)=>{let start=0;if(a.after!=null){const decoded=Buffer.from(a.after,'base64').toString();if(!/^cursor:\d+$/.test(decoded)||b64(decoded)!==a.after)throw Error('Invalid cursor');start=Number(decoded.slice(7))+1;}const first=a.first??100;if(!Number.isInteger(first)||first<0||first>100)throw Error('first must be an integer between 0 and 100');const nodes=items.slice(start,start+first),cursor=(i:number)=>b64('cursor:'+i);return {nodes,edges:nodes.map((node,i)=>({node,cursor:cursor(start+i)})),totalCount:items.length,pageInfo:{hasNextPage:start+nodes.length<items.length,hasPreviousPage:start>0,startCursor:nodes.length?cursor(start):null,endCursor:nodes.length?cursor(start+nodes.length-1):null}};};
 const resolve=(type:string,obj:Obj,name:string,a:Obj):any=>{
 if(name==='__typename')return obj.__type||type;
 if(type==='Query'){
 if(name==='viewer')return wrap('User',user);if(name==='user')return a.login===user.login?wrap('User',user):null;
 if(name==='repository'){const r=repos.get(a.owner+'/'+a.name);return r?repoNode(r):null;}if(name==='node')return find(a.id);
 if(name==='__type')return schema[a.name]||enums[a.name]?{name:a.name,kind:enums[a.name]?'ENUM':'OBJECT',fields:schema[a.name]?Object.keys(schema[a.name]).map(name=>({name})):null,enumValues:enums[a.name]?.map(name=>({name}))||null}:null;
 if(name==='__schema')return {queryType:{name:'Query'},mutationType:{name:'Mutation'},types:[...Object.keys(schema),...Object.keys(enums)].map(name=>resolve('Query',{},'__type',{name}))};
 }
 if(type==='Mutation'){
 tick();
 const i=a.input;if(!i||typeof i!=='object')throw Error('Missing input');const target=find(i.repositoryId||i.issueId||i.pullRequestId||i.subjectId);if(!target)throw Error('Not Found');const r=target.r,path='/api/v3/repos/'+r.meta.full_name;let result:any;
 if(name==='createIssue'||name==='createPullRequest'){if(target.__type!=='Repository')throw Error('Expected repository ID');if(name==='createIssue')result={issue:itemNode('Issue',r,rest('POST',path+'/issues',{title:i.title,body:i.body}))};else result={pullRequest:itemNode('PullRequest',r,rest('POST',path+'/pulls',{title:i.title,body:i.body,head:i.headRefName,base:i.baseRefName}))};}
 if(name==='closeIssue'){if(target.__type!=='Issue')throw Error('Expected issue ID');result={issue:itemNode('Issue',r,rest('PATCH',path+'/issues/'+target.item.number,{state:'closed'}))};}
 if(name==='mergePullRequest'){if(target.__type!=='PullRequest')throw Error('Expected pull request ID');if(i.mergeMethod&&!enums.PullRequestMergeMethod.includes(i.mergeMethod))throw Error('Invalid merge method');rest('PUT',path+'/pulls/'+target.item.number+'/merge',{merge_method:i.mergeMethod?.toLowerCase(),commit_message:i.commitBody});result={pullRequest:target};}
 if(name==='addComment'){if(!['Issue','PullRequest'].includes(target.__type))throw Error('Expected issue or pull request ID');result={commentEdge:{node:itemNode('IssueComment',r,rest('POST',path+'/issues/'+target.item.number+'/comments',{body:i.body}))}};}
 return {...result,clientMutationId:i.clientMutationId??null};
 }
 if(type==='Repository'){const r=obj.r,m=r.meta;
 const fields:Obj={id:idOf(type,m),databaseId:m.id,name:m.name,nameWithOwner:m.full_name,description:m.description,owner:wrap('User',m.owner),defaultBranchRef:r.git.refs.has('refs/heads/'+m.default_branch)?{name:m.default_branch}:null,viewerPermission:'ADMIN',hasIssuesEnabled:true};if(name in fields)return fields[name];
 if(name==='issue'||name==='pullRequest')return itemNode(name==='issue'?'Issue':'PullRequest',r,(name==='issue'?r.issues:r.pulls).get(a.number));
 if(name==='issues'||name==='pullRequests'){const t=name==='issues'?'Issue':'PullRequest';let items:any[]=[...(name==='issues'?r.issues:r.pulls).values()];if(a.states)items=items.filter(i=>a.states.includes(i.merged?'MERGED':i.state.toUpperCase()));const field=a.orderBy?.field==='UPDATED_AT'?'updated_at':a.orderBy?.field==='COMMENTS'?'comments':'created_at',dir=a.orderBy?.direction==='ASC'?1:-1;items.sort((x,y)=>dir*(typeof x[field]==='number'?x[field]-y[field]:String(x[field]).localeCompare(String(y[field]))||x.number-y.number));return connection(items.map(i=>itemNode(t,r,i)),a);}
 }
 if(['Issue','PullRequest','IssueComment'].includes(type)){const i=obj.item,r=obj.r;if(name==='id')return idOf(type,i);if(name==='databaseId')return i.id;if(name==='state')return i.merged?'MERGED':i.state.toUpperCase();if(name==='author')return wrap('User',i.user);if(name==='headRefName')return i.head.ref;if(name==='baseRefName')return i.base.ref;if(name==='mergeable')return i.mergeable===false?'CONFLICTING':i.mergeable===true?'MERGEABLE':'UNKNOWN';if(name==='files')return connection(rest('GET','/api/v3/repos/'+r.meta.full_name+'/pulls/'+i.number+'/files?per_page=100').map((f:Obj)=>({...f,path:f.filename})),a);if(name==='comments')return connection((r.comments.get(i.number)||[]).map((c:Obj)=>itemNode('IssueComment',r,c)),a);if(name==='createdAt')return i.created_at;if(name==='updatedAt')return i.updated_at;return i[name]??null;}
 if(type==='User'&&name==='id')return idOf(type,obj);if(type==='User'&&name==='databaseId')return obj.id;
 return obj[name]??null;
 };
 const run=(op:any)=>{try{if(!op||typeof op.query!=='string')throw Error('query must be a string');const operations=new Parser(op.query).document();const operation=op.operationName?operations.find(o=>o.name===op.operationName):operations.length===1?operations[0]:undefined;if(!operation)throw Error('An operation name is required or was not found');const vars={...Object.fromEntries(Object.entries(operation.defaults).map(([k,v])=>[k,evaluate(v,{})])),...op.variables};for(const n of operation.required)if(vars[n]==null)throw Error(`Missing required variable $${n}`);
 const validate=(type:string,fields:Field[])=>{for(const f of fields){if(f.on){if(!schema[f.on])throw Error('Unknown type '+f.on);validate(f.on,f.children);continue;}if(f.name==='__typename')continue;const fields=schema[type];if(!fields||!(f.name in fields))throw Error(`Cannot query field "${f.name}" on type "${type}".`);checkArguments(argumentsByField[type+'.'+f.name]||{},Object.fromEntries(Object.entries(f.args).map(([k,v])=>[k,evaluate(v,vars)])),type+'.'+f.name);const child=fields[f.name];if(!!child!==!!f.children.length)throw Error('Invalid selection for '+f.name);if(child)validate(child,f.children);}};validate(operation.type==='mutation'?'Mutation':'Query',operation.fields);
 const project=(type:string,obj:any,fields:Field[]):any=>{if(obj==null)return null;if(Array.isArray(obj))return obj.map(o=>project(type,o,fields));type=obj.__type||type;const result:Obj={};for(const f of fields){if(f.on){if(f.on===type||f.on==='Node')Object.assign(result,project(type,obj,f.children));continue;}const a=Object.fromEntries(Object.entries(f.args).map(([k,v])=>[k,evaluate(v,vars)]));const value=resolve(type,obj,f.name,a);result[f.key]=f.children.length?project(schema[type][f.name],value,f.children):value;}return result;};return {data:project(operation.type==='mutation'?'Mutation':'Query',{},operation.fields)};
 }catch(e){return {errors:[{message:e instanceof Error?e.message:'Invalid GraphQL request'}]};}};
 return Array.isArray(body)?body.map(run):run(body);
}
