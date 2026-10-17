// Runs only in Gantry-managed preview pages. Entries stay in browser memory.
(() => {
  if (window.parent === window || window.__gantryDiagnostics) return;
  window.__gantryDiagnostics = true;
  let port = null;
  let sequence = 0;
  const entries = [];
  const text = value => {
    try {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value.slice(0, 8000);
      const seen = new WeakSet();
      return (JSON.stringify(value, (_, item) => {
        if (typeof item === 'bigint') return String(item);
        if (typeof item === 'object' && item !== null) { if (seen.has(item)) return '[Circular]'; seen.add(item); }
        return item;
      }) ?? String(value)).slice(0, 8000);
    } catch { return '[Unserializable value]'; }
  };
  const emit = entry => {
    try {
      const record = { ...entry, id: ++sequence, time: Date.now() };
      entries.push(record); if (entries.length > 500) entries.shift();
      port?.postMessage({type:'entry', entry:record});
      return record;
    } catch { /* Diagnostics must never interrupt the app. */ }
  };
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'gantry-diagnostics-connect' || !event.ports[0]) return;
    try { const origin = new URL(event.origin); if (origin.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) return; } catch { return; }
    port?.close(); port = event.ports[0];
    port.postMessage({type:'snapshot', entries});
  });
  for (const level of ['log','info','warn','error','debug','trace','table']) {
    const original = console[level];
    console[level] = function(...args) { emit({kind:'console',level,message:args.map(text).join(' ')}); return Reflect.apply(original, console, args); };
  }
  addEventListener('error', event => { if (event.message) emit({kind:'console',level:'error',message:`${event.message}\n${event.filename || ''}:${event.lineno || ''}`}); });
  addEventListener('unhandledrejection', event => emit({kind:'console',level:'error',message:`Unhandled rejection: ${text(event.reason)}`}));
  const limit = 16384;
  const clip = value => String(value).length > limit ? String(value).slice(0,limit) + '\n[Truncated at 16 KB]' : String(value);
  const headers = value => { try { return clip([...new Headers(value).entries()].map(([k,v]) => k + ': ' + v).join('\n')) || '(No headers exposed)'; } catch { return '(Headers unavailable)'; } };
  const body = value => {
    if (value == null) return '(Empty body)';
    if (typeof value === 'string' || value instanceof URLSearchParams) return clip(value);
    if (value instanceof FormData) return clip([...value.entries()].map(([k,v]) => k + ': ' + (typeof v === 'string' ? v : '[File: ' + v.name + ', ' + v.size + ' bytes]')).join('\n'));
    if (value instanceof Blob) return '[Binary body: ' + value.size + ' bytes]';
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return '[Binary body: ' + value.byteLength + ' bytes]';
    return '(Streaming body not captured)';
  };
  const readBody = async message => {
    if (!message.body) return '(Empty body)';
    const type = message.headers.get('content-type') || '';
    if (type && !/json|text|xml|javascript|urlencoded/.test(type)) { void message.body.cancel().catch(() => {}); return '(Binary body not captured)'; }
    const reader = message.body.getReader();
    const decoder = new TextDecoder();
    let result = '', size = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 3000);
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        const remaining = limit - size;
        result += decoder.decode(value.subarray(0, remaining), {stream:true});
        size += value.byteLength;
        if (size >= limit) { result += '\n[Truncated at 16 KB]'; break; }
      }
      return (result + decoder.decode() + (timedOut ? '\n[Capture timed out]' : '')) || '(Empty body)';
    } catch { return '(Body unavailable)'; }
    finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
  };
  const update = (record, patch) => {
    if (!record || !entries.includes(record)) return;
    Object.assign(record,patch);
    try { port?.postMessage({type:'update',entry:record}); } catch {}
  };
  const network = (method, url, status, started, type, details, error) => emit({kind:'network',method,url:String(url).slice(0,8000),status,duration:Math.round((performance.now()-started)*10)/10,requestType:type,...details,...(error ? {error:text(error)} : {})});
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const started = performance.now();
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const requestHeaders = headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    let requestBody = Promise.resolve(body(init?.body));
    try { if (init?.body === undefined && input instanceof Request) requestBody = readBody(input.clone()); } catch { requestBody = Promise.resolve('(Body unavailable)'); }
    return Reflect.apply(originalFetch, this, arguments).then(response => {
      const record = network(method,url,response.status,started,'fetch',{requestHeaders,responseHeaders:headers(response.headers),requestBody:'Loading…',responseBody:'Loading…'});
      let responseBody;
      try { responseBody = readBody(response.clone()); } catch { responseBody = Promise.resolve('(Body unavailable)'); }
      void Promise.all([requestBody,responseBody]).then(([requestBody,responseBody]) => update(record,{requestBody,responseBody})).catch(() => {});
      return response;
    }, error => {
      const record = network(method,url,0,started,'fetch',{requestHeaders,responseBody:'(No response received)'},error);
      void requestBody.then(requestBody => update(record,{requestBody})).catch(() => {});
      throw error;
    });
  };
  const requests = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method,url) { const result = Reflect.apply(originalOpen,this,arguments); requests.set(this,{method:String(method),url:String(url),headers:[]}); return result; };
  XMLHttpRequest.prototype.setRequestHeader = function(name,value) { const result = Reflect.apply(originalSetHeader,this,arguments); requests.get(this)?.headers.push(String(name) + ': ' + String(value)); return result; };
  XMLHttpRequest.prototype.send = function(value) {
    const started = performance.now();
    const request = requests.get(this) || {method:'GET',url:'',headers:[]};
    const requestBody = body(value);
    const done = () => {
      this.removeEventListener('loadend',done);
      let responseBody = '(Body unavailable)', responseHeaders = '(Headers unavailable)';
      try {
        responseHeaders = clip(this.getAllResponseHeaders()) || '(No headers exposed)';
        responseBody = this.responseType === 'json' ? clip(JSON.stringify(this.response,null,2)) : !this.responseType || this.responseType === 'text' ? clip(this.responseText) || '(Empty body)' : '(Binary body not captured)';
      } catch {}
      network(request.method,request.url,this.status,started,'xhr',{requestHeaders:clip(request.headers.join('\n')) || '(No headers set)',requestBody,responseHeaders,responseBody},this.status === 0 ? 'Request failed or was aborted' : undefined);
    };
    this.addEventListener('loadend',done);
    try { return Reflect.apply(originalSend,this,arguments); } catch (error) { this.removeEventListener('loadend',done); throw error; }
  };
  try {
    new PerformanceObserver(list => {
      for (const item of list.getEntries()) {
        if (['fetch','xmlhttprequest'].includes(item.initiatorType)) continue;
        emit({kind:'network',method:'GET',url:item.name.slice(0,8000),status:item.responseStatus || null,duration:Math.round(item.duration*10)/10,requestType:item.initiatorType || 'resource'});
      }
    }).observe({type:'resource',buffered:true});
  } catch { /* Resource Timing is optional. Fetch and XHR still work. */ }
})();
