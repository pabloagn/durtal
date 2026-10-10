import {describe,it,expect,vi} from 'vitest';
import {drizzle} from 'drizzle-orm/postgres-js';
import {getTableName,type SQL} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {Db} from '@/lib/catalogue/work-store';
vi.mock('@/lib/db',()=>({db:new Proxy({},{get(){throw new Error('Global database forbidden');}})}));
const state=vi.hoisted(()=>({loaded:null as unknown,active:false,reads:[] as string[],writes:[] as {sql:string;params:unknown[]}[],order:[] as string[],conn:null as unknown}));
vi.mock('@/lib/ebooks/match/load',async(importActual)=>({...await importActual<object>(),loadMatchCatalogue:async(conn:unknown)=>{if(!state.active || conn!==state.conn)throw new Error('Escaped planning connection');state.reads.push('load');return state.loaded;}}));
vi.mock('@/lib/enrichment/read-only-session',()=>({withReadOnlyPlanningConnection:async(_url:string,callback:(conn:unknown)=>unknown,options:{isolationLevel:string})=>{expect(options.isolationLevel).toBe('repeatable read');state.active=true;try{return await callback(state.conn);}finally{state.active=false;}}}));
vi.mock('@/lib/db/atomic',()=>({atomicOn:async(_conn:unknown,build:(d:unknown)=>unknown[])=>{state.order.push('atomic');const dialect=new PgDialect();state.writes.push(...build(drizzle.mock()).map((query)=>dialect.sqlToQuery((query as {getSQL():SQL}).getSQL())));return [];}}));
vi.mock('@/lib/enrichment/queue',()=>({BULK_ACCESSION_PRIORITY:200,queueNewBookEnrichment:async()=>({ok:true,jobs:[]})}));
import {planLink,linkEbook,linkUndoEntry} from '@/lib/ebooks/match/link';
import {planAccession,accessionEbooks} from '@/lib/ebooks/match/accession';
import {bookAuthorFor,resolveBookCredits,planBookWork} from '@/lib/catalogue/book-store';
import {MATCH_TABLES,type LoadedMatchCatalogue} from '@/lib/ebooks/match/load';
import {catalogue,ebook,work,edition,copy,at} from './fixtures';
const url='postgres://localhost/sln495_source';
const workId='10000000-0000-4000-8000-000000000001',editionId='20000000-0000-4000-8000-000000000001',copyId='30000000-0000-4000-8000-000000000001';
function setup(hasCopy=false,configured:string|null='ebooks-location'){
  state.reads.length=0;state.writes.length=0;state.order.length=0;
  const e=edition({id:editionId,workId}),c=copy({id:copyId,editionId,locationId:'other-digital'}),w=work({id:workId,editions:hasCopy?[e]:[],copies:hasCopy?[c]:[]}),input=ebook();
  state.loaded={catalogue:catalogue({ebooks:[input],works:[w],ebookLocationId:configured,digitalLocationIds:['ebooks-location','other-digital']}),rows:{...Object.fromEntries(MATCH_TABLES.map((table)=>[table,[]])),ebooks:[{id:input.id,match_state:'pending',updated_at:at}],instances:hasCopy?[{id:copyId,edition_id:editionId,updated_at:at}]:[]},catalogueFingerprint:'a'.repeat(64),inputFingerprint:'b'.repeat(64)} as unknown as LoadedMatchCatalogue;
  const assert=()=>{if(!state.active)throw new Error('Escaped transitive planning read');};
  state.conn={select:(columns:Record<string,unknown>)=>{assert();return {from:(table:Parameters<typeof getTableName>[0])=>{assert();const name=getTableName(table);state.reads.push(name);const rows=name==='works' && 'id' in columns ? [{id:workId}] : [];const chain={where:()=>chain,limit:async()=>{assert();return rows;},then:(resolve:(rows:unknown)=>unknown)=>{assert();return Promise.resolve(rows).then(resolve);}};return chain;}};},query:{authors:{findFirst:async()=>{assert();state.reads.push('find-author');return undefined;}}}};
  return state.loaded as LoadedMatchCatalogue;
}
describe('shared guarded matching writers',()=>{
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
