"""SLN-497 valid medallion fixtures for the disposable preview only."""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import uuid
import zipfile

NAMESPACE = uuid.UUID("3b62bb98-b0e4-4d37-b158-c5e633e151ba")


def ident(kind, number):
    return str(uuid.uuid5(NAMESPACE, f"{kind}-{number}"))


def text(value):
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def serialized(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def sized_object(key, payload, content_type):
    return {"key": key, "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload), "contentType": content_type}


def cover_widths(root, image):
    """The existing sharp dependency converts the fixture artwork once, before the loop."""
    script = """const sharp=require('sharp');let chunks=[];process.stdin.on('data',b=>chunks.push(b));process.stdin.on('end',async()=>{try{const image=Buffer.concat(chunks);const out={};for(const w of [240,400,800])out[w]=(await sharp(image).resize({width:w}).webp().toBuffer()).toString('base64');process.stdout.write(JSON.stringify(out));}catch(e){process.stderr.write(String(e));process.exitCode=1;}});"""
    result = subprocess.run(["node", "-e", script], cwd=root, input=image, capture_output=True, check=True)
    return {int(width): base64.b64decode(payload) for width, payload in json.loads(result.stdout).items()}


def ebook_library_seed(root, s3_dir, count):
    """Writes valid fixture bytes under real hashes; returns guarded disposable SQL without executing it."""
    if count < 1 or count > 100000:
        raise ValueError("--ebooks must be between 1 and 100000")
    root, s3_dir = Path(root), Path(s3_dir)
    source = (root / "src/__tests__/fixtures/ebooks/epub3.epub").read_bytes()
    protected_source = (root / "src/__tests__/fixtures/ebooks/drm.epub").read_bytes()
    with zipfile.ZipFile(io.BytesIO(source)) as archive:
        image_name = next(name for name in archive.namelist() if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
        artwork = archive.read(image_name)
    covers = cover_widths(root, artwork)
    bucket = s3_dir.resolve() / "durtal"
    def write(key, payload):
        destination = bucket / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
    location, author = ident("location", 0), ident("author", 0)
    lines = ["""do $$ begin
      if current_database() <> 'durtal_preview' then raise exception 'eBook seed requires durtal_preview'; end if;
    end $$;""", "begin;",
      f"insert into locations(id,name,type) select '{location}','eBooks','digital' where not exists(select 1 from locations where name='eBooks' and type='digital');",
      f"insert into authors(id,name,slug) values('{author}','Seed Library Author','seed-library-author');"]
    for number in range(1, count + 1):
        ebook, file_id = ident("ebook", number), ident("file", number)
        title = f"Seed Library Book {number}" + (" with a long title that wraps over several lines" if number % 17 == 0 else "")
        language = ["en", "fr", "es"][number % 3]
        state = "linked" if number % 3 == 0 else "standalone" if number % 5 == 0 else "pending"
        if number == 4:
            state = "excluded"
        drm = "adobe-adept" if number == 5 else None
        status = "quarantined" if number == 7 else "missing" if number == 6 else "stored"
        payload = io.BytesIO(protected_source if drm else source)
        # A valid per-book ZIP comment gives each file a real unique checksum without pretending shared bytes differ.
        with zipfile.ZipFile(payload, "a") as archive:
            archive.comment = ebook.encode()
        original = payload.getvalue() if status != "quarantined" else bytes([80, 75, 3, 4]) + b"Damaged central directory fixture"
        checksum = hashlib.sha256(original).hexdigest()
        folder = f"ebooks/epub/{checksum[:2]}/{checksum}"
        bronze = sized_object(f"bronze/{folder}/source.epub", original, "application/epub+zip")
        write(bronze["key"], original)
        approved = status != "quarantined" and not drm
        validation = {"integrity": "verified" if status != "quarantined" else "unverified",
          "drm": "protected" if drm else "clear", "downloadable": bool(approved), "nativeReadable": bool(approved),
          "reason": "DRM fixture" if drm else "Central directory missing" if status == "quarantined" else None}
        artifacts = [{"name": f"cover-{width}.webp", "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "contentType": "image/webp"}
                     for width, data in covers.items()] if approved else []
        report_bytes = serialized({"version": 2, "source": bronze, "validation": validation, "metadata": {"title": title}, "artifacts": artifacts})
        report_hash = hashlib.sha256(report_bytes).hexdigest()
        silver = sized_object(f"silver/{folder}/v2/{report_hash}.json", report_bytes, "application/json")
        write(silver["key"], report_bytes)
        gold = []
        if approved:
            gold.append(sized_object(f"gold/{folder}/file.epub", original, "application/epub+zip"))
            if status != "missing":
                write(gold[0]["key"], original)
            for width, data in covers.items():
                key = f"gold/{folder}/derived/v2/{report_hash}/cover-{width}.webp"
                write(key, data)
                gold.append(sized_object(key, data, "image/webp"))
            marker_bytes = serialized({"title": title, "medallion": {"version": 2, "bronze": bronze, "silver": silver, "validation": validation, "artifacts": gold}})
            marker = sized_object(f"gold/{folder}/derived/v2/{report_hash}/manifest.json", marker_bytes, "application/json")
            write(marker["key"], marker_bytes)
            gold.append(marker)
        metadata = {"medallion": {"version": 2, "bronze": bronze, "silver": silver, "validation": validation, "gold": gold}}
        instance = None
        if state == "linked":
            work, edition, instance = ident("work", number), ident("edition", number), ident("instance", number)
            lines += [
              f"insert into works(id,kind,title,slug) values('{work}','book',{text(title)},'seed-library-book-{number}');",
              f"insert into work_authors(work_id,author_id) values('{work}','{author}');",
              f"insert into editions(id,work_id,title,language,publisher) values('{edition}','{work}',{text(title)},'{language}','Seed Press');",
              f"insert into instances(id,edition_id,location_id,format) select '{instance}','{edition}',id,'epub' from locations where name='eBooks' and type='digital' limit 1;"]
        cover = next((object["key"] for object in gold if object["key"].endswith("cover-800.webp")), None)
        marker_key = gold[-1]["key"] if gold else None
        stored_key = gold[0]["key"] if gold else bronze["key"]
        lines += [
          f"insert into ebooks(id,title,authors,author_sort,language,match_state,instance_id,import_source,import_ref,search_text,cover_key) values('{ebook}',{text(title)},array['Seed Library Author'],'Author, Seed Library','{language}','{state}',{text(instance)},'folder','seed-library-{number}',search_normalize({text(title + ' Seed Library Author')}),{text(cover)});",
          f"insert into ebook_files(id,ebook_id,sha256,s3_key,format,size_bytes,content_type,status,drm,metadata,manifest_key,cover_key) values('{file_id}','{ebook}','{checksum}','{stored_key}','epub',{len(original)},'application/epub+zip','{status}',{text(drm)},{text(serialized(metadata).decode())}::jsonb,{text(marker_key)},{text(cover)});"]
        if approved and status == "stored":
            lines.append(f"update ebooks set preferred_file_id='{file_id}' where id='{ebook}';")
            if number <= 20 and state != "excluded":
                locator = {"v": 1, "fileHash": checksum, "href": "OEBPS/chapter1.xhtml", "sectionIndex": 0, "progression": 0.2, "totalProgression": 0.44}
                lines.append(f"insert into ebook_positions(ebook_id,file_id,device_id,device_label,locator,progression,furthest_progression,chapter,client_updated_at) values('{ebook}','{file_id}','{ident('device', 0)}','Seed phone · Safari',{text(serialized(locator).decode())}::jsonb,0.44,0.44,'Chapter I',now() - interval '{number} hours');")
    lines += ["commit;", "analyze ebooks;", "analyze ebook_files;", "analyze ebook_positions;"]
    return "\n".join(lines)
