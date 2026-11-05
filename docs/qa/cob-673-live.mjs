import { historyQuery, waitForIndexedBlock, historyPages } from './history-queries.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const repo=process.cwd();
const {CONTRACTS,SUBGRAPH_ENDPOINTS,indexedEvent,stakingAbi,merkleDropAbi}=await import(pathToFileURL(repo+'/packages/core/src/index.ts'));
const prefix=process.argv[2];
if (!prefix || !process.argv[3]) throw new Error('usage: node --import tsx docs/qa/cob-673-live.mjs <installed-prefix> <evidence-directory>');
const require=createRequire(prefix+'/package.json');
const {createPublicClient,http,decodeEventLog,formatUnits,zeroAddress}=require('viem');
const client=createPublicClient({transport:http('https://ethereum-rpc.publicnode.com',{retryCount:2})});
const dir=process.argv[3];
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR};
const save=(name,data)=>writeFileSync(`${dir}/${name}.json`,JSON.stringify(data,(_,v)=>typeof v==='bigint'?String(v):v,2));
const graphql=historyQuery(SUBGRAPH_ENDPOINTS.mainnet);
const cli=(name,args)=>{
 try {const out=execFileSync(prefix+'/node_modules/.bin/safenet',args,{cwd:prefix,env,encoding:'utf8',timeout:180000});
 writeFileSync(`${dir}/${name}.stdout`,out); return {exit:0,data:args.includes('--json')?JSON.parse(out):out};}
 catch(e){writeFileSync(`${dir}/${name}.stderr`,e.stderr??'');return {exit:e.status,error:'command failed'};}
};
const seedBlock=(await graphql('{ _meta {block{number}} }'))._meta.block.number;
const seedWithdrawals=await historyPages(graphql,'withdrawals','staker',seedBlock);
const seedAccounts=await historyPages(graphql,'rewardAccounts','claimCount',seedBlock);
const stakers=new Set(seedWithdrawals.map(w=>w.staker));
const addresses=seedAccounts.filter(a=>stakers.has(a.id) && a.claimCount>0)
 .sort((a,b)=>b.claimCount-a.claimCount || a.id.localeCompare(b.id)).slice(0,3).map(a=>a.id);
