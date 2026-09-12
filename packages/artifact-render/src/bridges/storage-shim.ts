/* SPDX-License-Identifier: MIT */

/**
 * Storage shim injected into the artifact iframe's <head>.
 *
 * Why: the artifact iframe runs with the strict sandbox tokens spelled
 * out in ADR-1035 (scripts only — no same-origin privilege). In that
 * mode, any access to `localStorage` or `sessionStorage` throws
 * `SecurityError`, and the resulting exception during module
 * evaluation tears the whole DOM tree down — a "blank preview" with
 * no signal in the console other than the SecurityError itself.
 *
 * This shim probes for the native storage, and if it throws, replaces
 * both storages with in-memory objects that satisfy the same surface
 * (getItem/setItem/removeItem/clear/key/length).
 *
 * It also intercepts clicks on `a[href]` (capture phase) so the artifact
 * author can use `target="_blank"` and intra-document anchors without
 * navigating the host: anchors scroll into view, and popups open only
 * when the protocol is `http:`, `https:`, or `mailto:` — anything else
 * is swallowed to prevent the artifact from breaking out of the
 * sandbox via `javascript:` URLs, custom schemes, or the like.
 *
 * The script is exported as a string constant rather than injected from
 * a file at build time so the package stays pure (no file I/O at
 * runtime, no template loading) and the test can assert on its
 * presence/absence byte-for-byte.
 */
export const STORAGE_SHIM_SCRIPT = `<script>(function(){
  function makeStore(){
    var d={};
    return {
      getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},
      setItem:function(k,v){d[k]=String(v)},
      removeItem:function(k){delete d[k]},
      clear:function(){d={}},
      key:function(i){return Object.keys(d)[i]||null},
      get length(){return Object.keys(d).length}
    };
  }
  function install(){
    var ls=makeStore();
    var ss=makeStore();
    try{Object.defineProperty(window,'localStorage',{get:function(){return ls},configurable:true});}catch(e){}
    try{Object.defineProperty(window,'sessionStorage',{get:function(){return ss},configurable:true});}catch(e){}
  }
  try{
    var t='__unifia_probe__';
    localStorage.setItem(t,t);
    localStorage.removeItem(t);
  }catch(e){
    install();
  }
  document.addEventListener('click',function(ev){
    var el=ev.target;
    while(el&&el.nodeType===1&&el.tagName!=='A'){el=el.parentElement;}
    if(!el||el.nodeType!==1)return;
    var href=el.getAttribute('href')||'';
    if(href.charAt(0)==='#'){
      ev.preventDefault();
      var id=href.slice(1);
      var target=document.getElementById(id);
      if(target&&typeof target.scrollIntoView==='function')target.scrollIntoView();
      return;
    }
    if(el.target==='_blank'){
      try{
        var u=new URL(href,document.baseURI);
        if(u.protocol!=='http:'&&u.protocol!=='https:'&&u.protocol!=='mailto:'){ev.preventDefault();}
      }catch(e){ev.preventDefault();}
    }
  },true);
})();</script>`
