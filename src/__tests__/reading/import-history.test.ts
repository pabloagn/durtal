import { describe, expect, it } from "vitest";
import { DURTAL_EXPORT_HEADERS, DURTAL_EXPORT_HEADERS_V2, NOTE_EXPORT_COLUMNS, SESSION_EXPORT_COLUMNS } from "@/lib/export/columns";
import { toCSV, toTSV } from "@/lib/utils/export";
import { emptyDurtalExport, parseImportFile, parseUploadedFile } from "@/lib/reading/import/parse";
import { historyRow, instantCell, instantValue } from "@/lib/reading/import/history-parse";
import { importedThought, renderThought } from "@/lib/reading/import/thought";

const id = "11111111-1111-4111-8111-111111111111";
const parent = "22222222-2222-4222-8222-222222222222";
const work = "33333333-3333-4333-8333-333333333333";
const session = { session_id:id, reading_id:parent, reading_source_key:`durtal:${parent}`, edition_id:"", work_id:work, work_title:"A book", day:"1969-12-31", started_at:"1969-12-31T23:59:59.123456Z", ended_at:"1969-12-31T23:59:59.999999Z", time_zone:"Europe/Amsterdam", duration_seconds:"1", format:"ebook", source:"reader", start_percent:"25", end_percent:"50", pages_total:"200", note:"A\tline\nwith \"quotes\"", paused_seconds:"0", created_at:"1969-12-31T23:59:59.999999Z", updated_at:"1970-01-01T00:00:00.000001Z", export_version:"3" };
const rich = {type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"code",marks:[{type:"code"}]},{type:"hardBreak"},{type:"text",text:"A & B",marks:[{type:"link",attrs:{href:"https://example.com/a?x=1&y=2",target:"_blank",rel:"noopener noreferrer nofollow",class:null}}]}]}]};

describe("known empty Durtal files", () => {
  for (const [version,headers] of [[2,DURTAL_EXPORT_HEADERS_V2],[3,DURTAL_EXPORT_HEADERS]] as const) {
    it.each(Object.entries(headers))(`accepts v${version} %s headers as a named no-op in both delimiters`,(entity,columns)=>{
      for(const write of [toCSV,toTSV]) {
        const text=write([],columns);
        expect(emptyDurtalExport(text)).toBe(entity);
        expect(parseUploadedFile(text)).toMatchObject({source:"durtal",emptyEntity:entity,rows:[]});
      }
    });
  }
  it.each(["\u0000","\ud800","\udfff"])("refuses invalid Unicode in extra header names before parsing rows or accepting an empty file: %j",bad=>{
    for(const write of [toCSV,toTSV]) for(const records of [[],[session]]) {
      const text=write(records,[...SESSION_EXPORT_COLUMNS,`extra${bad}`]);
      expect(()=>parseImportFile(text)).toThrow("column name");
      expect(()=>emptyDurtalExport(text)).toThrow("column name");
    }
  });
  it("keeps blank, unknown, ambiguous and malformed files refused",()=>{
    expect(()=>emptyDurtalExport("\uFEFF\r\n")).toThrow("empty");
    expect(()=>parseUploadedFile("unknown\n")).toThrow("not a Goodreads");
    expect(()=>emptyDurtalExport([...new Set([...DURTAL_EXPORT_HEADERS.works,...DURTAL_EXPORT_HEADERS.authors])].join(","))).toThrow("combines");
    expect(()=>emptyDurtalExport('a,b\n"broken')).toThrow();
    expect(()=>parseUploadedFile(toCSV([{title:"A"}],DURTAL_EXPORT_HEADERS.works))).toThrow("Only reading history");
  });
});

describe("Durtal reading baselines",()=>{
  it("keeps starting percent separate from current percent in version 3",()=>{
    const reading={reading_id:id,work_id:work,title:"A book",status:"reading",format:"ebook",unit:"pages",total_pages:200,start_page:50,start_percent:25,start_minutes:0,current_page:160,current_percent:80,source:"manual",created_at:session.created_at,updated_at:session.updated_at,export_version:3};
    for(const write of [toCSV,toTSV]) {
      const parsed=parseImportFile(write([reading],DURTAL_EXPORT_HEADERS.readings)).rows[0];
      expect(parsed.error).toBeNull();
      expect(parsed.readings[0].restore).toMatchObject({startPage:50,startPercent:25,startMinutes:0,currentPage:160,currentPercent:80});
    }
  });
});

