// Proposed new ebook-only viewer-request function. Never rewrites signed paths.
var FORMATS = {"epub":"epub","kepub":"kepub","pdf":"pdf","mobi":"mobi","azw":"azw","azw3":"azw3","kfx":"kfx","fb2":"fb2","fbz":"fbz","cbz":"cbz","cbr":"cbr","djvu":"djvu","txt":"txt","rtf":"rtf","docx":"docx","lit":"lit","chm":"chm","other":"bin"};
var DERIVED = {"cover-240.webp":1,"cover-400.webp":1,"cover-800.webp":1,"manifest.json":1};
function accepted(uri) {
  var m = /^\/gold\/ebooks\/([a-z0-9]+)\/([a-f0-9]{2})\/([a-f0-9]{64})\/(.+)$/.exec(uri);
  if (m) {
    if (!Object.prototype.hasOwnProperty.call(FORMATS, m[1])) return false;
    var ext = FORMATS[m[1]];
    if (!ext || m[2] !== m[3].slice(0,2)) return false;
    if (m[4] === 'file.' + ext) return true;
    var derived = /^derived\/v2\/([a-f0-9]{64})\/(cover-(?:240|400|800)\.webp|manifest\.json)$/.exec(m[4]);
    return !!derived;
  }
  m = /^\/files\/([a-f0-9]{2})\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(uri);
  if (m && m[1] === m[2].slice(0,2)) {
    for (var f in FORMATS) if (FORMATS[f] === m[3]) return true;
  }
  m = /^\/derived\/([a-f0-9]{64})\/(cover-(?:240|400|800)\.webp|manifest\.json)$/.exec(uri);
  return !!m;
}
function denied() {
  return {statusCode:403,statusDescription:'Forbidden',headers:{'cache-control':{value:'no-store'},'x-content-type-options':{value:'nosniff'}}};
}
function handler(event) {
  var request = event.request;
  if (!accepted(request.uri)) return denied();
  if (request.method === 'GET' || request.method === 'HEAD') return request;
  if (request.method !== 'OPTIONS') return denied();
  var h = request.headers;
  var method = h['access-control-request-method'];
  var headers = h['access-control-request-headers'];
  if (!h.origin || !method || !/^(GET|HEAD)$/.test(method.value)) return denied();
  if (headers && headers.value.trim() !== '' && !/^range$/i.test(headers.value.trim())) return denied();
  return {statusCode:204,statusDescription:'No Content',headers:{
    'access-control-allow-origin':{value:'*'},
    'access-control-allow-methods':{value:'GET, HEAD, OPTIONS'},
    'access-control-allow-headers':{value:'Range'},
    'access-control-max-age':{value:'86400'},
    'cache-control':{value:'no-store'},
    'x-content-type-options':{value:'nosniff'}
  }};
}