assert.equal(addresses.length,3);save('selected-addresses',addresses);console.log('Selected three accounts with claims and withdrawals');
const receipts=new Map(); const blocks=new Map();
const independent=createPublicClient({transport:http('https://eth.drpc.org',{retryCount:2})});
const receiptFailures=[];
async function receipt(hash){if(!receipts.has(hash))receipts.set(hash,client.getTransactionReceipt({hash}).catch(async()=>{receiptFailures.push({hash,provider:'publicnode',fallback:'drpc'});return independent.getTransactionReceipt({hash});}));return receipts.get(hash);}
async function block(n){const k=String(n);if(!blocks.has(k))blocks.set(k,client.getBlock({blockNumber:BigInt(n)}));return blocks.get(k);}
async function batches(items,fn){const out=[];for(let i=0;i<items.length;i+=4)out.push(...await Promise.all(items.slice(i,i+4).map(fn)));return out;}
const comparison=[];
for(const [i,address] of [...addresses,zeroAddress].entries()){
 const run=cli(`installed-history-${i}`,['rewards','history',address,'--all','--json']);assert.equal(run.exit,0);const h=run.data;
 await waitForIndexedBlock(graphql,h.block);
 const indexed={rewardClaims:await historyPages(graphql,'rewardClaims','amount blockNumber timestamp transactionHash',h.block,`account: "${address}"`)};
 assert.equal(h.count,indexed.rewardClaims.length);
 assert.equal(h.claims.length,h.count);assert.equal(h.totalClaimed,h.cumulativeClaimed.value);assert.equal(h.sumMatchesChain,true);
 const checks=await batches(indexed.rewardClaims,async c=>{
  const r=await receipt(c.transactionHash); const l=r.logs.find(l=>`${r.transactionHash}-${l.logIndex}`===c.id); assert.ok(l);assert.equal(l.address.toLowerCase(),CONTRACTS.merkleDrop.address.toLowerCase());
  const decoded=decodeEventLog({abi:[indexedEvent('merkleDrop','Claimed')],data:l.data,topics:l.topics,strict:true});
  assert.equal(decoded.args.account.toLowerCase(),address);assert.equal(String(decoded.args.amount),c.amount);assert.equal(String(r.blockNumber),c.blockNumber);
  const b=await block(r.blockNumber);assert.equal(String(b.timestamp),c.timestamp);
  const row=h.claims.find(row=>row.transaction===c.transactionHash && row.block===c.blockNumber && row.amount===c.amount);assert.ok(row);assert.equal(row.time,new Date(Number(b.timestamp)*1000).toISOString());
  return {id:c.id,transaction:c.transactionHash,block:c.blockNumber,timestamp:c.timestamp,wei:c.amount,receiptVerified:true};
 });
 assert.equal(String(await client.readContract({address:CONTRACTS.merkleDrop.address,abi:merkleDropAbi,functionName:'cumulativeClaimed',args:[address],blockNumber:BigInt(h.block)})),h.totalClaimed);
 comparison.push({address,claims:h.count,wei:h.totalClaimed,safe:formatUnits(BigInt(h.totalClaimed),18),block:h.block,receipts:checks.length,checks});
 console.log(`Verified claims for account ${i}: ${checks.length} receipts`);
}
save('claim-comparison',comparison);
const w=cli('installed-network',['withdrawals','list','--json']);assert.equal(w.exit,0);
await waitForIndexedBlock(graphql,w.data.block);
const data=await graphql(`{ network(id: "1", block: {number: ${w.data.block}}) {withdrawalCount} }`);
data.withdrawals=await historyPages(graphql,'withdrawals','staker amount claimed initiatedAtBlock initiatedAtTimestamp initiatedTxHash claimedAtBlock claimedAtTimestamp claimedTxHash',w.data.block);
assert.equal(data.withdrawals.length,data.network.withdrawalCount);
const withdrawalChecks=await batches(data.withdrawals,async row=>{
 for(const claimed of [false,true]){
  if(claimed && !row.claimed)continue;
  const hash=claimed?row.claimedTxHash:row.initiatedTxHash;const r=await receipt(hash);
  const logs=r.logs.filter(l=>l.address.toLowerCase()===CONTRACTS.staking.address.toLowerCase()).flatMap(l=>{
   try {return [{log:l,decoded:decodeEventLog({abi:[indexedEvent('staking',claimed?'WithdrawalClaimed':'WithdrawalInitiated')],data:l.data,topics:l.topics,strict:true})}];} catch {return [];}
  });
  const match=logs.find(l=>String(l.decoded.args.withdrawalId)===row.id);assert.ok(match,`withdrawal receipt ${row.id}`);
  assert.equal(match.decoded.args.staker.toLowerCase(),row.staker);assert.equal(String(match.decoded.args.amount),row.amount);
  assert.equal(String(r.blockNumber),claimed?row.claimedAtBlock:row.initiatedAtBlock);
  assert.equal(String((await block(r.blockNumber)).timestamp),claimed?row.claimedAtTimestamp:row.initiatedAtTimestamp);
 }
 return {...row,receiptsVerified:true};
});
console.log('Verified every withdrawal initiation and claim receipt');
const pending=data.withdrawals.filter(r=>!r.claimed);
const queueChecks=await batches([...new Set(data.withdrawals.map(r=>r.staker))],async address=>{
 const queue=await client.readContract({address:CONTRACTS.staking.address,abi:stakingAbi,functionName:'getPendingWithdrawals',args:[address],blockNumber:BigInt(w.data.block)});
 const expected=pending.filter(r=>r.staker===address).map(r=>r.amount).sort();assert.deepEqual(queue.map(r=>String(r.amount)).sort(),expected);
 return {address,pending:queue.length,wei:String(queue.reduce((s,r)=>s+r.amount,0n))};
});
const total=String(pending.reduce((s,r)=>s+BigInt(r.amount),0n));
assert.equal(w.data.initiated,data.withdrawals.length);assert.equal(w.data.claimed,data.withdrawals.length-pending.length);assert.equal(w.data.count.value,pending.length);assert.equal(w.data.openSum,total);assert.equal(w.data.total.value,total);
save('withdrawal-comparison',{block:w.data.block,initiated:data.withdrawals.length,claimed:w.data.claimed,pending:pending.length,wei:total,receipts:withdrawalChecks,queues:queueChecks});
const regressions=[];
for(const [name,args] of [
 ['version',['--version']],['status',['status','--json']],['validators',['validators','list','--all','--json']],
 ['rewards-check',['rewards','check',addresses[0],'--json']],['address-withdrawals',['withdrawals','list','--address',addresses[0],'--json']],
 ['history-human',['rewards','history',addresses[0]]],['withdrawals-human',['withdrawals','list']],
 ['invalid-address',['rewards','history','invalid','--json']],['unsupported-network',['rewards','history',addresses[0],'--network','gnosis','--json']],
]){const r=cli('installed-'+name,args);regressions.push({name,exit:r.exit});assert.equal(r.exit,['invalid-address','unsupported-network'].includes(name)?2:0);}
save('regressions',regressions);
const server=spawn(prefix+'/node_modules/.bin/safenet-mcp',[],{cwd:prefix,env,stdio:['pipe','pipe','pipe']});
let stderr='';server.stderr.on('data',b=>stderr+=b);const waiting=new Map();let id=0;
createInterface({input:server.stdout}).on('line',line=>{const msg=JSON.parse(line);if(msg.id!==undefined){waiting.get(msg.id)?.(msg);waiting.delete(msg.id);}});
const call=(method,params)=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(new Error('MCP timeout')),180000);waiting.set(n,msg=>{clearTimeout(timer);resolve(msg)});server.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});
try{
 const init=await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'cob-673-installed-qa',version:'1.0.0'}});assert.ok(init.result);save('mcp-initialize',init);
 server.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const list=await call('tools/list',{});assert.ok(list.result.tools.some(t=>t.name==='rewards_history'));save('mcp-tools-list',list);
 for(const [i,address] of [addresses[0],zeroAddress].entries()){
 const r=await call('tools/call',{name:'rewards_history',arguments:{address,all:true}});assert.ok(!r.result.isError);assert.equal(r.result.structuredContent.count,comparison[i===0?0:3].claims);save('mcp-history-'+i,r);
 }
 const bad=await call('tools/call',{name:'rewards_history',arguments:{address:'invalid'}});assert.equal(bad.result.isError,true);save('mcp-invalid-address',bad);
}finally{server.stdin.end();server.kill();writeFileSync(dir+'/mcp.stderr',stderr);}
save('receipt-fallbacks',receiptFailures);
save('installed-versions',{cli:JSON.parse(readFileSync(prefix+'/node_modules/@cobuilders/safenet-cli/package.json','utf8')).version,mcp:JSON.parse(readFileSync(prefix+'/node_modules/@cobuilders/safenet-mcp/package.json','utf8')).version});
console.log('Installed CLI and MCP QA complete');