describe("historical session parsing",()=>{
  it.each([toCSV,toTSV])("keeps positions, multiline text, original instants and counters",write=>{
    const parsed=parseImportFile(write([session],SESSION_EXPORT_COLUMNS));
    expect(parsed.rows[0].error).toBeNull();
    expect(parsed.rows[0].history).toMatchObject({id,readingId:parent,workId:work,createdAt:session.created_at,updatedAt:session.updated_at,
      values:{start_percent:25,end_percent:50,pages_total:200,note:session.note,paused_seconds:0,started_at:session.started_at,ended_at:session.ended_at}});
  });
  it("compares negative-epoch microseconds exactly",()=>{
    expect(instantValue(session.ended_at)).toBe(BigInt(-1));
    expect(instantValue("1970-01-01T01:00:00.000001+01:00")).toBe(BigInt(1));
    expect(historyRow("sessions",{...session,ended_at:"1969-12-31T23:59:59.123455Z"}).error).toContain("before");
  });
  it.each(["0000-01-01T00:00:00Z","2023-02-29T00:00:00Z","2024-01-01T24:00:00Z","2024-01-01T00:00:00.1234567Z"])("refuses nonrepresentable instant %s",date=>{
    expect(()=>instantCell(date,"created_at")).toThrow();
  });
  it("refuses year zero days, active timers, duplicate IDs and invalid exact IDs",()=>{
    for (const day of ["0000-01-01","0000/1/1"," 0000/1/1 "," 0000-01-01 "]) expect(historyRow("sessions",{...session,day}).error).toContain("day");
    expect(historyRow("sessions",{...session,source:"timer",ended_at:""}).error).toContain("running timer");
    expect(historyRow("sessions",{...session,reading_id:"bad"}).error).toContain("reading_id");
    expect(parseImportFile(toCSV([session,session],SESSION_EXPORT_COLUMNS)).rows[1].error).toContain("Duplicate");
  });
});

describe("bounded rich thoughts",()=>{
  it("preserves code, links and line breaks with equivalent HTML and JSON",()=>{
    const html=renderThought(rich);
    expect(html).toContain("<code>code</code><br>");
    expect(importedThought({thought_html:html,thought_json:JSON.stringify(rich)}).json).toEqual(rich);
    expect(importedThought({thought_json:JSON.stringify(rich)}).html).toContain("<code>code</code>");
  });
  it("preserves block and mark formatting accepted by the note editor",()=>{
    const doc={type:"doc",content:[{type:"orderedList",attrs:{start:3},content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"both",marks:[{type:"strike"},{type:"underline"}]}]}]}]},{type:"codeBlock",attrs:{language:"typescript"},content:[{type:"text",text:"a\nb"}]},{type:"horizontalRule"}]};
    const html=renderThought(doc);
    expect(importedThought({thought_html:html,thought_json:JSON.stringify(doc)}).html).toContain('<ol start="3">');
  });
  it("refuses disagreement, unsupported nodes, inherited allowlist names and unsafe links",()=>{
    expect(()=>importedThought({thought_html:"<p>different</p>",thought_json:JSON.stringify(rich)})).toThrow("disagree");
    for(const type of ["image","toString","constructor","__proto__"]) {
      expect(()=>renderThought({type:"doc",content:[{type}]})).toThrow();
      expect(()=>renderThought({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"x",marks:[{type}]}]}]})).toThrow();
    }
    expect(()=>renderThought({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"x",marks:[{type:"link",attrs:{href:"javascript:alert(1)"}}]}]}]})).toThrow();
  });
  it("bounds old and rich thoughts, and treats present empty columns as explicit absence",()=>{
    expect(()=>importedThought({thought:"x".repeat(200001)})).toThrow("too long");
    expect(()=>importedThought({thought_html:"x".repeat(200001)})).toThrow("too long");
    expect(importedThought({thought_html:"",thought_json:"",thought:"old text"})).toEqual({html:null,json:null});
    expect(importedThought({thought:"<literal>\nnext"}).html).toBe("<p>&lt;literal&gt;<br>next</p>");
    let nested:unknown={type:"paragraph"};for(let i=0;i<40;i++) nested={type:"blockquote",content:[nested]};
    expect(()=>renderThought({type:"doc",content:[nested]})).toThrow();
  });
  it.each(["\u0000","\ud800","\udfff"])("refuses PostgreSQL-invalid text and attributes %j",bad=>{
    expect(()=>importedThought({thought:bad})).toThrow();
    expect(()=>renderThought({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:bad}]}]})).toThrow();
    expect(()=>renderThought({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"a",marks:[{type:"link",attrs:{href:"https://example.com",rel:bad}}]}]}]})).toThrow();
    const row=historyRow("sessions",{...session,note:bad});
    expect(row.error).toContain("cannot store");
    expect(JSON.stringify(row)).not.toContain(bad);
  });
  it("parses quote-only rich content and retains literal note bodies",()=>{
    const note={note_id:id,work_id:work,kind:"quote",body:"  a\tpassage\nkept  ",source:"manual",thought_html:renderThought(rich),thought_json:JSON.stringify(rich)};
    expect(parseImportFile(toTSV([note],NOTE_EXPORT_COLUMNS)).rows[0].history?.values.body).toBe(note.body);
    expect(historyRow("notes",{...note,kind:"note"}).error).toContain("Only quotes");
  });
});
