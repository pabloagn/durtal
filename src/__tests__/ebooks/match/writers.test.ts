import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {drizzle} from 'drizzle-orm/postgres-js';
import {getTableName,sql,type SQL} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {Db} from '@/lib/catalogue/work-store';
vi.mock('@/lib/db',()=>({db:new Proxy({},{get(){throw new Error('Global database forbidden');}})}));
const state=vi.hoisted(()=>({loaded:null as unknown,active:false,reads:[] as string[],writes:[] as {sql:string;params:unknown[]}[],order:[] as string[],conn:null as unknown,subLocations:[] as Record<string,unknown>[],queueFailure:false,connectionBoundary:null as null|(()=>Promise<void>),preparationBoundary:null as null|((at:Date|undefined)=>Promise<void>)}));
vi.mock('@/lib/catalogue/book-store',async(importActual)=>{
  const actual=await importActual<typeof import('@/lib/catalogue/book-store')>();
  return {...actual,planBookEdition:async(...args:Parameters<typeof actual.planBookEdition>)=>{
    const prepared=await actual.planBookEdition(...args);
    await state.preparationBoundary?.(args[1]?.at);
    return prepared;
  }};
});
vi.mock('@/lib/ebooks/match/load',async(importActual)=>({...await importActual<object>(),loadMatchCatalogue:async(conn:unknown)=>{if(!state.active || conn!==state.conn)throw new Error('Escaped planning connection');state.reads.push('load');return state.loaded;}}));
vi.mock('@/lib/enrichment/read-only-session',()=>({withReadOnlyPlanningConnection:async(_url:string,callback:(conn:unknown)=>unknown,options:{isolationLevel:string})=>{expect(options.isolationLevel).toBe('repeatable read');if(state.connectionBoundary)await state.connectionBoundary();state.active=true;try{return await callback(state.conn);}finally{state.active=false;}}}));
vi.mock('@/lib/db/atomic',()=>({atomicOn:async(_conn:unknown,build:(d:unknown)=>unknown[])=>{state.order.push('atomic');const dialect=new PgDialect();state.writes.push(...build(drizzle.mock()).map((query)=>dialect.sqlToQuery((query as {getSQL():SQL}).getSQL())));return [];}}));
vi.mock('@/lib/enrichment/queue',()=>({BULK_ACCESSION_PRIORITY:200,queueNewBookEnrichment:async()=>{if(state.queueFailure)throw new Error('Queued follow-up failed');return {ok:true,jobs:[]};}}));
import {planLink,planLinkOn,linkEbook,linkUndoEntry,prepareLinkWrite} from '@/lib/ebooks/match/link';
import {EXISTING_COPY_METADATA_COLUMNS,existingCopyStampForRow} from '@/lib/ebooks/match/existing-copy';
import {hashMatchingPlan,planMatchingOn} from '@/lib/ebooks/match/plan';
import {prepareMatchAtomicExtension} from '@/lib/ebooks/match/review-extension';
import {planDecision,planDecisionOn,applyDecision} from '@/lib/ebooks/match/decisions';
import {planAccession,planAccessionOn,accessionEbooks,accessionPlanHash} from '@/lib/ebooks/match/accession';
import {bookAuthorFor,resolveBookCredits,planBookWork} from '@/lib/catalogue/book-store';
import {MATCH_TABLES,type LoadedMatchCatalogue} from '@/lib/ebooks/match/load';
import {persistClassification} from '@/lib/ebooks/match/classification';
import {prepareUploadAtomicExtension} from '@/lib/ebooks/upload/atomic-extension';
import {uploadAtomicScenario} from '../upload/atomic-fixture';
import {catalogue,ebook,work,edition,copy,at} from './fixtures';
const url='postgres://localhost/sln495_source';
const workId='10000000-0000-4000-8000-000000000001',editionId='20000000-0000-4000-8000-000000000001',copyId='30000000-0000-4000-8000-000000000001';
function setup(hasCopy=false,configured:string|null='ebooks-location'){
  state.reads.length=0;state.writes.length=0;state.order.length=0;state.subLocations=[];state.queueFailure=false;state.connectionBoundary=null;state.preparationBoundary=null;
  const e=edition({id:editionId,workId}),c=copy({id:copyId,editionId,locationId:'other-digital'}),w=work({id:workId,editions:hasCopy?[e]:[],copies:hasCopy?[c]:[]}),input=ebook();
  state.loaded={catalogue:catalogue({ebooks:[input],works:[w],ebookLocationId:configured,digitalLocationIds:['ebooks-location','other-digital']}),rows:{...Object.fromEntries(MATCH_TABLES.map((table)=>[table,[]])),ebooks:[{id:input.id,match_state:'pending',updated_at:at}],editions:hasCopy?[{id:editionId,work_id:workId,metadata_locked:false}]:[],locations:['ebooks-location','other-digital'].map((id)=>({id,type:'digital',is_active:true})),instances:hasCopy?[{id:copyId,edition_id:editionId,location_id:'other-digital',status:'available',format:null,file_size_bytes:null,updated_at:at}]:[]},catalogueFingerprint:'a'.repeat(64),inputFingerprint:'b'.repeat(64)} as unknown as LoadedMatchCatalogue;
  const assert=()=>{if(!state.active)throw new Error('Escaped transitive planning read');};
  state.conn={execute:async()=>{assert();state.reads.push('sub_locations');return state.subLocations.map((row)=>({row}));},select:(columns:Record<string,unknown>)=>{assert();return {from:(table:Parameters<typeof getTableName>[0])=>{assert();const name=getTableName(table);state.reads.push(name);const rows=name==='works' && 'id' in columns ? [{id:workId}] : [];const chain={where:()=>chain,limit:async()=>{assert();return rows;},then:(resolve:(rows:unknown)=>unknown)=>{assert();return Promise.resolve(rows).then(resolve);}};return chain;}};},query:{authors:{findFirst:async()=>{assert();state.reads.push('find-author');return undefined;}}}};
  return state.loaded as LoadedMatchCatalogue;
}
describe('shared guarded matching writers',()=>{
  function uuidInput(){
    const s=setup(),id='80000000-0000-4000-8000-000000000001';
    s.catalogue=catalogue({ebooks:[ebook({id,authors:['New Person']})],works:[work({id:workId})],authors:[]});
    s.rows.ebooks=[{id,match_state:'pending',updated_at:at}];
    return {s,id};
  }
  function reviewExtension(plan:Parameters<typeof linkEbook>[1]|Parameters<typeof accessionEbooks>[1],id:string){
    const operation={version:plan.version,operationId:plan.operationId,runId:plan.runId,planSha256:plan.planSha256,targetDatabase:plan.targetDatabase};
    return prepareMatchAtomicExtension({coreWriter:plan.kind==='link'?'link':'accession',coreOperation:plan,ebookIds:[id],reviewOperations:[operation],purpose:'decision'},
      {extraTables:['activity_events'],before:(d)=>[d.execute(sql`select ${'review before'}`)],after:(d)=>[d.execute(sql`select ${'review after'}`)]});
  }
  it.each(['preparation','reservation'] as const)('uses original nested link values after caller mutation during awaited %s',async(boundary)=>{
    const {id}=uuidInput();
    const plan=await planLink(url,{ebookId:id,workId,method:'manual',newCopyDraft:{notes:'Authorized note'}});
    const original=JSON.parse(JSON.stringify(plan)),extension=reviewExtension(plan,id);
    const mutate=async()=>{
      await Promise.resolve();
      plan.effect.newCopy!.fileSizeBytes=999999;plan.effect.newEdition!.title='Forged title';
      plan.choices.newCopyDraft!.notes='Forged note';plan.instanceId='90000000-0000-4000-8000-000000000009';
      plan.snapshot.rows.ebooks[0].title='Forged snapshot';
    };
    if(boundary==='preparation')state.preparationBoundary=mutate;
    await linkEbook({} as Db,plan,original.targetDatabase,{atomicExtension:extension,beforeWrite:async(receipt)=>{
      state.order.push('reserved');expect(receipt.operationId).toBe(original.operationId);
      if(boundary==='reservation')await mutate();
    }});
    const insert=state.writes.find((query)=>query.sql.startsWith('insert into "instances"'))!;
    expect(insert.params).toEqual(expect.arrayContaining([original.instanceId,1000,'Authorized note']));
    expect(insert.params).not.toEqual(expect.arrayContaining([999999]));
    expect(state.writes.some((query)=>query.params.includes('Forged title')||query.params.includes('Forged note'))).toBe(false);
    const written=state.writes.find((query)=>query.sql.includes('returning link_written'))!;
    expect(JSON.parse(written.params[0] as string)).toMatchObject({operationId:original.operationId,planSha256:original.planSha256,instanceId:original.instanceId});
    expect(state.order).toEqual(['reserved','atomic']);expect(state.writes.at(-1)?.params).toEqual(['review after']);
  });
  it.each(['preparation','reservation'] as const)('uses original accession authors, effects and ownership IDs after awaited %s mutation',async(boundary)=>{
    const {s,id}=uuidInput();s.catalogue=catalogue({...s.catalogue.source,works:[]});
    const plan=await planAccession(url,[id]),original=JSON.parse(JSON.stringify(plan)),extension=reviewExtension(plan,id);
    const mutate=async()=>{
      await Promise.resolve();
      plan.authors[0].name='Forged author';plan.authors[0].id='90000000-0000-4000-8000-000000000009';
      plan.entries[0].effect.copy!.fileSizeBytes=999999;plan.entries[0].effect.work!.title='Forged work';
      plan.entries[0].receipt.operationId='90000000-0000-4000-8000-000000000008';
      plan.entries[0].receipt.authorIdsCreated= ['90000000-0000-4000-8000-000000000009'];
      plan.entries[0].receipt.before.ebook.title='Forged snapshot';
    };
    if(boundary==='preparation')state.preparationBoundary=mutate;
    const result=await accessionEbooks({} as Db,plan,original.targetDatabase,{atomicExtension:extension,beforeWrite:async()=>{
      state.order.push('reserved');if(boundary==='reservation')await mutate();
    }});
    expect(state.writes.find((query)=>query.sql.startsWith('insert into "authors"'))?.params).toEqual(expect.arrayContaining([original.authors[0].id,'New Person']));
    expect(state.writes.find((query)=>query.sql.startsWith('insert into "instances"'))?.params).toContain(1000);
    expect(state.writes.some((query)=>query.params.includes('Forged author')||query.params.includes('Forged work')||query.params.includes(999999))).toBe(false);
    expect(result.receipts[0]).toMatchObject({operationId:original.entries[0].receipt.operationId,authorIdsCreated:original.entries[0].receipt.authorIdsCreated});
    const written=state.writes.find((query)=>query.sql.includes('returning link_written'))!;
    expect(JSON.parse(written.params[0] as string)).toMatchObject({operationId:original.entries[0].receipt.operationId,planSha256:original.planSha256,authorIdsCreated:original.entries[0].receipt.authorIdsCreated});
    expect(state.order).toEqual(['reserved','atomic']);expect(state.writes.at(-1)?.params).toEqual(['review after']);
  });
  it.each(['link','accession'] as const)('refuses forged %s receipt identity and nested ownership/snapshot in awaited reservation hooks before submitting SQL',async(writer)=>{
    const {s,id}=uuidInput();if(writer==='accession')s.catalogue=catalogue({...s.catalogue.source,works:[]});
    const plan=writer==='link'?await planLink(url,{ebookId:id,workId,method:'manual'}):await planAccession(url,[id]);
    const original=JSON.parse(JSON.stringify(plan)),extension=reviewExtension(plan,id);
    for(const field of ['identity','ownership','snapshot']){
      const options={atomicExtension:extension,beforeWrite:async(receipt:ReturnType<typeof linkUndoEntry>)=>{
        await Promise.resolve();
        if(field==='identity')receipt.operationId='90000000-0000-4000-8000-000000000009';
        else if(field==='ownership')(receipt.activityIdsCreated as string[])[0]='90000000-0000-4000-8000-000000000009';
        else receipt.before.ebook.title='Forged snapshot';
      }};
      const write=plan.kind==='link'?linkEbook({} as Db,plan,plan.targetDatabase,options):accessionEbooks({} as Db,plan,plan.targetDatabase,options);
      await expect(write).rejects.toThrow(TypeError);expect(state.writes).toEqual([]);expect(plan).toEqual(original);
    }
  });
  it.each(['link','accession'] as const)('rejects mutable Date DTO input and detects changed internal %s preparation time',async(writer)=>{
    const {s,id}=uuidInput();if(writer==='accession')s.catalogue=catalogue({...s.catalogue.source,works:[]});
    const plan=writer==='link'?await planLink(url,{ebookId:id,workId,method:'manual'}):await planAccession(url,[id]);
    const changed=JSON.parse(JSON.stringify(plan));changed.snapshot.rows.ebooks[0].updated_at=new Date(at);
    changed.planSha256=plan.kind==='link'?hashMatchingPlan(changed):accessionPlanHash(changed);
    if(plan.kind!=='link')for(const entry of changed.entries)entry.receipt.planSha256=changed.planSha256;
    await expect(plan.kind==='link'?linkEbook({} as Db,changed,changed.targetDatabase):accessionEbooks({} as Db,changed,changed.targetDatabase)).rejects.toThrow('mutable internal values');
    expect(state.writes).toEqual([]);
    state.preparationBoundary=async(date)=>{await Promise.resolve();date!.setTime(date!.getTime()+60000);};
    await expect(plan.kind==='link'?linkEbook({} as Db,plan,plan.targetDatabase):accessionEbooks({} as Db,plan,plan.targetDatabase)).rejects.toThrow('timestamp changed');
    expect(state.writes).toEqual([]);
  });
  it('hashes a strict draft and real sub-location rows, then inserts one protected copy and history',async()=>{
    setup(true);
    const subLocationId='70000000-0000-4000-8000-000000000001';
    state.subLocations=[{id:subLocationId,location_id:'other-digital',name:'Owner folder'}];
    const plan=await planLink(url,{ebookId:'ebook-1',workId,editionId,locationId:'other-digital',method:'manual',
      newCopyDraft:{subLocationId,notes:'Owner note',acquisitionType:'gift',isSigned:true}});
    expect(state.reads).toContain('sub_locations');
    expect(plan.additionalSnapshotRows).toEqual({sub_locations:state.subLocations});
    expect(plan.choices.newCopyDraft).toMatchObject({notes:'Owner note',isSigned:true,isFirstPrinting:false});
    const altered=JSON.parse(JSON.stringify(plan));altered.additionalSnapshotRows.sub_locations[0].name='changed';
    await expect(prepareLinkWrite(altered,plan.targetDatabase)).rejects.toThrow('hash');
    await linkEbook({} as Db,plan,plan.targetDatabase);
    const insert=state.writes.filter((query)=>query.sql.startsWith('insert into "instances"'));
    expect(insert).toHaveLength(1);expect(insert[0].params).toEqual(expect.arrayContaining([plan.instanceId,plan.editionId,subLocationId,'Owner note','gift','epub',1000]));
    expect(state.writes[0].sql).toContain('"sub_locations"');
    expect(state.writes.some((query)=>query.sql.includes('from "sub_locations"') && query.sql.includes('harmonization_assert'))).toBe(true);
    expect(state.writes.filter((query)=>query.sql.startsWith('insert into "instance_status_history"'))).toHaveLength(1);
  });
  it.each(['missing','wrong-parent'])('refuses a %s sub-location before preparing writes',async(variant)=>{
    setup();const subLocationId='70000000-0000-4000-8000-000000000001';
    state.subLocations=variant==='missing'?[]:[{id:subLocationId,location_id:'physical-shelf'}];
    await expect(planLink(url,{ebookId:'ebook-1',workId,method:'manual',newCopyDraft:{subLocationId}})).rejects.toThrow('must belong');
    expect(state.writes).toEqual([]);
  });
  it('rejects copy draft on an existing copy and explicit new-edition intent on automatic writers',async()=>{
    setup(true);
    await expect(planLink(url,{ebookId:'ebook-1',workId,instanceId:copyId,method:'manual',newCopyDraft:{notes:'Owner'}})).rejects.toThrow('newly planned');
    await expect(planLink(url,{ebookId:'ebook-1',workId,method:'score',newEdition:{}})).rejects.toThrow('Manual');
    const plan=await planLink(url,{ebookId:'ebook-1',workId,method:'manual',newEdition:{}});
    plan.choices.method='score';plan.planSha256=hashMatchingPlan(plan);
    await expect(prepareLinkWrite(plan,plan.targetDatabase)).rejects.toThrow('Manual');
    expect(state.writes).toEqual([]);
  });
  it('does not let explicit no-ISBN creation bypass an identifier owned by another work',async()=>{
    const s=setup();s.catalogue=catalogue({ebooks:[ebook({isbns:['9780306406157']})],works:[work({id:workId}),work({id:'another-work',editions:[edition({id:'another-edition',workId:'another-work',isbn13:'9780306406157'})]})]});
    await expect(planLink(url,{ebookId:'ebook-1',workId,method:'manual',newEdition:{isbn13:null}})).rejects.toThrow('contradicts this book');
    expect(state.writes).toEqual([]);
  });
  it('combines move and digital fill in one copy update and records exact original edition/owned fields',async()=>{
    const s=setup(true);s.catalogue=catalogue({ebooks:[ebook({isbns:['9780306406157']})],works:[work({id:workId,editions:[edition({id:editionId,workId,metadataSource:'phantom_canon'}),edition({id:'identified-edition',workId,isbn13:'9780306406157'})],copies:[copy({id:copyId,editionId})]})]});
    s.rows.instances=[{id:copyId,edition_id:editionId,location_id:'ebooks-location',status:'available',format:'ebook',file_size_bytes:42,updated_at:'2026-10-09T12:00:00.123456+00:00',notes:'preserve'}];
    const plan=await planLink(url,{ebookId:'ebook-1',workId,method:'manual'});
    expect(plan.effect).toMatchObject({movedFromEditionId:editionId,filledCopy:{format:'epub',fileSizeBytes:1000}});
    expect(linkUndoEntry(plan)).toMatchObject({before:{originalEdition:s.rows.editions[0]},fillProvenance:{fields:['format','file_size_bytes'],expected:{format:'epub',fileSizeBytes:1000}}});
    await linkEbook({} as Db,plan,plan.targetDatabase);
    const updates=state.writes.filter((query)=>query.sql.startsWith('update "instances"'));
    expect(updates).toHaveLength(1);expect(updates[0].sql).toContain('"edition_id" =');expect(updates[0].sql).toContain('"format" =');
    expect(updates[0].params).toEqual(expect.arrayContaining(['identified-edition','epub',1000]));
    expect(updates[0].sql).not.toMatch(/"(?:location_id|status|acquisition_type|notes)" =/);
  });
  it('edits the selected existing copy and links in the same atomic with actual receipt last',async()=>{
    const s=setup(true),raw=s.rows.instances[0];
    Object.assign(raw,Object.fromEntries(Object.values(EXISTING_COPY_METADATA_COLUMNS).map(key=>[key,null])),
      {is_signed:true,is_first_printing:true,notes:'Original',updated_at:'2026-10-09T12:00:00.123456+00:00'});
    const input={ebookId:s.catalogue.source.ebooks[0].id,workId,editionId,instanceId:copyId,method:'manual' as const,
      existingCopyPatch:{notes:'Chosen note',isSigned:false},expectedCopyStamp:existingCopyStampForRow(raw)};
    const pending=planLink(url,input);input.existingCopyPatch.notes='Changed after await';
    const plan=await pending;
    const extension=reviewExtension(plan,plan.ebook.id);
    await linkEbook({} as Db,plan,plan.targetDatabase,{atomicExtension:extension});
    const updates=state.writes.filter(row=>row.sql.startsWith('update "instances"'));
    expect(updates).toHaveLength(1);expect(updates[0].params).toContain('Chosen note');
    expect(updates[0].params).not.toContain('Changed after await');expect(updates[0].sql).toContain('1 microsecond');
    expect(updates[0].sql).not.toMatch(/"(?:location_id|sub_location_id|status)" =/);
    expect(linkUndoEntry(plan).metadataProvenance).toEqual({fields:['is_signed','notes'],beforeStamp:input.expectedCopyStamp});
    expect(state.writes.at(-1)?.params).toContain('review after');
    expect(state.writes.findIndex(row=>row.sql.includes('link_written'))).toBeGreaterThan(state.writes.indexOf(updates[0]));
  });
  it('freezes existing-copy choices and identity before a delayed connection callback',async()=>{
    const s=setup(true),raw=s.rows.instances[0];
    Object.assign(raw,Object.fromEntries(Object.values(EXISTING_COPY_METADATA_COLUMNS).map(key=>[key,null])),
      {is_signed:false,is_first_printing:false,updated_at:'2026-10-09T12:00:00.123456Z'});
    const originalStamp=existingCopyStampForRow(raw);
    const input={ebookId:s.catalogue.source.ebooks[0].id,workId,editionId,instanceId:copyId,method:'manual' as const,
      existingCopyPatch:{notes:'Original exact choice'},expectedCopyStamp:{...originalStamp}};
    const identity={runId:'10000000-0000-4000-8000-000000000001',now:at};
    let release!:()=>void;const delayed=new Promise<void>(done=>{release=done;});state.connectionBoundary=()=>delayed;
    const pending=planLink(url,input,identity);
    expect(state.reads).toEqual([]);
    input.existingCopyPatch.notes='Mutated during connection wait';input.expectedCopyStamp.updatedAt='2026-10-09T12:00:00.123457Z';
    input.expectedCopyStamp.metadataFingerprint='f'.repeat(64);identity.runId='10000000-0000-4000-8000-000000000002';
    identity.now='2026-10-10T12:00:00.000Z';
    release();const plan=await pending;
    expect(plan.choices.existingCopyPatch).toEqual({notes:'Original exact choice'});
    expect(plan.choices.expectedCopyStamp).toEqual(originalStamp);expect(plan.createdAt).toBe(at);
    expect(plan.runId).toBe('10000000-0000-4000-8000-000000000001');expect(plan.planSha256).toBe(hashMatchingPlan(plan));
    await linkEbook({} as Db,plan,plan.targetDatabase);
    const update=state.writes.find(row=>row.sql.startsWith('update "instances"'))!;
    expect(update.params).toContain('Original exact choice');expect(update.params).not.toContain('Mutated during connection wait');
  });
  it('rejects a stale microsecond or raw metadata stamp and refuses new-copy draft reuse',async()=>{
    const s=setup(true),raw=s.rows.instances[0];
    Object.assign(raw,Object.fromEntries(Object.values(EXISTING_COPY_METADATA_COLUMNS).map(key=>[key,null])),
      {is_signed:false,is_first_printing:false,updated_at:'2026-10-09T12:00:00.123456Z'});
    const input={ebookId:s.catalogue.source.ebooks[0].id,workId,editionId,instanceId:copyId,method:'manual' as const,
      existingCopyPatch:{notes:null},expectedCopyStamp:existingCopyStampForRow(raw)};
    await expect(planLink(url,{...input,expectedCopyStamp:{...input.expectedCopyStamp,updatedAt:'2026-10-09T12:00:00.123457Z'}})).rejects.toThrow('changed');
    raw.notes='Concurrent owner edit';await expect(planLink(url,input)).rejects.toThrow('changed');
    input.expectedCopyStamp=existingCopyStampForRow(raw);
    await expect(planLink(url,{...input,newCopyDraft:{notes:'Create intent'}})).rejects.toThrow('newly planned copy');
    await expect(planLink(url,{...input,expectedCopyStamp:undefined})).rejects.toThrow('complete expected');
    expect(state.writes).toEqual([]);
  });
  it('places the trusted receipt suffix after the matching receipt and keeps it as the last query',async()=>{
    const s=setup(),id='80000000-0000-4000-8000-000000000001';
    s.catalogue=catalogue({...s.catalogue.source,ebooks:[ebook({id})]});s.rows.ebooks=[{id,match_state:'pending',updated_at:at}];
    const plan=await planLink(url,{ebookId:id,workId,method:'manual'});
    const operation={version:plan.version,operationId:plan.operationId,runId:plan.runId,planSha256:plan.planSha256,targetDatabase:plan.targetDatabase};
    const extension=prepareMatchAtomicExtension({coreWriter:'link',coreOperation:plan,ebookIds:[id],reviewOperations:[operation],purpose:'decision'},
      {extraTables:['activity_events'],before:(d)=>[d.execute(sql`select ${'review before'}`)],after:(d)=>[d.execute(sql`select ${'review after'}`)]});
    await linkEbook({} as Db,plan,plan.targetDatabase,{atomicExtension:extension});
    expect(state.order).toEqual(['atomic']);expect(state.writes[0].sql).toContain('"activity_events"');
    const before=state.writes.findIndex((query)=>query.params.includes('review before'));
    const receipt=state.writes.findIndex((query)=>query.sql.includes('returning link_written'));
    expect(before).toBe(MATCH_TABLES.length+1);expect(receipt).toBe(state.writes.length-2);expect(state.writes.at(-1)?.params).toEqual(['review after']);
  });
  it.each((['classification','decision','link','accession'] as const).flatMap(writer=>
    ['2030-01-01T12:00:00.123Z','2025-01-01T12:00:00.001Z'].map(now=>({writer,now}))))(
    'constructs final monotonic PostgreSQL versions for upload $writer with plan $now',async({writer,now})=>{
      const scenario=uploadAtomicScenario(),b=scenario.binding,id=b.ebookIds[0],s=setup(writer==='link');
      s.catalogue=catalogue({...s.catalogue.source,ebooks:[ebook({id,authors:writer==='accession'?['New Person']:['Andre Breton']})],
        ...(writer==='accession'?{works:[],authors:[]}:{})});
      s.rows.ebooks=[{id,match_state:'pending',instance_id:null,created_at:'2026-10-09T12:00:00.000000Z',
        updated_at:'2030-01-01T12:00:00.123456Z',matched_at:null}];
      const identity={runId:scenario.operation.runId,targetDatabase:b.databaseFingerprint,now};
      state.active=true;
      const plan=await (async()=>{try{return writer==='classification'
        ? await planMatchingOn(state.conn as Db,[id],{...identity,mode:'classification_only',rematch:true})
        : writer==='decision'?await planDecisionOn(state.conn as Db,[id],{action:'keep'},identity)
        : writer==='link'?await planLinkOn(state.conn as Db,{ebookId:id,workId,editionId,instanceId:copyId,method:'manual'},identity)
        : await planAccessionOn(state.conn as Db,[id],identity);}finally{state.active=false;}})();
      const operation={version:plan.version,operationId:plan.operationId,runId:plan.runId,
        planSha256:plan.planSha256,targetDatabase:plan.targetDatabase};
      b.coreWriter=writer;b.coreOperation=operation;b.targetSnapshot.ebooks=s.rows.ebooks.map(row=>({...row}));
      (b.command.rawSnapshot.progress as {uploadCoreV1:{coreOperation:typeof operation}}).uploadCoreV1.coreOperation=operation;
      const extension=prepareUploadAtomicExtension(b,{before:()=>[],after:d=>[d.execute(sql`select ${'upload suffix'}`)]});
      const apply=async(atomicExtension?:typeof extension)=>{
        const options=atomicExtension?{atomicExtension}:{};
        switch(plan.kind){
          case 'classification':return atomicExtension?persistClassification({} as Db,plan,plan.targetDatabase,{atomicExtension}):persistClassification({} as Db,plan,plan.targetDatabase);
          case 'decision':return applyDecision({} as Db,plan,plan.targetDatabase,options);
          case 'link':return linkEbook({} as Db,plan,plan.targetDatabase,options);
          case 'accession_batch':return accessionEbooks({} as Db,plan,plan.targetDatabase,options);
        }
      };
      await apply(extension);
      const bookUpdates=state.writes.filter(row=>row.sql.startsWith('update "ebooks"'));
      const versions=bookUpdates.filter(row=>row.sql.includes('"updated_at" ='));
      expect(versions).toHaveLength(1);expect(versions[0].sql).toContain('isfinite(updated_at)');
      expect(versions[0].sql).toContain("greatest(clock_timestamp(),updated_at+interval '1 microsecond')");
      if(writer==='classification')expect(bookUpdates.at(-1)?.sql).not.toContain('"updated_at" =');
      if(writer==='link')expect(state.writes.find(row=>row.sql.startsWith('update "instances"'))?.sql)
        .toContain("greatest(clock_timestamp(),updated_at+interval '1 microsecond')");
      expect(state.writes.at(-1)?.params).toContain('durtal.ebook.upload.rows.v1');
      state.writes=[];await apply();
      expect(state.writes.filter(row=>row.sql.startsWith('update "ebooks"')).some(row=>row.sql.includes('clock_timestamp()'))).toBe(false);
    });
  it.each(['decision','accession'] as const)('composes one trusted %s atomic and returns its actual result with explicit follow-up failure',async(writer)=>{
    const s=setup(),id='80000000-0000-4000-8000-000000000001';
    s.catalogue=catalogue({ebooks:[ebook({id,authors:['New Person']})],works:[],authors:[]});
    s.rows.ebooks=[{id,match_state:'pending',updated_at:at}];
    const plan=writer==='decision'?await planDecision(url,[id],{action:'keep'}):await planAccession(url,[id]);
    const operation={version:plan.version,operationId:plan.operationId,runId:plan.runId,planSha256:plan.planSha256,targetDatabase:plan.targetDatabase};
    const extension=prepareMatchAtomicExtension({coreWriter:writer,coreOperation:plan,ebookIds:[id],reviewOperations:[operation],purpose:'decision'},
      {extraTables:['activity_events'],before:(d)=>[d.execute(sql`select ${'review before'}`)],after:(d)=>[d.execute(sql`select ${'review after'}`)]});
    if(plan.kind==='decision')expect(await applyDecision({} as Db,plan,plan.targetDatabase,{atomicExtension:extension})).toEqual([]);
    else {
      state.queueFailure=true;
      const outcome=await accessionEbooks({} as Db,plan,plan.targetDatabase,{atomicExtension:extension});
      expect(outcome.result).toEqual([]);expect(outcome.followUpFailures).toEqual([{workId:plan.entries[0].workId,error:'Queued follow-up failed'}]);
      expect(state.writes.at(-2)?.sql).toContain('returning link_written');
    }
    expect(state.order).toEqual(['atomic']);expect(state.writes.at(-1)?.params).toEqual(['review after']);
    expect(state.writes.filter((query)=>query.sql.includes('lock table'))).toHaveLength(1);
    expect(state.writes.findIndex((query)=>query.params.includes('review before'))).toBe(MATCH_TABLES.length+1);
  });
  it('finishes ISBN and book-boundary reads inside planning and returns a serializable plan',async()=>{
    const s=setup();s.catalogue=catalogue({...s.catalogue.source,ebooks:[ebook({isbns:['9780306406157']})]});
    const plan=await planLink(url,{ebookId:'ebook-1',workId,method:'manual'});
    expect(state.active).toBe(false);expect(state.reads).toEqual(['load','works','editions']);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(plan.effect).toMatchObject({rule:'new_isbn_edition',ready:true});
    await linkEbook({} as Db,plan,plan.targetDatabase,{beforeWrite:async()=>{state.order.push('reserved');}});
    expect(state.order).toEqual(['reserved','atomic']);
    expect(state.writes[0].sql).toContain('lock table');
    expect(state.writes.some((query)=>query.sql.startsWith('insert into "instance_status_history"'))).toBe(true);
    expect(state.writes.filter((query)=>query.sql.includes('harmonization_assert'))).toHaveLength(MATCH_TABLES.length);
    expect(state.writes.at(-1)?.sql).toContain('returning link_written');
  });
  it('fills an explicit active digital copy without requiring a configured location or creating history/parents',async()=>{
    setup(true,null);
    const plan=await planLink(url,{ebookId:'ebook-1',workId,instanceId:copyId,method:'manual'});
    expect(plan.effect).toMatchObject({rule:'fill_copy',instanceId:copyId,editionId,newCopy:null,newEdition:null});
    expect(linkUndoEntry(plan)).toMatchObject({createdInstance:false,createdEdition:false,historyIdsCreated:[],activityIdsCreated:[]});
    await linkEbook({} as Db,plan,plan.targetDatabase);
    expect(state.writes.some((query)=>/insert into "(?:works|editions|instances|instance_status_history)"/.test(query.sql))).toBe(false);
  });
  it('composes a new copy on the selected edition with initial available history',async()=>{
    setup(true);
    const plan=await planLink(url,{ebookId:'ebook-1',workId,editionId,locationId:'other-digital',method:'manual'});
    expect(plan.effect).toMatchObject({editionId,instanceId:null,newEdition:null,newCopy:{locationId:'other-digital',status:'available'}});
    await linkEbook({} as Db,plan,plan.targetDatabase);
    expect(state.writes.some((query)=>query.sql.startsWith('insert into "instances"'))).toBe(true);
    expect(state.writes.find((query)=>query.sql.startsWith('insert into "instance_status_history"'))?.params).toContain('available');
  });
  it.each(['physical-shelf','inactive-digital','nonexistent'])('refuses a location-only choice at %s before write planning',async(locationId)=>{
    const s=setup();
    s.rows.locations=[{id:'physical-shelf',type:'physical',is_active:true},{id:'inactive-digital',type:'digital',is_active:false}];
    await expect(planLink(url,{ebookId:'ebook-1',workId,locationId,method:'manual'})).rejects.toThrow('active digital location');
    expect(state.writes).toEqual([]);
  });
  it('accepts a location-only active digital destination and preserves the work lifecycle',async()=>{
    setup(false,null);
    const plan=await planLink(url,{ebookId:'ebook-1',workId,locationId:'other-digital',method:'manual'});
    expect(plan.effect).toMatchObject({ready:true,instanceId:null,newCopy:{locationId:'other-digital',status:'available'}});
    await linkEbook({} as Db,plan,plan.targetDatabase);
    expect(state.writes.find((query)=>query.sql.startsWith('insert into "instances"'))?.params).toContain('other-digital');
    expect(state.writes.some((query)=>query.sql.startsWith('update "works"') || query.sql.startsWith('insert into "work_status_history"'))).toBe(false);
  });
  it('refuses non-finite confidence and automatic writes without a scoped precision receipt',async()=>{
    setup();await expect(planLink(url,{ebookId:'ebook-1',workId,method:'manual',probability:NaN})).rejects.toThrow();
    await expect(planLink(url,{ebookId:'ebook-1',workId,method:'score',probability:1})).rejects.toThrow('approved group');
    expect(state.writes).toEqual([]);
  });
  it('uses supplied connections through author lookup, credit resolution and slug planning',async()=>{
    setup();state.active=true;
    try{const author=await bookAuthorFor('New Person',[],state.conn as Db);expect(author.row).not.toBeNull();await resolveBookCredits([{authorName:'Another Person',role:'translator'}],[],state.conn as Db);await planBookWork({title:'Test',authorIds:[]},'New Person',{conn:state.conn as Db});}finally{state.active=false;}
    expect(state.reads).toEqual(['find-author','authors','find-author','authors','works']);
  });
  it('accessions through shared helpers with tracked author/series/work/edition/copy ids and both initial histories',async()=>{
    const s=setup();s.catalogue=catalogue({ebooks:[ebook({authors:['New Person'],series:'New Series'})],works:[],authors:[]});
    const plan=await planAccession(url,['ebook-1']);
    expect(state.active).toBe(false);expect(state.reads).toEqual(['load','authors','series','works']);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(plan.entries[0].receipt).toMatchObject({workCreated:true,createdEdition:true,createdInstance:true});
    expect(plan.entries[0].receipt.authorIdsCreated).toHaveLength(1);
    expect(plan.entries[0].receipt.seriesIdCreated).toBe(plan.series[0].id);
    await accessionEbooks({} as Db,plan,plan.targetDatabase,{beforeWrite:async()=>{state.order.push('reserved');}});
    expect(state.order).toEqual(['reserved','atomic']);
    expect(state.writes.some((query)=>query.sql.startsWith('insert into "work_status_history"') && query.params.includes('accessioned'))).toBe(true);
    expect(state.writes.some((query)=>query.sql.startsWith('insert into "instance_status_history"') && query.params.includes('available'))).toBe(true);
  });
});
