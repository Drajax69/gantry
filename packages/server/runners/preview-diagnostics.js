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
  const network = (method, url, status, started, type, error) => emit({kind:'network',method,url:String(url).slice(0,8000),status,duration:Math.round((performance.now()-started)*10)/10,requestType:type,...(error ? {error:text(error)} : {})});
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const started = performance.now();
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    return Reflect.apply(originalFetch, this, arguments).then(response => { network(method,url,response.status,started,'fetch'); return response; }, error => { network(method,url,0,started,'fetch',error); throw error; });
  };
  const requests = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method,url) { requests.set(this,{method:String(method),url:String(url)}); return Reflect.apply(originalOpen,this,arguments); };
  XMLHttpRequest.prototype.send = function() {
    const started = performance.now();
    const request = requests.get(this) || {method:'GET',url:''};
    const done = () => { this.removeEventListener('loadend',done); network(request.method,request.url,this.status,started,'xhr',this.status === 0 ? 'Request failed or was aborted' : undefined); };
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
